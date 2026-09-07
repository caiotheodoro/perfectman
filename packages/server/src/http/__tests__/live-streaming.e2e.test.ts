/** Real scheduler/controller/HTTP wiring; only the provider's I/O is controlled. */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import type { LiveEvent } from "@perfectman/shared";
import { FIXTURE } from "../../authoring/__tests__/scenario-fixtures.js";
import { createWebServer, type StartRunRequest } from "../server.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function firstCommittedLine(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE response body");
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("Stream ended before the first committed line");
    pending += decoder.decode(chunk.value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const event = JSON.parse(data.slice(6)) as LiveEvent;
      if (event.type !== "pulse") continue;
      const lines = event.frame.messages.filter((message) => message.eventType === "message_sent");
      if (lines.length) return lines.map((message) => message.text);
    }
  }
}

it("streams an earlier agent's committed line while the next agent's provider request is still pending", async () => {
  const firstRelease = deferred();
  const laterStarted = deferred();
  const laterRelease = deferred();
  let calls = 0;
  let laterSettled = false;
  const provider = createServer((req, res) => {
    void (async () => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as { max_tokens?: number };
      let content = '{"ok":true}';
      if (body.max_tokens !== 8) {
        const call = ++calls;
        if (call === 1) await firstRelease.promise;
        if (call === 2) {
          laterStarted.resolve();
          await laterRelease.promise;
          laterSettled = true;
        }
        content = JSON.stringify(call === 1 ? {
          intentType: "send_message", channelTarget: "geral", visibleContent: "Already committed.",
          privateMotiveSummary: "I want to speak to the group.", personTargets: [], memoryWrites: [],
        } : { intentType: "no_op", privateMotiveSummary: "I will listen.", personTargets: [], memoryWrites: [] });
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        id: "local-fixture", object: "chat.completion", created: 0, model: "local-fixture",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      }));
    })().catch((error: Error) => res.destroy(error));
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const address = provider.address();
  if (!address || typeof address !== "object") throw new Error("Missing provider port");
  const runsRoot = await mkdtemp(join(tmpdir(), "perfectman-live-streaming-"));
  const web = createWebServer({ runsRoot });
  const base = `http://127.0.0.1:${await web.listen(0)}`;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const persona = await readFile(join(__dirname, "../../authoring/__tests__/fixtures/iris.persona.md"), "utf8");
    const request: StartRunRequest = {
      inputs: {
        kind: "markdown", scenario: { filename: "dinner.scenario.md", text: FIXTURE },
        personas: [
          { filename: "iris.persona.md", text: persona },
          { filename: "bruno.persona.md", text: persona.replace("personaId: iris", "personaId: bruno") },
        ],
      },
      llm: { providerType: "openai-compatible", modelName: "local-fixture", baseUrl: `http://127.0.0.1:${address.port}/v1` },
      limits: { maxPulses: 1 },
    };
    const start = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    if (start.status !== 201) throw new Error(`Run start failed: ${await start.text()}`);
    const { streamUrl } = await start.json() as { streamUrl: string };
    const stream = await fetch(`${base}${streamUrl}`, { signal: abort.signal });
    firstRelease.resolve();
    const [lines] = await Promise.race([
      Promise.all([firstCommittedLine(stream), laterStarted.promise]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("No early committed SSE line while the later provider request was held")), 5000);
      }),
    ]);
    expect({ lines, laterSettled }).toEqual({ lines: ["Already committed."], laterSettled: false });
  } finally {
    clearTimeout(timer);
    abort.abort();
    firstRelease.resolve();
    laterRelease.resolve();
    web.controller.stop();
    await web.controller.completion();
    web.server.closeAllConnections();
    await web.close();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    await rm(runsRoot, { recursive: true, force: true });
  }
}, 15000);
