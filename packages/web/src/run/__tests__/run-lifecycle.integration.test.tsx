import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage, RunStatus } from "@perfectman/shared";
import { fold, type RunStream } from "../../api/useRunStream.js";
import { RunScreen } from "../RunScreen.js";

const EMPTY: RunStream = {
  replay: null, helloRunId: null, status: null, notices: [], raw: [], dropped: 0,
  connected: false, error: null, stoppedReason: null,
};

function streamWith(messages: number, state?: RunStatus["state"]): RunStream {
  const priorEvents: LiveMessage[] = Array.from({ length: messages }, (_, i) => ({
    eventId: `line-${i}`, channelId: "room", actorId: "iris", eventType: "message_sent",
    text: `Opening line ${i}`, visibleToAgents: [], pulseIndex: -1, createdAt: 0,
  }));
  const stream = fold(EMPTY, {
    type: "hello", runId: "r1", simulationId: "s", simulationName: "Dinner", maxPulses: 6,
    agents: [{ id: "iris", displayName: "Iris", archetype: "connector" }],
    channels: [{ id: "room", name: "Dinner", type: "public_channel", memberAgentIds: ["iris"] }],
    priorEvents,
  });
  return state ? fold(stream, { type: "status", status: {
    runId: "r1", simulationId: "s", state, pulseIndex: 0, pulsesRun: 0, maxPulses: 6,
    counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
    ...(state === "failed" ? { error: { message: "Provider unavailable" } } : {}),
  } }) : stream;
}

// Unused callbacks and media output are intentional sinks; these tests exercise lifecycle UI.
const ignore = () => undefined;
function screen(stream: RunStream, onReset = ignore, onStop = ignore) {
  return <RunScreen compiled={null} stream={stream} runId="r1" error={null}
    onRun={ignore} onStop={onStop} onDismissError={ignore} onReset={onReset} />;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", window.localStorage);
  localStorage.setItem("perfectman.sound.muted", "1");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(ignore);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("run lifecycle", () => {
  it("shows the compiled cast while the start request is pending, before a stream exists", () => {
    const { container, getByRole } = render(<RunScreen
      compiled={{ ok: true, config: {}, diagnostics: [], summary: {
        agents: [{ id: "iris", displayName: "Iris", archetype: "connector", personaFile: "iris.md", calibrationFrom: "iris" }],
        channels: [{ id: "room", name: "Dinner", type: "public_channel", members: ["iris"] }],
        maxPulses: 6, seed: 0, languages: {},
      } }} stream={EMPTY} runId={null} starting error={null}
      onRun={ignore} onStop={ignore} onDismissError={ignore} onReset={ignore}
    />);
    expect(container.querySelector(".stage .figure__name")?.textContent).toBe("Iris");
    expect(getByRole("button", { name: "Cancel preparation" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows the first available beat without waiting for more turns or terminal status", () => {
    const { queryByLabelText, getByRole, rerender } = render(screen(streamWith(1)));
    expect(queryByLabelText("Position in the run")?.textContent).toBe("1 / 1");
    expect(getByRole("button", { name: "Stop the run" }).hasAttribute("disabled")).toBe(false);
    rerender(screen(streamWith(1, "done")));
    expect(queryByLabelText("Position in the run")?.textContent).toBe("1 / 1");
  });

  it.each(["done", "failed"] as const)("makes a %s run with dialogue recoverable", (state) => {
    const onReset = vi.fn();
    const { getByRole, getByText } = render(screen(streamWith(1, state), onReset));
    const action = state === "done" ? "Start another run" : "Try another key";
    if (state === "failed") expect(getByText(/Provider unavailable/).textContent).toContain("The run stopped");
    fireEvent.click(getByRole("button", { name: action }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("discloses expired live history without requiring the reader to open Details", () => {
    const stream = streamWith(1, "running");
    stream.notices = [{ type: "history_truncated", detail: "Earlier live history has expired." }];
    const { getAllByRole } = render(screen(stream));
    expect(getAllByRole("status").map((node) => node.textContent)).toContain("Earlier live history has expired.");
  });

  it.each([0, 4])("reports an interruption with %i buffered beats while keeping cancellation available", (count) => {
    const onStop = vi.fn();
    const stream = { ...streamWith(count, "running"), connected: false };
    const { getAllByText, getByRole } = render(screen(stream, ignore, onStop));
    expect(getAllByText("Connection interrupted. Reconnecting…").length).toBeGreaterThan(0);
    fireEvent.click(getByRole("button", { name: count === 0 ? "Cancel preparation" : "Stop the run" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});


it.each([true, false])("keeps incoming beats unread in a hidden tab and preserves playing=%s", (playing) => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { container, getByLabelText, getByRole, rerender } = render(screen(streamWith(4)));
  if (!playing) fireEvent.click(getByRole("button", { name: "Pause" }));
  act(() => vi.advanceTimersByTime(1000));

  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  rerender(screen(streamWith(5)));
  act(() => vi.advanceTimersByTime(10_000));
  expect(getByLabelText("Position in the run").textContent).toBe("1 / 5");
  expect(container.querySelector(".stage--playing")).toBeNull();

  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(2499));
  expect(getByLabelText("Position in the run").textContent).toBe("1 / 5");
  act(() => vi.advanceTimersByTime(1));
  expect(getByLabelText("Position in the run").textContent).toBe(playing ? "2 / 5" : "1 / 5");
  expect(getByRole("button", { name: playing ? "Pause" : "Play" }).textContent).toBe(playing ? "Pause" : "Play");
});
