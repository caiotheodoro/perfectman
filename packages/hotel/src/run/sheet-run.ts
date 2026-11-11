import { loadSlimKbFromEnv } from "@perfectman/server/hotel";
import type { BeatSheet, CameraIntent, SheetBeat, SpaceView } from "@perfectman/shared";
import { settleSheetDrama } from "../authoring/beat-sheet.js";
import { buildSheetLinks, sheetMode } from "../authoring/beat-sheet-links.js";
import { generateBeatSheet } from "../authoring/beat-sheet-generate.js";
import type { SheetBrief } from "../authoring/beat-sheet-generate.js";
import type { RunDrama } from "../authoring/scenario-drama.js";
import type { Clock } from "../clock/clock.js";
import type { HotelConfig } from "../config.js";
import { SheetNotes } from "../director/drama/sheet-notes.js";
import { SheetPlayer } from "../director/drama/sheet-player.js";
import type { SheetReport, SheetSummary } from "../director/drama/sheet-player.js";
import type { DramaDecisionPort } from "../director/drama/ports.js";
import { planBlock, planFace, planProp } from "../embodiment/sheet-stage.js";
import type { StageCtx } from "../embodiment/sheet-stage.js";
import type { PlannedCommand } from "../embodiment/types.js";
import type { GatewayExecutor } from "../gateway/hotel-gateway.js";
import type { Logger } from "../util/log.js";
import type { ScenarioBody } from "./scenario-body.js";

/**
 * The beat sheet inside a run (Contract A): what `Run` hands over and gets back, so the run itself only starts it, asks it for the actors' note and stops it.
 * `SheetRuntime` owns the sheet's player, its notes, the authored silence and the stage hooks (blocking, props, faces), each done through the run's own body
 * commands; `ensureSheet` writes a sheet at run start for a scenario compiled without one, inside the 25 s the contract allows.
 */

export type SheetHost = {
  run: number;
  clock: Clock;
  rng: () => number;
  logger: Logger;
  /** The run's mirror, only for `view`. */
  view(ref: string, now: number): SpaceView | undefined;
  /** Where body commands go (the cinematic wrapper in a cinematic run). */
  send(cmds: PlannedCommand[]): void;
  isOwn(ref: string): boolean;
  isGone(ref: string): boolean;
  port(): DramaDecisionPort | undefined;
  drama: RunDrama;
  wireOf(ref: string): number | undefined;
  walkCloser?(actor: string, target: string): boolean;
  record?(kind: string, data: Record<string, unknown>): void;
  /** The cinematic director's seam for the sheet's camera intent (B4); absent: the intent is logged and recorded and nothing moves. */
  camera?(intent: CameraIntent, beat: Extract<SheetBeat, { kind: "camera" }>): void;
  names: ReadonlyMap<string, string>;
  language: "pt-BR" | "en";
  /** Wire faces the hotel has beyond the old six (`fear`, `disgust`, `smug` once the hotel offers them). */
  nativeFaces?: readonly string[];
};

const PAUSE_RELEASE_GAP_MS = 1_200;

export class SheetRuntime {
  readonly notes: SheetNotes;
  private readonly player: SheetPlayer;
  private startedAt = 0;
  private holdUntil = 0;
  private readonly held: Array<() => void> = [];
  private releasing = false;
  private readonly outcomes = { played: 0, dropped: new Map<string, number>() };

  constructor(readonly sheet: BeatSheet, private readonly h: SheetHost) {
    this.notes = new SheetNotes(sheet, h.names, h.language);
    this.player = new SheetPlayer({
      clock: h.clock,
      port: () => h.port(),
      sheet,
      drama: h.drama,
      wireOf: (ref) => h.wireOf(ref),
      ...(h.walkCloser ? { walkCloser: h.walkCloser } : {}),
      logger: h.logger,
      stage: {
        block: (b) => this.stage(b.actor, b.id, (ctx) => planBlock(b.to, b.how, ctx)),
        prop: (b) => this.stage(b.actor, b.id, (ctx) => planProp(b.op, b.prop, b.to, ctx)),
        expression: (actor, face) => {
          if (h.isGone(actor)) return false;
          h.send(planFace(actor, face, h.nativeFaces));
          return true;
        },
        camera: (intent, beat) => {
          h.record?.("sheet_camera", { beat: beat.id, intent });
          h.logger.info("beat sheet camera", { run: h.run, beat: beat.id, ...intent });
          h.camera?.(intent, beat);
        },
        pause: (ms, beat) => {
          this.holdUntil = Math.max(this.holdUntil, h.clock.now() + ms);
          h.record?.("sheet_pause", { beat: beat.id, ms });
        },
      },
      onReport: (r) => this.onReport(r),
    });
  }

