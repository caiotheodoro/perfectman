/**
 * A change of room is a page turning, not a swap. The page that is leaving
 * stays mounted for the turn and keeps drawing the beat it was on; the new one
 * comes in behind it. Same room, new line: no turn, the room just updates.
 */
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeBeats, type LiveChannel, type StageBeat } from "@perfectman/shared";
import { Panel, TURN_MS } from "../Panel.js";
import * as motion from "../motion.js";

const AGENTS = [
  { id: "iris", displayName: "íris" },
  { id: "bruno", displayName: "bruno" },
];
const IDS = ["bruno", "iris"];
const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "geral", type: "public_channel", memberAgentIds: ["iris", "bruno"] },
  { id: "dm", name: "dm", type: "private_channel", memberAgentIds: ["iris", "bruno"] },
];

function beat(id: string, over: Partial<StageBeat> = {}): StageBeat {
  return {
    id, kind: "message", pulseIndex: 0, channelId: "geral", actorId: "iris", text: `line ${id}`,
    audienceIds: [], participantIds: ["iris", "bruno"], duration: 3, page: 0, ...over,
  };
}

const BEATS = [beat("a"), beat("b", { actorId: "bruno" }), beat("c", { channelId: "dm" }), beat("d", { channelId: "dm" })];
const PLACED = placeBeats(BEATS, AGENTS, CHANNELS);

function panelAt(index: number) {
  return <Panel beat={BEATS[index]} placement={PLACED[index]!} index={index} agents={AGENTS} channels={CHANNELS} ids={IDS} />;
}

describe("Panel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows one page in one room", () => {
    const { container } = render(panelAt(0));
    expect(container.querySelectorAll(".pages__page")).toHaveLength(1);
  });

  it("does not turn between two lines in the same room", () => {
    const { container, rerender } = render(panelAt(0));
    rerender(panelAt(1));
    expect(container.querySelectorAll(".pages__page")).toHaveLength(1);
    expect(container.textContent).toContain("line b");
  });

  it("keeps the leaving page up for the turn, still showing its own line", () => {
    const { container, rerender } = render(panelAt(1));
    rerender(panelAt(2));
    const pages = container.querySelectorAll(".pages__page");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.className).toContain("pages__page--leave-forward");
    expect(pages[0]?.textContent).toContain("line b");
    expect(pages[1]?.className).toContain("pages__page--enter-forward");
    expect(pages[1]?.textContent).toContain("line c");
  });

  it("drops the leaving page once the turn is over", () => {
    const { container, rerender } = render(panelAt(1));
    rerender(panelAt(2));
    act(() => {
      vi.advanceTimersByTime(TURN_MS + 1);
    });
    expect(container.querySelectorAll(".pages__page")).toHaveLength(1);
  });

  it("turns the other way when seeking backwards", () => {
    const { container, rerender } = render(panelAt(3));
    rerender(panelAt(0));
    const pages = container.querySelectorAll(".pages__page");
    expect(pages[0]?.className).toContain("pages__page--leave-back");
    expect(pages[1]?.className).toContain("pages__page--enter-back");
  });

  it("never holds more than one leaving page under rapid seeks", () => {
    const { container, rerender } = render(panelAt(0));
    rerender(panelAt(2));
    rerender(panelAt(0));
    rerender(panelAt(3));
    expect(container.querySelectorAll(".pages__page")).toHaveLength(2);
  });

  it("still turns when React renders twice, as it does in development", () => {
    const { container, rerender } = render(<StrictMode>{panelAt(1)}</StrictMode>);
    rerender(<StrictMode>{panelAt(2)}</StrictMode>);
    expect(container.querySelectorAll(".pages__page")).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(TURN_MS + 1);
    });
    expect(container.querySelectorAll(".pages__page")).toHaveLength(1);
  });

  it("swaps instantly when the reader asked for less motion", () => {
    vi.spyOn(motion, "reducedMotion").mockReturnValue(true);
    const { container, rerender } = render(panelAt(1));
    rerender(panelAt(2));
    expect(container.querySelectorAll(".pages__page")).toHaveLength(1);
    expect(container.textContent).toContain("line c");
  });
});
