/**
 * EMBODIMENT: do the bodies act. Reads frames.jsonl (acts, body commands, arrivals, spawns): how many acts per minute, how wide the verb ladder is
 * and whether one verb is spammed, how many faces and gestures, whether every act got its reactions, how the actors move about the room, and
 * whether they enter and leave on purpose.
 *
 * An act that never reached the screen (aborted, declined, timeout) does not count. Faces and gestures are what the actors commanded, which is
 * what the client plays; "neutral" is a face, "stop" and "stand" are not gestures.
 */
import { LADDER_RUNGS } from "../drama/axes.js";
import { isVisibleAct, type RunBundle } from "./bundle.js";
import { HUMANLIKE_WEIGHT, type HumanLikeReport } from "./humanlike-hook.js";
import { measureRun } from "./measure.js";
import { bandFor, type CinemaNorms } from "./norms.js";
import { groupOf, read, readFail, readScore, round1, type GroupScore, type Reading } from "./types.js";

const IDLE_GESTURES = new Set(["stop", "stand", "sit"]);
/** Entrances / exits this close to the end of the run are the stop command clearing the stage, not staging. */
export const END_CLEAR_S = 20;
/** Tile distance bands for blocking: touching, talking, across the room. */
export const NEAR_TILES = 2;
export const MID_TILES = 5;

const distBand = (d: number): 0 | 1 | 2 => (d <= NEAR_TILES ? 0 : d <= MID_TILES ? 1 : 2);

export function proximityChanges(bundle: RunBundle): number {
  // the latest known tile of each actor, after every arrival; count how often a pair crosses a distance band
  const pos = new Map<string, { x: number; y: number }>();
  const band = new Map<string, number>();
  let changes = 0;
  for (const a of bundle.arrivals) {
    pos.set(a.actor, { x: a.x, y: a.y });
    for (const [other, p] of pos) {
      if (other === a.actor) continue;
      const key = [a.actor, other].sort().join("|");
      const b = distBand(Math.abs(p.x - a.x) + Math.abs(p.y - a.y));
      const before = band.get(key);
      if (before !== undefined && before !== b) changes++;
      band.set(key, b);
    }
  }
  return changes;
}

