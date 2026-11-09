import type { DramaSession } from "../director/dialect.js";
import type { DramaFrame } from "../director/drama-frames.js";
import type { HotelFrame } from "../director/index.js";

type Frame<T extends DramaFrame["t"]> = Extract<HotelFrame, { t: T }>;

/**
 * Where the manager hands every hotel-to-sidecar frame of the drama contract (act-contract.md 3.1), one typed method per
 * frame. Packet P1 owns the routing; the director (P2) and the planner and memory (P3) implement what they need and
 * leave the rest to `NOOP_DRAMA_SINK`. A frame only gets here from a dialect 2 link (NEG-5), so a sink never has to ask
 * which dialect it is talking to. Handlers are called in the order the frames arrived, which is the order of FRM-1 and SCENE-4.
 */
export interface DramaFrameSink {
  /** Once per `hello`, before any frame: the drama state of a dialect 2 link (`dead` is a full replacement set, NEG-8), or null for a dialect 1 link. */
  onSession(session: DramaSession | null): void;
  onActStarted(frame: Frame<"act_started">): void;
  onActBeat(frame: Frame<"act_beat">): void;
  onActReaction(frame: Frame<"act_reaction">): void;
  onActDone(frame: Frame<"act_done">): void;
  onDramaConsent(frame: Frame<"drama_consent">): void;
  onActorDeath(frame: Frame<"actor_death">): void;
  onActorRevive(frame: Frame<"actor_revive">): void;
  onHumanDown(frame: Frame<"human_down">): void;
  onHumanUp(frame: Frame<"human_up">): void;
  onSceneCut(frame: Frame<"scene_cut">): void;
  onDramaState(frame: Frame<"drama_state">): void;
}

const nothing = (): void => undefined;

/** The default: every frame is read and dropped, so a run without a director behaves as one without drama. */
export const NOOP_DRAMA_SINK: DramaFrameSink = {
  onSession: nothing,
  onActStarted: nothing,
  onActBeat: nothing,
  onActReaction: nothing,
  onActDone: nothing,
  onDramaConsent: nothing,
  onActorDeath: nothing,
  onActorRevive: nothing,
  onHumanDown: nothing,
  onHumanUp: nothing,
  onSceneCut: nothing,
  onDramaState: nothing,
};

/** Routes one drama frame to its handler. Exhaustive: a new member of `DRAMA_HOTEL_TYPES` is a compile error until it is handled here. */
export function routeDramaFrame(frame: DramaFrame, sink: DramaFrameSink): void {
  switch (frame.t) {
    case "act_started":
      return sink.onActStarted(frame);
    case "act_beat":
      return sink.onActBeat(frame);
    case "act_reaction":
      return sink.onActReaction(frame);
    case "act_done":
      return sink.onActDone(frame);
    case "drama_consent":
      return sink.onDramaConsent(frame);
    case "actor_death":
      return sink.onActorDeath(frame);
    case "actor_revive":
      return sink.onActorRevive(frame);
    case "human_down":
      return sink.onHumanDown(frame);
    case "human_up":
      return sink.onHumanUp(frame);
    case "scene_cut":
      return sink.onSceneCut(frame);
    case "drama_state":
      return sink.onDramaState(frame);
    default: {
      const unhandled: never = frame;
      return unhandled;
    }
  }
}
