import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DramaEvent } from "../drama/index.js";
import type { SimResult } from "./drama-sim.js";

/**
 * What a sim leaves on disk and on the screen. `frames.jsonl` is the hotel's frame log wrapper `{conn, dir, frame, run, ts_ms}` (what
 * `loadHotelRun` and the drama extractor read); `events.jsonl` is the drama events the probes were run over; `probes.json` is the report;
 * `timeline.txt` is the same frames in words, for reading a run the way a person watches it.
 */

const secs = (ms: number): string => `${(ms / 1000).toFixed(1).padStart(6)}s`;

/** One line per thing that happened, in the order it happened. */
export function timelineOf(result: SimResult): string[] {
  type Row = { at: number; text: string };
  const rows: Row[] = [];
  const ev = (e: DramaEvent): string | undefined => {
    switch (e.kind) {
      case "act_started":
        return `START   ${e.actId} ${e.actor} ${e.verb}${e.with ? ` -> ${e.with}` : ""}${e.rung ? ` (rung ${e.rung})` : ""}${e.origin ? ` [${e.origin}]` : ""}${e.authoredSkip ? " authored skip" : ""}`;
      case "act_beat":
        return `contact ${e.actId} witnesses [${e.witnesses.join(", ")}] owed [${e.owed.map((o) => `${o.who}:${o.role}`).join(", ")}]`;
      case "act_reaction":
        return `react   ${e.actId} ${e.who} (${e.role}) ${e.reaction}${e.source ? ` [${e.source}]` : ""}`;
      case "act_done":
        return `DONE    ${e.actId} ${e.verb ?? ""} ${e.outcome}${e.reason ? ` (${e.reason}${e.detail ? `: ${e.detail}` : ""})` : ""}`;
      case "actor_death":
        return `DEATH   ${e.actor} (${e.cause ?? "?"})`;
      case "actor_revive":
        return `REVIVE  ${e.actor}`;
      case "human_down":
        return `DOWN    ${e.human} for ${e.ms} ms`;
      case "human_up":
        return `UP      ${e.human}`;
      case "scene_cut":
        return `CUT     scene ${e.scene}`;
      case "consent_chip":
        return `chip    ${e.actId ?? ""} ${e.phase}${e.phase === "answered" && e.rawAnswer ? ` ${e.rawAnswer}` : ""}`;
      default:
        return undefined;
    }
  };
  for (const e of result.events) {
    const text = ev(e);
    if (text) rows.push({ at: e.atMs, text });
  }
  for (const p of result.proposals) {
    if (p.decision.startsWith("veto") || p.decision.startsWith("authored:veto")) rows.push({ at: p.atMs, text: `VETO    ${p.actor} ${p.verb}${p.with ? ` -> ${p.with}` : ""}: ${p.reason ?? ""}${p.detail ? ` (${p.detail})` : ""}` });
  }
  for (const s of result.speech) rows.push({ at: s.atMs, text: `says    ${s.actor}: ${s.text}` });
  return rows.sort((a, b) => a.at - b.at).map((r) => `${secs(r.at)}  ${r.text}`);
}

export type ProbeRow = { probe: string; measured: number; passed: boolean; bound: [number, number]; codes: string[] };

export function probeReport(result: SimResult) {
  const probes: ProbeRow[] = result.probes.map((p) => ({ probe: p.probe, measured: Number(p.measured.toFixed(4)), passed: p.passed, bound: p.bound as [number, number], codes: p.codes }));
  const failed = probes.filter((p) => !p.passed);
  const verbs: Record<string, number> = {};
  for (const e of result.events) if (e.kind === "act_started") verbs[e.verb] = (verbs[e.verb] ?? 0) + 1;
  return {
    scene: result.title,
    seed: result.seed,
    durationMs: result.durationMs,
    actors: result.actors,
    acts: result.stats,
    verbs,
    passed: probes.length - failed.length,
    total: probes.length,
    failed: failed.map((p) => `${p.probe}=${p.measured} (band ${p.bound.join("..")}${p.codes.length ? `, ${p.codes.join("/")}` : ""})`),
    offDeviations: result.offDeviations,
    droppedBodies: result.droppedBodies,
    probes,
  };
}

/** Writes `frames.jsonl`, `events.jsonl`, `probes.json` and `timeline.txt` into `dir`. */
export function writeSim(dir: string, result: SimResult): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "frames.jsonl"), `${result.lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  writeFileSync(join(dir, "events.jsonl"), `${result.events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  writeFileSync(join(dir, "probes.json"), `${JSON.stringify(probeReport(result), null, 2)}\n`);
  writeFileSync(join(dir, "timeline.txt"), `${timelineOf(result).join("\n")}\n`);
}