export function scoreEmbodiment(bundle: RunBundle, norms: CinemaNorms, opts: { humanlike?: HumanLikeReport } = {}): GroupScore {
  const B = norms.bands;
  const minutes = Math.max(1 / 6, bundle.durationS / 60);
  const visible = bundle.acts.filter(isVisibleAct);
  const readings: Reading[] = [];
  const actors = bundle.cast.length > 0 ? bundle.cast : [...new Set(bundle.bodyCmds.map((c) => c.actor))];
  const nActors = Math.max(1, actors.length);

  // ---- acts per minute and the verb ladder
  // acts per minute of the run, the denominator `scripts/run-metrics.mjs` uses too; the corpus reader divides by first-to-last event (under 10% apart on
  // the baseline runs). Hard acts are counted by the corpus's own reader (measure.ts renders each act on screen as a direction).
  const f = measureRun(bundle).features;
  readings.push(read("actsPerMin", visible.length / minutes, 0.16, B.actsPerMin, `${visible.length} acts on screen in ${round1(minutes)} min (${bundle.acts.length - visible.length} more never played out)`));
  if (f?.hardActs != null) readings.push(read("hardActs", f.hardActs, 0.06, bandFor(norms, "hardActs", f.turns), `${f.hardActs} hard physical act(s) (a strike, shove, grab, kill, collapse, kiss or embrace) in ${f.turns} turns`));
  const verbs = new Map<string, number>();
  for (const a of visible) verbs.set(a.verb, (verbs.get(a.verb) ?? 0) + 1);
  if (visible.length === 0) {
    readings.push(readFail("distinctVerbs", 0.1, "no acts", B.distinctVerbs));
    readings.push(readFail("ladderSpan", 0.1, "no acts", B.ladderSpan));
    readings.push(readFail("topVerbShare", 0.05, "no acts", B.topVerbShare));
  } else {
    readings.push(read("distinctVerbs", verbs.size, 0.1, B.distinctVerbs, `verbs used: ${[...verbs].map(([v, n]) => `${v} x${n}`).join(", ")}`));
    const rungs = visible.map((a) => (LADDER_RUNGS as readonly string[]).indexOf(a.verb)).filter((r) => r >= 0);
    const span = rungs.length === 0 ? 0 : Math.max(...rungs) - Math.min(...rungs);
    readings.push(read("ladderSpan", span, 0.1, B.ladderSpan, rungs.length === 0 ? "no act on the drama ladder (glare, insult, shove, slap, punch, kill)" : `ladder rungs ${Math.min(...rungs) + 1} to ${Math.max(...rungs) + 1}`));
    const top = [...verbs].sort((a, b) => b[1] - a[1])[0]!;
    readings.push(read("topVerbShare", top[1] / visible.length, 0.05, B.topVerbShare, `${top[0]} is ${top[1]} of ${visible.length} acts (act_spam above ~50%)`));
  }

  // ---- faces and gestures
  const faces = new Set(bundle.bodyCmds.filter((c) => c.kind === "expression" && c.detail).map((c) => c.detail!));
  const gestures = new Set(bundle.bodyCmds.filter((c) => c.kind === "action" && c.detail && !IDLE_GESTURES.has(c.detail)).map((c) => c.detail!));
  readings.push(read("distinctFaces", faces.size, 0.08, B.distinctFaces, faces.size === 0 ? "no expression was commanded" : `faces: ${[...faces].join(", ")}`));
  readings.push(read("distinctGestures", gestures.size, 0.05, B.distinctGestures, gestures.size === 0 ? "no gesture was commanded" : `gestures: ${[...gestures].join(", ")}`));

  // ---- reaction integrity: of the reactions the acts' contact beats said were owed, how many were not missed
  const owed = visible.reduce((a, x) => a + x.owed, 0);
  const missed = visible.reduce((a, x) => a + x.owedMissed, 0);
  const noReaction = visible.filter((a) => a.contact && a.owed > 0 && a.reactions === 0).length;
  readings.push(
    owed === 0
      ? { metric: "reactionIntegrity", value: null, score: null, weight: 0.15, band: B.reactionIntegrity, note: "no act owed a reaction, so nothing to check" }
      : read("reactionIntegrity", 1 - missed / owed, 0.15, B.reactionIntegrity, `${owed - missed} of ${owed} owed reactions delivered; ${noReaction} act(s) with a contact and no reaction at all`),
  );

  // ---- blocking and movement
  const walks = bundle.bodyCmds.filter((c) => c.kind === "walk").length;
  readings.push(read("walksPerActorMin", walks / nActors / minutes, 0.05, B.walksPerActorMin, `${walks} walks by ${nActors} actors in ${round1(minutes)} min`));
  const tiles = new Map<string, Set<string>>();
  for (const a of bundle.arrivals) {
    const s = tiles.get(a.actor) ?? new Set<string>();
    s.add(`${a.x},${a.y}`);
    tiles.set(a.actor, s);
  }
  const meanTiles = tiles.size === 0 ? 0 : [...tiles.values()].reduce((a, s) => a + s.size, 0) / Math.max(nActors, tiles.size);
  readings.push(read("distinctTilesPerActor", meanTiles, 0.05, B.distinctTilesPerActor, `${round1(meanTiles)} distinct tiles stood on per actor`));
  const prox = proximityChanges(bundle);
  readings.push(read("proximityChanges", prox, 0.07, B.proximityChanges, `pairs crossed between touching (<=${NEAR_TILES} tiles), talking (<=${MID_TILES}) and across the room ${prox} times`));

  // ---- entrances and exits
  const entered = new Set(bundle.entrances.map((e) => e.actor));
  readings.push(read("entranceShare", entered.size / nActors, 0.05, B.entranceShare, `${entered.size} of ${nActors} actors walked in`));
  const exits = bundle.exits.filter((e) => e.tS < bundle.durationS - END_CLEAR_S);
  readings.push(read("exits", exits.length, 0.05, B.exits, exits.length === 0 ? "nobody left the scene before the end" : `${exits.length} exit(s): ${exits.map((e) => `${e.actor} (${e.via}) at ${round1(e.tS)} s`).join(", ")}`));

  // ---- human-likeness (agent B5's module), only when a report was handed in
  if (opts.humanlike) {
    const c = Object.entries(opts.humanlike.components).map(([k, v]) => `${k} ${round1(v)}`).join(", ");
    readings.push(readScore("humanLike", opts.humanlike.score0to100, opts.humanlike.score0to100, HUMANLIKE_WEIGHT, `human-likeness report ${round1(opts.humanlike.score0to100)}/100${c ? ` (${c})` : ""}`));
  }

  return groupOf("embodiment", readings, {
    humanLike: opts.humanlike ? { score0to100: opts.humanlike.score0to100, components: opts.humanlike.components } : "off",
    acts: visible.length,
    actsNotPlayed: bundle.acts.length - visible.length,
    verbs: Object.fromEntries(verbs),
    faces: [...faces],
    gestures: [...gestures],
    owedReactions: owed,
    missedReactions: missed,
    walks,
  }, ["actsPerMin", "ladderSpan"]);
}
