import type { ActionEmotions, ActVerb, BodyCommandBody, Presence, RelationalState, RoomView, Tile } from "@perfectman/shared";
import { chebyshev, dirDiffDeg, sectorTo } from "../space/geometry.js";
import { BAND, FACE_TOLERANCE_DEG, KEEP } from "./constants.js";
import {
  EDGE_OF_GROUP,
  ENVY_KEEP,
  GRIEVANCE_RESENTMENT,
  GRIEVANCE_TRUST,
  IMPULSE_LOWER,
  JEALOUS_ALTERNATE_MS,
  MOMENTUM_GAIN,
  MOMENTUM_MAX,
  MOOD_FACE_RADIUS,
  NO_GRIEVANCE_FACTOR,
  PATIENCE_RAISE,
  SOLO_COOLDOWN_MS,
  SOLO_THETA,
  STANCE_THETA,
  SUSPICION_KEEP,
} from "./drama-readings.js";
import { pickTile } from "./tiles.js";
import type { PlanInput, PlannerMemory } from "./types.js";

/** A command the emotion rules want, with the keep priority the planner's budget sorts by. */
export type EmotionCand = { keep: number; cmd: BodyCommandBody & { afterArrival?: string } };

export type EmotionCtx = {
  input: PlanInput;
  room: RoomView;
  self: Presence;
  mem: PlannerMemory;
  /** The planner's id for the walk this plan starts, so a command can wait for its arrival. */
  planId: string;
};

const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const SOLO_VERBS: readonly ActVerb[] = ["storm_off", "cry", "faint", "turn_back", "recoil", "freeze_gasp"];

type Who = { p: Presence; rel: RelationalState | undefined; dist: number };

/**
 * What an actor's whole emotion state does to its body (verb-bible 4.2 to 4.5), for a run with drama on. The 15 action
 * tendencies, the 15 social emotions, the core mood and the relational state toward each person in the room are all read
 * here; none of them was before. Three kinds of decision come out: a solo or targeted verb (`act`), one posture or approach
 * stance, and the mood's face. At most one verb and one stance per call, so a feeling is one visible choice, not a pile.
 */
export function emotionRules(ctx: EmotionCtx): EmotionCand[] {
  const { input, self } = ctx;
  const A = input.actionEmotions ?? ZERO_ACT;
  const fallen = input.drama?.fallen ?? new Map();
  const people: Who[] = ctx.room.occupants
    .filter((p) => p.ref !== self.ref && !fallen.has(p.ref))
    .map((p) => ({ p, rel: input.agentState.relationalStates.get(p.ref), dist: chebyshev(p.tile, self.tile) }))
    .filter((w) => w.dist <= BAND.socialMax);

  const verb = soloVerb(ctx, A, people);
  if (verb) return verb;
  const rescue = rescueOrTend(ctx, A);
  if (rescue) return rescue;
  const stance = bestStance(ctx, A, people);
  if (stance) return stance;
  return moodFace(ctx) ?? [];
}

// ---- thresholds ------------------------------------------------------------------------------------------------------

/** A threshold seed, moved by momentum, patience and impulsiveness (bible 4.4, 4.5). */
function theta(seed: number, ctx: EmotionCtx, A: ActionEmotions): number {
  const m = ctx.input.agentState.coreMood;
  const shift = clamp(MOMENTUM_GAIN * m.momentumArousal, -MOMENTUM_MAX, MOMENTUM_MAX) + clamp(-MOMENTUM_GAIN * m.momentumValence, -MOMENTUM_MAX, MOMENTUM_MAX);
  return seed - shift + PATIENCE_RAISE * A.strategicPatience - IMPULSE_LOWER * A.impulsiveProvocation;
}

const cooling = (ctx: EmotionCtx, verb: ActVerb): boolean => {
  const at = ctx.mem.soloAt?.[verb];
  return at !== undefined && ctx.input.now - at < (SOLO_COOLDOWN_MS[verb] ?? 0);
};

/** The mood's intensity: the circumplex radius, which the verb table turns into an impact class and a pace. */
const intensityOf = (ctx: EmotionCtx): { intensity?: number } => {
  const r = Math.round(ctx.input.agentState.coreMood.circumplexRadius * 100) / 100;
  return r > 0 ? { intensity: clamp(r, 0, 1) } : {};
};

const actCmd = (ctx: EmotionCtx, verb: ActVerb, withRef?: string): EmotionCand => ({
  keep: KEEP.gesture,
  cmd: { cmd: "act", actId: ctx.input.drama?.nextActId() ?? "", verb, origin: "director", ...(withRef ? { with: withRef } : {}), ...intensityOf(ctx) },
});

// ---- solo and targeted verbs -------------------------------------------------------------------------------------------

