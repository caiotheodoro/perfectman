import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as motion from "../../stage/motion.js";
import { Intro } from "../Intro.js";
import { INTRO_BEATS } from "../intro-script.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Intro playback", () => {
  // reducedMotion is an intentional browser-preference input seam, not a call-count assertion.
  it("starts paused for reduced motion, keeps all six authored moments in order, and allows seeking", () => {
    vi.useFakeTimers();
    vi.spyOn(motion, "reducedMotion").mockReturnValue(true);
    const onDone = vi.fn();
    const { getByRole, getByLabelText, container } = render(<Intro onDone={onDone} />);
    expect(getByRole("button", { name: "Play preview" }).textContent).toBe("Play");
    act(() => vi.advanceTimersByTime(60_000));
    expect(getByLabelText("Beat 1 of 6").textContent?.trim()).toBe("1 / 6");
    for (const [index, beat] of INTRO_BEATS.entries()) {
      if (index > 0) fireEvent.click(getByRole("button", { name: "Next beat" }));
      expect(container.querySelector(".pages__page:not([aria-hidden])")?.textContent, `Beat ${index + 1}`).toContain(beat.line ?? beat.thought);
      expect(getByLabelText(`Beat ${index + 1} of 6`).textContent?.trim(), `Beat ${index + 1}`).toBe(`${index + 1} / 6`);
    }
    expect(getByRole("button", { name: "Next beat" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(getByRole("button", { name: /^Beat 3:/ }));
    expect(getByLabelText("Beat 3 of 6").textContent?.trim()).toBe("3 / 6");
    fireEvent.click(getByRole("button", { name: "Previous beat" }));
    expect(getByLabelText("Beat 2 of 6").textContent?.trim()).toBe("2 / 6");
    fireEvent.click(getByRole("button", { name: "Build a room" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("pauses autoplay and resumes the same beat for its reading interval", () => {
    vi.useFakeTimers();
    vi.spyOn(motion, "reducedMotion").mockReturnValue(false);
    const { getByRole, getByLabelText, container } = render(<Intro onDone={() => undefined} />);
    expect(container.querySelector(".stage--playing")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Pause preview" }));
    expect(container.querySelector(".stage--playing")).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(getByLabelText("Beat 1 of 6").textContent?.trim()).toBe("1 / 6");
    fireEvent.click(getByRole("button", { name: "Play preview" }));
    const firstBeat = INTRO_BEATS[0];
    expect(firstBeat).toBeDefined();
    act(() => vi.advanceTimersByTime(firstBeat!.hold));
    expect(getByLabelText("Beat 2 of 6").textContent?.trim()).toBe("2 / 6");
    fireEvent.click(getByRole("button", { name: "Next beat" }));
    expect(getByRole("button", { name: "Play preview" }).textContent).toBe("Play");
    act(() => vi.advanceTimersByTime(60_000));
    expect(getByLabelText("Beat 3 of 6").textContent?.trim()).toBe("3 / 6");
  });
});
