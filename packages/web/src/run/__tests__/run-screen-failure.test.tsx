/**
 * When the model, the key or the output format does not work, the run screen
 * hands the viewer back to setup with the reason — it does not sit on
 * "Reaching the model…" forever.
 */
import { render } from "@testing-library/react";
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
  it("gives up with the reason, so setup can ask for the key again", () => {
    const onGiveUp = vi.fn();
    render(
      <RunScreen compiled={{ ok: true, config: {}, diagnostics: [], summary: null }} stream={failed("HTTP 401: invalid api key", "Check the key.")} runId="r1" error={null}
        onStop={vi.fn()} onDismissError={vi.fn()} onReset={vi.fn()} onGiveUp={onGiveUp} unlockRef={{ current: () => undefined }} />,
    );
    expect(onGiveUp).toHaveBeenCalledWith({ message: "HTTP 401: invalid api key", hint: "Check the key." });
  });

  it("offers a way back when nothing is running", () => {
    const onReset = vi.fn();
    const { getByRole } = render(
      <RunScreen compiled={null} stream={EMPTY} runId={null} error={null}
        onStop={vi.fn()} onDismissError={vi.fn()} onReset={onReset} onGiveUp={vi.fn()} unlockRef={{ current: () => undefined }} />,
    );
    getByRole("button", { name: "Back to setup" }).click();
    expect(onReset).toHaveBeenCalledOnce();
  });
});
