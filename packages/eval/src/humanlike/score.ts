import type { HumanlikeMetrics } from "./metrics.js";

/**
 * The human-likeness score (0-100) and the bands behind it. Each band is where a believable, still stylized, scene's number should sit; a metric inside its
 * band scores 1, and the score falls away linearly to 0 one band-width outside it. Every band says where it comes from:
 *  - `prior`: literature or a judgement call, NOT measured here. Calibrate against graded clips.
 *  - `corpus`: read off the cinema-norms corpus (agent E1, 2026-11-11, `packages/shared/src/cinema-norms/cinema-norms.json`).
 *  - `runs`: measured on the baseline runs 55-63 (docs/eval/humanlike-baseline.md).
 * The orchestrator folds `score` into the cinematic score's embodiment group; the five `groups` are there to read why it moved.
 */

export type Group = "proxemics" | "gaze" | "turns" | "gesture" | "idle";

export type Band = {
  key: string;
  label: string;
  group: Group;
  lo: number;
  hi: number;
  weight: number;
  src: "prior" | "corpus" | "runs";
  note: string;
  read(m: HumanlikeMetrics): number | null;
};

export const BANDS: readonly Band[] = [
  { key: "distance.inEarshotShare", label: "lines said within earshot (5 tiles)", group: "proxemics", lo: 0.9, hi: 1, weight: 1.5, src: "prior", note: "embodiment.md 5.2: say is clear to 6 tiles; a speaker farther than that is not talking to anyone", read: (m) => m.distance.inEarshotShare },
  { key: "distance.conversationalShare", label: "lines said at 1-4 tiles", group: "proxemics", lo: 0.6, hi: 1, weight: 1, src: "prior", note: "Hall 1966: personal and near-social bands carry most conversation", read: (m) => m.distance.conversationalShare },
  { key: "stacking.perActorHour", label: "stacked on one tile (events per actor-hour)", group: "proxemics", lo: 0, hi: 0.5, weight: 1.5, src: "prior", note: "two people never stand in one place", read: (m) => m.stacking.perActorHour },
  { key: "gaze.speakerRate", label: "speaker faces the addressee", group: "gaze", lo: 0.7, hi: 0.95, weight: 1.5, src: "prior", note: "Argyle & Cook 1976: speakers look at the listener about half the time; staging asks for more, a break is the exception", read: (m) => m.gaze.speakerRate },
  { key: "gaze.listenerRate", label: "listener faces the speaker", group: "gaze", lo: 0.7, hi: 0.95, weight: 1.5, src: "prior", note: "Argyle & Cook 1976: listeners look about three quarters of the time", read: (m) => m.gaze.listenerRate },
  { key: "gaze.breakReturnRate", label: "speaker looks away and comes back", group: "gaze", lo: 0.05, hi: 0.4, weight: 0.75, src: "prior", note: "Kendon 1967: gaze breaks at the start of a turn and returns at its end", read: (m) => m.gaze.breakReturnRate },
  { key: "latency.startTyping.p50", label: "median ms from a line to the reply's first key press", group: "turns", lo: 600, hi: 6000, weight: 1, src: "prior", note: "Stivers 2009: about 200 ms between spoken turns; chat adds reading and a first key press, and a scene written by a model lags by its call", read: (m) => m.latency.startTyping.p50 },
  { key: "overlap.rate", label: "a line lands while the last one is still on screen", group: "turns", lo: 0.05, hi: 0.3, weight: 1, src: "prior", note: "Heldner & Edlund 2010: overlap is common in speech; chat shows it as a line landing on a line", read: (m) => m.overlap.rate },
  { key: "interruption.rate", label: "lines cut off by a dash", group: "turns", lo: 0.01, hi: 0.06, weight: 1, src: "corpus", note: "cinema-norms interruptShare: screenplays p50 0 / p75 0.038-0.044, plays p50 0.017-0.033", read: (m) => m.interruption.rate },
  { key: "typing.lengthCorrelation", label: "bubble time follows the length of the line (r)", group: "turns", lo: 0.4, hi: 1, weight: 1.25, src: "prior", note: "typing is proportional to what is typed", read: (m) => m.typing.lengthCorrelation },
  { key: "gesture.perLine", label: "lines carrying a gesture", group: "gesture", lo: 0.2, hi: 0.6, weight: 1.25, src: "prior", note: "McNeill 1992: most animated speech is accompanied by gesture; a chat avatar carries fewer", read: (m) => m.gesture.perLine },
  { key: "backchannel.rate", label: "heard lines answered by a silent signal", group: "gesture", lo: 0.25, hi: 0.7, weight: 1.25, src: "prior", note: "Yngve 1970: listeners give feedback signals through the speaker's turn", read: (m) => m.backchannel.rate },
  { key: "expression.changesPerActorMin", label: "face changes per actor-minute", group: "gesture", lo: 1, hi: 6, weight: 0.5, src: "prior", note: "judgement: a face that never changes reads as a mask", read: (m) => m.expression.changesPerActorMin },
  { key: "walks.perActorMin", label: "walks per actor-minute", group: "idle", lo: 0.4, hi: 3, weight: 1, src: "corpus", note: "cinema-norms actsPerMin, screenplays p25-p75 1-2.5 body acts a minute for the whole scene; a walk is one", read: (m) => m.walks.perActorMin },
  { key: "idle.motionPerActorMin", label: "idle motion per actor-minute", group: "idle", lo: 1, hi: 6, weight: 1, src: "prior", note: "judgement: posture shifts, glances, a step, while nobody speaks to the actor", read: (m) => m.idle.motionPerActorMin },
  { key: "idle.frozenShare", label: "10 s windows with no visible change", group: "idle", lo: 0, hi: 0.3, weight: 1.25, src: "prior", note: "judgement: people do not hold still for ten seconds", read: (m) => m.idle.frozenShare },
  { key: "idle.reversalsPerActorHour", label: "back-and-forth walks (jitter) per actor-hour", group: "idle", lo: 0, hi: 4, weight: 0.75, src: "prior", note: "pacing is fine, a loop is not", read: (m) => m.idle.reversalsPerActorHour },
];

