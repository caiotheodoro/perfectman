/**
 * The cinematic score: five groups, one number, every part explainable.
 *
 *   arc 0.30 | dialogue 0.15 | embodiment 0.20 | camera 0.10 | engagement 0.25
 *
 * The overall is the weight-normalised mean of the groups that exist (a group with nothing to read, or the judge not run, is left out and the rest
 * renormalised, with `partial: true` and the missing names listed). `deterministic` is always the mean of the four measured groups, so two runs can
 * be compared before and after a change without spending a judge call.
 *
 * HARD INVARIANT: no physical climax by 4:00 caps the overall at {@link CLIMAX_CAP} (below "good"), however well the rest scores, and
 * `invariants.climaxByDeadline` reports pass/fail on its own.
 *
 * Calibration: nothing here is calibrated against human grades yet (see calibration.ts); the bands are priors, the engagement judge is unvalidated.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTurns } from "../script-likeness/index.js";
import type { ScriptTurn } from "@perfectman/shared";
import { climaxInvariant, scoreArc, type ClimaxInvariant } from "./arc.js";
import { loadRunBundle, type RunBundle } from "./bundle.js";
import { scoreCamera } from "./camera.js";
import { scoreDialogue } from "./dialogue.js";
import { scoreEmbodiment } from "./embodiment.js";
import { engagementGroup, judgeEngagement, type EngagementJudgment } from "./engagement.js";
import { fallbackNorms, METRIC_IDS, type CinemaNorms } from "./norms.js";
import { GROUP_NAMES, GROUP_WEIGHTS, round1, type GroupName, type GroupScore } from "./types.js";
import type { DramaJudgeProvider } from "../drama/drama-judge.js";

export const CINEMATIC_VERSION = "cinematic-v1";
/** With no physical climax by the deadline the score cannot pass this: a scene that never lands its climax is not a good scene. */
export const CLIMAX_CAP = 59;

export type CinematicScore = {
  version: typeof CINEMATIC_VERSION;
  run: string;
  durationS: number;
  /** 0-100 over the groups that exist, after the climax cap; null when no group has anything to read. */
  score: number | null;
  /** Before the cap. */
  raw: number | null;
  capped: boolean;
  /** Mean of the four measured groups only (arc, dialogue, embodiment, camera): comparable without a judge. */
  deterministic: number | null;
  partial: boolean;
  missing: GroupName[];
  groups: Record<GroupName, GroupScore>;
  /** The weights that were applied after leaving out missing groups. */
  weights: Partial<Record<GroupName, number>>;
  invariants: { climaxByDeadline: ClimaxInvariant };
  norms: { origin: string; fromCinemaNorms: number; priors: number; note?: string };
  engagement?: Pick<EngagementJudgment, "judge" | "mock" | "mean" | "score" | "notes" | "digestSha256">;
  sources: RunBundle["sources"];
};

function mean(groups: GroupScore[], weightOf: (n: GroupName) => number): number | null {
  const have = groups.filter((g) => g.score !== null);
  const total = have.reduce((a, g) => a + weightOf(g.name), 0);
  return total === 0 ? null : have.reduce((a, g) => a + g.score! * weightOf(g.name), 0) / total;
}

/** Combines the five groups. Pure. */
export function combineGroups(bundle: RunBundle, groups: Record<GroupName, GroupScore>, norms: CinemaNorms, judgment: EngagementJudgment | null): CinematicScore {
  const list = GROUP_NAMES.map((n) => groups[n]);
  const have = list.filter((g) => g.score !== null);
  const missing = list.filter((g) => g.score === null).map((g) => g.name);
  const totalW = have.reduce((a, g) => a + GROUP_WEIGHTS[g.name], 0);
  const weights = Object.fromEntries(have.map((g) => [g.name, Math.round((GROUP_WEIGHTS[g.name] / totalW) * 1000) / 10])) as Partial<Record<GroupName, number>>;
  const raw = mean(list, (n) => GROUP_WEIGHTS[n]);
  const det = mean(list.filter((g) => g.name !== "engagement"), (n) => GROUP_WEIGHTS[n]);
  const climax = climaxInvariant(bundle);
  const capped = raw !== null && !climax.pass && raw > CLIMAX_CAP;
  const fromCinema = METRIC_IDS.filter((m) => norms.normSources[m] === "cinema-norms").length;
  return {
    version: CINEMATIC_VERSION,
    run: bundle.runId,
    durationS: round1(bundle.durationS),
    score: raw === null ? null : round1(capped ? CLIMAX_CAP : raw),
    raw: raw === null ? null : round1(raw),
    capped,
    deterministic: det === null ? null : round1(!climax.pass && det > CLIMAX_CAP ? CLIMAX_CAP : det),
    partial: missing.length > 0,
    missing,
    groups,
    weights,
    invariants: { climaxByDeadline: climax },
    norms: { origin: norms.origin, fromCinemaNorms: fromCinema, priors: METRIC_IDS.length - fromCinema, ...(norms.note ? { note: norms.note } : {}) },
    ...(judgment ? { engagement: { judge: judgment.judge, mock: judgment.mock, mean: judgment.mean, score: judgment.score, ...(judgment.notes ? { notes: judgment.notes } : {}), digestSha256: judgment.digestSha256 } } : {}),
    sources: bundle.sources,
  };
}