/** A grievance toward someone: a negative event that is not outweighed by a later positive one, a resentful or distrustful view, or a resentful heart (bible 4.5). */
function grievance(ctx: EmotionCtx, rel: RelationalState | undefined): boolean {
  if (ctx.input.agentState.socialEmotions.resentment >= GRIEVANCE_RESENTMENT) return true;
  if (!rel) return false;
  if (rel.resentment >= GRIEVANCE_RESENTMENT || rel.trust <= GRIEVANCE_TRUST) return true;
  return rel.lastNegativeAt !== null && (rel.lastPositiveAt === null || rel.lastNegativeAt >= rel.lastPositiveAt);
}

/** You can only give the cold shoulder to someone you have dealt with. */
const known = (rel: RelationalState | undefined): boolean => rel !== undefined && (rel.interactionCount > 0 || rel.lastInteractionAt !== null);

type Option = { verb: ActVerb; margin: number; make: () => EmotionCand[] };

function soloVerb(ctx: EmotionCtx, A: ActionEmotions, people: Who[]): EmotionCand[] | undefined {
  const { input } = ctx;
  const S = input.agentState.socialEmotions;
  const M = input.agentState.coreMood;
  const options: Option[] = [];
  const add = (verb: ActVerb, v: number, make: () => EmotionCand[]): void => {
    const t = theta(SOLO_THETA[verb] ?? 0.7, ctx, A);
    if (v >= t && !cooling(ctx, verb)) options.push({ verb, margin: v - t, make });
  };

  const sad = 0.5 * clamp(-M.valence, 0, 1) + 0.5 * (1 - M.energy);
  add("storm_off", Math.max(S.humiliation, S.resentment, S.shame, A.resentfulColdness, A.shameWithdrawal), () => [actCmd(ctx, "storm_off")]);
  add("cry", Math.max(sad, S.shame, S.humiliation, A.vulnerableRetreat, A.shameWithdrawal), () => [actCmd(ctx, "cry")]);
  const faintSpike = M.energy < 0.15 && M.momentumArousal > 0.3 ? 0.9 : 0;
  add("faint", Math.max(S.shame, S.humiliation, S.fearOfExclusion, faintSpike), () => [actCmd(ctx, "faint")]);
  if (M.momentumArousal >= 0.3) add("freeze_gasp", M.arousal, () => [actCmd(ctx, "freeze_gasp")]);

  // recoil: a quick lean away from someone close that this actor fears.
  const close = people.find((w) => w.dist <= BAND.intimate && (w.rel?.threat ?? 0) > 0.5);
  if (close) add("recoil", A.defensiveness, () => [actCmd(ctx, "recoil")]);

  // turn_back: toward the person it has the most reason to turn from.
  let best: { who: Who; v: number } | undefined;
  for (const w of people) {
    if (!known(w.rel)) continue;
    const g = grievance(ctx, w.rel) ? 1 : NO_GRIEVANCE_FACTOR;
    const v = Math.max(g * Math.max(S.contempt, S.shame, S.resentment), A.resentfulColdness, A.contemptuousDismissal, A.defensiveness, w.rel?.desireForDistance ?? 0);
    if (!best || v > best.v) best = { who: w, v };
  }
  if (best) add("turn_back", best.v, () => [actCmd(ctx, "turn_back", best.who.p.ref)]);

  const pick = options.sort((a, b) => b.margin - a.margin || SOLO_VERBS.indexOf(a.verb) - SOLO_VERBS.indexOf(b.verb))[0];
  return pick?.make();
}

// ---- rescuers, tenders ------------------------------------------------------------------------------------------------

/** Walks next to `target` and plays `verb` on arrival; plays it at once when already adjacent. */
function reachThen(ctx: EmotionCtx, verb: ActVerb, target: Presence): EmotionCand[] {
  if (chebyshev(ctx.self.tile, target.tile) <= 1) return [actCmd(ctx, verb, target.ref)];
  const to = pickTile({ room: ctx.room, self: ctx.self.ref, near: target.tile, radius: 1, awayFrom: { tile: target.tile, ideal: 1 }, rng: ctx.input.rng });
  if (!to) return [];
  const act = actCmd(ctx, verb, target.ref);
  return [{ keep: KEEP.move, cmd: { cmd: "walk", to, plan: ctx.planId } }, { ...act, cmd: { ...act.cmd, afterArrival: ctx.planId } }];
}

