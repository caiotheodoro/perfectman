import { CLIMAX_VERBS } from "@perfectman/shared";
import type { BeatSheet, SheetBeat } from "@perfectman/shared";
import type { ActStartedEvent } from "../drama/index.js";
import type { SimResult } from "../embodiment/drama-sim.js";
import type { DramaProbeResult } from "./drama-reads.js";
import { PROBE_BANDS, checkProbe } from "./types.js";

/**
 * Beat sheet probes (Contract A, "Invariants" and "Runtime"): rules a scene that played a sheet promises outright, judged over the sim's events and the sheet player's
 * own record. Deterministic, no model. They are not part of `runDramaProbes` (a scene without a sheet has nothing to judge), the bench scenarios of the sheet call them.
 *
 *  - `sheet-climax-by-240s`  the ms of the first act that is the sheet's climax (actor, verb, target; the sheet's own, or the improvised arc's having already thrown it), at most 4:00; never started is far past any band.
 *  - `sheet-climax-physical` the climax act that started is one of the contract's physical verbs (1 or 0).
 *  - `sheet-no-stray-scenario-acts` scenario-origin acts that the sheet did not write (0): the sheet is the scene's whole script.
 *  - `sheet-skip-only-peak`  authored skips that are neither the sheet's own nor its forced climax (0).
 *  - `sheet-one-climax`      the sheet threw its climax at most once (a scenario-origin start; 0 when the improvised arc had thrown it already).
 *  - `sheet-silence-kept`    lines said while a `pause` beat held (0).
 *  - `sheet-not-all-talk`    distinct blocking, prop and camera beats that reached the stage (3 or more).
 *  - `sheet-beats-played`    the share of the sheet's non-act beats that played (0.9 or more).
 */

const NEVER = 1e9;

type ActBeat = Extract<SheetBeat, { kind: "act" }>;

export function sheetProbes(r: SimResult, sheet: BeatSheet): DramaProbeResult[] {
  const climax = sheet.beats.find((b): b is ActBeat => b.kind === "act" && b.climax === true);
  const started = r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
  const scenario = started.filter((a) => a.origin === "scenario");
  const result = (probe: string, label: string, measured: number, evidence: Record<string, unknown>): DramaProbeResult => {
    const checked = checkProbe(probe, label, measured, PROBE_BANDS[probe]!);
    return { ...checked, codes: [], evidence };
  };

  const hits = climax ? started.filter((a) => a.actor === climax.actor && a.verb === climax.verb && a.with === climax.with) : [];
  const first = hits[0];
  const ownActs = new Set(sheet.beats.filter((b): b is ActBeat => b.kind === "act").map((b) => `${b.actor}|${b.verb}|${b.with ?? ""}`));
  const stray = scenario.filter((a) => !ownActs.has(`${a.actor}|${a.verb}|${a.with ?? ""}`));
  const skipOk = new Set(sheet.beats.filter((b): b is ActBeat => b.kind === "act" && (b.authored_skip === true || b.climax === true)).map((b) => `${b.actor}|${b.verb}|${b.with ?? ""}`));
  const skips = started.filter((a) => a.authoredSkip === true && !skipOk.has(`${a.actor}|${a.verb}|${a.with ?? ""}`));
  const pauses = (r.sheet?.stage ?? []).filter((s) => s.kind === "pause").map((s) => ({ from: s.atMs, to: s.atMs + Number(/(\d+)/.exec(s.detail ?? "")?.[1] ?? 0) }));
  const spoken = r.speech.filter((s) => pauses.some((p) => s.atMs >= p.from && s.atMs < p.to));
  const stage = new Set((r.sheet?.stage ?? []).filter((s) => ["block", "prop", "camera"].includes(s.kind)).map((s) => `${s.kind}|${s.beat}`));
  const quiet = sheet.beats.filter((b) => b.kind !== "act" && b.kind !== "cut");
  const playedIds = new Set((r.sheet?.reports ?? []).filter((x) => x.outcome === "played").map((x) => x.beat));

  return [
    result("sheet-climax-by-240s", "ms of the sheet's climax act", first ? first.atMs : NEVER, { climax: climax ? { actor: climax.actor, verb: climax.verb, with: climax.with, planned: climax.at_ms } : null, at: first?.atMs ?? null }),
    result("sheet-climax-physical", "The climax that started is a physical verb", first && (CLIMAX_VERBS as readonly string[]).includes(first.verb) ? 1 : 0, { verb: first?.verb ?? null }),
    result("sheet-no-stray-scenario-acts", "Scenario acts the sheet did not write", stray.length, { acts: stray.map((a) => `${a.actor} ${a.verb} ${a.with ?? ""} @${a.atMs}`) }),
    result("sheet-skip-only-peak", "Authored skips beyond the sheet's own and its climax", skips.length, { acts: skips.map((a) => `${a.actor} ${a.verb} @${a.atMs}`) }),
    result("sheet-one-climax", "Times the sheet threw its climax act", hits.filter((a) => a.origin === "scenario").length, { at: hits.map((a) => `${a.atMs} ${a.origin ?? ""}`) }),
    result("sheet-silence-kept", "Lines said during an authored pause", spoken.length, { pauses, lines: spoken.map((s) => `${s.actor} @${s.atMs}`) }),
    result("sheet-not-all-talk", "Distinct block, prop and camera beats on the stage", stage.size, { beats: [...stage] }),
    result("sheet-beats-played", "Share of the sheet's non-act beats that played", quiet.length === 0 ? 1 : quiet.filter((b) => playedIds.has(b.id)).length / quiet.length, { unplayed: quiet.filter((b) => !playedIds.has(b.id)).map((b) => b.id) }),
  ];
}
