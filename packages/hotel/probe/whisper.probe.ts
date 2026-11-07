/**
 * Real-model check for whispers to cast members: does a whispered, addressed line get a whispered reply
 * to the whisperer, and how fast.
 *
 *   set -a; source llm.env; set +a
 *   PROBE_LINKS=lunaris PROBE_STYLE=compact PROBE_WHISPERS=6 pnpm --filter @perfectman/hotel probe:whisper
 *
 * The sidecar, runtime, prompt builder, planner and the model chain are the real ones; the Director is `FakeDirector`.
 * Knobs (env): PROBE_LINKS (names or `chain`), PROBE_STYLE (full|compact), PROBE_WHISPERS (count, default 6),
 * PROBE_MAX_USD (stop past this, default 0.1), PROBE_OUT (results json), PROBE_TRACE=1 (print each whisper's calls).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isNearRepeat } from "../../server/src/agent/repetition-guard.ts";
import type { LlmEnv } from "../src/config.ts";
import type { PromptStyle } from "../src/llm/chain-config.ts";
import { KNOWN_PRICES, parseChain } from "../src/llm/chain-config.ts";
import type { ChainTap } from "../src/llm/chain.ts";
import { startSidecar } from "../src/sidecar.ts";
import { FakeDirector } from "../src/testing/fake-director.ts";
import { compiledScenario, fakeHotelHttp, testConfig, TEST_SECRET, waitFor } from "../src/testing/helpers.ts";
import { silentLogger } from "../src/util/log.ts";
import { percentile } from "../src/util/stats.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const WHISPERS = Number(env["PROBE_WHISPERS"] ?? 6);
const MAX_USD = Number(env["PROBE_MAX_USD"] ?? 0.1);
const STYLE: PromptStyle | undefined = env["PROBE_STYLE"] === "full" ? "full" : env["PROBE_STYLE"] === "compact" ? "compact" : undefined;
const WANT = (env["PROBE_LINKS"] ?? "lunaris").split(",").map((s) => s.trim());
const OUT = env["PROBE_OUT"] ?? resolve(HERE, "whisper-results.json");
const TRACE = env["PROBE_TRACE"] === "1";

const TEXTS = [
  "psiu {n}, o que voce recomenda pra beber?",
  "{n}, me conta baixinho: quem aqui voce acha mais legal?",
  "{n}, vem ca, preciso te contar um segredo.",
  "{n}, voce vem sempre aqui? me fala so pra mim.",
  "{n}, tem alguma musica boa tocando hoje?",
  "psiu {n}, voce conhece o Rafa faz tempo?",
];

describe("real-model probe: whispers to the cast", () => {
  it("replies to whispers", async () => {
    const raw = env["PERFECTMAN_LLM_CHAIN"];
    if (!raw) throw new Error("PERFECTMAN_LLM_CHAIN is not set (source the llm.env first)");
    const problems: string[] = [];
    const all = parseChain(raw, problems);
    if (problems.length > 0) throw new Error(problems.join("; "));
    const links = all.filter((l) => WANT.includes(l.name) || WANT.includes("chain")).map((l) => ({ ...l, ...(STYLE ? { promptStyle: STYLE } : {}) }));
    if (links.length === 0) throw new Error("no link selected");
    const llm: LlmEnv = {
      provider: "openai-compatible",
      baseUrl: links[0]!.baseUrl,
      apiKeyEnv: links[0]!.apiKeyEnv,
      models: links.map((l) => l.model),
      chain: links,
      prices: Object.fromEntries(links.flatMap((l) => (KNOWN_PRICES[l.model] ? [[l.model, KNOWN_PRICES[l.model]!]] : []))),
      concurrency: 3,
      softCallsPerMin: 600,
      softTokensPerHour: 5_000_000,
    };
    const { body } = compiledScenario("pt-BR");
    const agents = (body as { config: { agents: Array<{ id: string; promptProfile: { displayName: string } }> } }).config.agents.map((a) => ({ id: a.id, name: a.promptProfile.displayName }));

    const fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 300 });
    fake.addRoom(12, 12, 10);
    fake.addHuman(12, 9, "pmlive6138", 6, 5);
    const http = fakeHotelHttp({ 31: body });
    const cfg = testConfig(fake.url, { llm });
    const sidecar = await startSidecar(cfg, { fetchImpl: http.fetchImpl, timing: { baseIntervalMs: 6000 }, statusIntervalMs: 1000, logger: silentLogger });
    try {
      await waitFor(() => fake.received.some((f) => f.t === "hello_ack"), "hello_ack", 10_000);
      fake.startRun({ run: 7, room: 12, scenarioVersion: 31, capActors: 12 });
      const run = await waitFor(() => sidecar.manager?.getRun(7), "the run", 30_000);
      await waitFor(() => run.state === "running", "running", 60_000);
      const chain = run.llmChain();
      if (!chain) throw new Error("no chain");
      const taps: Array<ChainTap & { at: number }> = [];
      chain.tap = (e) => taps.push({ ...e, at: Date.now() });
      await waitFor(() => agents.every((a) => fake.avatarByRef(a.id) !== undefined), "all spawned", 60_000);
      // Let the cast walk in and chat a little, so there are old lines to recycle.
      await new Promise((r) => setTimeout(r, 25_000));

      const spent = (): number => chain.snapshot().links.reduce((n, l) => n + l.costUsd, 0);
      const rows: Array<{ to: string; text: string; replied: boolean; whispered: boolean; toWhisperer: boolean; stale: string[]; recycled: boolean; latencyMs: number | null; reply: string | null; other: string[] }> = [];
      for (let i = 0; i < WHISPERS && spent() < MAX_USD; i++) {
        const target = agents[i % agents.length]!;
        const av = fake.avatarByRef(target.id)!;
        const text = TEXTS[i % TEXTS.length]!.replace("{n}", target.name);
        const from = fake.chats.length;
        const tapFrom = taps.length;
        const sentAt = Date.now();
        fake.humanSay(12, 9, text, "whisper", av.id);
        let firstFromTarget: { text: string; mode: string; to: number | null; at: number } | undefined;
        // The answer is the target's first whispered line to the whisperer; a public line from the target on the way
        // (an earlier model call landing late) is counted apart, as `stale`.
        while (Date.now() - sentAt < 30_000) {
          await new Promise((r) => setTimeout(r, 100));
          const c = fake.chats.slice(from).filter((x) => x.actor === av.id && x.mode !== "thought");
          const hit = c.find((x) => x.mode === "whisper" && x.to === 9) ?? (c.length > 0 && Date.now() - sentAt > 20_000 ? c[0] : undefined);
          if (hit) firstFromTarget = { text: hit.text, mode: hit.mode, to: hit.to ?? null, at: hit.at };
          if (firstFromTarget) break;
        }
        if (firstFromTarget) await new Promise((r) => setTimeout(r, 1500));
        const after = fake.chats.slice(from).filter((x) => x.mode !== "thought");
        const older = fake.chats.slice(0, from).filter((x) => x.actor === av.id && x.mode !== "thought").map((x) => x.text);
        rows.push({
          to: target.name,
          text,
          replied: firstFromTarget !== undefined,
          whispered: firstFromTarget?.mode === "whisper",
          toWhisperer: firstFromTarget?.to === 9,
          stale: after.filter((x) => x.actor === av.id && x.mode !== "whisper").map((x) => x.text.slice(0, 60)),
          recycled: firstFromTarget ? isNearRepeat(firstFromTarget.text, older) : false,
          latencyMs: firstFromTarget ? firstFromTarget.at - sentAt : null,
          reply: firstFromTarget?.text ?? null,
          other: after.filter((x) => x.actor !== av.id).map((x) => `${x.actor}:${x.mode}:${x.text.slice(0, 50)}`),
        });
        if (TRACE && !(firstFromTarget?.mode === "whisper")) {
          const ev = (await run.simulation?.runtime.getEventLog().getCommittedThrough(run.simulation.simulationId, Number.MAX_SAFE_INTEGER)) ?? [];
          console.log("EVENTS", ev.slice(-16).map((x) => `${x.actorId} ${x.type} ${JSON.stringify(x.payload).slice(0, 160)}`).join("\n"));
        }
        if (TRACE) {
          const mine = taps.slice(tapFrom).filter((t) => t.agentId === target.id);
          if (env["PROBE_PROMPT"] === "1" && mine[0]) console.log("PROMPT\n" + mine[0].prompt.system + "\n-----\n" + mine[0].prompt.user);
          console.log(JSON.stringify({ whisper: text, calls: mine.map((t) => ({ link: t.link, outcome: t.outcome, ms: t.latencyMs, content: t.content?.slice(0, 400), error: t.error })), reply: firstFromTarget }));
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      const lat = rows.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
      const ok = rows.filter((r) => r.replied && r.whispered && r.toWhisperer && !r.recycled);
      const result = {
        links: links.map((l) => l.name),
        style: STYLE ?? "default",
        whispers: rows.length,
        replied: rows.filter((r) => r.replied).length,
        whisperedBack: rows.filter((r) => r.replied && r.whispered && r.toWhisperer).length,
        recycled: rows.filter((r) => r.recycled).length,
        goodReplies: ok.length,
        goodRatePct: rows.length === 0 ? null : Math.round((1000 * ok.length) / rows.length) / 10,
        latencyP50Ms: lat.length ? percentile(lat, 50) : null,
        latencyMaxMs: lat.length ? Math.max(...lat) : null,
        costUsd: Math.round(spent() * 1e6) / 1e6,
        rows,
      };
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(result, null, 1));
      console.log(JSON.stringify({ ...result, rows: undefined }));
      for (const r of rows) console.log(JSON.stringify(r));
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await sidecar.close();
      await fake.stop();
    }
  });
});