function rescueOrTend(ctx: EmotionCtx, A: ActionEmotions): EmotionCand[] | undefined {
  const { input, self, room } = ctx;
  const rels = input.agentState.relationalStates;
  const fallen = input.drama?.fallen ?? new Map();

  // tend_fallen: someone on the floor within reach, and a reason to go to them.
  const tend = room.occupants
    .filter((p) => p.ref !== self.ref && fallen.has(p.ref) && chebyshev(p.tile, self.tile) <= BAND.socialMax)
    .map((p) => ({ p, v: Math.max(A.repairImpulse, A.comfortSeeking, A.warmth, rels.get(p.ref)?.affection ?? 0) }))
    .sort((a, b) => b.v - a.v || chebyshev(a.p.tile, self.tile) - chebyshev(b.p.tile, self.tile))[0];
  if (tend && tend.v >= theta(SOLO_THETA.tend_fallen ?? 0.6, ctx, A) && !cooling(ctx, "tend_fallen")) return reachThen(ctx, "tend_fallen", tend.p);

  // restrain: a violent act just landed in front of this actor and it wants to put it right (a rescuer).
  const r = input.drama?.rescue;
  if (r && r.aggressor !== self.ref && r.victim !== self.ref && !r.aggressor.startsWith("h:")) {
    const aggressor = room.occupants.find((p) => p.ref === r.aggressor && !fallen.has(p.ref));
    const v = Math.max(A.repairImpulse, rels.get(r.victim)?.affection ?? 0);
    if (aggressor && v >= theta(SOLO_THETA.restrain ?? 0.6, ctx, A) && !cooling(ctx, "restrain")) return reachThen(ctx, "restrain", aggressor);
  }

  // tableau: its own embrace, kiss or restraint just landed and it likes a held picture.
  if (input.drama?.staged && A.pridefulPerformance >= theta(SOLO_THETA.tableau ?? 0.6, ctx, A) && !cooling(ctx, "tableau")) return [actCmd(ctx, "tableau")];
  return undefined;
}

// ---- stances ---------------------------------------------------------------------------------------------------------------

type Stance = { v: number; make: () => EmotionCand[] };

const argmax = (people: Who[], f: (w: Who) => number): Who | undefined =>
  [...people].sort((a, b) => f(b) - f(a) || a.dist - b.dist || a.p.ref.localeCompare(b.p.ref))[0];

