import { describe, expect, it } from "vitest";
import { normalizeReplaySource } from "./replay.js";

const message = (id: string, text: string, pulse = 0) => ({
  id, actorId: "ada", channelId: "secret", type: "message_sent", payload: { content: text },
  pulseIndex: pulse, visibility: { visibleToSpectators: true, visibilityReason: "public" },
});
const state = {
  agentId: "ada", presence: "active", coreMood: { valence: -0.2, arousal: 0.8 },
  socialEmotions: { suspicion: 0.9, affection: 0.1 },
  relationalStates: { nox: { targetAgentId: "nox", trust: -0.3, interactionCount: 2 } },
  memories: [{ summary: "A memory that is not a new public message." }],
};
const replay = (pulses: unknown[]) => ({
  simulationName: "Recorded scene", agentIds: ["ada"], agentNames: { ada: "Ada" },
  channels: [{ id: "secret", type: "private_channel" }], pulses,
});

describe("replay to video source fidelity", () => {
  it("retains pulse/event order, empty pulses and private channels without backfilling state", () => {
    const input = replay([
      { pulseIndex: 2, committedEvents: [message("seed", "Seed", 2)], agentStates: { ada: state } },
      { pulseIndex: 0, committedEvents: [message("second", "Next"), message("third", "Then")] },
      { pulseIndex: 1, committedEvents: [] },
    ]);
    const story = normalizeReplaySource(input);
    expect(story.steps.filter(s => s.kind === "message").map(s => s.text)).toEqual(["Seed", "Next", "Then"]);
    expect(story.steps.filter(s => s.phase === "Recorded pulse").map(s => s.pulse)).toEqual([2, 0, 1]);
    const first = story.steps.find(s => s.text === "Seed")!;
    const snapshot = story.steps.find(s => s.kind === "state")!;
    expect(first.visibility).toBe("private");
    expect(first.emotion).toBeUndefined();
    expect(story.steps.indexOf(snapshot)).toBeGreaterThan(story.steps.indexOf(first));
    expect(snapshot.emotion?.values).toMatchObject({ suspicion: 0.9, valence: -0.2, "relational.nox.trust": -0.3 });
    expect(snapshot.raw).toEqual(state);
    expect(snapshot.sourceRefs).toContain("/pulses/0/agentStates/ada");
    expect(new Set(story.steps.map(s => s.id)).size).toBe(story.steps.length);
  });

  it("animates fresh intent only, retains unknown operators, and folds duplicate state/visibility records", () => {
    const operator = { type: "agent_state_snapshot", pulseIndex: 0, agentId: "ada", data: { state } };
    const story = normalizeReplaySource(replay([{
      pulseIndex: 0, committedEvents: [message("one", "Exact dialogue")], agentStates: { ada: state },
      agentThinking: { ada: { privateMotiveSummary: "Stale thought" } },
      operatorEvents: [
        { type: "event_visibility", data: { eventId: "one" } },
        { type: "action_intent", agentId: "ada", data: { privateMotiveSummary: "Fresh thought", emotionDrivers: ["suspicion"] } },
        { type: "future_phase", detail: "An explicit phase", data: { change: "Keep this fact" } },
        operator,
      ],
    }]));
    const texts = story.steps.map(s => s.text).join("\n");
    expect(texts).toContain("Fresh thought");
    expect(texts).not.toContain("Stale thought");
    expect(texts).toContain("Keep this fact");
    expect(story.steps.find(s => s.text.includes("Fresh thought"))?.emotion?.drivers).toEqual(["suspicion"]);
    expect(story.steps.filter(s => s.kind === "state")).toHaveLength(1);
    const snapshot = story.steps.find(s => s.kind === "state")!;
    expect(snapshot.sourceRefs).toContain("/pulses/0/agentStates/ada");
    expect(snapshot.raw).toEqual({ state, operatorRecord: operator });
    expect(story.steps.find(s => s.text === "Exact dialogue")?.sourceRefs).toContain("/pulses/0/operatorEvents/0");
    expect(story.notices.join(" ")).toContain("reconstructed");
    expect(story.steps[0]!.raw).toMatchObject({ agentThinking: { ada: { privateMotiveSummary: "Stale thought" } } });
  });

  it("keeps engine failure separate from emotion and rejects malformed or misattributed state", () => {
    const story = normalizeReplaySource(replay([{ pulseIndex: 0, committedEvents: [], operatorEvents: [{
      type: "action_intent", agentId: "ada", data: { privateMotiveSummary: "Fallback applied: bad JSON", emotionDrivers: ["anger"] },
    }] }]));
    expect(story.steps.at(-1)).toMatchObject({ phase: "Recorded engine interruption", visibility: "operator" });
    expect(story.steps.at(-1)?.emotion).toBeUndefined();
    expect(() => normalizeReplaySource(replay([{ pulseIndex: 0, committedEvents: [], agentStates: { ada: { coreMood: { valence: "bad" } } } }]))).toThrow();
    expect(() => normalizeReplaySource(replay([{ pulseIndex: 0, committedEvents: [], agentStates: { ada: { agentId: "nox" } } }]))).toThrow(/mismatch/);
    expect(() => normalizeReplaySource(replay([{ pulseIndex: 0, committedEvents: [], operatorEvents: [{ type: "action_intent", pulseIndex: 1 }] }]))).toThrow(/different pulse/);
  });

  it("escapes agent IDs in source pointers and retains final goal and ending records at the end", () => {
    const story = normalizeReplaySource({ ...replay([{ pulseIndex: 0, committedEvents: [], agentStates: { "a/~b": {} } }]),
      goals: [{ title: "A recorded goal", status: "accepted" }], endReason: "operator_command",
      endingOffer: { epilogue: "The recorded ending." },
    });
    expect(story.steps.some(s => s.sourceRefs.includes("/pulses/0/agentStates/a~1~0b"))).toBe(true);
    expect(story.steps.at(-1)?.text).toContain("The recorded ending.");
    expect(story.steps.at(-2)?.phase).toBe("Recorded final goal state");
  });
});
