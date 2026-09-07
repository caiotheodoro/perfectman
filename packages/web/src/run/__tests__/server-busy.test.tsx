/**
 * The server takes one run at a time, and on a shared link the run in progress
 * is usually not yours. Finding that out by pressing Start and reading a 409 is
 * the wrong order, so the form asks first and says whose turn it is.
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunStatus } from "@perfectman/shared";
import type { RunStream } from "../../api/useRunStream.js";
import { RunScreen } from "../RunScreen.js";
import * as client from "../../api/client.js";

const EMPTY: RunStream = {
  replay: null, helloRunId: null, status: null, notices: [], raw: [], dropped: 0,
  connected: false, error: null, stoppedReason: null,
};

const COMPILED = { ok: true, config: {}, diagnostics: [], summary: null };

function status(over: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: "r_other", simulationId: "s", state: "running", pulseIndex: 3, pulsesRun: 4, maxPulses: 16,
    counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 }, ...over,
  };
}

function screen(props: Partial<Parameters<typeof RunScreen>[0]> = {}) {
  return render(
    <RunScreen
      compiled={COMPILED} stream={EMPTY} runId={null} error={null}
      onRun={vi.fn()} onStop={vi.fn()} onDismissError={vi.fn()} onReset={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("when the server is already busy", () => {
  it("says so, with how far along the other run is", async () => {
    vi.spyOn(client, "currentStatus").mockResolvedValue(status());
    const { container } = screen();

    await waitFor(() => expect(container.querySelector(".busy")).not.toBeNull());
    expect(container.querySelector(".busy")?.textContent).toContain("4 of 16 turns in");
  });

  it("disables Start rather than letting it fail with a 409", async () => {
    vi.spyOn(client, "currentStatus").mockResolvedValue(status());
    const { container } = screen();

    await waitFor(() => expect(container.querySelector(".busy")).not.toBeNull());
    const start = [...container.querySelectorAll("button")].find((b) => /start/i.test(b.textContent ?? ""));
    expect(start?.disabled).toBe(true);
  });

  it("leaves Start alone when the server is idle", async () => {
    vi.spyOn(client, "currentStatus").mockResolvedValue(
      status({ runId: null, state: "idle", pulsesRun: 0, maxPulses: 0 }),
    );
    const { container } = screen();

    await waitFor(() => expect(client.currentStatus).toHaveBeenCalled());
    expect(container.querySelector(".busy")).toBeNull();
  });

  it("does not block the button when the server cannot be reached", async () => {
    // An unreachable server is a different problem, and pressing Start reports
    // it properly. Blocking on it would strand the user with no way forward.
    vi.spyOn(client, "currentStatus").mockRejectedValue(new Error("network"));
    const { container } = screen();

    await waitFor(() => expect(client.currentStatus).toHaveBeenCalled());
    expect(container.querySelector(".busy")).toBeNull();
  });

  it("treats a run that is still tearing down as busy", async () => {
    // `stopping` still refuses a start: teardown waits for the pulse in flight.
    vi.spyOn(client, "currentStatus").mockResolvedValue(status({ state: "stopping" }));
    const { container } = screen();

    await waitFor(() => expect(container.querySelector(".busy")).not.toBeNull());
  });

  it("stops asking once a run of your own is on screen", async () => {
    vi.spyOn(client, "currentStatus").mockResolvedValue(status());
    screen({ runId: "r_mine" });

    await new Promise((r) => setTimeout(r, 60));
    expect(client.currentStatus).not.toHaveBeenCalled();
  });
});