export type BandResult = { key: string; label: string; group: Group; value: number | null; lo: number; hi: number; sub: number | null; weight: number; src: Band["src"] };

/** 1 inside [lo, hi]; falling away linearly to 0 half a band-width (at least a tenth of the larger bound) outside. */
export function bandScore(value: number, lo: number, hi: number): number {
  if (value >= lo && value <= hi) return 1;
  const width = Math.max(0.5 * (hi - lo), 0.1 * Math.max(Math.abs(lo), Math.abs(hi), 0.2));
  const dist = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - dist / width);
}

export type HumanlikeScore = {
  score: number;
  groups: Record<Group, number | null>;
  bands: BandResult[];
  /** Bands that had a number to score, of the bands there are. */
  scored: number;
  total: number;
};

export function scoreHumanlike(m: HumanlikeMetrics): HumanlikeScore {
  const bands: BandResult[] = BANDS.map((b) => {
    const value = b.read(m);
    return { key: b.key, label: b.label, group: b.group, value, lo: b.lo, hi: b.hi, sub: value === null ? null : bandScore(value, b.lo, b.hi), weight: b.weight, src: b.src };
  });
  const acc = (rows: BandResult[]): number | null => {
    const scored = rows.filter((r) => r.sub !== null);
    const w = scored.reduce((s, r) => s + r.weight, 0);
    return w === 0 ? null : Math.round((scored.reduce((s, r) => s + r.weight * r.sub!, 0) / w) * 1000) / 10;
  };
  const groups = Object.fromEntries((["proxemics", "gaze", "turns", "gesture", "idle"] as const).map((g) => [g, acc(bands.filter((b) => b.group === g))])) as Record<Group, number | null>;
  return { score: acc(bands) ?? 0, groups, bands, scored: bands.filter((b) => b.sub !== null).length, total: bands.length };
}
