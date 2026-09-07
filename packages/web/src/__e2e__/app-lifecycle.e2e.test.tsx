import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileResponse, StartRunRequest } from "@perfectman/shared";
import { App } from "../App.js";

const persona = (id: string) => ({ filename: `${id}.md`, text: `---\npersonaId: ${id}\ndisplayName: ${id}\narchetype: connector\n---\n` });
const LIBRARY = {
  casts: ["A", "B"].map((id) => ({ id, title: `Cast ${id}`, blurb: "", files: [persona(id)] })),
  scenes: ["A", "B"].map((id) => ({
    id, title: `Scene ${id}`, blurb: "", cast: id,
    files: [{ filename: `scene-${id}.md`, text: `---\nscenarioId: ${id}\n---\nAn opening.` }],
  })),
};
const COMPILED: CompileResponse = { ok: true, config: {}, diagnostics: [], summary: null };

function deferred<T>() {
  let resolve = (_value: T): void => { throw new Error("Response was not initialized"); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function api(compileReplies: Promise<Response>[] = [], runReply?: Promise<Response>) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/api/presets")) return Response.json(LIBRARY);
    if (url.endsWith("/api/compile")) return compileReplies.shift() ?? Response.json(COMPILED);
    if (url.endsWith("/api/runs") && runReply) return runReply;
    if (url.endsWith("/stop")) return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${url}`);
  };
  vi.stubGlobal("fetch", fetcher);
  return requests;
}

async function chooseScene(name = "A") {
  render(<App />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: /Cast A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a scene" }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Scene ${name}`) }));
}

async function checkScene() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", window.localStorage);
  localStorage.setItem("perfectman.intro.seen", "1");
  localStorage.setItem("perfectman.sound.muted", "1");
  // Media output and stream delivery are intentional I/O sinks in these HTTP-wiring tests.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.stubGlobal("EventSource", class extends EventTarget { close() {} });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("App lifecycle wiring", () => {
  it("shows pending preparation and stops the accepted run when cancelled before POST returns", async () => {
    const pending = deferred<Response>();
    const requests = api([], pending.promise);
    await chooseScene();
    await checkScene();
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: "test-key" } });
    fireEvent.change(screen.getByLabelText(/^Extra request fields/), { target: { value: '{"thinking":{"type":"disabled"},"fixtureOption":true}' } });
    fireEvent.click(screen.getByRole("button", { name: "Start the run" }));
    expect(screen.queryByRole("button", { name: "Start the run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel preparation" }));
    expect(screen.getByText("Cancelling as soon as the server answers…").textContent).toContain("Cancelling");
    expect(screen.getByRole("button", { name: "Stopping…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { pending.resolve(Response.json({ runId: "accepted", status: {}, streamUrl: "/stream" })); });
    const starts = requests.filter(({ url }) => url.endsWith("/api/runs"));
    const request: StartRunRequest = JSON.parse(String(starts[0]?.init?.body));
    expect(starts).toHaveLength(1);
    expect(request.llm.apiKey).toBe("test-key");
    expect(request.llm.extraBody).toEqual({ thinking: { type: "disabled" }, fixtureOption: true });
    expect(requests.filter(({ url }) => url.endsWith("/accepted/stop")).map(({ init }) => init?.method)).toEqual(["POST"]);
  });

  it("invalidates approval immediately and ignores a late response for older input", async () => {
    const older = deferred<Response>();
    const latest = deferred<Response>();
    const requests = api([Promise.resolve(Response.json(COMPILED)), older.promise, latest.promise]);
    await chooseScene();
    await checkScene();
    expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit as markdown" }));
    const editor = screen.getByLabelText("Contents of scene-A.md");
    fireEvent.change(editor, { target: { value: "Older input" } });
    expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(true);
    await checkScene();
    fireEvent.change(editor, { target: { value: "Latest input" } });
    await checkScene();
    await act(async () => { older.resolve(Response.json(COMPILED)); });
    expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { latest.resolve(Response.json(COMPILED)); });
    expect(screen.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(false);
    const last = requests.filter(({ url }) => url.endsWith("/api/compile")).at(-1);
    expect(JSON.parse(String(last?.init?.body)).inputs.scenario.text).toBe("Latest input");
  });

  it("explains a scene's cast replacement and compiles the replacement cast", async () => {
    const requests = api();
    await chooseScene("B");
    expect(screen.getByRole("status").textContent).toBe("This scene uses Cast B. Your cast has changed to match.");
    await checkScene();
    const compiled = requests.find(({ url }) => url.endsWith("/api/compile"));
    expect(JSON.parse(String(compiled?.init?.body)).inputs.personas).toEqual([persona("B")]);
  });
});
