/**
 * The strip under the room: every beat as a small picture, the current one
 * ringed, the ones a live run has produced but the reader has not reached
 * still blank. It is the scrubber, so it must work from the keyboard.
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { placeBeats, type LiveChannel, type StageBeat } from "@perfectman/shared";
import { ContactSheet } from "../ContactSheet.js";
import { frameFor, frameLabel } from "../Frame.js";

const AGENTS = [
  { id: "iris", displayName: "íris" },
  { id: "bruno", displayName: "bruno" },
];
const IDS = ["iris", "bruno"];
const CHANNELS: LiveChannel[] = [{ id: "geral", name: "geral", type: "public_channel", memberAgentIds: IDS }];

function beat(id: string, over: Partial<StageBeat> = {}): StageBeat {
  return {
    id, kind: "message", pulseIndex: 0, channelId: "geral", actorId: "iris", text: id,
    audienceIds: [], participantIds: IDS, duration: 3, page: 0, ...over,
  };
}
const BEATS = ["a", "b", "c", "d", "e"].map((id) => beat(id, { actorId: id < "c" ? "iris" : "bruno" }));
const PLACED = placeBeats(BEATS, AGENTS, CHANNELS);
const FRAMES = BEATS.map((b, i) => frameFor(b, PLACED[i]!, IDS));
const LABELS = BEATS.map((b) => frameLabel(b, AGENTS, CHANNELS[0]));

function sheet(over: Partial<Parameters<typeof ContactSheet>[0]> = {}) {
  const onSeek = vi.fn();
  const utils = render(
    <ContactSheet frames={FRAMES} labels={LABELS} index={2} reached={2} live={false} onSeek={onSeek} {...over} />,
  );
  return { ...utils, onSeek, buttons: () => utils.container.querySelectorAll("button") };
}

describe("ContactSheet", () => {
  it("shows one frame per beat, with no words in it", () => {
    const { buttons, container } = sheet();
    expect(buttons()).toHaveLength(5);
    expect(container.textContent).toBe("");
  });

  it("rings the current frame and names every frame for a screen reader", () => {
    const { buttons } = sheet();
    expect(buttons()[2]?.getAttribute("aria-current")).toBe("true");
    expect(buttons()[1]?.getAttribute("aria-current")).toBeNull();
    expect(buttons()[0]?.getAttribute("aria-label")).toBe("íris speaks in geral");
  });

  it("seeks to a frame when it is clicked", () => {
    const { buttons, onSeek } = sheet();
    fireEvent.click(buttons()[4]!);
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it("is one tab stop that the arrow keys move through", () => {
    const { buttons, onSeek, container } = sheet();
    expect([...buttons()].filter((b) => b.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(container.querySelector('[role="group"]')!, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(3);
    fireEvent.keyDown(container.querySelector('[role="group"]')!, { key: "Home" });
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("leaves frames the reader has not reached blank while the run is live", () => {
    const { container } = sheet({ live: true, reached: 2 });
    const blank = container.querySelectorAll(".frame--blank");
    expect(blank).toHaveLength(2);
    expect(container.querySelectorAll("button")[3]?.getAttribute("aria-label")).toContain("ahead of you");
  });

  it("draws every frame of a finished run, whatever was reached", () => {
    const { container } = sheet({ live: false, reached: 0 });
    expect(container.querySelectorAll(".frame--blank")).toHaveLength(0);
  });
});
