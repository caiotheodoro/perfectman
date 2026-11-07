/**
 * Embodiment probes (docs/embodiment.md section 10). They read a wall-clock
 * `BodyFrameLog` (frames in both directions plus periodic space snapshots),
 * not the pulse-indexed `BehavioralEvent` stream, and return the same
 * `ProbeResult` shape as the existing probes. Bands are calibration-pending
 * seeds, like every band in `PROBE_BANDS`.
 *
 * Frame kinds read (written by the fake grid hotel, and by the hotel's frame
 * recorder): out `actor_cmd {agentId, cmd, plan?, stale}`; in `moves
 * {agentId, tile, dir}`, `moved_room`, `walk_started {agentId, planId}`,
 * `arrived {agentId, planId}`, `avatar_state {agentId, state, seatId?}`,
 * `avatar_action {agentId, a}`, `actor_error {agentId, code}`, `chat
 * {agentId, mode, toRef?, sameRoom?, distance?}`, `human_chat {ref, toRef?}`.
 */
import { SAY_CLEAR_TILES, chebyshev, facingKind } from "@perfectman/engine";
import type { BodyFrame, BodyFrameLog, Direction8, Tile } from "@perfectman/shared";
import { checkProbe, PROBE_BANDS, type ProbeResult } from "./types.js";

const TICK_MS = 300;
const JITTER_WINDOW_MS = 20_000;
const FACING_CHECK_AFTER_MS = 3_000;
const TEN_MINUTES_MS = 600_000;
/** Errors the hotel (or Tilehouse) refused an accepted command with, as opposed to rate limiting. */
const RATE_CODES = new Set(["slow_down", "chat_limit"]);

export type EmbodimentProbeInput = {
  log: BodyFrameLog;
  /** Actor refs; humans are not judged. */
  actorIds: readonly string[];
  /** Zone of a tile, for the spread index. Default: 4x4 tile cells. */
  zoneOf?: (room: string, tile: Tile) => string;
  /** Rendered prompts (system + user), for the identity lint. */
  prompts?: readonly string[];
};

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const framesOf = (log: BodyFrameLog, kind: string, dir?: "in" | "out"): BodyFrame[] =>
  log.frames.filter((f) => f.kind === kind && (dir === undefined || f.dir === dir));
const str = (f: BodyFrame, k: string): string => String(f.data[k] ?? "");
const durationMs = (log: BodyFrameLog): number => {
  const times = [...log.frames.map((f) => f.atMs), ...log.snapshots.map((s) => s.atMs)];
  return times.length < 2 ? 0 : Math.max(...times) - Math.min(...times);
};

/** Steps that cover more than one tile per tick, outside a room change, over all steps. */
export function teleportRate(log: BodyFrameLog): number {
  const last = new Map<string, { at: number; tile: Tile }>();
  let steps = 0;
  let bad = 0;
  for (const f of log.frames) {
    if (f.kind === "moved_room") last.delete(str(f, "agentId"));
    if (f.kind !== "moves") continue;
    const id = str(f, "agentId");
    const tile = f.data["tile"] as Tile;
    const prev = last.get(id);
    if (prev) {
      steps += 1;
      const ticks = Math.max(1, Math.round((f.atMs - prev.at) / TICK_MS));
      if (chebyshev(prev.tile, tile) > ticks) bad += 1;
    }
    last.set(id, { at: f.atMs, tile });
  }
  return ratio(bad, steps);
}

/** `say` lines to a named addressee who was farther than the say radius or in another room. */
export function earshotViolationRate(log: BodyFrameLog): number {
  const lines = framesOf(log, "chat").filter((f) => f.data["mode"] === "say" && f.data["toRef"] !== undefined && f.data["sameRoom"] !== undefined);
  const bad = lines.filter((f) => f.data["sameRoom"] === false || Number(f.data["distance"]) > SAY_CLEAR_TILES);
  return ratio(bad.length, lines.length);
}

