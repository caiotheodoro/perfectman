/**
 * The stream fold, without a browser.
 *
 * `fold` is where "live" and "stored replay" become the same object, so the
 * invariants worth pinning are the ones a reconnect breaks: a replayed `hello`
 * must not erase folded pulses, and a replayed pulse must not double a row.
 */
import { describe, expect, it } from "vitest";
import type { LiveEvent, LiveMessage, LivePulseFrame, RunStatus } from "@perfectman/shared";
import { fold, type RunStream } from "../useRunStream.js";

const BASE: RunStream = {
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

function message(id: string, pulseIndex: number, visibleToAgents: string[] = []): LiveMessage {
  return {
    eventId: id,
    channelId: "geral",
    actorId: "iris",
    eventType: "message",
    text: id,
    visibleToAgents,
    pulseIndex,
    createdAt: 0,
  };
}

function hello(runId: string, priorEvents: LiveMessage[] = []): LiveEvent {
  return {
    type: "hello",
    runId,
    simulationId: "sim",
    simulationName: "dinner",
    agents: [{ id: "iris", displayName: "Íris", archetype: "connector" }],
    channels: [{ id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris"] }],
    maxPulses: 12,
    priorEvents,
  };
}

function pulse(pulseIndex: number, messages: LiveMessage[], droppedBefore?: number): LiveEvent {
  const frame: LivePulseFrame = {
    pulseIndex,
    eventsCommitted: messages.length,
    agentsCalled: 1,
    messages,
    thinking: {},
    emotions: {},
    notices: [],
    ...(droppedBefore === undefined ? {} : { droppedBefore }),
  };
  return { type: "pulse", frame };
}

describe("fold — hello", () => {
  it("opens an empty replay when the run has no seeded history", () => {
    const state = fold(BASE, hello("run_1"));
    expect(state.replay?.simulationName).toBe("dinner");
    expect(state.replay?.pulses).toEqual([]);
    expect(state.helloRunId).toBe("run_1");
  });

  it("puts seeded history in a pulse before the first one", () => {
    const state = fold(BASE, hello("run_1", [message("prior", 0)]));
    expect(state.replay?.pulses).toHaveLength(1);
    expect(state.replay?.pulses[0]?.pulseIndex).toBe(-1);
    expect(state.replay?.pulses[0]?.messages[0]?.eventId).toBe("prior");
  });

  it("keeps folded pulses when the same run says hello again", () => {
    // A reconnect replays hello, and the backlog is bounded — rebuilding from
    // the frame alone would silently drop everything older than the window.
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(0, [message("a", 0)]));
    state = fold(state, pulse(1, [message("b", 1)]));

    const resumed = fold(state, hello("run_1"));

    expect(resumed.replay?.pulses.map((p) => p.pulseIndex)).toEqual([0, 1]);
    expect(resumed.connected).toBe(true);
  });

  it("starts over when a different run says hello", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(0, [message("a", 0)]));

    const restarted = fold(state, hello("run_2"));

    expect(restarted.replay?.pulses).toEqual([]);
    expect(restarted.helloRunId).toBe("run_2");
  });
});

describe("fold — pulses", () => {
  it("ignores a pulse that arrives before hello", () => {
    expect(fold(BASE, pulse(0, [message("a", 0)])).replay).toBeNull();
  });

  it("keeps pulses ordered when one arrives late", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(2, [message("c", 2)]));
    state = fold(state, pulse(1, [message("b", 1)]));
    expect(state.replay?.pulses.map((p) => p.pulseIndex)).toEqual([1, 2]);
  });

  it("replaces rather than duplicates a pulse index seen twice", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(0, [message("a", 0)]));
    state = fold(state, pulse(0, [message("a", 0), message("a2", 0)]));
    expect(state.replay?.pulses).toHaveLength(1);
    expect(state.replay?.pulses[0]?.messages).toHaveLength(2);
  });

  it("accumulates the coalesced-away count across frames", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(3, [], 2));
    state = fold(state, pulse(7, [], 3));
    expect(state.dropped).toBe(5);
  });

  it("carries the audience through untouched, empty array included", () => {
    // Empty means "everyone in the channel". Normalizing it here would invert
    // the exclusion story the POV filter reads.
    let state = fold(BASE, hello("run_1"));
    state = fold(state, pulse(0, [message("open", 0), message("private", 0, ["iris"])]));
    expect(state.replay?.pulses[0]?.messages[0]?.visibleToAgents).toEqual([]);
    expect(state.replay?.pulses[0]?.messages[1]?.visibleToAgents).toEqual(["iris"]);
  });
});

describe("fold — channels, notices and endings", () => {
  it("appends a channel opened mid-run", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, {
      type: "channel",
      channel: { id: "dm", name: "iris+marcela", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
    });
    expect(state.replay?.channels.map((c) => c.id)).toEqual(["geral", "dm"]);
  });

  it("replaces a channel whose membership changed", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, {
      type: "channel",
      channel: { id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris", "bruno"] },
    });
    expect(state.replay?.channels).toHaveLength(1);
    expect(state.replay?.channels[0]?.memberAgentIds).toEqual(["iris", "bruno"]);
  });

  it("collects notices in arrival order", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, { type: "notice", notice: { type: "llm_failure", detail: "timeout" } });
    state = fold(state, { type: "notice", notice: { type: "stagnation_detected", detail: "quiet" } });
    expect(state.notices.map((n) => n.type)).toEqual(["llm_failure", "stagnation_detected"]);
  });

  it("records the stop reason and drops the live flag", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold({ ...state, connected: true }, {
      type: "stopped",
      stopReason: "max_pulses",
      replayUrl: "/api/runs/run_1/replay",
    });
    expect(state.stoppedReason).toBe("max_pulses");
    expect(state.replay?.stopReason).toBe("max_pulses");
    expect(state.connected).toBe(false);
  });

  it("calls an ending without a reason finished", () => {
    let state = fold(BASE, hello("run_1"));
    state = fold(state, { type: "stopped", replayUrl: "/api/runs/run_1/replay" });
    expect(state.stoppedReason).toBe("finished");
    expect(state.replay?.stopReason).toBeUndefined();
  });

  it("joins an error to its hint so the alert reads as one sentence", () => {
    const state = fold(BASE, { type: "error", message: "Ollama unreachable", hint: "start the daemon" });
    expect(state.error).toBe("Ollama unreachable — start the daemon");
  });

  it("stores a status frame verbatim", () => {
    const status: RunStatus = {
      runId: "run_1",
      simulationId: "sim",
      state: "running",
      pulseIndex: 4,
      pulsesRun: 5,
      maxPulses: 12,
      counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
    };
    expect(fold(BASE, { type: "status", status }).status).toEqual(status);
  });
});
