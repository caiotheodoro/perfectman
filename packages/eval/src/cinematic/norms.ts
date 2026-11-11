/**
 * Norms the cinematic score reads each metric against, behind one small interface so the reference distributions can be swapped without touching a scorer.
 *
 * A norm is a {@link Band}: full marks (100) inside `[lo, hi]`, falling linearly to 0 at `floor` below and `ceil` above. `hi` / `ceil` may be
 * `null` for a metric where more is never worse. Every metric the scorers read is named in {@link METRIC_IDS}; a norms file may carry any
 * subset, the rest comes from {@link FALLBACK_NORMS}.
 *
 * Where norms come from today (be honest about it):
 *  - dialogue's script-likeness sub-score reads `@perfectman/shared`'s `SCRIPT_NORMS` (derived from 45 public-domain plays; THEATRE only);
 *  - every other band is a PRIOR: a defensible screenwriting / editing convention written down here, `source: "prior"`, not measured on a corpus.
 *
 * When agent E1's reference distributions land (`cinema-norms.json`, built from films, series and plays) they replace the priors with no code
 * change: `loadCinemaNorms()` reads the file, converts percentile ladders to bands (`lo` = p10, `hi` = p90, `floor` = p0, `ceil` = p100 unless
 * the file gives them) and records which metrics came from where in the report (`normSources`). See docs/eval/cinematic-score.md, "Swapping in E1's norms".
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT_NORMS, type ScriptNorms } from "@perfectman/shared";

export type Band = {
  lo: number;
  hi: number | null;
  floor: number;
  ceil: number | null;
  source: "prior" | "cinema-norms";
};

export const METRIC_IDS = [
  // arc
  "timeToIncitingS",
  "reversals",
  "escalationShape",
  "peakIntensity",
  "timeToClimaxS",
  "aftermathShare",
  "stakesChange",
  // dialogue
  "interruptionShare",
  "deadAirShare",
  "pauseBeatsPerMin",
  "subtext",
  "replyAdherence",
  "staleReplyShare",
  // embodiment
  "actsPerMin",
  "distinctVerbs",
  "ladderSpan",
  "topVerbShare",
  "distinctFaces",
  "distinctGestures",
  "reactionIntegrity",
  "walksPerActorMin",
  "distinctTilesPerActor",
  "proximityChanges",
  "entranceShare",
  "exits",
  // camera
  "distinctShots",
  "topShotShare",
  "shotsPerMin",
  "shortShotShare",
  "shotOnSpeaker",
  "staleDropRate",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

/** The hard invariant of the plan: a physical climax by this many seconds. */
export const CLIMAX_DEADLINE_S = 240;

const prior = (lo: number, hi: number | null, floor: number, ceil: number | null): Band => ({ lo, hi, floor, ceil, source: "prior" });

export const FALLBACK_NORMS: Readonly<Record<MetricId, Band>> = {
  // ---- arc (a scene budgeted to a physical climax by 4:00)
  timeToIncitingS: prior(0, 45, 0, 120), // something disturbs the scene inside 45 s; zero at 2 min
  reversals: prior(1, 4, 0, 8), // at least one turn of the scene; more than ~4 in a 4 minute scene is noise
  escalationShape: prior(0.8, null, 0.4, null), // share of (earlier, later) bucket pairs up to the peak that do not fall
  peakIntensity: prior(4, null, 1, null), // peak event weight: 3 = shove, 4 = slap, 5 = punch, 6 = kill
  timeToClimaxS: prior(0, 210, 0, 300), // 100 up to 3:30, zero at 5:00; the pass/fail line is CLIMAX_DEADLINE_S
  aftermathShare: prior(0.08, 0.3, 0, 0.6),
  stakesChange: prior(0.5, null, 0.1, null),
  // ---- dialogue
  interruptionShare: prior(0.03, 0.2, 0, 0.5),
  deadAirShare: prior(0, 0.05, 0, 0.25),
  pauseBeatsPerMin: prior(0.5, 4, 0, 10),
  subtext: prior(0.3, 0.8, 0.05, 1),
  replyAdherence: prior(0.6, null, 0.2, null),
  staleReplyShare: prior(0, 0.1, 0, 0.4),
  // ---- embodiment
  actsPerMin: prior(1, 6, 0, 15),
  distinctVerbs: prior(4, null, 1, null),
  ladderSpan: prior(3, null, 0, null),
  topVerbShare: prior(0, 0.5, 0, 0.9),
  distinctFaces: prior(4, null, 1, null),
  distinctGestures: prior(2, null, 0, null),
  reactionIntegrity: prior(0.9, null, 0.5, null),
  walksPerActorMin: prior(0.3, 3, 0, 8),
  distinctTilesPerActor: prior(4, null, 1, null),
  proximityChanges: prior(3, null, 0, null),
  entranceShare: prior(0.66, null, 0, null),
  exits: prior(1, null, 0, null),
  // ---- camera
  distinctShots: prior(4, null, 1, null),
  topShotShare: prior(0, 0.5, 0, 0.9),
  shotsPerMin: prior(4, 14, 0.5, 30),
  shortShotShare: prior(0, 0.1, 0, 0.4),
  shotOnSpeaker: prior(0.9, null, 0.4, null),
  staleDropRate: prior(0, 0.05, 0, 0.3),
};

/** Score 0-100 of a value against a band: 100 inside, linear to 0 at the floor / ceil, 0 beyond. */
export function bandScore(value: number, band: Band): number {
  if (Number.isNaN(value)) return 0;
  if (value >= band.lo && (band.hi === null || value <= band.hi)) return 100;
  if (value < band.lo) return band.floor >= band.lo ? 0 : Math.max(0, Math.min(100, ((value - band.floor) / (band.lo - band.floor)) * 100));
  const hi = band.hi!;
  return band.ceil === null || band.ceil <= hi ? 0 : Math.max(0, Math.min(100, ((band.ceil - value) / (band.ceil - hi)) * 100));
}

