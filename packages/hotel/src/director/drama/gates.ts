import type { ActOrigin, ActVerb, AvatarState } from "@perfectman/shared";
import { LADDER_VERBS, PHYSICAL_VERBS, ladderRung } from "@perfectman/shared";
import { HUMAN_REF } from "../../authoring/scenario-drama.js";
import type { RunDrama } from "../../authoring/scenario-drama.js";
import { chebyshev } from "../../space/geometry.js";
import type { BlockedReason } from "../index.js";
import { HARM_VERBS, LIMITS, VERB_GATES } from "./tuning.js";

/**
 * The sidecar's copy of the hotel's gates (act-contract.md 2.4, GATE-1 to GATE-10, in the order of `enums.gate_order`).
 * Pure: the world it reads comes in as a value, so the same table of cases that the hotel runs (fixture
 * `blocked-all-reasons.jsonl`) can be run here (GATE-5, GATE-8, LAD-1). The first gate that blocks decides.
 */

export type GateAvatar = { id: number; human: boolean; tile: readonly [number, number]; state: AvatarState; fallen: boolean };

/** The ladder, the budgets and the chips as the gates read them; `ActLedger` implements it. */
export interface LadderView {
  rungCur(actor: number, target: number): number;
  lastPhysicalAt(): number | undefined;
  kills(): number;
  lastSameVerbAt(actor: number, verb: ActVerb, target: number | undefined): number | undefined;
  chipBusy(human: number): boolean;
  chipCooldownUntil(human: number): number | undefined;
}

export type GateInput = {
  verb: ActVerb;
  actor: number;
  target: number | undefined;
  origin: ActOrigin;
  authoredSkip: boolean;
  now: number;
  /** GATE-1: the hotel's runtime switch, as `drama_state` last said. */
  enabled: boolean;
  /** GATE-2. */
  calm: boolean;
  /** GATE-3: the room is auto-paused (SAFE-4). */
  paused: boolean;
  /** GATE-3: landed plus reserved violent acts at humans in the room's window, and the most the window holds. */
  harm: { count: number; max: number };
  /** GATE-6: human ids in the room whose session opted in. */
  optIn: ReadonlySet<number>;
  /**
   * GATE-6 for a human target: the scene lets a human be the target of an act without the per-act consent chip (`RunDrama.humansTargetable`, default true; the owner's call, 2026-11).
   * An act at a human who did not opt in is not refused for want of the chip. `false` is the old gate.
   */
  humansTargetable: boolean;
  /** The player's Block: true when the human `human` blocked the actor `actor`. A blocked actor never targets the blocker, with or without the chip (GATE-6 `blocked`). Absent: nobody blocked anyone. */
  blocks?: (human: number, actor: number) => boolean;
  /** GATE-5. */
  scenario: RunDrama;
  /** The `person-N` refs of the principals, for `may_target` and `may_die`; undefined for a human. */
  actorRef: string | undefined;
  targetRef: string | undefined;
  /** Every avatar in the actor's room, principals included. */
  avatars: readonly GateAvatar[];
  ladder: LadderView;
};

export type GateVerdict =
  | { ok: true; rung: number | undefined; skippedRungs: ActVerb[] }
  | { ok: false; reason: BlockedReason; detail?: string; rule: string };

const block = (reason: BlockedReason, rule: string, detail?: string): GateVerdict => ({ ok: false, reason, rule, ...(detail !== undefined ? { detail } : {}) });

export function reviewGates(i: GateInput): GateVerdict {
  const gate = VERB_GATES[i.verb];
  const rung = ladderRung(i.verb);
  const target = i.target === undefined ? undefined : i.avatars.find((a) => a.id === i.target);
  const targetHuman = target?.human ?? (i.target !== undefined && i.target > 0);

  // GATE-1
  if (!i.enabled) return block("kill_switch", "GATE-1");
  // GATE-2
  if (i.calm && gate.calmBlocks) return block("calm_room", "GATE-2");
  // GATE-3: only a violent verb at a human counts, and a pause blocks all of them.
  if (targetHuman && HARM_VERBS.has(i.verb) && (i.paused || i.harm.count >= i.harm.max)) return block("rate_limit", "GATE-3");
  // GATE-4: a fallen target (`tend_fallen` is the one verb that wants one).
  if (i.target !== undefined && i.verb !== "tend_fallen" && target?.fallen) return block("dead_target", "GATE-4");
  // GATE-5
  const scenario = scenarioGate(i, rung);
  if (scenario) return scenario;
  // GATE-6: the player's Block always holds; the chip only while the scene asks for one.
  if (targetHuman && i.target !== undefined && i.blocks?.(i.target, i.actor) === true) return block("consent_off", "GATE-6", "blocked");
  if (targetHuman && !i.humansTargetable && (gate.consent === "violent_chip" || gate.consent === "violent_chip_noncontact") && i.target !== undefined && !i.optIn.has(i.target)) return block("consent_off", "GATE-6");
  // GATE-7
  const far = distanceGate(i, gate, target);
  if (far) return far;
  // GATE-8
  const ladder = ladderGate(i, rung);
  if (!ladder.ok) return ladder.verdict;
  // GATE-9: a kill is also a physical beat (LAD-3), so it is held to the spacing as well, after its own count (LAD-4).
  if (gate.budget === "kill" && i.ladder.kills() >= LIMITS.killsPerScene) return block("budget", "GATE-9", "kill");
  if ((PHYSICAL_VERBS as readonly string[]).includes(i.verb)) {
    const last = i.ladder.lastPhysicalAt();
    if (last !== undefined && i.now - last < LIMITS.physicalSpacingMs) return block("budget", "GATE-9", "physical");
  }
  // GATE-10
  if (gate.cooldown) {
    const last = i.ladder.lastSameVerbAt(i.actor, i.verb, i.target);
    if (last !== undefined && i.now - last < LIMITS.sameVerbCooldownMs) return block("cooldown", "GATE-10", "verb");
  }
  if (targetHuman && gate.consent !== null && i.target !== undefined && (!i.humansTargetable || i.optIn.has(i.target))) {
    const until = i.ladder.chipCooldownUntil(i.target);
    if (until !== undefined && i.now < until) return block("cooldown", "GATE-10", "chip_cooldown");
    if (i.ladder.chipBusy(i.target)) return block("cooldown", "GATE-10", "chip_busy");
  }
  return { ok: true, rung, skippedRungs: ladder.skipped };
}

