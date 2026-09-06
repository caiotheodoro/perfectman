/**
 * `EventSource` → the same `ViewerReplay` shape a stored run has.
 *
 * Live is not a second data model: it is the replay, still growing. Folding the
 * stream into `ViewerReplay` here is what lets one viewer render both, and it
 * keeps the "did the browser see this" question answerable against a single
 * object rather than a pile of events.
 *
 * Pulses are coalescable on the wire, so a client that falls behind gets the
 * newest one and a `droppedBefore` count. Gaps are not reconstructed here —
 * `replay.json` has them, and the UI says how many are missing.
 */
import { useEffect, useRef, useState } from "react";
import type { LiveEvent, LiveNotice, RunStatus, ViewerPulse, ViewerReplay } from "@perfectman/shared";

/** Raw envelopes kept for the frame log; enough to debug, bounded so a long run cannot grow forever. */
const RAW_LOG_CAP = 500;

export type RunStream = {
  replay: ViewerReplay | null;
  /** The run `hello` announced, so a reconnect can tell resume from restart. */
  helloRunId: string | null;
  status: RunStatus | null;
  notices: LiveNotice[];
  /** Newest last. Trimmed to the most recent `RAW_LOG_CAP`. */
  raw: Array<{ seq: number; event: LiveEvent }>;
  /** Pulses coalesced away because this client fell behind. */
  dropped: number;
  connected: boolean;
  /** Transport or run failure. Distinct from a compile error, which never opens a stream. */
  error: string | null;
  stoppedReason: string | null;
};

const EMPTY: RunStream = {
  replay: null,
  helloRunId: null,
  status: null,
  notices: [],
  raw: [],
  dropped: 0,
  connected: false,
  error: null,
  stoppedReason: null,
};

export function useRunStream(runId: string | null): RunStream {
  const [state, setState] = useState<RunStream>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    if (!runId) {
      setState(EMPTY);
      return;
    }
    seq.current = 0;
    setState({ ...EMPTY, connected: false });

    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    const onMessage = (raw: MessageEvent<string>): void => {
      let event: LiveEvent;
      try {
        event = JSON.parse(raw.data) as LiveEvent;
      } catch {
        return;
      }
      seq.current += 1;
      const n = seq.current;
      setState((prev) => fold({ ...prev, raw: append(prev.raw, n, event) }, event));
      // The server closes the stream after `stopped`, and EventSource honours
      // its own `retry:` — so without this the browser reconnects, gets the
      // whole backlog replayed, and shows the run twice.
      if (event.type === "stopped") source.close();
    };

    // Every frame is a named event, so the default `message` listener never fires.
    for (const name of ["hello", "status", "pulse", "channel", "notice", "stopped", "error"]) {
      source.addEventListener(name, onMessage as EventListener);
    }
    source.addEventListener("open", () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    });
    source.addEventListener("error", () => {
      // EventSource reconnects on its own; this is a status, not a terminal state.
      setState((prev) => ({ ...prev, connected: false }));
    });

    return () => {
      source.close();
    };
  }, [runId]);

  return state;
}

function append(
  log: RunStream["raw"],
  seqNo: number,
  event: LiveEvent,
): RunStream["raw"] {
  const next = [...log, { seq: seqNo, event }];
  return next.length > RAW_LOG_CAP ? next.slice(next.length - RAW_LOG_CAP) : next;
}

export function fold(state: RunStream, event: LiveEvent): RunStream {
  switch (event.type) {
    case "hello": {
      // A reconnect replays `hello` mid-run. Keep what is already folded: the
      // backlog is bounded, so rebuilding from this frame alone would silently
      // drop every pulse older than the window.
      const resuming = state.helloRunId === event.runId && state.replay !== null;
      if (resuming) return { ...state, connected: true };
      return {
        ...state,
        connected: true,
        helloRunId: event.runId,
        replay: {
          simulationId: event.simulationId,
          simulationName: event.simulationName,
          agents: event.agents,
          channels: event.channels,
          // Seeded history arrives as pulse -1: it was written straight to the
          // repository, so no gateway ever saw it, but the viewer must not
          // start blank where the stored replay has a past.
          pulses:
            event.priorEvents.length > 0
              ? [
                  {
                    pulseIndex: -1,
                    eventsCommitted: event.priorEvents.length,
                    agentsCalled: 0,
                    messages: event.priorEvents,
                    thinking: {},
                    emotions: {},
                    notices: [],
                  },
                ]
              : [],
        },
      };
    }

    case "status":
      return { ...state, status: event.status };

    case "pulse": {
      if (!state.replay) return state;
      const pulse: ViewerPulse = {
        pulseIndex: event.frame.pulseIndex,
        eventsCommitted: event.frame.eventsCommitted,
        agentsCalled: event.frame.agentsCalled,
        messages: event.frame.messages,
        thinking: event.frame.thinking,
        emotions: event.frame.emotions,
        notices: event.frame.notices,
      };
      return {
        ...state,
        dropped: state.dropped + (event.frame.droppedBefore ?? 0),
        replay: { ...state.replay, pulses: upsertPulse(state.replay.pulses, pulse) },
      };
    }

    case "channel": {
      if (!state.replay) return state;
      const channels = state.replay.channels.some((c) => c.id === event.channel.id)
        ? state.replay.channels.map((c) => (c.id === event.channel.id ? event.channel : c))
        : [...state.replay.channels, event.channel];
      return { ...state, replay: { ...state.replay, channels } };
    }

    case "notice":
      return { ...state, notices: [...state.notices, event.notice] };

    case "stopped":
      return {
        ...state,
        connected: false,
        stoppedReason: event.stopReason ?? "finished",
        replay: state.replay ? { ...state.replay, ...stopReasonOf(event.stopReason) } : null,
      };

    case "error":
      return { ...state, error: event.hint ? `${event.message} — ${event.hint}` : event.message };

    default:
      return state;
  }
}

function stopReasonOf(stopReason: string | undefined): { stopReason?: string } {
  return stopReason ? { stopReason } : {};
}

/**
 * Coalescing means a pulse can arrive out of order relative to a reconnect, and
 * a reconnect can replay one already held. Keyed by index, sorted, so neither
 * duplicates a row.
 */
function upsertPulse(pulses: ViewerPulse[], pulse: ViewerPulse): ViewerPulse[] {
  const at = pulses.findIndex((p) => p.pulseIndex === pulse.pulseIndex);
  if (at >= 0) {
    const next = [...pulses];
    next[at] = pulse;
    return next;
  }
  return [...pulses, pulse].sort((a, b) => a.pulseIndex - b.pulseIndex);
}