  /** The scenario's seconds count from here, as the script's do. */
  start(): void {
    this.startedAt = this.h.clock.now();
    this.player.start();
  }

  stop(): void {
    this.player.stop();
    this.held.length = 0;
  }

  /** The actor's note at `now`: the sheet's own, which replaces the spine's. */
  craft(actor: string, now: number): string | undefined {
    return this.notes.textFor(actor, now - this.startedAt);
  }

  summary(): SheetSummary {
    return this.player.summary();
  }

  /** `beats_played` / `beats_dropped_<why>` for the run's counters. */
  counters(): Record<string, number> {
    const out: Record<string, number> = { beats_played: this.outcomes.played, beats_dropped: [...this.outcomes.dropped.values()].reduce((a, b) => a + b, 0) };
    for (const [why, n] of this.outcomes.dropped) out[`beats_dropped_${why.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`] = n;
    const c = this.player.summary().climax;
    if (c.at_ms !== undefined) out["beat_sheet_climax_ms"] = c.at_ms;
    return out;
  }

  private onReport(r: SheetReport): void {
    if (r.outcome === "played") this.outcomes.played += 1;
    else this.outcomes.dropped.set(r.why, (this.outcomes.dropped.get(r.why) ?? 0) + 1);
    this.h.record?.("sheet_beat", { beat: r.beat.id, kind: r.beat.kind, phase: r.beat.phase, outcome: r.outcome, why: r.why, ...(r.late ? { late: true } : {}) });
  }

  /** One stage hook: plan the commands for the actor in its room, send them. False when it cannot be placed or there is nowhere to go (the player releases it late once). */
  private stage(actor: string, beatId: string, plan: (ctx: StageCtx) => PlannedCommand[] | undefined): boolean {
    if (this.h.isGone(actor) || !this.h.isOwn(actor)) return false;
    const now = this.h.clock.now();
    const view = this.h.view(actor, now);
    const room = view?.room;
    if (!view || !room || room.stale) return false;
    const ctx: StageCtx = {
      room,
      self: actor,
      rng: this.h.rng,
      tileOf: (ref) => room.occupants.find((p) => p.ref === ref)?.tile,
      isPerson: (ref) => this.h.isOwn(ref) || room.occupants.some((p) => p.ref === ref),
      now,
      plan: `drama:sheet:${beatId}`,
    };
    const cmds = plan(ctx);
    if (cmds === undefined) return false;
    if (cmds.length > 0) this.h.send(cmds);
    return true;
  }

  // ---- authored silence ---------------------------------------------------------------------------------------

  /**
   * Wraps the run's outgoing executor: while a `pause` beat holds, the actors' lines and typing wait, and are released one at a time after it. Everything else (walks, faces, acts)
   * passes. A hold only delays: nothing is dropped and no line is ever invented.
   */
  wrap(inner: GatewayExecutor): GatewayExecutor {
    const isSpeech = (c: PlannedCommand): boolean => c.cmd === "chat" || c.cmd === "typing";
    const holding = (): boolean => this.h.clock.now() < this.holdUntil;
    return {
      send: (cmds) => {
        if (!holding()) return inner.send(cmds);
        const pass = cmds.filter((c) => !isSpeech(c));
        const wait = cmds.filter(isSpeech).filter((c) => c.cmd !== "typing");
        if (pass.length > 0) inner.send(pass);
        for (const c of wait) this.hold(() => inner.send([c]));
      },
      ...(inner.sendChat
        ? {
            sendChat: (cmd) => {
              if (!holding()) return inner.sendChat!(cmd);
              this.hold(() => void inner.sendChat!(cmd));
              return true;
            },
          }
        : {}),
      sendThought: (agentId, text) => inner.sendThought(agentId, text),
    };
  }

