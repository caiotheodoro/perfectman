/**
 * Turning a pulse into a sequence. The load-bearing case is the agent who
 * thought something and said nothing — the frame log could never show it, and
 * dropping it would hide the behaviour the engine exists to produce.
 */
import { describe, expect, it } from "vitest";
import type { LiveChannel, LiveMessage, LivePulseFrame, LiveThinking } from "../../live/live-frame.types.js";
import { priorEventsToBeats, pulseToBeats, toRecordedEmotion, type BeatContext } from "../live-to-beats.js";

const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris", "bruno", "marcela"] },
  { id: "dm", name: "iris+marcela", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
];
const CONTEXT: BeatContext = { channels: CHANNELS, defaultChannelId: "geral" };

function message(over: Partial<LiveMessage> = {}): LiveMessage {
  return {
    eventId: "e1", channelId: "geral", actorId: "iris", eventType: "message_sent",
    text: "so are we talking about it", visibleToAgents: [], pulseIndex: 0, createdAt: 0, ...over,
  };
}

function thinking(over: Partial<LiveThinking> = {}): LiveThinking {
  return {
    agentId: "marcela", intentType: "no_op", privateMotiveSummary: "counting who answered him first",
    emotionDrivers: ["suspicion"], motivationDrivers: [], ...over,
  };
}

function frame(over: Partial<LivePulseFrame> = {}): LivePulseFrame {
  return {
    pulseIndex: 3, eventsCommitted: 0, agentsCalled: 0,
    messages: [], thinking: {}, emotions: {}, notices: [], ...over,
  };
}

describe("pulseToBeats — what was said", () => {
  it("keeps an empty audience empty, because empty means everyone", () => {
    // Resolving this to the member list here would make a public line
    // indistinguishable from one addressed to every member individually.
    const [beat] = pulseToBeats(frame({ messages: [message()] }), CONTEXT);
    expect(beat?.audienceIds).toEqual([]);
    expect(beat?.participantIds).toEqual(["iris", "bruno", "marcela"]);
  });

  it("carries a restricted audience through untouched", () => {
    const [beat] = pulseToBeats(frame({ messages: [message({ visibleToAgents: ["marcela"] })] }), CONTEXT);
    expect(beat?.audienceIds).toEqual(["marcela"]);
  });

  it("stages a speaker's own thought alongside their line", () => {
    const [beat] = pulseToBeats(
      frame({ messages: [message()], thinking: { iris: thinking({ agentId: "iris" }) } }),
      CONTEXT,
    );
    expect(beat?.kind).toBe("message");
    expect(beat?.thought?.text).toBe("counting who answered him first");
    expect(beat?.thought?.drivers).toEqual(["suspicion"]);
  });

  it("takes participants from the channel the line was said in", () => {
    const [beat] = pulseToBeats(frame({ messages: [message({ channelId: "dm" })] }), CONTEXT);
    expect(beat?.participantIds).toEqual(["iris", "marcela"]);
  });

  it("marks an arrival as a stage action rather than a spoken line", () => {
    const [beat] = pulseToBeats(
      frame({ messages: [message({ eventType: "agent_left", text: "" })] }),
      CONTEXT,
    );
    expect(beat?.kind).toBe("event");
    expect(beat?.stageAction).toEqual({ kind: "leave", agentIds: ["iris"] });
  });
});

describe("pulseToBeats — what was not said", () => {
  it("gives a silent agent's thought its own beat", () => {
    const beats = pulseToBeats(frame({ messages: [message()], thinking: { marcela: thinking() } }), CONTEXT);
    const silence = beats.find((b) => b.kind === "silence");
    expect(silence?.actorId).toBe("marcela");
    expect(silence?.text).toBe("");
    expect(silence?.thought?.text).toBe("counting who answered him first");
  });

  it("does not double-stage an agent who both thought and spoke", () => {
    const beats = pulseToBeats(
      frame({ messages: [message()], thinking: { iris: thinking({ agentId: "iris" }) } }),
      CONTEXT,
    );
    expect(beats.filter((b) => b.kind === "silence")).toHaveLength(0);
  });

  it("drops an engine-written motive — a parse failure is not a feeling", () => {
    const beats = pulseToBeats(
      frame({ thinking: { marcela: thinking({ privateMotiveSummary: "Fallback applied: no JSON" }) } }),
      CONTEXT,
    );
    expect(beats).toHaveLength(0);
  });

  it("drops an empty motive rather than staging a blank thought", () => {
    const beats = pulseToBeats(frame({ thinking: { marcela: thinking({ privateMotiveSummary: "" }) } }), CONTEXT);
    expect(beats).toHaveLength(0);
  });
});

describe("toRecordedEmotion", () => {
  it("flattens the live shape into what the face reader expects", () => {
    const emotion = toRecordedEmotion({ valence: -0.5, arousal: 0.8, top: [{ key: "contempt", value: 0.9 }] });
    expect(emotion).toEqual({
      source: "snapshot",
      label: "contempt",
      values: { valence: -0.5, arousal: 0.8, contempt: 0.9 },
    });
  });

  it("leaves the label off when no social emotion cleared the floor", () => {
    const emotion = toRecordedEmotion({ valence: 0.1, arousal: 0.3, top: [] });
    expect(emotion?.label).toBeUndefined();
    expect(emotion?.values).toEqual({ valence: 0.1, arousal: 0.3 });
  });
});

describe("priorEventsToBeats", () => {
  it("puts seeded history before the first pulse so the room is not empty", () => {
    const [beat] = priorEventsToBeats([message({ eventId: "prior" })], CONTEXT);
    expect(beat?.pulseIndex).toBe(-1);
    expect(beat?.id).toBe("prior");
    expect(beat?.duration).toBeGreaterThan(0);
  });
});
