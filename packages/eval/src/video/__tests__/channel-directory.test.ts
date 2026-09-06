import { describe, expect, it } from "vitest";
import { normalizeVideoSource } from "../read-source.js";
import { planVideo } from "../storyboard.js";
import { planScene } from "../scene-plan.js";

describe("channel directory fidelity", () => {
  it("does not derive room privacy from legacy motives or internal records", () => {
    const input = { transcript: [
      { pulse: 0, agent: "ada", type: "message_sent", channelId: "room", private: false, content: "Hello" },
      { pulse: 0, agent: "ada", type: "private_motive_summary", channelId: "room", private: true, content: "A thought" },
      { pulse: 0, agent: "ada", type: "no_op_recorded", channelId: "room", private: true },
      { pulse: 0, agent: "ada", type: "operator_warning", channelId: "internal", private: true },
      { pulse: 0, agent: "ada", type: "private_motive_summary", channelId: "room", private: false, content: "Fallback applied: no provider" },
    ] };
    const story = normalizeVideoSource(input);
    expect(story.channels).toEqual([{ id: "room", name: "room", kind: "public" }]);
    expect(story.steps[0]?.visibility).toBe("public");
    expect(story.steps[1]?.raw).toBe(input.transcript[1]);
    expect(story.steps[1]).toMatchObject({ kind: "private", visibility: "private" });
    expect(story.steps[2]?.visibility).toBe("operator");
    expect(story.steps[4]).toMatchObject({ kind: "event", visibility: "operator" });
    const scene = planScene(planVideo(story, "input.json", "hash"));
    expect(scene.channels[scene.beats[1]!.channelIndex]?.kind).toBe("thought");
    expect(scene.channels[scene.beats[4]!.channelIndex]?.kind).toBe("operator");
  });

  it("includes silent recorded members in the cast without placing them in past scenes", () => {
    const channels = [{ id: "room", type: "public_channel", memberAgentIds: ["ada", "silent"] }];
    const events = [{ actorId: "ada", type: "message_sent", channelId: "room", payload: { content: "Hello" } }];
    for (const input of [{ channels, events }, { channels, agentIds: ["ada"], pulses: [{ pulseIndex: 0, committedEvents: events }] }]) {
      const story = normalizeVideoSource(input), scene = planScene(planVideo(story, "input.json", "hash"));
      expect(story.agents.map(agent => agent.id)).toEqual(["ada", "silent"]);
      expect(scene.channels.find(channel => channel.id === "room:room")?.memberIndexes).toEqual([0, 1]);
      expect(scene.beats.find(beat => beat.kind === "message")?.participantIndexes).toEqual([0]);
      expect(story.steps.find(step => step.kind === "message")?.audienceIds).toBeUndefined();
    }
  });
});
