import type {
  ActDoneEvent,
  ActorDeathEvent,
  ActOutcome,
  ActReactionEvent,
  ActStartedEvent,
  BodyActEvent,
  ConsentChipAnsweredEvent,
  SpeechEvent,
  DramaEvent,
} from "../drama/index.js";
import type { PositionLookup } from "../probes/embodiment.js";

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
export const reaction = (actId: string, atMs: number, who: string, role: "target" | "witness" = "witness"): ActReactionEvent => ({
  kind: "act_reaction",
  atMs,
  room: ROOM,
  actId,
  who,
  role,
  reaction: "gasp",
});
export const done = (actId: string, atMs: number, outcome: ActOutcome = "landed"): ActDoneEvent => ({ kind: "act_done", atMs, room: ROOM, actId, outcome });
export const death = (actor: string, atMs: number): ActorDeathEvent => ({ kind: "actor_death", atMs, room: ROOM, actor });
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
});

export const input = (events: DramaEvent[], extra: { durationMs?: number; actorIds?: string[] } = {}) => ({ events, actorIds: extra.actorIds ?? ACTORS, ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}) });


/** A fixed floor plan: ref -> tile, all in the scene's room. `moves` swaps in other tiles from a given instant on. */
export const plan = (tiles: Record<string, [number, number]>, moves: { fromMs: number; tiles: Record<string, [number, number]> } | undefined = undefined): PositionLookup =>
  (ref, atMs) => {
    const tile = (moves !== undefined && atMs >= moves.fromMs ? moves.tiles[ref] : undefined) ?? tiles[ref];
    return tile === undefined ? undefined : { room: ROOM, tile };
  };

