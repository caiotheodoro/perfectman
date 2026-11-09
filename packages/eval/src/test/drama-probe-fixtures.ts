import type {
  ActBeatEvent,
  ActDoneEvent,
  ActorDeathEvent,
  ActorReviveEvent,
  ActOutcome,
  ActReactionEvent,
  ActStartedEvent,
  BodyActEvent,
  ConsentChipAnsweredEvent,
  DramaEvent,
  HumanDownEvent,
  HumanUpEvent,
  OwedRole,
  SceneCutEvent,
  SpeechEvent,
} from "../drama/index.js";

export const ROOM = "17";
export const ACTORS = ["a", "b", "c", "d"];

export const started = (actId: string, atMs: number, actor: string, verb: string, extra: Partial<ActStartedEvent> = {}): ActStartedEvent => ({
  kind: "act_started",
  atMs,
  room: ROOM,
  actId,
  verb,
  actor,
  intensity: 0.5,
  ...extra,
});
export const reaction = (actId: string, atMs: number, who: string, role: OwedRole = "witness", extra: Partial<ActReactionEvent> = {}): ActReactionEvent => ({
  kind: "act_reaction",
  atMs,
  room: ROOM,
  actId,
  who,
  role,
  reaction: "gasp",
  ...extra,
});
/** Contact. `owed` is `[who, role]` pairs: what the hotel says is owed, the only debts the probes read. */
export const beat = (actId: string, atMs: number, owed: Array<[string, OwedRole]> = [], extra: Partial<ActBeatEvent> = {}): ActBeatEvent => ({
  kind: "act_beat",
  atMs,
  room: ROOM,
  actId,
  beat: "contact",
  witnesses: owed.filter(([, role]) => role === "witness").map(([who]) => who),
  owed: owed.map(([who, role]) => ({ who, role })),
  ...extra,
});
export const done = (actId: string, atMs: number, outcome: ActOutcome = "landed", extra: Partial<ActDoneEvent> = {}): ActDoneEvent => ({ kind: "act_done", atMs, room: ROOM, actId, outcome, ...extra });
export const death = (actor: string, atMs: number): ActorDeathEvent => ({ kind: "actor_death", atMs, room: ROOM, actor });
export const revive = (actor: string, atMs: number, extra: Partial<ActorReviveEvent> = {}): ActorReviveEvent => ({ kind: "actor_revive", atMs, room: ROOM, actor, ...extra });
export const sceneCut = (atMs: number, scene: string, revived: string[] = [], removed: string[] = []): SceneCutEvent => ({ kind: "scene_cut", atMs, scene, revived, removed });
export const humanDown = (human: string, atMs: number, ms = 5000, extra: Partial<HumanDownEvent> = {}): HumanDownEvent => ({ kind: "human_down", atMs, room: ROOM, human, ms, ...extra });
export const humanUp = (human: string, atMs: number, reason = "timer", extra: Partial<HumanUpEvent> = {}): HumanUpEvent => ({ kind: "human_up", atMs, room: ROOM, human, reason, ...extra });
export const speech = (actor: string, atMs: number, text = "hi", mode = "say"): SpeechEvent => ({ kind: "speech", atMs, room: ROOM, actor, mode, text });
export const bodyAct = (actor: string, atMs: number, act: BodyActEvent["act"] = "gesture", name = "wave"): BodyActEvent => ({ kind: "body_act", atMs, room: ROOM, actor, act, name });
export const take = (actId: string, atMs: number, actor = "h:9", withRef = "a"): ConsentChipAnsweredEvent => ({
  kind: "consent_chip",
  phase: "answered",
  atMs,
  room: ROOM,
  pairId: actId,
  actId,
  actor,
  with: withRef,
  answer: "take",
  rawAnswer: "take",
});

export const input = (events: DramaEvent[], extra: { durationMs?: number; actorIds?: string[] } = {}) => ({ events, actorIds: extra.actorIds ?? ACTORS, ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}) });
