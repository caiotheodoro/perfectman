import { describe, expect, it } from "vitest";
import { buildFilmTimeline } from "../../director/film.js";
import { PACES } from "../../director/timing.js";
import { scriptToReplay, type Script } from "../script-to-replay.js";
import { SURPRISE_PARTY_SCRIPT, surpriseParty } from "../surprise-party.js";

const film = (fictionOnly = false) => buildFilmTimeline(surpriseParty(), { pace: PACES.normal, huddle: "push", fictionOnly });

describe("the surprise party film", () => {
  it("runs long enough to land a joke and short enough to loop on a landing page", () => {
    const { duration } = film();
    expect(duration).toBeGreaterThan(40);
    expect(duration).toBeLessThan(90);
  });

  it("speaks every scripted line, in order", () => {
    expect(film().msgs.map((m) => m.text)).toEqual(SURPRISE_PARTY_SCRIPT.beats.map((b) => b.say));
  });

  it("gives the committee its own private scene, so the camera moves in", () => {
    const kinds = film().scenes.map((s) => s.type);
    expect(kinds).toContain("huddle");
  });

  it("keeps the thoughts for the omniscient cut and drops them from the fiction-only cut", () => {
    const thoughts = (fictionOnly: boolean) => film(fictionOnly).balloons.filter((b) => b.kind === "thought").length;
    expect(thoughts(false)).toBeGreaterThanOrEqual(12);
    expect(thoughts(true)).toBe(0);
  });
});

describe("scriptToReplay", () => {
  const base: Script = {
    title: "t", start: "09:05", step: 2,
    cast: [{ id: "a", name: "A", archetype: "organizer" }, { id: "b", name: "B", archetype: "elder" }],
    channels: [{ id: "main", name: "main", type: "public_channel", memberAgentIds: ["a", "b"] }],
    beats: [{ who: "a", say: "hi" }],
  };

  it("carries a mood until somebody changes it", () => {
    const replay = scriptToReplay({ ...base, beats: [{ who: "a", say: "one", feel: { b: "panic" } }, { who: "a", say: "two" }] });
    expect(replay.pulses[1]!.agentStates["b"]!.socialEmotions).toEqual(replay.pulses[0]!.agentStates["b"]!.socialEmotions);
    expect(replay.pulses[0]!.agentStates["b"]!.socialEmotions["socialAnxiety"]).toBeGreaterThan(0.5);
  });

  it("records who each line is aimed at and zero-pads the story clock", () => {
    const replay = scriptToReplay(base);
    expect(replay.pulses[0]!.committedEvents[0]!.payload["addresseeIds"]).toEqual(["b"]);
    expect(replay.storyClock).toEqual({ start: "09:05", minutesPerPulse: 2 });
  });

  it("refuses a beat that cannot happen", () => {
    expect(() => scriptToReplay({ ...base, beats: [{ who: "zed", say: "hi" }] })).toThrow(/not in the cast/);
    expect(() => scriptToReplay({ ...base, beats: [{ who: "a", say: "hi", in: "nowhere" }] })).toThrow(/unknown channel/);
    expect(() => scriptToReplay({ ...base, beats: [{ who: "a", say: "hi", feel: { zed: "calm" } }] })).toThrow(/not in the cast/);
  });
});