function bestStance(ctx: EmotionCtx, A: ActionEmotions, people: Who[]): EmotionCand[] | undefined {
  const { input, room, self, mem } = ctx;
  const S = input.agentState.socialEmotions;
  const M = input.agentState.coreMood;
  const stances: Stance[] = [];
  const face = (p: Presence): EmotionCand[] =>
    self.state !== "walk" && dirDiffDeg(sectorTo(self.tile, p.tile), self.dir) > FACE_TOLERANCE_DEG ? [{ keep: KEEP.face, cmd: { cmd: "face", targetTile: p.tile } }] : [];
  const express = (f: string): EmotionCand[] => (mem.lastExpression === f ? [] : [{ keep: KEEP.face, cmd: { cmd: "expression", face: f } }]);
  const walkTo = (to: Tile | undefined): EmotionCand[] => (to ? [{ keep: KEEP.move, cmd: { cmd: "walk", to, plan: ctx.planId } }] : []);
  const away = (w: Who, ideal: number): Tile | undefined => pickTile({ room, self: self.ref, near: self.tile, radius: ideal, awayFrom: { tile: w.p.tile, ideal }, rng: input.rng });
  const toward = (w: Who, ideal: number): Tile | undefined => pickTile({ room, self: self.ref, near: w.p.tile, radius: ideal + 1, awayFrom: { tile: w.p.tile, ideal }, rng: input.rng });
  const add = (v: number, seed: number, make: () => EmotionCand[]): void => void (v >= seed && stances.push({ v, make }));

  // anger and dominance: face the one it resents, angry, and close in when it wants to be seen to win.
  if (M.arousal >= 0.5 && M.valence <= -0.2) {
    const w = argmax(people, (x) => x.rel?.resentment ?? 0);
    const v = Math.max(S.resentment, A.dominanceAssertion);
    if (w) add(v, theta(STANCE_THETA, ctx, A), () => [...express("angry"), ...face(w.p), ...(A.dominanceAssertion >= STANCE_THETA && w.dist > BAND.personal + 1 ? walkTo(toward(w, BAND.personal)) : [])]);
  }
  // jealousy: watches the one it wants, angry then sad (no validated display, bible 4.2).
  const jealous = argmax(people, (x) => x.rel?.attraction ?? 0);
  if (jealous) {
    const face2 = Math.floor(ctx.input.now / JEALOUS_ALTERNATE_MS) % 2 === 0 ? "angry" : "sad";
    add(Math.max(S.jealousy, A.jealousInspection), STANCE_THETA, () => [...express(face2), ...face(jealous.p)]);
  }
  // envy and suspicion: keep a cool distance and keep an eye on them.
  const envied = argmax(people, (x) => x.rel?.envy ?? 0);
  if (envied) add(Math.max(S.envy, envied.rel?.envy ?? 0), STANCE_THETA, () => (envied.dist < ENVY_KEEP ? walkTo(away(envied, ENVY_KEEP)) : face(envied.p)));
  const wary = argmax(people, (x) => Math.max(x.rel?.suspicion ?? 0, -(x.rel?.trust ?? 0)));
  if (wary) add(Math.max(S.suspicion, wary.rel?.suspicion ?? 0, -(wary.rel?.trust ?? 0)), STANCE_THETA, () => (wary.dist < SUSPICION_KEEP ? walkTo(away(wary, SUSPICION_KEEP)) : face(wary.p)));
  // approach stances: admiration, curiosity, comfort, intimacy, neediness.
  const approach = (target: Who | undefined, v: number, band: number, smile: boolean): void => {
    if (target) add(v, STANCE_THETA, () => [...(target.dist > band + 1 ? walkTo(toward(target, band)) : face(target.p)), ...(smile ? express("smile") : [])]);
  };
  const admired = argmax(people, (x) => x.rel?.admiration ?? 0);
  approach(admired, Math.max(S.admiration, admired?.rel?.admiration ?? 0), BAND.personal, true);
  const curious = argmax(people, (x) => x.rel?.curiosity ?? 0);
  approach(curious, Math.max(A.curiousApproach, curious?.rel?.curiosity ?? 0), BAND.personal, false);
  approach(argmax(people, (x) => (x.rel?.comfort ?? 0) + (x.rel?.affection ?? 0)), A.comfortSeeking, BAND.intimate, false);
  approach(argmax(people, (x) => (x.rel?.attraction ?? 0) + (x.rel?.comfort ?? 0)), S.desireForIntimacy, BAND.intimate, false);
  approach(argmax(people, (x) => x.rel?.comfort ?? 0), S.neediness, BAND.intimate, false);
  // left out: hovers at the edge of the group, sad.
  if (people.length >= 2) {
    const cx = people.reduce((s, w) => s + w.p.tile[0], 0) / people.length;
    const cy = people.reduce((s, w) => s + w.p.tile[1], 0) / people.length;
    const centre = people[0];
    if (centre && Math.max(Math.abs(cx - self.tile[0]), Math.abs(cy - self.tile[1])) <= 2) {
      add(S.fearOfExclusion, STANCE_THETA, () => [...express("sad"), ...walkTo(away({ ...centre, p: { ...centre.p, tile: [Math.round(cx), Math.round(cy)] } }, EDGE_OF_GROUP))]);
    }
  }
  // status and pride: takes the centre of the room, shows off.
  const middle = room.zones.find((z) => z.kind === "middle");
  if (middle && chebyshev(self.tile, middle.center) > 2) {
    add(S.desireForStatus, STANCE_THETA, () => walkTo(pickTile({ room, self: self.ref, near: middle.center, radius: 1, rng: input.rng })));
  }
  add(Math.max(S.pride, A.pridefulPerformance), STANCE_THETA, () => preen(ctx));

  const pick = stances.sort((a, b) => b.v - a.v)[0];
  return pick?.make();
}

/** Pride is posture we cannot draw, so it is a thumbs-up on the usual gesture cooldown (the planner's `gesture` rule is not reachable from here). */
function preen(ctx: EmotionCtx): EmotionCand[] {
  const { input, mem } = ctx;
  const last = input.space.body.dwell.lastGestureAt["thumbs"];
  if (input.drama?.noReward) return [];
  if (last !== undefined && input.now - last < 15_000) return [];
  if (mem.lastGesture?.a === "thumbs" && input.now - mem.lastGesture.at < 30_000) return [];
  return [{ keep: KEEP.gesture, cmd: { cmd: "gesture", a: "thumbs" } }];
}

// ---- the mood's face ---------------------------------------------------------------------------------------------------------

/** A strong mood shows on the face by its place on the circumplex (bible 4.1: body first, face second, congruent). */
function moodFace(ctx: EmotionCtx): EmotionCand[] | undefined {
  const m = ctx.input.agentState.coreMood;
  if (m.circumplexRadius < MOOD_FACE_RADIUS) return undefined;
  const v = Math.cos(m.circumplexAngle);
  const a = Math.sin(m.circumplexAngle);
  const face = v < -0.3 ? (a > 0.3 ? "angry" : "sad") : v > 0.3 ? "smile" : undefined;
  if (!face || ctx.mem.lastExpression === face) return undefined;
  return [{ keep: KEEP.face, cmd: { cmd: "expression", face } }];
}
