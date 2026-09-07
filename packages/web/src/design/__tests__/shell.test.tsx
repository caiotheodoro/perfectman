/**
 * The mark in the corner is the way home: it shows the landing again. It is
 * not a step, so it does not touch what has been picked.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../Shell.js";

describe("Shell", () => {
  afterEach(cleanup);

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