export type CinemaNorms = {
  bands: Record<MetricId, Band>;
  /** Norms the dialogue group's script-likeness reads. */
  scriptNorms: ScriptNorms;
  /** Where the bands came from: `fallback`, or the file read. */
  origin: string;
  /** Per metric: `prior` or `cinema-norms`. */
  normSources: Record<MetricId, "prior" | "cinema-norms">;
  /** Free text from the norms file (corpus size, build date). */
  note?: string;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The percentile positions of a ladder in a norms file (same as script-norms: LADDER_PCTS). */
const LADDER_PCTS = [0, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 100] as const;

function ladderAt(ladder: number[], pct: number): number {
  const i = LADDER_PCTS.indexOf(pct as (typeof LADDER_PCTS)[number]);
  if (i >= 0 && ladder.length === LADDER_PCTS.length) return ladder[i]!;
  // any other length: spread evenly over 0..100
  const pos = (pct / 100) * (ladder.length - 1);
  const a = Math.floor(pos);
  const b = Math.min(ladder.length - 1, a + 1);
  return ladder[a]! + (ladder[b]! - ladder[a]!) * (pos - a);
}

/** One metric entry of a norms file: a band, or a percentile ladder (an array of numbers). Undefined when it is neither. */
export function bandFromEntry(entry: unknown): Band | undefined {
  if (Array.isArray(entry) && entry.length >= 2 && entry.every((n) => typeof n === "number")) {
    const ladder = [...(entry as number[])].sort((a, b) => a - b);
    return { lo: ladderAt(ladder, 10), hi: ladderAt(ladder, 90), floor: ladderAt(ladder, 0), ceil: ladderAt(ladder, 100), source: "cinema-norms" };
  }
  if (!isObj(entry)) return undefined;
  if (Array.isArray(entry["ladder"])) return bandFromEntry(entry["ladder"]);
  const lo = numOrNull(entry["lo"]);
  const hi = numOrNull(entry["hi"]);
  const floor = numOrNull(entry["floor"]);
  const ceil = numOrNull(entry["ceil"]);
  if (typeof lo !== "number" || typeof floor !== "number") return undefined;
  return { lo, hi: hi === undefined ? null : hi, floor, ceil: ceil === undefined ? null : ceil, source: "cinema-norms" };
}

/**
 * Builds norms from a parsed norms file: `{ version, built?, note?, metrics: { <MetricId>: Band | ladder } }`. Unknown metric ids are ignored (and listed
 * in `ignored`), missing ones fall back to the priors. A file that names none of the known metrics is rejected: it is probably another format.
 */
export function normsFromFile(raw: unknown, origin: string): { norms: CinemaNorms; ignored: string[] } {
  if (!isObj(raw)) throw new Error(`${origin}: expected a JSON object`);
  const metrics = isObj(raw["metrics"]) ? raw["metrics"] : undefined;
  if (!metrics) throw new Error(`${origin}: no "metrics" object (expected { metrics: { <metric>: {lo,hi,floor,ceil} | [ladder] } })`);
  const bands: Record<MetricId, Band> = { ...FALLBACK_NORMS };
  const normSources = Object.fromEntries(METRIC_IDS.map((m) => [m, "prior"])) as Record<MetricId, "prior" | "cinema-norms">;
  const ignored: string[] = [];
  let used = 0;
  for (const [key, entry] of Object.entries(metrics)) {
    if (!(METRIC_IDS as readonly string[]).includes(key)) {
      ignored.push(key);
      continue;
    }
    const band = bandFromEntry(entry);
    if (!band) {
      ignored.push(key);
      continue;
    }
    bands[key as MetricId] = band;
    normSources[key as MetricId] = "cinema-norms";
    used++;
  }
  if (used === 0) throw new Error(`${origin}: none of the ${Object.keys(metrics).length} metrics is one the scorer reads (${METRIC_IDS.slice(0, 4).join(", ")}, ...)`);
  return { norms: { bands, scriptNorms: SCRIPT_NORMS, origin, normSources, ...(typeof raw["note"] === "string" ? { note: raw["note"] } : {}) }, ignored };
}

export function fallbackNorms(): CinemaNorms {
  return {
    bands: { ...FALLBACK_NORMS },
    scriptNorms: SCRIPT_NORMS,
    origin: "fallback (priors + script-norms)",
    normSources: Object.fromEntries(METRIC_IDS.map((m) => [m, "prior"])) as Record<MetricId, "prior">,
  };
}

/** Where a committed norms file is looked for when none is named: the first that exists wins. */
export function defaultNormsCandidates(cwd: string = process.cwd()): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(here, "../../../..");
  return [...new Set([join(cwd, "docs/eval/cinema-norms.json"), join(repo, "docs/eval/cinema-norms.json"), join(repo, "packages/shared/src/cinema-norms.json"), join(repo, "packages/kb/cinema-norms.json")])];
}

/**
 * Norms from `file`, else `CINEMA_NORMS_FILE`, else the first default candidate that exists, else the fallback. A named file that is missing or
 * unreadable throws (a typo must not silently score against priors).
 */
export function loadCinemaNorms(file?: string, env: NodeJS.ProcessEnv = process.env): CinemaNorms {
  const named = file ?? env["CINEMA_NORMS_FILE"];
  const path = named ?? defaultNormsCandidates().find((p) => existsSync(p));
  if (path === undefined) return fallbackNorms();
  if (!existsSync(path)) throw new Error(`cinema norms file not found: ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${(err as Error).message})`);
  }
  return normsFromFile(raw, path).norms;
}