/** GATE-5 and SCN-1 to SCN-4. */
function scenarioGate(i: GateInput, rung: number | undefined): GateVerdict | undefined {
  const { block: drama, effective, freePlay } = i.scenario;
  const gate = VERB_GATES[i.verb];

  if (i.authoredSkip) {
    // LAD-2, SCN-4: only an authored beat of the scenario, in a scenario that has a block (even an empty one) whose ceiling covers the verb.
    const covered = drama !== undefined && (rung === undefined || rung <= drama.max_rung);
    if (i.origin !== "scenario" || !covered) return block("no_scenario_gate", "GATE-5", "skip");
  }
  const needsBlock = gate.scenario === "needs_block" || gate.scenario === "needs_block_and_may_die";
  if (freePlay && (needsBlock || gate.scenario === "needs_may_die")) return block("no_scenario_gate", "GATE-5", "free_play");
  if (rung !== undefined && rung > effective.max_rung) return block("no_scenario_gate", "GATE-5", "max_rung");

  if (needsBlock && rung !== undefined && rung >= 4 && i.actorRef !== undefined) {
    const victim = i.targetRef ?? (i.target !== undefined && i.target > 0 ? HUMAN_REF : undefined);
    if (victim === undefined || !effective.may_target.some(([a, v]) => a === i.actorRef && v === victim)) return block("no_scenario_gate", "GATE-5", "may_target");
  }
  if (gate.scenario === "needs_block_and_may_die") {
    const victim = i.targetRef ?? (i.target !== undefined && i.target > 0 ? HUMAN_REF : undefined);
    if (victim === undefined || !effective.may_die.includes(victim)) return block("no_scenario_gate", "GATE-5", "may_die");
  }
  if (gate.scenario === "needs_may_die" && (i.actorRef === undefined || !effective.may_die.includes(i.actorRef))) return block("no_scenario_gate", "GATE-5", "may_die");
  return undefined;
}

/** GATE-7: how far, and whether the principals are still and on their feet. A principal the mirror cannot place is not judged (the hotel decides). */
function distanceGate(i: GateInput, gate: (typeof VERB_GATES)[ActVerb], target: GateAvatar | undefined): GateVerdict | undefined {
  if (gate.maxDist === null || target === undefined) return undefined;
  const actor = i.avatars.find((a) => a.id === i.actor);
  if (!actor) return undefined;
  if (chebyshev(actor.tile, target.tile) > gate.maxDist) return block("too_far", "GATE-7", "distance");
  if (gate.still) {
    if (actor.state === "walk" || target.state === "walk") return block("too_far", "GATE-7", "moving");
    if (!(actor.state === "stand" || actor.state === "sit") || !(target.state === "stand" || target.state === "sit")) return block("too_far", "GATE-7", "posture");
  }
  return undefined;
}

/** GATE-8: LAD-1 (one rung per beat, or an authored skip), LAD-11 (an autonomous rung 4 or above needs a witness). */
function ladderGate(i: GateInput, rung: number | undefined): { ok: true; skipped: ActVerb[] } | { ok: false; verdict: GateVerdict } {
  if (rung === undefined || i.target === undefined) return { ok: true, skipped: [] };
  const cur = i.ladder.rungCur(i.actor, i.target);
  const legal = Math.max(cur, 1) + 1;
  const skipping = rung > legal;
  if (skipping && !(i.authoredSkip && i.origin === "scenario")) return { ok: false, verdict: block("ladder", "LAD-1", "rung") };
  if ((i.origin === "model" || i.origin === "director") && rung > LIMITS.zeroWitnessCapRung && !hasWitness(i)) return { ok: false, verdict: block("ladder", "LAD-11", "zero_witness") };
  return { ok: true, skipped: skipping ? (LADDER_VERBS as readonly ActVerb[]).filter((_, idx) => idx + 1 > Math.max(cur, 0) && idx + 1 < rung) : [] };
}

/** LAD-11: any avatar but the principals within earshot of either of them, alive, on its feet. Humans count. */
function hasWitness(i: GateInput): boolean {
  const actor = i.avatars.find((a) => a.id === i.actor);
  const target = i.avatars.find((a) => a.id === i.target);
  if (!actor || !target) return true; // not placed: the hotel decides
  return i.avatars.some(
    (a) =>
      a.id !== i.actor &&
      a.id !== i.target &&
      !a.fallen &&
      (a.state === "stand" || a.state === "sit") &&
      (chebyshev(a.tile, actor.tile) <= LIMITS.earshotTiles || chebyshev(a.tile, target.tile) <= LIMITS.earshotTiles),
  );
}
