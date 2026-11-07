import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmEnv } from "../config.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";
import type { SidecarFrame } from "../director/index.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let llm: Server | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  await new Promise<void>((r) => (llm ? llm.close(() => r()) : r()));
  sidecar = fake = llm = undefined;
  delete process.env["TEST_LINK_A_KEY"];
});

type Status = Extract<SidecarFrame, { t: "run_status" }>;
const lastStatus = (f: FakeDirector): Status | undefined => f.received.filter((x): x is Status => x.t === "run_status").at(-1);

const RECYCLED = "Calma, vamos ouvir todo mundo, pessoal.";
const ANSWER = "Pede o drink da casa, vale cada gole.";

/** A stub model: a whisper prompt gets `whisperAnswer`, everything else the stock line aimed at the room. */
async function boot(whisperAnswer: string, prompts: string[]) {
  llm = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { messages?: Array<{ role: string; content: string }>; max_tokens?: number };
      const user = parsed.messages?.find((m) => m.role === "user")?.content ?? "";
      if (parsed.max_tokens !== 1) prompts.push(user);
      const whispered = user.includes("cochichou só pra você");
      // The recycled case also names a third person, as the 8B model did.
      const intent = JSON.stringify({ intentType: "send_message", visibleContent: whispered ? whisperAnswer : RECYCLED, privateMotiveSummary: "responder", personTargets: whispered ? ["person-2"] : [] });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 50 }, model: "small" }));
    });
  });
  await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
  const addr = llm.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env["TEST_LINK_A_KEY"] = "key-a";
  const chain = [{ name: "small", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "small", maxContextTokens: 4096 }];
  const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["small"], chain, prices: {}, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
  const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
  fake = b.fake;
  sidecar = b.sidecar;
  b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
  await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
  await waitFor(() => ["person-1", "person-2", "person-3"].every((r) => b.fake.avatarByRef(r)), "the cast spawned");
  // The cast says its first lines on arrival; the test starts once the room has been quiet for a moment.
  let quietSince = Date.now();
  let seen = b.fake.chats.length;
  await waitFor(() => {
    if (b.fake.chats.length !== seen) {
      seen = b.fake.chats.length;
      quietSince = Date.now();
    }
    return Date.now() - quietSince > 1500 && seen > 0;
  }, "the room to settle", 15_000);
  return b;
}

/** What was said out loud (thoughts are logged, not spoken), from chat number `from` on. */
const spoken = (f: FakeDirector, from = 0) => f.chats.slice(from).filter((c) => c.mode !== "thought");

describe("a whisper to an actor is answered with a whisper back (D44)", () => {
  it("whispers the reply to the whisperer, and the model is told the line was a private one for it", async () => {
    const prompts: string[] = [];
    const b = await boot(ANSWER, prompts);
    const duda = b.fake.avatarByRef("person-1")!;
    // The room has said RECYCLED already (the cast's first lines), so it is an older line of Duda's.
    expect(spoken(b.fake).some((c) => c.actor === duda.id && c.text === RECYCLED)).toBe(true);
    const before = b.fake.chats.length;

    b.fake.humanSay(12, 9, "psiu, o que voce recomenda pra beber?", "whisper", duda.id);
    const reply = await waitFor(() => spoken(b.fake, before).find((c) => c.actor === duda.id && c.text === ANSWER), "the answer to the whisper", 8000);
    expect(reply).toMatchObject({ mode: "whisper", to: 9 });
    // Nothing was said out loud by anyone about it.
    expect(spoken(b.fake, before).filter((c) => c.mode !== "whisper" && c.text === ANSWER)).toHaveLength(0);
    const prompt = prompts.find((p) => p.includes("cochichou só pra você")) ?? "";
    expect(prompt).toContain('(cochichando só pra você): "psiu, o que voce recomenda pra beber?"');

    // The frame log notes who it was aimed at: the whisperer, not the third person the model named.
    const frame = await waitFor(() => sidecar?.manager?.getRun(7)?.frameLog.frames.find((f) => f.kind === "chat" && f.data["mode"] === "whisper"), "the chat frame");
    expect(frame.data).toMatchObject({ agentId: "person-1", toRef: "h:9" });
  }, 25_000);

  it("never sends a recycled line to the room: the model repeats itself, the whisperer still gets the whisper", async () => {
    const prompts: string[] = [];
    const b = await boot(RECYCLED, prompts);
    const duda = b.fake.avatarByRef("person-1")!;
    expect(spoken(b.fake).some((c) => c.actor === duda.id && c.text === RECYCLED)).toBe(true);
    const before = b.fake.chats.length;

    b.fake.humanSay(12, 9, "psiu, o que voce recomenda pra beber?", "whisper", duda.id);
    const reply = await waitFor(() => spoken(b.fake, before).find((c) => c.actor === duda.id), "something from Duda after the whisper", 10_000);
    expect(reply).toMatchObject({ mode: "whisper", to: 9, text: RECYCLED });
    await new Promise((r) => setTimeout(r, 1500));
    // Not one line from her to the room after the whisper, and none of the other two answered it in public with her words.
    expect(spoken(b.fake, before).filter((c) => c.actor === duda.id && c.mode !== "whisper")).toHaveLength(0);
  }, 25_000);

  it("a spoken line still gets a spoken answer", async () => {
    const prompts: string[] = [];
    const b = await boot(ANSWER, prompts);
    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    const reply = await waitFor(() => spoken(b.fake).find((c) => c.text === RECYCLED), "a spoken answer", 8000);
    expect(reply.mode).toBe("say");
    expect(prompts.some((p) => p.includes("cochich"))).toBe(false);
  }, 25_000);
});
