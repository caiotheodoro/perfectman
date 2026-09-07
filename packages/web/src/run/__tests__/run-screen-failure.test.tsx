/**
 * When the model, the key or the output format does not work, the run screen
 * says so and asks for the key again — it does not sit on "Reaching the
 * model…" forever.
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunStream } from "../../api/useRunStream.js";
import { RunScreen } from "../RunScreen.js";

const EMPTY: RunStream = {
  replay: null, helloRunId: null, status: null, notices: [], raw: [], dropped: 0, connected: false, error: null, stoppedReason: null,
};

function failed(message: string, hint?: string): RunStream {
  return {
    ...EMPTY,
    status: {
      runId: "r1", simulationId: "s", state: "failed", pulseIndex: 0, pulsesRun: 0, maxPulses: 6,
      error: { message, ...(hint ? { hint } : {}) }, counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
    },
  };
}

describe("RunScreen after a failure before the stage", () => {
  it("returns to the form, shows the error, and asks for the key again", () => {
    const onReset = vi.fn();
    const { container, rerender } = render(
      <RunScreen compiled={{ ok: true, config: {}, diagnostics: [], summary: null }} stream={failed("HTTP 401: invalid api key", "Check the key.")} runId="r1" error={null} onRun={vi.fn()} onStop={vi.fn()} onDismissError={vi.fn()} onReset={onReset} />,
    );
    expect(onReset).toHaveBeenCalled();
    // The app clears the run id in response; the form comes back with the failure on it.
    rerender(
      <RunScreen compiled={{ ok: true, config: {}, diagnostics: [], summary: null }} stream={EMPTY} runId={null} error={null} onRun={vi.fn()} onStop={vi.fn()} onDismissError={vi.fn()} onReset={onReset} />,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("HTTP 401: invalid api key");
    expect(alert?.textContent).toContain("Check the key.");
    const key = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(key).not.toBeNull();
    expect(key?.value).toBe("");
    expect(document.activeElement).toBe(key);
  });
});
