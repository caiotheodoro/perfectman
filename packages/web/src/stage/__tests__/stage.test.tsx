/**
 * The room draws what the placement says, not what it works out for itself.
 * Seating is decided once for the whole run (see shared `placeBeats`); the
 * stage only puts figures on the marks it is handed.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { idlePlacement, placeBeats, type LiveChannel, type StageBeat } from "@perfectman/shared";
import { Stage } from "../Stage.js";

const AGENTS = [
  { id: "iris", displayName: "íris" },
  { id: "bruno", displayName: "bruno" },
  { id: "marcela", displayName: "marcela" },
];
const IDS = AGENTS.map((a) => a.id).sort();
const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris", "bruno", "marcela"] },
];

function beat(over: Partial<StageBeat> = {}): StageBeat {
  return {
    id: "b1", kind: "message", pulseIndex: 0, channelId: "geral", actorId: "iris", text: "hello",
    audienceIds: [], participantIds: ["iris", "bruno", "marcela"], duration: 3, page: 0, ...over,
  };
}

describe("Stage", () => {
  it("draws exactly the marks in the placement, not everyone in the beat", () => {
    const b = beat();
    const [placement] = placeBeats([b], AGENTS, CHANNELS);
    const only = { ...placement!, marks: placement!.marks.filter((m) => m.agentId === "bruno") };
    const { container } = render(<Stage beat={b} placement={only} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    expect(container.querySelectorAll(".stage__mark")).toHaveLength(1);
    expect(container.textContent).toContain("bruno");
    expect(container.textContent).not.toContain("marcela");
  });

  it("hangs one speech balloon off the speaker", () => {
    const b = beat();
    const [placement] = placeBeats([b], AGENTS, CHANNELS);
    const { container } = render(<Stage beat={b} placement={placement!} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    expect(container.querySelectorAll(".bubble--speech")).toHaveLength(1);
    expect(container.querySelectorAll(".bubble--thought")).toHaveLength(0);
  });

  it("shows a thought as a cloud, never as paper", () => {
    const b = beat({ kind: "silence", text: "", thought: { text: "not now", drivers: [] } });
    const [placement] = placeBeats([b], AGENTS, CHANNELS);
    const { container } = render(<Stage beat={b} placement={placement!} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    expect(container.querySelectorAll(".bubble--thought")).toHaveLength(1);
    expect(container.querySelectorAll(".bubble--speech")).toHaveLength(0);
    expect(container.querySelector(".stage--thought")).not.toBeNull();
  });

  it("names who is shut out of a private room", () => {
    const channels: LiveChannel[] = [
      ...CHANNELS,
      { id: "dm", name: "dm", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
    ];
    const b = beat({ channelId: "dm", participantIds: ["iris", "marcela"] });
    const [placement] = placeBeats([b], AGENTS, channels);
    const { container } = render(<Stage beat={b} placement={placement!} agents={AGENTS} channels={channels} ids={IDS} />);
    expect(container.querySelector(".stage__shut-out")?.textContent).toContain("bruno");
  });

  it("lists three shut-out people the way a sentence would", () => {
    const five = [...AGENTS, { id: "d", displayName: "Dora" }, { id: "e", displayName: "Eli" }];
    const channels: LiveChannel[] = [
      ...CHANNELS,
      { id: "dm", name: "dm", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
    ];
    const b = beat({ channelId: "dm", participantIds: ["iris", "marcela"] });
    const [placement] = placeBeats([b], five, channels);
    const { container } = render(<Stage beat={b} placement={placement!} agents={five} channels={channels} ids={five.map((a) => a.id)} />);
    expect(container.querySelector(".stage__shut-out")?.textContent).toBe("bruno, Dora and Eli cannot see this");
  });

  it("seats the idle room with nobody lit and no balloon", () => {
    const placement = idlePlacement(CHANNELS[0], AGENTS);
    const { container } = render(<Stage beat={undefined} placement={placement} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    expect(container.querySelectorAll(".stage__mark")).toHaveLength(3);
    expect(container.querySelectorAll(".bubbles")).toHaveLength(0);
  });
});

describe("Stage reactions", () => {
  it("lets a non-speaker wear the face they recorded", () => {
    const b = beat({
      emotion: { source: "authored", label: "neutral" },
      reactions: { marcela: { source: "authored", label: "worried" } },
    });
    const [placement] = placeBeats([b], AGENTS, CHANNELS);
    const { container } = render(<Stage beat={b} placement={placement!} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    const faces = Object.fromEntries(
      [...container.querySelectorAll(".figure")].map((f) => [f.querySelector(".figure__name")?.textContent, f.getAttribute("data-face")]),
    );
    expect(faces["marcela"]).toBe("worried");
    expect(faces["bruno"]).toBe("neutral");
  });
});

describe("Stage events", () => {
  it("draws no balloon for someone arriving, leaving or opening a room", () => {
    const b = beat({ kind: "event", text: "conversa_privada", stageAction: { kind: "invite", agentIds: ["iris"] } });
    const [placement] = placeBeats([b], AGENTS, CHANNELS);
    const { container } = render(<Stage beat={b} placement={placement!} agents={AGENTS} channels={CHANNELS} ids={IDS} />);
    expect(container.querySelector(".bubbles")).toBeNull();
  });
});
