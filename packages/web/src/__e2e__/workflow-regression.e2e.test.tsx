import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CompileResponse, LiveMessage } from "@perfectman/shared";
import { App } from "../App.js";
import { stubEventSource } from "../__tests__/event-source.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("preserves a run through navigation and opens a changed scene only after that run ends", async () => {
  vi.useFakeTimers();
  // Storage and media output are I/O sinks; run state and navigation stay real.
  vi.stubGlobal("localStorage", { getItem: () => "1" });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const { sources, send } = stubEventSource();
  const persona = { filename: "iris.md", text: "---\npersonaId: iris\ndisplayName: Iris\narchetype: connector\n---\n" };
  const compiled: CompileResponse = { ok: true, config: {}, diagnostics: [], summary: null };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/presets")) return Response.json({
      casts: [{ id: "cast", title: "Dinner cast", blurb: "", files: [persona] }],
      scenes: ["Dinner", "Reunion"].map((name) => ({
        id: name.toLowerCase(), title: `${name} scene`, blurb: "", cast: "cast",
        files: [{ filename: "scene.md", text: `---\nscenarioId: ${name.toLowerCase()}\n---\nA ${name.toLowerCase()}.` }],
      })),
    });
    if (url.endsWith("/api/compile")) return Response.json(compiled);
    if (url.endsWith("/api/runs")) return Response.json({ runId: "r1", status: {}, streamUrl: "/api/runs/r1/stream" });
    throw new Error(`Unexpected request: ${url}`);
  };
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: /Dinner cast/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a scene" }));
  fireEvent.click(screen.getByRole("button", { name: /Dinner scene/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  fireEvent.click(screen.getByRole("button", { name: "Ready" }));
  fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: "fixture-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Start the run" }));
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: /^Scene/ }));
  fireEvent.click(screen.getByRole("button", { name: /Reunion scene/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Return to the run" }));
  expect(screen.getByRole("heading", { name: "Dinner scene" }).textContent).toBe("Dinner scene");
  send({
    type: "hello", runId: "r1", simulationId: "dinner", simulationName: "Dinner", maxPulses: 6,
    agents: [{ id: "iris", displayName: "Iris", archetype: "connector" }],
    channels: [{ id: "room", name: "Dinner", type: "public_channel", memberAgentIds: ["iris"] }],
    priorEvents: [],
  });
  send({ type: "status", status: {
    runId: "r1", simulationId: "dinner", state: "running", pulseIndex: 0, pulsesRun: 1, maxPulses: 6,
    counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
  } });
  const messages: LiveMessage[] = Array.from({ length: 4 }, (_, index) => ({
    eventId: `line-${index}`, channelId: "room", actorId: "iris", eventType: "message_sent",
    text: `Dinner line ${index}`, visibleToAgents: [], pulseIndex: 0, createdAt: index,
  }));
  send({ type: "pulse", frame: {
    pulseIndex: 0, eventsCommitted: 4, agentsCalled: 1, messages, thinking: {}, emotions: {}, notices: [],
  } });
  fireEvent.click(screen.getByRole("button", { name: "Next beat" }));
  fireEvent.click(screen.getByRole("button", { name: "Next beat" }));
  expect(screen.getByLabelText("Position in the run").textContent).toBe("3 / 4");
  expect(screen.getByRole("button", { name: "Play" }).textContent).toBe("Play");
  fireEvent.click(screen.getByRole("button", { name: /^Scene/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(sources).toHaveLength(1);
  expect({
    position: screen.getByLabelText("Position in the run").textContent,
    paused: screen.queryByRole("button", { name: "Play" }) !== null,
  }).toEqual({ position: "3 / 4", paused: true });

  fireEvent.click(screen.getByTitle("Back to the introduction"));
  act(() => vi.advanceTimersByTime(60_000));
  fireEvent.click(screen.getByRole("button", { name: "Build a room" }));
  expect(screen.getByLabelText("Position in the run").textContent).toBe("3 / 4");
  expect(screen.getByRole("button", { name: "Play" }).textContent).toBe("Play");

  fireEvent.click(screen.getByRole("button", { name: /^Scene/ }));
  fireEvent.click(screen.getByRole("button", { name: /Reunion scene/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Return to the run" }));
  expect(screen.getByRole("heading", { name: "Dinner" }).textContent).toBe("Dinner");
  expect(screen.getByLabelText("Position in the run").textContent).toBe("3 / 4");
  expect(screen.getByRole("button", { name: "Play" }).textContent).toBe("Play");
  expect(sources).toHaveLength(1);

  send({ type: "status", status: {
    runId: "r1", simulationId: "dinner", state: "done", pulseIndex: 0, pulsesRun: 1, maxPulses: 6,
    counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
  } });
  send({ type: "stopped", stopReason: "max_pulses", replayUrl: "/api/runs/r1/replay" });
  fireEvent.click(screen.getByRole("button", { name: /^Scene/ }));
  fireEvent.click(screen.getByRole("button", { name: /Reunion scene/ }));
  expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Ready" }));
  expect(screen.getByRole("heading", { name: "Give your cast a model." }).textContent).toBe("Give your cast a model.");
  expect(screen.queryByLabelText("Position in the run")).toBeNull();
  const key = screen.getByLabelText<HTMLInputElement>(/^API key/);
  expect(key.value).toBe("");
  expect(screen.getByRole("button", { name: "Start the run" }).hasAttribute("disabled")).toBe(true);
});
