/**
 * A room the agents opened themselves is named by the engine, and that name is
 * an id. These are the shapes a real run produced.
 */
import { describe, expect, it } from "vitest";
import type { LiveChannel } from "@perfectman/shared";
import { roomLabel } from "../room-label.js";

const AGENTS = [
  { id: "iris", displayName: "Iris" },
  { id: "bruno", displayName: "Bruno" },
  { id: "marcela", displayName: "Marcela" },
];

function channel(over: Partial<LiveChannel>): LiveChannel {
  return { id: "c", name: "c", type: "public_channel", memberAgentIds: [], ...over };
}

describe("roomLabel", () => {
  it("keeps the authored name of a public channel", () => {
    expect(roomLabel(channel({ name: "studio", memberAgentIds: ["iris"] }), AGENTS)).toBe("studio");
  });

  it("names a private room by who is in it, not by its id", () => {
    const room = channel({
      type: "private_channel",
      name: "Bk1u4NORDRAIyZFCMFJRF",
      memberAgentIds: ["iris", "marcela"],
    });
    expect(roomLabel(room, AGENTS)).toBe("Iris and Marcela");
  });

  it("says so when somebody opened a room and is in it alone", () => {
    const room = channel({ type: "private_channel", name: "x", memberAgentIds: ["iris"] });
    expect(roomLabel(room, AGENTS)).toBe("Iris alone");
  });

  it("lists three the way a sentence would", () => {
    const room = channel({
      type: "private_channel",
      name: "x",
      memberAgentIds: ["iris", "bruno", "marcela"],
    });
    expect(roomLabel(room, AGENTS)).toBe("Iris, Bruno and Marcela");
  });

  it("falls back to a description rather than showing an id with no members", () => {
    const room = channel({ type: "private_channel", name: "Bk1u4NORDRAIyZFCMFJRF", memberAgentIds: [] });
    expect(roomLabel(room, AGENTS)).toBe("a private channel");
  });

  it("keeps an authored private name when it reads like a name", () => {
    const room = channel({ type: "private_channel", name: "iris_marcela", memberAgentIds: [] });
    expect(roomLabel(room, AGENTS)).toBe("iris_marcela");
  });

  it("handles a beat whose channel is not in the list yet", () => {
    expect(roomLabel(undefined, AGENTS)).toBe("somewhere");
  });
});