export type ScoreRunOptions = {
  norms?: CinemaNorms;
  /** The engagement judge; omitted = not run (the overall is partial). */
  judge?: { provider: DramaJudgeProvider; mock?: boolean; actorModels?: readonly string[]; maxChars?: number; fromS?: number; toS?: number };
  /** Test seam: the turns script-likeness reads (default: the run directory read the way the script-likeness CLI reads it). */
  scriptTurns?: ScriptTurn[];
};

export function scoreBundleDeterministic(bundle: RunBundle, norms: CinemaNorms, scriptTurns?: ScriptTurn[]): Record<Exclude<GroupName, "engagement">, GroupScore> {
  return {
    arc: scoreArc(bundle, norms),
    dialogue: scoreDialogue(bundle, norms, scriptTurns ? { scriptTurns } : {}),
    embodiment: scoreEmbodiment(bundle, norms),
    camera: scoreCamera(bundle, norms),
  };
}

/** The script-likeness benchmark's own reading of the run directory (same turns the script-likeness CLI scores), or undefined when it cannot read one. */
function benchmarkTurns(dir: string | undefined): ScriptTurn[] | undefined {
  if (!dir || !existsSync(join(dir, "events.jsonl"))) return undefined;
  try {
    return loadTurns(dir).turns;
  } catch {
    return undefined;
  }
}

export async function scoreBundle(bundle: RunBundle, opts: ScoreRunOptions = {}): Promise<CinematicScore> {
  const norms = opts.norms ?? fallbackNorms();
  const det = scoreBundleDeterministic(bundle, norms, opts.scriptTurns ?? benchmarkTurns(bundle.dir));
  let judgment: EngagementJudgment | null = null;
  if (opts.judge) {
    judgment = await judgeEngagement({
      bundle,
      provider: opts.judge.provider,
      ...(opts.judge.actorModels ? { actorModels: opts.judge.actorModels } : {}),
      ...(opts.judge.maxChars !== undefined ? { maxChars: opts.judge.maxChars } : {}),
      ...(opts.judge.fromS !== undefined ? { fromS: opts.judge.fromS } : {}),
      ...(opts.judge.toS !== undefined ? { toS: opts.judge.toS } : {}),
      ...(opts.judge.mock ? { mock: true } : {}),
    });
  }
  const groups = { ...det, engagement: engagementGroup(judgment, opts.judge ? "judge returned" : "judge not run") } as Record<GroupName, GroupScore>;
  return combineGroups(bundle, groups, norms, judgment);
}

export async function scoreRun(dir: string, opts: ScoreRunOptions = {}): Promise<CinematicScore> {
  return scoreBundle(loadRunBundle(dir), opts);
}

// ---------------------------------------------------------------------------------------------------------------------
// replay.json
// ---------------------------------------------------------------------------------------------------------------------

/** The compact form that goes into replay.json under `cinematic_score` (the way `script_likeness` is): numbers a dashboard can read, no readings. */
export function replayManifestOf(s: CinematicScore): Record<string, unknown> {
  return {
    version: s.version,
    score: s.score,
    deterministic: s.deterministic,
    partial: s.partial,
    capped: s.capped,
    groups: Object.fromEntries(GROUP_NAMES.map((n) => [n, s.groups[n].score])),
    climax_by_deadline: { pass: s.invariants.climaxByDeadline.pass, at_s: s.invariants.climaxByDeadline.atS, verb: s.invariants.climaxByDeadline.verb, deadline_s: s.invariants.climaxByDeadline.deadlineS },
    ...(s.engagement ? { engagement: { judge: s.engagement.judge, mock: s.engagement.mock, mean: s.engagement.mean } } : {}),
    norms: s.norms.origin,
  };
}

/** Writes `cinematic_score` into `<dir>/replay.json`, leaving every other key as it was. Returns false when there is no replay.json to extend. */
export function writeCinematicToReplay(dir: string, s: CinematicScore): boolean {
  const file = join(dir, "replay.json");
  if (!existsSync(file)) return false;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  manifest["cinematic_score"] = replayManifestOf(s);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}
