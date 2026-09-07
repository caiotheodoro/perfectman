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

  it("puts a speaker's own thought after their line, not on top of it", () => {
    // Two balloons over one head do not fit above a figure at the back of the
    // room, and the thought reads better as its own moment anyway.
    const beats = pulseToBeats(
      frame({ messages: [message()], thinking: { iris: thinking({ agentId: "iris" }) } }),
      CONTEXT,
    );
    expect(beats.map((b) => b.kind)).toEqual(["message", "aside"]);
    expect(beats[0]?.thought).toBeUndefined();
    expect(beats[1]?.thought?.text).toBe("counting who answered him first");
    expect(beats[1]?.thought?.drivers).toEqual(["suspicion"]);
    expect(beats[1]?.actorId).toBe("iris");
  });

  it("splits a long thought across beats so no balloon outgrows the room", () => {
    const long = "I keep going over it. ".repeat(12);
    const beats = pulseToBeats(frame({ thinking: { marcela: thinking({ privateMotiveSummary: long }) } }), CONTEXT);
    expect(beats.length).toBeGreaterThan(1);
    for (const beat of beats) expect(beat.thought!.text.length).toBeLessThanOrEqual(130);
    // Drivers belong with the last page, where the caption sits.
    expect(beats[0]?.thought?.drivers).toEqual([]);
    expect(beats[beats.length - 1]?.thought?.drivers).toEqual(["suspicion"]);
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
  it("extends unfinished pulses without premature silence or moving existing beats", () => {
    const partial = frame({ complete: false, messages: [message()], thinking: {
      iris: thinking({ agentId: "iris", intentType: "send_message" }), marcela: thinking(),
    } });
    const first = pulseToBeats(partial, CONTEXT);
    const grown = { ...partial, messages: [...partial.messages, message({ eventId: "e2", actorId: "bruno" })] };
    const next = pulseToBeats(grown, CONTEXT);
    const complete = pulseToBeats({ ...grown, complete: true }, CONTEXT);
    expect(first.map((beat) => beat.kind)).toEqual(["message", "aside"]);
    expect(next.map((beat) => beat.id).slice(0, first.length)).toEqual(first.map((beat) => beat.id));
    expect(complete.map((beat) => beat.id).slice(0, next.length)).toEqual(next.map((beat) => beat.id));
    expect(complete.slice(next.length).map((beat) => [beat.kind, beat.actorId])).toEqual([["silence", "marcela"]]);
  });

  it("gives a silent agent's thought its own beat", () => {
    const beats = pulseToBeats(frame({ messages: [message()], thinking: { marcela: thinking() } }), CONTEXT);
    const silence = beats.find((b) => b.kind === "silence");
    expect(silence?.actorId).toBe("marcela");
    expect(silence?.text).toBe("");
    expect(silence?.thought?.text).toBe("counting who answered him first");
  });

  it("does not also stage a speaker as silent", () => {
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

describe("pulseToBeats — pages", () => {
  it("numbers a single-page line page 0", () => {
    const [beat] = pulseToBeats(frame({ messages: [message()] }), CONTEXT);
    expect(beat?.page).toBe(0);
  });

  it("numbers the pages of a long line so only the first can cue a sound", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const beats = pulseToBeats(frame({ messages: [message({ text })] }), CONTEXT);
    const spoken = beats.filter((b) => b.kind === "message");
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.map((b) => b.page)).toEqual(spoken.map((_, i) => i));
  });

  it("numbers thought pages too", () => {
    const motive = Array.from({ length: 50 }, (_, i) => `reason${i}`).join(" ");
    const beats = pulseToBeats(
      frame({ thinking: { marcela: thinking({ privateMotiveSummary: motive }) } }),
      CONTEXT,
    );
    expect(beats.map((b) => b.page)).toEqual(beats.map((_, i) => i));
  });

  it("gives seeded history page 0", () => {
    const [beat] = priorEventsToBeats([message()], CONTEXT);
    expect(beat?.page).toBe(0);
  });
});

describe("pulseToBeats — reactions", () => {
  it("carries everyone else's recorded emotion so the room can react to a line", () => {
    const emotions = {
      iris: { valence: 0.2, arousal: 0.3, top: [{ key: "neutral", value: 0.5 }] },
      marcela: { valence: -0.6, arousal: 0.7, top: [{ key: "fear_of_exclusion", value: 0.8 }] },
    };
    const [beat] = pulseToBeats(frame({ messages: [message()], emotions }), CONTEXT);
    expect(beat?.emotion?.label).toBe("neutral");
    expect(beat?.reactions?.["marcela"]?.label).toBe("fear_of_exclusion");
    expect(beat?.reactions?.["iris"]).toBeUndefined();
  });

  it("only includes people in the room", () => {
    const emotions = { marcela: { valence: 0, arousal: 0, top: [{ key: "calm", value: 1 }] } };
    const [beat] = pulseToBeats(
      frame({ messages: [message({ channelId: "dm", actorId: "iris" })], emotions: { ...emotions, bruno: emotions.marcela } }),
      CONTEXT,
    );
    expect(Object.keys(beat?.reactions ?? {})).toEqual(["marcela"]);
  });
});

describe("pulseToBeats — a stage action is not a line", () => {
  it("never puts the channel's name in a balloon when a room is opened", () => {
    const beats = pulseToBeats(
      frame({ messages: [message({ eventType: "channel_created", channelId: "dm", text: "conversa_privada", visibleToAgents: ["iris", "marcela"] })] }),
      CONTEXT,
    );
    expect(beats[0]?.kind).toBe("event");
    expect(beats[0]?.stageAction?.kind).toBe("invite");
    expect(beats[0]?.text).toBe("");
    expect(beats[0]?.duration).toBeLessThanOrEqual(2);
  });
});