/** Commands the hotel accepted and then refused (anything but a rate limit), over all commands. */
export function impossibleActionRate(log: BodyFrameLog): number {
  const refused = framesOf(log, "actor_error", "in").filter((f) => !RATE_CODES.has(str(f, "code")));
  return ratio(refused.length, framesOf(log, "actor_cmd", "out").length);
}

/** Direction reversals (a step against the previous one) per actor-minute. */
export function jitterIndex(log: BodyFrameLog, actorIds: readonly string[]): number {
  const minutes = durationMs(log) / 60_000;
  if (minutes === 0 || actorIds.length === 0) return 0;
  let reversals = 0;
  for (const id of actorIds) {
    let prev: { dir: number; at: number } | undefined;
    for (const f of log.frames) {
      if (f.kind === "moved_room" && str(f, "agentId") === id) prev = undefined;
      if (f.kind !== "moves" || str(f, "agentId") !== id) continue;
      const dir = Number(f.data["dir"]);
      if (prev && f.atMs - prev.at <= JITTER_WINDOW_MS && (dir - prev.dir + 8) % 8 === 4) reversals += 1;
      prev = { dir, at: f.atMs };
    }
  }
  return reversals / actorIds.length / minutes;
}

/** After an addressed line to a listener within earshot, is the listener facing the speaker within 45 degrees ~3 s later? */
export function facingRate(log: BodyFrameLog): number {
  let judged = 0;
  let facing = 0;
  for (const f of log.frames) {
    const speaker = f.kind === "chat" ? str(f, "agentId") : f.kind === "human_chat" ? str(f, "ref") : "";
    const listener = str(f, "toRef");
    if (!speaker || !listener || f.data["mode"] === "whisper") continue;
    const snap = log.snapshots.find((s) => s.atMs >= f.atMs + FACING_CHECK_AFTER_MS && s.room === f.room);
    const a = snap?.occupants.find((o) => o.ref === speaker);
    const b = snap?.occupants.find((o) => o.ref === listener);
    if (!a || !b || chebyshev(a.tile, b.tile) > SAY_CLEAR_TILES) continue;
    judged += 1;
    if (facingKind(b.dir as Direction8, b.tile, a.tile) === "facing") facing += 1;
  }
  return judged === 0 ? 1 : facing / judged;
}

/** Seat sittings per actor per 10 minutes. */
export function furnitureUse(log: BodyFrameLog, actorIds: readonly string[]): number {
  if (actorIds.length === 0) return 0;
  const sits = framesOf(log, "avatar_state", "in").filter((f) => f.data["state"] === "sit" && actorIds.includes(str(f, "agentId")));
  const span = Math.max(durationMs(log), 1);
  return (sits.length / actorIds.length) * (TEN_MINUTES_MS / span);
}

/** Mean over snapshots of the largest share of actors standing in one zone. */
export function spreadIndex(log: BodyFrameLog, actorIds: readonly string[], zoneOf?: EmbodimentProbeInput["zoneOf"]): number {
  const zone = zoneOf ?? ((_r: string, t: Tile) => `${Math.floor(t[0] / 4)},${Math.floor(t[1] / 4)}`);
  const shares: number[] = [];
  const bySecond = new Map<number, Map<string, string>>();
  for (const s of log.snapshots) {
    const actors = s.occupants.filter((o) => actorIds.includes(o.ref));
    for (const o of actors) {
      const t = bySecond.get(s.atMs) ?? new Map<string, string>();
      t.set(o.ref, `${s.room}:${zone(s.room, o.tile)}`);
      bySecond.set(s.atMs, t);
    }
  }
  for (const where of bySecond.values()) {
    if (where.size < 3) continue; // a share of two people says nothing about clustering
    const counts = new Map<string, number>();
    for (const z of where.values()) counts.set(z, (counts.get(z) ?? 0) + 1);
    shares.push(Math.max(...counts.values()) / where.size);
  }
  return shares.length === 0 ? 0 : shares.reduce((a, b) => a + b, 0) / shares.length;
}

