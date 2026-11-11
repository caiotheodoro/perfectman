/**
 * A run, measured the way the cinema corpus was: the chat lines become `speech` events and the acts that reached the screen become `direction`
 * events, all with their clock time, and `measureScene` (the one implementation E1's norms were built with) reads them. So a run and a corpus scene
 * go through the same lexicons, the same intensity proxy, the same arc detector.
 *
 * Why acts are rendered as words: the corpus measures directions from their text, so the only way to measure an act the same way is to give it a text
 * the lexicons classify. {@link ACT_TEXT} holds one short phrase per act verb, picked so it lands in the class the verb belongs to (violence, tenderness,
 * small body movement). The phrase carries no names (a name such as "Cai" is a hard-act word in Portuguese).
 *
 * The intensity proxy sees open hostility (hostile words, shouting, cut-off lines) and physical acts; it is near-blind to cold, afraid or restrained
 * conflict (AUC 0.56 against model-tagged hot emotions, 0.85 against violent actions; docs/plans/cinema-norms.md, Reliability). So the arc positions
 * (inciting, climax, aftermath) and the reversals count are read only when the proxy finds a STRONG arc in the run (the same gate E1's strong-arc
 * ladders are built on: peak 0.3+, rise 0.15+, 16 of 18 plausible in the hand-check). When it does not, that says "the proxy cannot see an arc here",
 * not "there is no arc", and the reading is left out rather than scored 0.
 */
import { measureScene, type CineEvent, type CineScene, type SceneFeatures, type SourceInfo } from "@perfectman/shared";
import { isVisibleAct, type RunBundle } from "./bundle.js";

/** One phrase per act verb, in the run's language, in the lexicon class the verb belongs to. */
export const ACT_TEXT: Readonly<Record<string, { en: string; pt: string }>> = {
  // violence (hard acts, conflict)
  shove: { en: "shoves", pt: "empurra" },
  slap: { en: "slaps", pt: "esbofeteia" },
  punch: { en: "punches", pt: "esmurra" },
  kill: { en: "kills", pt: "mata" },
  die: { en: "dies", pt: "morre" },
  faint: { en: "faints", pt: "desmaia" },
  restrain: { en: "grabs", pt: "agarra" },
  // tenderness (a physical beat, not conflict)
  hug: { en: "hugs", pt: "abraca" },
  kiss: { en: "kisses", pt: "beija" },
  // small body movement
  glare: { en: "stares", pt: "encara" },
  insult: { en: "shouts", pt: "grita" },
  cry: { en: "cries", pt: "chora" },
  storm_off: { en: "exits", pt: "sai" },
  tableau: { en: "stands", pt: "se levanta" },
  turn_back: { en: "turns", pt: "vira" },
  tend_fallen: { en: "stands", pt: "se levanta" },
  recoil: { en: "steps", pt: "afasta" },
  freeze_gasp: { en: "stops", pt: "para" },
};
const DEFAULT_ACT_TEXT = { en: "looks", pt: "olha" } as const;

/** E1's strong-arc gate (docs/plans/cinema-norms.md): peak 0.3+, rise 0.15+ over the opening. */
export const STRONG_PEAK = 0.3;
export const STRONG_RISE = 0.15;

export type RunMeasure = {
  scene: CineScene;
  info: SourceInfo;
  /** `measureScene`'s figures; null when the run has fewer than 3 spoken lines. */
  features: SceneFeatures | null;
  /** The proxy finds a strong arc (see the file header): where inciting, climax, aftermath and reversals can be read. */
  strong: boolean;
};

export function sceneOfBundle(bundle: RunBundle): { scene: CineScene; info: SourceInfo } {
  const lang = bundle.language;
  const events: Array<CineEvent & { t0: number }> = [];
  for (const l of bundle.lines) events.push({ kind: "speech", speaker: l.speaker, text: l.text, t0: l.tS });
  for (const a of bundle.acts) {
    if (!isVisibleAct(a)) continue;
    events.push({ kind: "direction", text: (ACT_TEXT[a.verb] ?? DEFAULT_ACT_TEXT)[lang], t0: a.tS });
  }
  // speech first on a tie: the line that sets the act up
  events.sort((x, y) => x.t0 - y.t0 || (x.kind === y.kind ? 0 : x.kind === "speech" ? -1 : 1));
  return {
    scene: { sourceId: `run-${bundle.runId}`, index: 0, events },
    info: { id: `run-${bundle.runId}`, title: `run ${bundle.runId}`, lang, medium: "series", genre: "other", era: "modern", form: "screenplay", timeSource: "clock" },
  };
}

export const isStrongArc = (f: SceneFeatures | null): boolean => f !== null && f.tClimax !== null && f.tInciting !== null && f.aftermathShare !== null && f.peak >= STRONG_PEAK && f.peakRise >= STRONG_RISE;

const cache = new WeakMap<RunBundle, RunMeasure>();

/** Measures a run with the corpus's own feature reader. Cached per bundle (every group reads it). */
export function measureRun(bundle: RunBundle): RunMeasure {
  const hit = cache.get(bundle);
  if (hit) return hit;
  const { scene, info } = sceneOfBundle(bundle);
  const features = measureScene(scene, info, { durSec: bundle.durationS });
  const m: RunMeasure = { scene, info, features, strong: isStrongArc(features) };
  cache.set(bundle, m);
  return m;
}
