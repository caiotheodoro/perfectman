import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../Shell.js";

afterEach(cleanup);

describe("Shell and past runs", () => {
  it("offers to watch a past run when it is given somewhere to go", () => {
    const onWatch = vi.fn();
    render(<Shell step="cast" furthest="cast" onStep={vi.fn()} onHome={vi.fn()} onWatch={onWatch}><p>body</p></Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Watch a past run" }));

    expect(onWatch).toHaveBeenCalledOnce();
  });

  it("shows no such button when there is nowhere to go", () => {
    render(<Shell step="cast" furthest="cast" onStep={vi.fn()} onHome={vi.fn()}><p>body</p></Shell>);

    expect(screen.queryByRole("button", { name: "Watch a past run" })).toBeNull();
  });
});