/** Largest share of one gesture kind among actor gestures (0 until there are 5 to judge). */
export function gestureDiversity(log: BodyFrameLog, actorIds: readonly string[]): number {
  const gestures = framesOf(log, "avatar_action", "in").filter((f) => actorIds.includes(str(f, "agentId")) && !str(f, "a").startsWith("face:"));
  if (gestures.length < 5) return 0;
  const counts = new Map<string, number>();
  for (const g of gestures) counts.set(str(g, "a"), (counts.get(str(g, "a")) ?? 0) + 1);
  return Math.max(...counts.values()) / gestures.length;
}

/** Commands sent while the actor's room was stale or degraded, over all commands. */
export function staleCommandRate(log: BodyFrameLog): number {
  const cmds = framesOf(log, "actor_cmd", "out");
  return ratio(cmds.filter((f) => f.data["stale"] === true).length, cmds.length);
}

/** Walk plans replaced by a newer walk before they arrived, over plans started. */
export function planAbandonRate(log: BodyFrameLog): number {
  const started = framesOf(log, "walk_started", "in");
  const arrived = new Set(framesOf(log, "arrived", "in").map((f) => `${str(f, "agentId")}:${str(f, "planId")}`));
  let abandoned = 0;
  for (let i = 0; i < started.length; i++) {
    const f = started[i]!;
    const id = str(f, "agentId");
    if (arrived.has(`${id}:${str(f, "planId")}`)) continue;
    const replaced = started.slice(i + 1).some((g) => str(g, "agentId") === id);
    if (replaced) abandoned += 1;
  }
  return ratio(abandoned, started.length);
}

export function slowdownCount(log: BodyFrameLog): number {
  return framesOf(log, "actor_error", "in").filter((f) => RATE_CODES.has(str(f, "code"))).length;
}

/** D43: no rendered prompt names what anyone is. */
export const IDENTITY_FORBIDDEN = /\b(ai|ia|bots?|rob[oô]s?|models?|modelos?|agents?|agentes?|simulations?|simula[cç][aã]o|pulses?|badge|real person)\b/gi;

export function promptIdentityHits(prompts: readonly string[]): number {
  return prompts.reduce((n, p) => n + (p.match(IDENTITY_FORBIDDEN)?.length ?? 0), 0);
}

export function runEmbodimentProbes(input: EmbodimentProbeInput): ProbeResult[] {
  const { log, actorIds } = input;
  const band = (name: string): [number, number] => PROBE_BANDS[name]!;
  const results: ProbeResult[] = [
    checkProbe("teleport-rate", "Steps beyond one tile per tick", teleportRate(log), band("teleport-rate")),
    checkProbe("earshot-violation", "Say lines to an addressee out of earshot", earshotViolationRate(log), band("earshot-violation")),
    checkProbe("impossible-action-rate", "Accepted commands the hotel refused", impossibleActionRate(log), band("impossible-action-rate")),
    checkProbe("jitter-index", "Direction reversals per actor-minute", jitterIndex(log, actorIds), band("jitter-index")),
    checkProbe("facing-rate", "Listeners facing the speaker", facingRate(log), band("facing-rate")),
    checkProbe("furniture-use", "Sittings per actor per 10 min", furnitureUse(log, actorIds), band("furniture-use")),
    checkProbe("spread-index", "Largest zone share of actors", spreadIndex(log, actorIds, input.zoneOf), band("spread-index")),
    checkProbe("gesture-diversity", "Largest same-gesture share", gestureDiversity(log, actorIds), band("gesture-diversity")),
    checkProbe("stale-command-rate", "Commands sent into a stale room", staleCommandRate(log), band("stale-command-rate")),
    checkProbe("plan-abandon-rate", "Walk plans replaced before arrival", planAbandonRate(log), band("plan-abandon-rate")),
    checkProbe("slowdown-count", "Hotel SlowDown errors", slowdownCount(log), band("slowdown-count")),
  ];
  if (input.prompts) {
    results.push(checkProbe("prompt-identity-lint", "Forbidden identity words in prompts", promptIdentityHits(input.prompts), band("prompt-identity-lint")));
  }
  return results;
}
