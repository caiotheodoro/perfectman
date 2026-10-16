import { describe, expect, it } from "vitest";
import type { ViewerReplay } from "../../live/live-frame.types.js";
import { buildFilmTimeline } from "../film.js";
import { liveToDirector } from "../live.js";
import { PACES } from "../timing.js";

const msg = (id: string, actorId: string, text: string, pulseIndex: number, visibleToAgents: string[] = []) =>
  ({ eventId: id, channelId: "room", actorId, eventType: "message_sent", text, visibleToAgents, pulseIndex, createdAt: pulseIndex });

const replay = (): ViewerReplay => ({
  simulationId: "s", simulationName: "Live",
  agents: [{ id: "a", displayName: "Ana", archetype: "organizer" }, { id: "b", displayName: "Bo", archetype: "trickster" }],
  channels: [{ id: "room", name: "room", type: "public_channel", memberAgentIds: ["a", "b"] }],
  storyClock: { start: "21:00", minutesPerPulse: 4 },
  look: { setting: "kitchen" },
  pulses: [
    { pulseIndex: -1, eventsCommitted: 1, agentsCalled: 0, messages: [msg("seed", "a", "seeded history", -1)], thinking: {}, emotions: {}, notices: [] },
    { pulseIndex: 1, eventsCommitted: 1, agentsCalled: 1, messages: [msg("m2", "b", "second", 1, ["a"])], thinking: {}, emotions: {}, notices: [] },
    { pulseIndex: 0, eventsCommitted: 1, agentsCalled: 1, messages: [msg("m1", "a", "first line", 0)],
      thinking: { a: { agentId: "a", intentType: "x", privateMotiveSummary: "nervous", emotionDrivers: ["fear"], motivationDrivers: ["win"] } },
      emotions: { a: { valence: -0.3, arousal: 0.8, top: [{ key: "socialAnxiety", value: 0.7 }] } }, notices: [] },
  ],
});

describe("liveToDirector", () => {
  it("films a growing run in pulse order and leaves the seeded history out", () => {
    const d = liveToDirector(replay());
    expect(d.pulses.map((p) => p.pulseIndex)).toEqual([0, 1]);
    const T = buildFilmTimeline(d, { pace: PACES.normal, huddle: "push", fictionOnly: false });
    expect(T.msgs.map((m) => m.text)).toEqual(["first line", "second"]);
  });

  it("carries feelings, thoughts, addressees and the scene's own look", () => {
    const d = liveToDirector(replay());
    expect(d.pulses[0]!.agentStates["a"]).toEqual({ coreMood: { valence: -0.3, arousal: 0.8, energy: 1 }, socialEmotions: { socialAnxiety: 0.7 } });
    expect(d.pulses[0]!.agentThinking?.["a"]).toMatchObject({ privateMotiveSummary: "nervous", emotionDrivers: ["fear", "win"] });
    expect(d.pulses[1]!.committedEvents[0]!.payload["addresseeIds"]).toEqual(["a"]);
    expect(d.look).toEqual({ setting: "kitchen" });
    expect(d.storyClock).toEqual({ start: "21:00", minutesPerPulse: 4 });
  });

  it("copes with a run that has not said anything yet", () => {
    const d = liveToDirector({ ...replay(), pulses: [] });
    expect(d.pulses).toEqual([]);
    expect(d.agentIds).toEqual(["a", "b"]);
  });
});
