/**
 * The caption says what kind of moment this is. For a stage action — a room
 * opened, someone arriving or leaving — it is the whole story, because there
 * is no balloon.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LiveChannel, StageBeat } from "@perfectman/shared";
import { Attribution } from "../Attribution.js";

const AGENTS = [
  { id: "rex", displayName: "Rex" },
  { id: "goulart", displayName: "Goulart" },
  { id: "caio", displayName: "Caio" },
];
const IDS = AGENTS.map((a) => a.id);
const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "acampamento", type: "public_channel", memberAgentIds: IDS },
  { id: "dm", name: "conversa_privada", type: "private_channel", memberAgentIds: ["rex", "goulart"] },
];

function beat(over: Partial<StageBeat>): StageBeat {
  return {
    id: "b", kind: "event", pulseIndex: 0, channelId: "dm", actorId: "rex", text: "",
    audienceIds: [], participantIds: ["rex", "goulart"], duration: 2, page: 0, ...over,
  };
}

function caption(b: StageBeat): string {
  const { container } = render(<Attribution beat={b} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
  return container.textContent ?? "";
}

describe("Attribution for stage actions", () => {
  it("says who a private room was opened with, not the channel's name", () => {
    const text = caption(beat({ stageAction: { kind: "invite", agentIds: ["rex"] }, audienceIds: ["rex", "goulart"] }));
    expect(text).toContain("Rex");
    expect(text).toContain("opens a private room with Goulart");
    expect(text).not.toContain("conversa_privada");
  });
  it("says who arrives where", () => {
    expect(caption(beat({ stageAction: { kind: "arrive", agentIds: ["rex"] }, channelId: "geral" }))).toContain("joins acampamento");
  });
  it("says who leaves where", () => {
    expect(caption(beat({ stageAction: { kind: "leave", agentIds: ["rex"] } }))).toContain("leaves Rex and Goulart");
  });
});
