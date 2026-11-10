import type { DramaFrameSink } from "../../run/drama-frame-sink.js";
import type { DramaSession } from "../dialect.js";
import type { DramaLink } from "./director.js";

/** What a run needs to have a drama director: the connection's two drama frames, and the hub that routes the hotel's frames to it. Inert on a dialect 1 link. */
export type DramaHost = { link: DramaLink; hub: DramaRunHub };

/**
 * The manager has one sink for the whole connection, but every drama frame carries its `run` (FRM-4). The hub is that
 * sink: it hands each frame to the director of the run it names, and the session of the link (which is per
 * connection, not per run) to every director, now and when one attaches later.
 */
export class DramaRunHub implements DramaFrameSink {
  private readonly sinks = new Map<number, DramaFrameSink>();
  /** `undefined` until the first `hello`; `null` for a dialect 1 link. */
  private session: DramaSession | null | undefined;

  attach(run: number, sink: DramaFrameSink): void {
    this.sinks.set(run, sink);
    if (this.session !== undefined) sink.onSession(this.session);
  }

  detach(run: number): void {
    this.sinks.delete(run);
  }

  /** The last `hello`'s session, for a director built after it. */
  get lastSession(): DramaSession | null | undefined {
    return this.session;
  }

  onSession(session: DramaSession | null): void {
    this.session = session;
    for (const sink of this.sinks.values()) sink.onSession(session);
  }

  onActStarted(f: Parameters<DramaFrameSink["onActStarted"]>[0]): void {
    this.sinks.get(f.run)?.onActStarted(f);
  }

  onActBeat(f: Parameters<DramaFrameSink["onActBeat"]>[0]): void {
    this.sinks.get(f.run)?.onActBeat(f);
  }

  onActReaction(f: Parameters<DramaFrameSink["onActReaction"]>[0]): void {
    this.sinks.get(f.run)?.onActReaction(f);
  }

  onActDone(f: Parameters<DramaFrameSink["onActDone"]>[0]): void {
    this.sinks.get(f.run)?.onActDone(f);
  }

  onDramaConsent(f: Parameters<DramaFrameSink["onDramaConsent"]>[0]): void {
    this.sinks.get(f.run)?.onDramaConsent(f);
  }

  onActorDeath(f: Parameters<DramaFrameSink["onActorDeath"]>[0]): void {
    this.sinks.get(f.run)?.onActorDeath(f);
  }

  onActorRevive(f: Parameters<DramaFrameSink["onActorRevive"]>[0]): void {
    this.sinks.get(f.run)?.onActorRevive(f);
  }

  onHumanDown(f: Parameters<DramaFrameSink["onHumanDown"]>[0]): void {
    this.sinks.get(f.run)?.onHumanDown(f);
  }

  onHumanUp(f: Parameters<DramaFrameSink["onHumanUp"]>[0]): void {
    this.sinks.get(f.run)?.onHumanUp(f);
  }

  onSceneCut(f: Parameters<DramaFrameSink["onSceneCut"]>[0]): void {
    this.sinks.get(f.run)?.onSceneCut(f);
  }

  onDramaState(f: Parameters<DramaFrameSink["onDramaState"]>[0]): void {
    this.sinks.get(f.run)?.onDramaState(f);
  }
}

/** Fans every frame out to each sink in order (the director's, the planner's, a test's); one throwing does not starve the rest of the frame. */
export function composeDramaSinks(...sinks: DramaFrameSink[]): DramaFrameSink {
  const all = <K extends keyof DramaFrameSink>(method: K) =>
    ((arg: never) => {
      let first: unknown;
      for (const s of sinks) {
        try {
          (s[method] as (a: never) => void)(arg);
        } catch (err) {
          first ??= err;
        }
      }
      if (first !== undefined) throw first;
    }) as DramaFrameSink[K];
  return {
    onSession: all("onSession"),
    onActStarted: all("onActStarted"),
    onActBeat: all("onActBeat"),
    onActReaction: all("onActReaction"),
    onActDone: all("onActDone"),
    onDramaConsent: all("onDramaConsent"),
    onActorDeath: all("onActorDeath"),
    onActorRevive: all("onActorRevive"),
    onHumanDown: all("onHumanDown"),
    onHumanUp: all("onHumanUp"),
    onSceneCut: all("onSceneCut"),
    onDramaState: all("onDramaState"),
  };
}
