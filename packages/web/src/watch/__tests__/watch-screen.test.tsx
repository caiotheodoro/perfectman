/**
 * Past runs, watched as films: pick one, wait for it, then play, scrub, change
 * the reading pace and the lens.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunListEntry } from "@perfectman/shared";
import * as client from "../../api/client.js";
import { WatchScreen } from "../WatchScreen.js";
import { tinyReplay } from "./replay-fixture.js";

const run = (over: Partial<RunListEntry> = {}): RunListEntry => ({
  runId: "run_1", simulationId: "sim_1", name: "The cat on the roof", state: "done", startedAt: 1_700_000_000_000,
  pulsesRun: 4, maxPulses: 4, counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 }, diagnostics: [], ...over,
});

beforeEach(() => {
  // jsdom has no canvas; text is measured by the fallback.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openFilm(): Promise<void> {
  vi.spyOn(client, "listRuns").mockResolvedValue({ runs: [run()] });
  vi.spyOn(client, "fetchReplay").mockResolvedValue(tinyReplay());
  render(<WatchScreen onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /The cat on the roof/ }));
  await screen.findByRole("button", { name: "Play" });
}

const clockText = (): string => document.querySelector(".film__time")!.textContent ?? "";
const duration = (): number => {
  const [m, s] = clockText().split(" / ")[1]!.split(":").map(Number);
  return m! * 60 + s!;
};

describe("the run picker", () => {
  it("lists finished runs and leaves out one that never got going", async () => {
    vi.spyOn(client, "listRuns").mockResolvedValue({ runs: [run(), run({ runId: "run_0", name: "Empty", pulsesRun: 0 })] });
    render(<WatchScreen onClose={vi.fn()} />);

    expect((await screen.findByRole("button", { name: /The cat on the roof/ })).textContent).toContain("The cat on the roof");
    expect(screen.queryByText("Empty")).toBeNull();
  });

  it("says what to do when there is nothing to watch", async () => {
    vi.spyOn(client, "listRuns").mockResolvedValue({ runs: [] });
    render(<WatchScreen onClose={vi.fn()} />);

    expect((await screen.findByText(/No finished runs yet/)).textContent).toContain("Run a scene first");
  });

  it("says when it could not list the runs", async () => {
    vi.spyOn(client, "listRuns").mockRejectedValue(new Error("server is down"));
    render(<WatchScreen onClose={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("server is down");
  });

  it("closes on Escape", () => {
    vi.spyOn(client, "listRuns").mockResolvedValue({ runs: [] });
    const onClose = vi.fn();
    render(<WatchScreen onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });
});

describe("opening a run", () => {
  it("says it is loading, then shows the film", async () => {
    await openFilm();

    expect(screen.getByRole("img", { name: /drawn as a film/ }).querySelectorAll(".watch-actor")).toHaveLength(3);
    expect(clockText()).toMatch(/^0:00 \/ \d+:\d\d$/);
  });

  it("offers a retry when the replay cannot be loaded", async () => {
    vi.spyOn(client, "listRuns").mockResolvedValue({ runs: [run()] });
    const fetch = vi.spyOn(client, "fetchReplay").mockRejectedValueOnce(new Error("no replay")).mockResolvedValue(tinyReplay());
    render(<WatchScreen onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /The cat on the roof/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("no replay");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Play" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("the controls", () => {
  it("plays and pauses, from the button and from the space bar", async () => {
    await openFilm();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" }).textContent).toBe("Pause");

    fireEvent.keyDown(document.querySelector(".film")!, { key: " " });
    expect(screen.getByRole("button", { name: "Play" }).textContent).toBe("Play");
  });

  it("moves through the film with the slider and the skip buttons", async () => {
    await openFilm();
    fireEvent.change(screen.getByLabelText("Position in the film"), { target: { value: "500" } });
    const middle = clockText().split(" / ")[0]!;
    expect(middle).not.toBe("0:00");

    fireEvent.click(screen.getByRole("button", { name: "Back five seconds" }));
    expect(clockText().split(" / ")[0]).not.toBe(middle);
  });

  it("changes the speed, the lens and the voices, and says which is on", async () => {
    await openFilm();
    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    expect(screen.getByRole("button", { name: "4x" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1x" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Fiction only" }));
    expect(screen.getByRole("button", { name: "Fiction only" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Omniscient" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Voices" }));
    expect(screen.getByRole("button", { name: "Voices" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(screen.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("makes the film longer for a relaxed reader and shorter for a fast one", async () => {
    await openFilm();
    fireEvent.click(screen.getByRole("button", { name: "Relaxed" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Relaxed" }).getAttribute("aria-pressed")).toBe("true"));
    await screen.findByRole("button", { name: "Play" });
    const relaxed = await waitFor(() => { const d = duration(); expect(d).toBeGreaterThan(0); return d; });

    fireEvent.click(screen.getByRole("button", { name: "Fast" }));
    await waitFor(() => expect(duration()).toBeLessThan(relaxed));
  });
});
