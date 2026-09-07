/**
 * Where everyone stands, for every beat at once.
 *
 * The stage used to remember seating in a ref keyed by channel. That had two
 * failures this file pins down: a silence beat renders the same channel as a
 * one-seat "thought" room and overwrote the public room's memory, and seeking
 * backwards replayed with whatever the memory held by then. A pure pass over
 * the whole beat list has neither problem, and the contact sheet needs every
 * beat's seating anyway.
 */
import { describe, expect, it } from "vitest";
import type { LiveChannel } from "../../live/live-frame.types.js";
import type { StageBeat } from "../beat.js";
import { idlePlacement, kindOf, placeBeats, roomKeyOf } from "../placement.js";
import { slotsFor } from "../slots.js";

const AGENTS = [{ id: "iris" }, { id: "bruno" }, { id: "marcela" }];
const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris", "bruno", "marcela"] },
  { id: "dm", name: "dm", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
];

let n = 0;
function beat(over: Partial<StageBeat> = {}): StageBeat {
  n += 1;
  return {
    id: `b${n}`,
    kind: "message",
    pulseIndex: 0,
    channelId: "geral",
    actorId: "iris",
    text: "…",
    audienceIds: [],
    participantIds: ["iris", "bruno", "marcela"],
    duration: 3,
    page: 0,
    ...over,
  };
}

function seats(placement: { marks: readonly { agentId: string; slot: number }[] }): Record<string, number> {
  return Object.fromEntries(placement.marks.map((m) => [m.agentId, m.slot]));
}

describe("placeBeats", () => {
  it("returns one placement per beat, in order", () => {
    const beats = [beat(), beat({ actorId: "bruno" })];
    const placed = placeBeats(beats, AGENTS, CHANNELS);
    expect(placed).toHaveLength(2);
    expect(placed[1]?.speaker?.agentId).toBe("bruno");
  });

  it("keeps everyone seated across beats in the same room", () => {
    const beats = [beat(), beat({ actorId: "bruno" }), beat({ actorId: "marcela" })];
    const [a, b, c] = placeBeats(beats, AGENTS, CHANNELS);
    expect(seats(b!)).toEqual(seats(a!));
    expect(seats(c!)).toEqual(seats(a!));
  });

  it("does not let a silence in the same channel reshuffle the public room", () => {
    // The old ref keyed memory by channel id, so the one-seat thought room
    // overwrote the public room's seating and the next line moved everyone.
    const beats = [
      beat(),
      beat({ kind: "silence", actorId: "marcela", text: "", thought: { text: "…", drivers: [] } }),
      beat({ actorId: "bruno" }),
    ];
    const [first, silence, after] = placeBeats(beats, AGENTS, CHANNELS);
    expect(silence?.kind).toBe("thought");
    expect(silence?.marks).toHaveLength(1);
    expect(seats(after!)).toEqual(seats(first!));
  });

  it("re-checks a held seat against the size of the new room", () => {
    const six = [...AGENTS, { id: "d" }, { id: "e" }, { id: "f" }];
    const all = six.map((a) => a.id);
    const channels: LiveChannel[] = [
      { id: "geral", name: "geral", type: "public_channel", memberAgentIds: all },
      { id: "dm", name: "dm", type: "private_channel", memberAgentIds: all },
    ];
    const beats = [beat({ participantIds: all }), beat({ channelId: "dm", participantIds: all, actorId: "f" })];
    const [, inPrivate] = placeBeats(beats, six, channels);
    for (const mark of inPrivate!.marks) expect(mark.slot).toBeLessThan(slotsFor("private").length);
  });

  it("is deterministic: walking the list twice gives the same seating", () => {
    const beats = [beat(), beat({ channelId: "dm", participantIds: ["iris", "marcela"] }), beat({ actorId: "marcela" })];
    const once = placeBeats(beats, AGENTS, CHANNELS).map(seats);
    const twice = placeBeats(beats, AGENTS, CHANNELS).map(seats);
    expect(twice).toEqual(once);
  });

  it("carries the warm-up seating into the first beat", () => {
    const idle = idlePlacement(CHANNELS[0], AGENTS);
    const [first] = placeBeats([beat({ actorId: "marcela" })], AGENTS, CHANNELS, { seed: idle });
    expect(seats(first!)).toEqual(seats(idle));
  });

  it("orders marks front to back by slot", () => {
    const [placed] = placeBeats([beat({ actorId: "marcela" })], AGENTS, CHANNELS);
    const slots = placed!.marks.map((m) => m.slot);
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it("names the room by kind and channel, so a thought is a different room than the channel it came from", () => {
    expect(roomKeyOf("thought", "geral")).not.toBe(roomKeyOf("public", "geral"));
    const beats = [beat(), beat({ kind: "silence", actorId: "bruno", text: "", thought: { text: "…", drivers: [] } })];
    const [talk, quiet] = placeBeats(beats, AGENTS, CHANNELS);
    expect(quiet?.roomKey).not.toBe(talk?.roomKey);
  });
});

describe("kindOf", () => {
  it("makes a silence a thought whatever the channel", () => {
    expect(kindOf("public_channel", beat({ kind: "silence" }))).toBe("thought");
  });
  it("reads the channel type otherwise", () => {
    expect(kindOf("private_channel", beat())).toBe("private");
    expect(kindOf("operator_channel", beat())).toBe("operator");
    expect(kindOf("public_channel", undefined)).toBe("public");
  });
});

describe("idlePlacement", () => {
  it("seats the channel's members in channel order with nobody speaking", () => {
    const idle = idlePlacement(CHANNELS[1], AGENTS);
    expect(idle.kind).toBe("private");
    expect(idle.marks.map((m) => m.agentId)).toEqual(["iris", "marcela"]);
    expect(idle.speaker).toBeUndefined();
  });
  it("is an empty public room when there is no channel yet", () => {
    expect(idlePlacement(undefined, AGENTS).marks).toEqual([]);
  });
});
