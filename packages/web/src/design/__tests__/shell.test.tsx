/**
 * The mark in the corner is the way home: it shows the landing again. It is
 * not a step, so it does not touch what has been picked.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../Shell.js";

describe("Shell", () => {
  afterEach(cleanup);

  it("focuses the new step heading when moving through the flow", () => {
    const props = { furthest: "scene" as const, onStep: vi.fn(), onHome: vi.fn() };
    const { getByRole, rerender } = render(<Shell {...props} step="cast"><h2>Cast</h2></Shell>);
    expect(document.activeElement).toBe(getByRole("heading", { name: "Cast" }));
    rerender(<Shell {...props} step="scene"><h2>Scene</h2></Shell>);
    expect(document.activeElement).toBe(getByRole("heading", { name: "Scene" }));
  });

  it("shows the landing when the mark is clicked", () => {
    const onHome = vi.fn();
    const { getByRole } = render(
      <Shell step="cast" furthest="cast" onStep={vi.fn()} onHome={onHome}>
        <p>step</p>
      </Shell>,
    );
    fireEvent.click(getByRole("button", { name: /perfectman/ }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
