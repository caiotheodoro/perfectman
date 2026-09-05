/**
 * The one transcript rendering every eval reader shares — judge, narrator,
 * evidence report, narrate CLI. Before this module each of them had its own
 * line format (`[private: …]`, `[internally: …]`, `[motive: …]`), none of
 * them showed the seeds the rubric anchors score against, and none could
 * join a `private_motive_summary` event (ADR-0014) back to the act it
 * explains.
 *
 * Canonical line:
 *   [p12] marcela (reply_sent) #cerne-decisao 🔒 "texto" [internally: motivo]
 *
 * Motive events are never rendered as lines of their own; they are folded
 * into the act they belong to via `sourceIntentId`. Engine-authored motives
 * (a parse error is not a feeling) render as `[engine-fallback]` under
 * `motives: "model"`, verbatim under `"all"`, and not at all under `"none"`.
 */

import type { CommittedEvent, PrivateMotiveSummaryPayload, RoleplayScenario } from "@perfectman/shared";
import { PromptSection, getPersonaPackById } from "@perfectman/shared";
import { isEngineAuthoredMotive } from "@perfectman/server";

export type TranscriptOptions = {
  /** `full` adds cast, channels and the seeded objectives/memories; `none` renders events only. */
  seeds: "none" | "full";
  /** `model` hides engine-authored motives behind `[engine-fallback]`; `all` shows them; `none` drops motives. */
  motives: "none" | "model" | "all";
  /** Cap on rendered event lines (motive events never count). */
  maxLines?: number;
};

/** Line-level rendering only needs the motive policy; a full options object is accepted as-is. */
export type MotiveRendering = Pick<TranscriptOptions, "motives"> & Partial<Omit<TranscriptOptions, "motives">>;

export type MotiveText = { text: string; engineAuthored: boolean };
export type MotiveIndex = Map<string, PrivateMotiveSummaryPayload>;

export type TranscriptLineInput = {
  pulse: number;
  actorId: string;
  type: string;
  channelId?: string;
  isPrivate: boolean;
  /** Already display-ready: quoted message text, a bare emoji, a channel name. */
  content?: string;
  motive?: MotiveText;
};

export type TranscriptView = {
  cast: string[];
  channels: string[];
  seeds: string[];
  lines: string[];
};

export function buildMotiveIndex(events: readonly CommittedEvent[]): MotiveIndex {
  const idx: MotiveIndex = new Map();
  for (const e of events) {
    if (e.type !== "private_motive_summary" || !e.sourceIntentId) continue;
    const p = e.payload as Partial<PrivateMotiveSummaryPayload>;
    if (typeof p.summary !== "string") continue;
    idx.set(e.sourceIntentId, {
      summary: p.summary,
      intentType: p.intentType ?? "no_op",
      emotionDrivers: Array.isArray(p.emotionDrivers) ? p.emotionDrivers : [],
      motivationDrivers: Array.isArray(p.motivationDrivers) ? p.motivationDrivers : [],
      engineAuthored:
        typeof p.engineAuthored === "boolean" ? p.engineAuthored : isEngineAuthoredMotive(p.summary),
    });
  }
  return idx;
}

/**
 * The motive behind an act: the joined `private_motive_summary` when one
 * exists, else the legacy `privateMotiveSummary` payload field (no-op
 * records, and artifacts recorded before ADR-0014).
 */
export function motiveForEvent(e: CommittedEvent, idx: MotiveIndex): MotiveText | undefined {
  if (e.type === "private_motive_summary") return undefined;
  const joined = e.sourceIntentId ? idx.get(e.sourceIntentId) : undefined;
  if (joined) return { text: joined.summary, engineAuthored: joined.engineAuthored };
  const legacy = (e.payload as Record<string, unknown>)["privateMotiveSummary"];
  if (typeof legacy === "string" && legacy.length > 0) {
    return { text: legacy, engineAuthored: isEngineAuthoredMotive(legacy) };
  }
  return undefined;
}

export function isPrivateEvent(e: CommittedEvent, scenario?: RoleplayScenario): boolean {
  const p = e.payload as Record<string, unknown>;
  if (scenario?.channels.some((c) => c.id === e.channelId && c.type === "private_channel")) return true;
  if (p["channelType"] === "private_channel") return true;
  return e.visibility.visibilityReason.includes("private");
}

