import type { ActOrigin, ActVerb, TableVerb } from "@perfectman/shared";
import { ACT_TARGET_MODE, impactClassOf, ladderRung } from "@perfectman/shared";
import type { ActReason, ChipAnswer, HelloDrama, HotelMsg, Owed, ReactionRole, VerbVocabRef } from "../director/index.js";
import { VERB_VOCAB_REV, VERB_VOCAB_SHA256, VERB_VOCAB_VERSION, VOCAB_CONSTANTS } from "../director/verb-vocab.generated.js";

/**
 * Pure builders of the hotel-to-sidecar frames of an act, in the order and with the fields act-contract.md section 3
 * fixes. The fake hotel plays them (`FakeDirector.scriptAct` and friends) and tests feed them straight to the router.
 * The numbers follow the contract's examples: run 7, room 12, actor -701, human 9. Nothing here decides a gate: the
 * script says what the hotel did, the way a recorded run would.
 */

export const VOCAB: VerbVocabRef = { version: VERB_VOCAB_VERSION, rev: VERB_VOCAB_REV, sha256: VERB_VOCAB_SHA256 };

export type ActOutcomeScript = "landed" | "dodged" | "declined" | "timeout" | "aborted" | "blocked";

export type ActScript = {
  actId: string;
  verb: ActVerb;
  actor?: number;
  /** The target; absent for the solo verbs. */
  with?: number;
  run?: number;
  room?: number;
  intensity?: number;
  origin?: ActOrigin;
  scene?: string;
  /** `T0`, epoch ms; every other instant is derived from it. */
  at?: number;
  outcome: ActOutcomeScript;
  /** A consent chip was shown to a human target. */
  chip?: boolean;
  answer?: ChipAnswer;
  /** `blocked` or `aborted`. */
  reason?: ActReason;
  detail?: string;
  /** Avatars in the witness set at contact (actors first, ascending). */
  witnesses?: number[];
  /** Actors that owe a reaction (the only ground truth, REA-1). */
  owed?: Array<{ who: number; role: ReactionRole }>;
  /** Reactions emitted, in order. */
  reactions?: Array<{ who: number; role: ReactionRole; reaction: string; source?: "table" | "planner" }>;
  /** `target_opt_in` of a human target, default true (every started violent act has it, GATE-6). */
  targetOptIn?: boolean;
  /** `landed` kill on an actor: the victim starts dying at contact. On a human: `human_down`. */
  death?: { victim: number; killer: number; human?: boolean; downMs?: number };
};

const DEFAULTS = { actor: -701, run: 7, room: 12, at: 1_730_000_123_456 } as const;

type Out = Extract<HotelMsg, { t: string }>;