  private hold(release: () => void): void {
    this.held.push(release);
    if (this.releasing) return;
    this.releasing = true;
    const next = (): void => {
      const now = this.h.clock.now();
      if (now < this.holdUntil) {
        this.h.clock.setTimer(next, this.holdUntil - now);
        return;
      }
      const one = this.held.shift();
      if (!one) {
        this.releasing = false;
        return;
      }
      one();
      this.h.clock.setTimer(next, PAUSE_RELEASE_GAP_MS);
    };
    this.h.clock.setTimer(next, Math.max(0, this.holdUntil - this.h.clock.now()));
  }
}

// ---- writing a sheet at run start ------------------------------------------------------------------------------------

/** Why a scenario gets no sheet at all (the old spine plays), or undefined when it should have one. */
export function sheetIneligible(body: ScenarioBody, drama: RunDrama, hasDirector: boolean): string | undefined {
  if (body.config.agents.length < 2) return "single_actor";
  if (drama.off) return "drama_off";
  if ((body.beats?.length ?? 0) > 0) return "authored_beats";
  if (!hasDirector) return "no_director";
  return undefined;
}

export function briefOfBody(body: ScenarioBody): SheetBrief {
  const agents = body.config.agents;
  const first = agents[0]?.promptProfile;
  return {
    title: body.title,
    situation: first?.scenarioContext?.roomContext ?? "",
    language: first?.language === "en" ? "en" : "pt-BR",
    cast: agents.map((a) => ({ id: a.id, name: a.promptProfile.displayName, objective: a.promptProfile.hiddenObjective })),
    drama: body.drama_mode === "default" || body.drama === undefined ? "derive" : body.drama,
  };
}

/**
 * A scenario compiled before the director step existed (or while it was off or failing) has no sheet: with `PERFECTMAN_BEAT_SHEET_LAZY=1` (or `PERFECTMAN_BEAT_SHEET=mock`) write one now,
 * with the contract's 25 s and $0.30, so a saved scenario needs no re-save to get its arc. On success the body comes back with `beat_sheet` and a `drama` block widened just enough to cover it; on failure the body
 * is returned as it was and the reason is the run's `beat_sheet_fallback`. Never throws.
 */
export async function ensureSheet(body: ScenarioBody, o: { hotel: HotelConfig; drama: RunDrama; hasDirector: boolean; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; logger: Logger; run: number }): Promise<{ body: ScenarioBody; fallback?: string }> {
  if (body.beat_sheet) return { body };
  const env = o.env ?? process.env;
  const skip = sheetIneligible(body, o.drama, o.hasDirector);
  if (skip) return { body, fallback: skip };
  const mode = sheetMode(o.hotel.llm.provider, (n) => env[n]);
  if (mode === "off") return { body, fallback: body.beat_sheet_error ?? "generator_off" };
  // Off unless asked for: it holds the run's start for up to 25 s and spends the model's money, so the host opts in (`PERFECTMAN_BEAT_SHEET_LAZY=1`). The compile writes the sheet by default.
  if (env["PERFECTMAN_BEAT_SHEET_LAZY"]?.trim() !== "1" && mode !== "mock") return { body, fallback: body.beat_sheet_error ?? "absent" };
  const links = mode === "llm" ? buildSheetLinks({ llm: o.hotel.llm, env: (n) => env[n], model: env["PERFECTMAN_BEATSHEET_MODEL"], extraBody: env["PERFECTMAN_BEATSHEET_EXTRA_BODY"], price: env["PERFECTMAN_BEATSHEET_PRICE"] }) : [];
  try {
    const result = await generateBeatSheet(briefOfBody(body), { links, mock: mode === "mock", kb: loadSlimKbFromEnv({ env, warn: (m) => o.logger.warn(m) }) ?? null, deadlineMs: 25_000, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
    if (!result.ok) return { body, fallback: `${result.reason}: ${result.detail}`.slice(0, 200) };
    const settled = settleSheetDrama(result.sheet, body.drama, body.drama_mode);
    const next: ScenarioBody = { ...body, beat_sheet: result.sheet };
    delete next.beat_sheet_error;
    if (settled) {
      next.drama = settled.drama;
      if (settled.drama_mode) next.drama_mode = settled.drama_mode;
      else delete next.drama_mode;
    }
    o.logger.info("beat sheet written at run start", { run: o.run, model: result.model, cost_usd: result.cost_usd, ms: result.ms, attempts: result.attempts, beats: result.sheet.beats.length, climax_at_ms: result.sheet.arc.climax_at_ms });
    return { body: next };
  } catch (err) {
    return { body, fallback: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200) };
  }
}