function displayContent(e: CommittedEvent): string | undefined {
  const p = e.payload as Record<string, unknown>;
  if (typeof p["content"] === "string" && p["content"].length > 0) return `"${p["content"]}"`;
  if (typeof p["emoji"] === "string") return p["emoji"];
  if (typeof p["reaction"] === "string") return p["reaction"];
  if (typeof p["channelName"] === "string") return `#${p["channelName"]}`;
  return undefined;
}

export function toTranscriptLineInput(
  e: CommittedEvent,
  idx: MotiveIndex,
  scenario?: RoleplayScenario,
): TranscriptLineInput {
  return {
    pulse: e.pulseIndex ?? 0,
    actorId: e.actorId,
    type: e.type,
    channelId: e.channelId,
    isPrivate: isPrivateEvent(e, scenario),
    content: displayContent(e),
    motive: motiveForEvent(e, idx),
  };
}

export function formatTranscriptLine(input: TranscriptLineInput, opts: MotiveRendering): string {
  let line = `[p${input.pulse}] ${input.actorId} (${input.type})`;
  if (input.channelId) line += ` #${input.channelId}`;
  if (input.isPrivate) line += " 🔒";
  if (input.content) line += ` ${input.content}`;
  const m = input.motive;
  if (m && opts.motives !== "none") {
    if (m.engineAuthored && opts.motives === "model") line += " [engine-fallback]";
    else line += ` [internally: ${m.text}]`;
  }
  return line;
}

export function renderTranscriptLine(
  e: CommittedEvent,
  scenario: RoleplayScenario | undefined,
  idx: MotiveIndex,
  opts: MotiveRendering,
): string {
  return formatTranscriptLine(toTranscriptLineInput(e, idx, scenario), opts);
}

function castLine(agentId: string, personaId: string): string {
  const displayName = getPersonaPackById(personaId)?.displayName ?? agentId;
  return `${agentId} → ${displayName} (${personaId})`;
}

function seedLines(scenario: RoleplayScenario): string[] {
  const out: string[] = [];
  for (const spec of scenario.agents) {
    const o = spec.hiddenObjective;
    if (o) {
      out.push(`${spec.agentId} objective: ${o.description}`);
      if (o.constraint) out.push(`  constraint: ${o.constraint}`);
      if (o.costOfExposure) out.push(`  cost of exposure: ${o.costOfExposure}`);
      if (o.breakingPoint) out.push(`  breaking point: ${o.breakingPoint}`);
    }
    for (const m of spec.memories ?? []) {
      out.push(`${spec.agentId} memory (${m.type}): ${m.summary}`);
    }
  }
  return out;
}

export function buildTranscriptView(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  opts: TranscriptOptions,
): TranscriptView {
  const idx = buildMotiveIndex(events);
  const lines = events
    .filter((e) => e.type !== "private_motive_summary")
    .map((e) => renderTranscriptLine(e, scenario, idx, opts));
  return {
    cast: opts.seeds === "full" ? scenario.agents.map((a) => castLine(a.agentId, a.personaId)) : [],
    channels:
      opts.seeds === "full"
        ? scenario.channels.map((c) => `#${c.id} (${c.type === "private_channel" ? "private 🔒" : "public"})`)
        : [],
    seeds: opts.seeds === "full" ? seedLines(scenario) : [],
    lines: opts.maxLines !== undefined ? lines.slice(0, opts.maxLines) : lines,
  };
}

/** Sections in order: cast, channels, seeds (omitted when empty), events. */
export function renderTranscript(view: TranscriptView): string {
  const s = new PromptSection();
  if (view.cast.length > 0) s.container("cast", (c) => c.list(undefined, view.cast));
  if (view.channels.length > 0) s.container("channels", (c) => c.list(undefined, view.channels));
  if (view.seeds.length > 0) s.container("seeds", (c) => c.raw(view.seeds.join("\n")));
  s.container("events", (c) => c.raw(view.lines.length > 0 ? view.lines.join("\n") : "(no events)"));
  return s.toString();
}