/** The frames of one act, FRM-1: `act_started`, `drama_consent` x2 (a chip), `act_beat`, `act_reaction`*, death or down, `act_done`; FRM-2: a blocked act is one `act_done`. */
export function actFrames(s: ActScript): Out[] {
  const run = s.run ?? DEFAULTS.run;
  const room = s.room ?? DEFAULTS.room;
  const actor = s.actor ?? DEFAULTS.actor;
  const t0 = s.at ?? DEFAULTS.at;
  const scene = s.scene ?? `${run}.2`;
  const target = ACT_TARGET_MODE[s.verb] === "required" ? s.with : undefined;
  const withField = target !== undefined ? { with: target } : {};
  const intensity = s.intensity ?? 0.5;
  const out: Out[] = [];
  const base = { run, room, act_id: s.actId } as const;

  if (s.outcome === "blocked") {
    out.push({ t: "act_done", ...base, verb: s.verb as TableVerb, actor, ...withField, outcome: "blocked", ...(s.reason ? { reason: s.reason } : {}), ...(s.detail ? { detail: s.detail } : {}), owed_missed: [], downgraded: [], at: t0 });
    return out;
  }

  const rung = ladderRung(s.verb);
  const impact = impactClassOf(s.verb, intensity);
  const chip = s.chip ?? false;
  out.push({
    t: "act_started", ...base, verb: s.verb as TableVerb, actor, ...withField, intensity, ...(impact ? { impact } : {}), origin: s.origin ?? "director", scene,
    ...(rung !== undefined ? { rung } : {}), skipped_rungs: [], authored_skip: false, ...(target !== undefined && target > 0 ? { target_opt_in: s.targetOptIn ?? true } : {}), chip, contact_in_ms: chip ? null : 300, at: t0,
  });
  let at = t0;
  if (chip && target !== undefined) {
    out.push({ t: "drama_consent", ...base, phase: "shown", actor, with: target, verb: s.verb as TableVerb, family: s.verb === "hug" || s.verb === "kiss" ? "affection" : "violent", ttl_ms: VOCAB_CONSTANTS.chip_ttl_ms, at: t0 + 14 });
    const answer = s.answer ?? "take";
    at = t0 + 14 + (answer === "timeout" ? VOCAB_CONSTANTS.chip_ttl_ms : 400);
    out.push({ t: "drama_consent", ...base, phase: "answered", actor, with: target, verb: s.verb as TableVerb, family: s.verb === "hug" || s.verb === "kiss" ? "affection" : "violent", answer, at });
  }
  const contact = s.outcome === "landed" || s.outcome === "timeout";
  if (contact) {
    at += chip ? VOCAB_CONSTANTS.chip_windup_ms : 300;
    const owed: Owed[] = (s.owed ?? []).map((o) => ({ who: o.who, role: o.role, due_at: at + (o.role === "target" ? VOCAB_CONSTANTS.target_deadline_ms : VOCAB_CONSTANTS.witness_deadline_ms) }));
    out.push({ t: "act_beat", ...base, beat: "contact", at, witnesses: [...(s.witnesses ?? [])], owed });
    (s.reactions ?? []).forEach((r, i) => out.push({ t: "act_reaction", ...base, who: r.who, role: r.role, reaction: r.reaction, source: r.source ?? "table", at: at + 400 + i * 300 }));
    if (s.death && !s.death.human) out.push({ t: "actor_death", run, room, actor: s.death.victim, cause: "kill", act_id: s.actId, killer: s.death.killer, scene, at: at + 175 });
    if (s.death?.human) out.push({ t: "human_down", run, room, human: s.death.victim, act_id: s.actId, ms: s.death.downMs ?? VOCAB_CONSTANTS.human_down_ms_default, scene, at: at + 175 });
  }
  const end = at + (contact ? 2200 : 800);
  out.push({
    t: "act_done", ...base, verb: s.verb as TableVerb, actor, ...withField, outcome: s.outcome === "aborted" ? "aborted" : s.outcome,
    ...(chip && s.answer ? { answer: s.answer } : chip && s.outcome === "landed" ? { answer: "take" as const } : {}),
    ...(s.reason ? { reason: s.reason } : {}), ...(s.detail ? { detail: s.detail } : {}), owed_missed: [], downgraded: [], at: end,
  });
  if (s.death?.human) out.push({ t: "human_up", run, room, human: s.death.victim, act_id: s.actId, reason: "timer", at: at + 175 + (s.death.downMs ?? VOCAB_CONSTANTS.human_down_ms_default) });
  return out;
}

/** SCENE-4: `scene_cut`, then one `actor_revive` per revived actor and one `actor_gone{died}` per removed one (permadeath), in that order. */
export function sceneCutFrames(p: { run?: number; room?: number; scene: string; prev: string; revived?: number[]; removed?: number[]; at?: number }): Out[] {
  const run = p.run ?? DEFAULTS.run;
  const room = p.room ?? DEFAULTS.room;
  const at = p.at ?? DEFAULTS.at;
  return [
    { t: "scene_cut", run, scene: p.scene, prev: p.prev, reason: "sidecar", revived: p.revived ?? [], removed: p.removed ?? [], at },
    ...(p.revived ?? []).map((actor): Out => ({ t: "actor_revive", run, room, actor, scene: p.scene, prev: p.prev, x: 5, y: 6, effect: "", at })),
    ...(p.removed ?? []).map((actor): Out => ({ t: "actor_gone", actor, run, reason: "died" })),
  ];
}

export function dramaStateFrame(p: { run?: number; room?: number; scene?: string; enabled?: boolean; calm?: boolean; paused?: boolean; pausedUntil?: number; optIn?: number[]; at?: number }): Out {
  const run = p.run ?? DEFAULTS.run;
  return {
    t: "drama_state", run, room: p.room ?? DEFAULTS.room, scene: p.scene ?? `${run}.1`, enabled: p.enabled ?? true, calm: p.calm ?? false, paused: p.paused ?? false,
    ...(p.pausedUntil !== undefined ? { paused_until: p.pausedUntil } : {}), opt_in: p.optIn ?? [], at: p.at ?? DEFAULTS.at,
  };
}

/** The `hello.drama` block of an offering hotel (NEG-2). */
export function helloDrama(p: { vocab?: VerbVocabRef; dead?: number[]; enabled?: boolean } = {}): HelloDrama {
  return { enabled: p.enabled ?? true, verb_vocab: p.vocab ?? VOCAB, chip_ttl_ms: VOCAB_CONSTANTS.chip_ttl_ms, harm_max: VOCAB_CONSTANTS.harm_max_default, harm_window_s: VOCAB_CONSTANTS.harm_window_s_default, dead: p.dead ?? [] };
}
