import type { ActionEmotions, ActVerb, AgentState, BodyCommand, Presence, RelationalState } from "@perfectman/shared";
import { chebyshev } from "../space/geometry.js";
import type { OwedDebt } from "./act-ledger.js";
import type { PlannedCommand } from "./types.js";

/**
 * The reaction a planner gives for a debt the hotel says it owes (act-contract.md REA-1, REA-3; verb-bible 5.3). The hotel's
 * table reacts for everyone with no model at all, so this is never needed for the deadline; it is how a reaction gets to
 * be someone's own. A qualifying command that arrives after `Tc` and before the table's step replaces that step (REA-3).
 * Only the replaceable labels can be replaced, and only solo verbs, `face` and `expression` qualify (a targeted verb is not
 * a "solo verb" in the table's sense, so `turn_back` is not used as a reaction).
 */

/** The labels the table gives and the planner may replace: `look_back`, `watch`, `freeze_gasp`, `surprised` (REA-3). */
export function isReplaceable(verb: ActVerb, role: "target" | "witness"): boolean {
  // target labels: glare look_back, insult surprised, point and plead look_back (replaceable); head_snap, stagger, die, hug_back, kiss_back, struggle (never).
  return role === "witness" || verb === "glare" || verb === "insult" || verb === "point" || verb === "plead";
}

export type ReactionArgs = {
  debt: OwedDebt;
  /** The reactor's own state: its feelings and its view of the two people in the act. Absent for an actor not planned yet: it gets the plain default. */
  state?: AgentState | undefined;
  actionEmotions?: ActionEmotions | undefined;
  /** Where somebody stands, for facing and for how close the blow was. */
  presence(ref: string): Presence | undefined;
  nextActId(): string;
};

export type Reaction = { cmd: PlannedCommand; delayMs: number; label: string };

/** A stable 0..1 per (act, reactor): the seed of the variety, so the same frames always give the same reactions (REA-4). */
export function seed(actId: string, who: string): number {
  let h = 2166136261;
  for (const c of `${actId}|${who}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

const ZERO: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

const NO_SOCIAL = { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 };

const CLIMAX: ReadonlySet<ActVerb> = new Set<ActVerb>(["kill", "die", "faint"]);
const AFFECTION: ReadonlySet<ActVerb> = new Set<ActVerb>(["hug", "kiss"]);
const NONCONTACT: ReadonlySet<ActVerb> = new Set<ActVerb>(["glare", "insult"]);

const known = (rel: RelationalState | undefined): boolean => rel !== undefined && (rel.interactionCount > 0 || rel.lastInteractionAt !== null);

type Option = { score: number; label: string; make: () => BodyCommand };

export function chooseReaction(a: ReactionArgs): Reaction | undefined {
  const { debt, state } = a;
  if (!isReplaceable(debt.verb, debt.role)) return undefined;
  const A = a.actionEmotions ?? ZERO;
  const S = state?.socialEmotions ?? NO_SOCIAL;
  const me = debt.who;
  const rels = state?.relationalStates ?? new Map<string, RelationalState>();
  const aggressor = debt.actor;
  const victim = debt.target ?? debt.actor;
  const relA = rels.get(aggressor);
  const relV = rels.get(victim);
  const h = seed(debt.actId, me);
  const noise = (h - 0.5) * 0.08;
  const options: Option[] = [];
  const add = (label: string, score: number, make: () => BodyCommand): void => void (score > 0 && options.push({ score: score + noise, label, make }));
  const solo = (verb: "recoil" | "freeze_gasp" | "cry") => (): BodyCommand => ({ agentId: me, cmd: "act", actId: a.nextActId(), verb, origin: "director" });
  const faceOf = (ref: string) => (): BodyCommand => {
    const p = a.presence(ref);
    return p ? { agentId: me, cmd: "face", targetTile: p.tile } : { agentId: me, cmd: "expression", face: "neutral" };
  };
  const express = (face: string) => (): BodyCommand => ({ agentId: me, cmd: "expression", face });

  const mine = a.presence(me);
  const hitAt = a.presence(aggressor);
  const close = mine && hitAt && chebyshev(mine.tile, hitAt.tile) <= 2;
  const fear = (relA?.threat ?? 0) > 0.3 || A.defensiveness > 0.5 ? 0.2 + 0.6 * (relA?.threat ?? 0) + 0.4 * A.defensiveness : 0;
  const flinch = Math.max(fear, close && debt.role === "witness" ? 0.55 : 0);

  if (debt.role === "target") {
    // glare, insult: what it gives back.
    add("recoil", flinch, solo("recoil"));
    const stand = Math.max(relA?.resentment ?? 0, S.resentment, A.dominanceAssertion);
    if (stand >= 0.5) add("stand", 0.3 + 0.6 * stand, express("angry"));
    if (debt.verb === "insult" && A.vulnerableRetreat >= 0.6) add("cry", 0.3 + 0.6 * A.vulnerableRetreat, solo("cry"));
    add(debt.verb === "insult" ? "freeze" : "look", debt.verb === "insult" ? 0.5 : 0.35, debt.verb === "insult" ? solo("freeze_gasp") : faceOf(aggressor));
    if (debt.verb === "glare") add("look", 0.45, faceOf(aggressor));
  } else if (AFFECTION.has(debt.verb)) {
    // a hug or a kiss in front of it.
    if (A.jealousInspection >= 0.6) add("jealous", 0.5 + 0.4 * A.jealousInspection, express("angry"));
    if (A.warmth >= 0.5) add("warm", 0.4 + 0.4 * A.warmth, express("smile"));
    add("watch", 0.45, faceOf(aggressor));
  } else {
    const stranger = !known(relA) && !known(relV);
    // someone it has never dealt with draws a plain look at a glare or an insult; a blow shocks anyone.
    add("watch", NONCONTACT.has(debt.verb) && stranger ? 0.7 : 0.4, faceOf(aggressor));
    add("freeze", 0.5, solo("freeze_gasp"));
    add("recoil", flinch, solo("recoil"));
    if (CLIMAX.has(debt.verb)) {
      const love = Math.max(relV?.affection ?? 0, relV?.comfort ?? 0);
      if (love >= 0.5) add("cry", 0.35 + 0.5 * love + 0.3 * A.vulnerableRetreat, solo("cry"));
    }
    const contempt = Math.max(S.contempt, A.contemptuousDismissal);
    if (contempt >= 0.5 && Math.max(relV?.affection ?? 0, relV?.comfort ?? 0) < 0.3) add("sneer", 0.4 + 0.6 * contempt, faceOf(victim));
  }

  const pick = options.sort((x, y) => y.score - x.score)[0];
  if (!pick) return undefined;
  // Before the table's own step (a witness's is at 600 ms or later, REA-4) and well inside the window the hotel gave.
  const window = debt.role === "target" ? 100 + Math.floor(h * 300) : 150 + Math.floor(h * 400);
  const delayMs = Math.max(0, Math.min(window, debt.dueInMs - 800));
  return { cmd: { ...pick.make(), owed: true }, delayMs, label: pick.label };
}
