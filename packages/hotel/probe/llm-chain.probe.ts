/**
 * Real-model probe for the LLM provider chain (docs/plans/hotel-llm-chain.md).
 *
 *   set -a; source llm.env; set +a
 *   PROBE_LINKS=mythomax,lunaris,chain PROBE_PULSES=40 pnpm --filter @perfectman/hotel probe:llm
 *
 * The sidecar, the runtime, the prompt builder, the arbiter and the planner are the
 * real ones, the Director is `FakeDirector` at the hotel's real tick, and the model is
 * the real chain. Each variant (one link alone, or the whole chain) runs the turn-taking
 * scenario and the embodiment scenario on the pt-BR preset `gato-no-telhado`.
 *
 * Knobs (env): PROBE_LINKS (names, or `chain`), PROBE_SCENARIOS (turns,embodiment,earshot),
 * PROBE_STYLE (force every link's hotel prompt: full or compact), PROBE_NO_BODY_HINT=1 (strip the body
 * shape hint and examples from the output contract: the "before" column of the body-emission table),
 * PROBE_PULSES (base pulses of the embodiment scenario), PROBE_LINES (human lines of the
 * turn-taking and earshot scenarios), PROBE_MAX_USD (stop spending past this), PROBE_OUT (results json),
 * PROBE_PROMPT_OUT (largest rendered prompt, for `bench:latency --prompt-file`), PROBE_DRY=1
 * (a local stub instead of the network: checks the harness, spends nothing).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SAY_CLEAR_TILES, chebyshev, facingKind } from "@perfectman/engine";
import { BodyIntentSchema } from "@perfectman/shared";
import type { BodyFrameLog, Direction8 } from "@perfectman/shared";
import { runEmbodimentProbes } from "../../eval/src/probes/embodiment.ts";
import { PromptBuilder } from "../../server/src/agent/prompt-builder.ts";
import { AuthoringService } from "../src/authoring/authoring-service.ts";
import type { LlmEnv } from "../src/config.ts";
import { KNOWN_PRICES, linkPromptStyle, parseChain } from "../src/llm/chain-config.ts";
import type { LlmLink, PromptStyle } from "../src/llm/chain-config.ts";
import type { ChainTap } from "../src/llm/chain.ts";
import { startSidecar } from "../src/sidecar.ts";
import type { Sidecar } from "../src/sidecar.ts";
import { FakeDirector } from "../src/testing/fake-director.ts";
import { fakeHotelHttp, testConfig, TEST_SECRET, waitFor } from "../src/testing/helpers.ts";
import { percentile } from "../src/util/stats.ts";
import { silentLogger } from "../src/util/log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESETS = resolve(HERE, "../../../examples/presets");
const SCENE = "gato-no-telhado";
const env = process.env;
const DRY = env["PROBE_DRY"] === "1";
const PULSES = Number(env["PROBE_PULSES"] ?? 40);
const LINES = Number(env["PROBE_LINES"] ?? 20);
const MAX_USD = Number(env["PROBE_MAX_USD"] ?? 0.5);
const OUT = env["PROBE_OUT"] ?? resolve(HERE, "probe-results.json");
const PROMPT_OUT = env["PROBE_PROMPT_OUT"];
type Scenario = "turns" | "embodiment" | "earshot";
const SCENARIOS = (env["PROBE_SCENARIOS"] ?? "turns,embodiment").split(",").map((s) => s.trim()) as Scenario[];
const STYLE: PromptStyle | undefined = env["PROBE_STYLE"] === "full" ? "full" : env["PROBE_STYLE"] === "compact" ? "compact" : undefined;
const NO_BODY_HINT = env["PROBE_NO_BODY_HINT"] === "1";
const WANT = (env["PROBE_LINKS"] ?? "chain").split(",").map((s) => s.trim());

type ChatSeen = { at: number; actor: number; mode: string; text: string; to: number | null };

// ---- the pt-BR human lines ---------------------------------------------------------

const ADDRESSED = [
  "{n}, tudo bem por aí? Que barulho é esse no telhado?",
  "{n}, você viu o gato hoje?",
  "{n}, o que você acha da assembleia de amanhã?",
  "{n}, me explica o que está acontecendo, fiquei perdida.",
  "{n}, você vai descer pra conversar?",
  "{n}, pode me dizer a verdade: foi você que deixou a janela aberta?",
];
const UNADDRESSED = [
  "alguém sabe de quem é esse gato, afinal?",
  "será que a gente resolve isso antes de amanhã?",
  "que horas são? perdi a noção do tempo",
  "tô achando que ninguém aqui está falando tudo.",
];

// ---- text heuristics ---------------------------------------------------------------

const PT = new Set(["que", "não", "nao", "você", "voce", "é", "de", "para", "pra", "com", "uma", "um", "tá", "ta", "né", "ne", "mas", "eu", "ele", "ela", "isso", "aqui", "vai", "tem", "se", "os", "as", "do", "da", "no", "na", "em", "por", "muito", "bem", "já", "ja", "só", "so", "gato", "mais", "como", "quem", "foi", "está", "esta", "estou", "meu", "minha", "seu", "sua", "tudo", "então", "entao", "ai", "olha", "gente"]);
const EN = new Set(["the", "you", "is", "are", "and", "i'm", "what", "this", "that", "with", "have", "don't", "it's", "not", "for", "was", "your", "my", "just", "but", "about", "they", "we", "he", "she", "of", "to", "in", "on", "do", "how", "who", "why", "me", "if", "so"]);

export function languageOf(text: string): "pt" | "en" | "unknown" {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
  const pt = words.filter((w) => PT.has(w)).length;
  const en = words.filter((w) => EN.has(w)).length;
  if (pt === 0 && en === 0) return "unknown";
  return pt >= en ? "pt" : "en";
}

/** D43: a character never says what it is. "ia" alone is a Portuguese verb form, so only the unambiguous forms count. */
const SELF_REFERENCE = /\b(ai|a\.i\.|bots?|chatbots?|assistente(\s+virtual)?|assistant|rob[oô]s?|llm|chatgpt|gpt|openai|modelo\s+de\s+linguagem|language\s+model|intelig[eê]ncia\s+artificial|artificial\s+intelligence)\b/i;

function parseLoose(content: string): { ok: boolean; clean: boolean; value?: Record<string, unknown> } {
  const t = content.trim();
  try {
    const v: unknown = JSON.parse(t);
    if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, clean: true, value: v as Record<string, unknown> };
  } catch {
    /* fall through to the recovery attempts */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1];
  const braces = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  for (const candidate of [fenced, braces]) {
    if (!candidate) continue;
    try {
      const v: unknown = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, clean: false, value: v as Record<string, unknown> };
    } catch {
      /* next */
    }
  }
  return { ok: false, clean: false };
}

// ---- harness -----------------------------------------------------------------------

/** The body shape hint and examples the output contract carries, for the "before" runs (PROBE_NO_BODY_HINT=1). */
const HINT_BLOCK = /(?:\n- |\n\n)"body" (?:is optional and every key|é opcional e cada chave)[\s\S]*?(?=\n\n<\/output_contract>)/;
if (NO_BODY_HINT) {
  const original = PromptBuilder.build.bind(PromptBuilder);
  PromptBuilder.build = (...args) => {
    const built = original(...args);
    const system = built.system.replace(HINT_BLOCK, "").replace('\n- "body": optional, see below', "");
    return { ...built, system, inputTokensEstimate: Math.ceil((system.length + built.user.length) / 4) };
  };
}

const bodyBlockOf = (user: string): string => /<body>([\s\S]*?)<\/body>/.exec(user)?.[1] ?? "";

/** The handles this render offered: the model may only use these. */
function handlesIn(user: string): Set<string> {
  return new Set(bodyBlockOf(user).match(/\b[pzfr]\d+\b/g) ?? []);
}

/**
 * Movement is plausible when the prompt shows someone 3 or more steps away, or a seat that is free:
 * a person could step closer or sit. (Everyone adjacent and no free seat leaves nothing to do but stay.)
 */
function movementPlausible(user: string): boolean {
  const block = bodyBlockOf(user);
  const far = [...block.matchAll(/^- p\d+ .*?\((\d+) (?:passos?|steps?)\)/gm)].some((m) => Number(m[1]) >= 3);
  const seat = /\b[1-9]\d* (?:de \d+ lugares livres|of \d+ seats free)/.test(block);
  return far || seat;
}

type BodyStats = {
  calls: number;
  withBody: number;
  /** Passes the strict body schema and names only handles this render offered. */
  valid: number;
  emitPct: number;
  validCallPct: number;
  /** Calls where movement was plausible, and how many of them carried a valid body. */
  plausible: number;
  plausibleValid: number;
  plausibleValidPct: number | null;
  /** Valid bodies that are exactly one of the two examples in that prompt's contract (a copy, not a choice). */
  copiedFromExample: number;
  /** Valid bodies whose private motive is also word for word the example's: the whole answer was copied, not just a shape that fits the moment. */
  copiedWhole: number;
  /** The distinct bodies that matched an example, with counts, to tell a copy from a sensible choice. */
  copiedShapes: Record<string, number>;
  kinds: { move: number; posture: number; gesture: number; expression: number };
};

function bodyStats(prompts: Array<{ system: string; user: string }>, values: Array<Record<string, unknown> | undefined>): BodyStats {
  const kinds = { move: 0, posture: 0, gesture: 0, expression: 0 };
  let withBody = 0;
  let valid = 0;
  let plausible = 0;
  let plausibleValid = 0;
  let copied = 0;
  let copiedWhole = 0;
  const copiedShapes: Record<string, number> = {};
  values.forEach((v, i) => {
    const user = prompts[i]?.user ?? "";
    const body = v?.["body"];
    const present = !!body && typeof body === "object" && Object.keys(body as object).length > 0;
    const can = movementPlausible(user);
    if (can) plausible++;
    if (!present) return;
    withBody++;
    const refs = (JSON.stringify(body).match(/"([pzfr]\d+)"/g) ?? []).map((m) => m.slice(1, -1));
    const known = handlesIn(user);
    const ok = BodyIntentSchema.safeParse(body).success && refs.every((r) => known.has(r));
    if (!ok) return;
    valid++;
    if (can) plausibleValid++;
    const shown = [...(prompts[i]?.system ?? "").matchAll(/^\{"intentType".*,"body":(\{.*\})\}$/gm)].map((m) => m[1]!);
    if (shown.includes(JSON.stringify(body))) {
      copied++;
      const key = JSON.stringify(body).replace(/"[pzfr]\d+"/g, '"h"');
      copiedShapes[key] = (copiedShapes[key] ?? 0) + 1;
      const motives = [...(prompts[i]?.system ?? "").matchAll(/^\{"intentType".*?"privateMotiveSummary":"([^"]*)".*,"body":\{.*\}\}$/gm)].map((m) => m[1]!);
      if (motives.includes(String(v?.["privateMotiveSummary"] ?? ""))) copiedWhole++;
    }
    for (const k of Object.keys(kinds) as Array<keyof typeof kinds>) if ((body as Record<string, unknown>)[k] !== undefined) kinds[k]++;
  });
  const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);
  return { calls: values.length, withBody, valid, emitPct: pct(withBody, values.length), validCallPct: pct(valid, values.length), plausible, plausibleValid, plausibleValidPct: plausible === 0 ? null : pct(plausibleValid, plausible), copiedFromExample: copied, copiedWhole, copiedShapes, kinds };
}

/** The eval lane's facing-rate, split by listener kind (same rule: 3 s later, within the say radius, whispers left out). */
function facingSplit(log: BodyFrameLog): Results["facing"] {
  const tally = { actor: { judged: 0, facing: 0 }, human: { judged: 0, facing: 0 } };
  for (const f of log.frames) {
    const speaker = f.kind === "chat" ? String(f.data["agentId"] ?? "") : f.kind === "human_chat" ? String(f.data["ref"] ?? "") : "";
    const listener = String(f.data["toRef"] ?? "");
    if (!speaker || !listener || f.data["mode"] === "whisper") continue;
    const snap = log.snapshots.find((x) => x.atMs >= f.atMs + 3000 && x.room === f.room);
    const a = snap?.occupants.find((o) => o.ref === speaker);
    const b = snap?.occupants.find((o) => o.ref === listener);
    if (!a || !b || chebyshev(a.tile, b.tile) > SAY_CLEAR_TILES) continue;
    const t = listener.startsWith("h:") ? tally.human : tally.actor;
    t.judged += 1;
    if (facingKind(b.dir as Direction8, b.tile, a.tile) === "facing") t.facing += 1;
  }
  const rate = (t: { judged: number; facing: number }) => ({ ...t, ratePct: t.judged === 0 ? null : Math.round((1000 * t.facing) / t.judged) / 10 });
  return { actor: rate(tally.actor), human: rate(tally.human) };
}

type Variant = { name: string; links: LlmLink[] };

async function stubServer(): Promise<{ server: Server; url: string }> {
  const intent = JSON.stringify({ intentType: "reply_to_message", replyToEventId: "e1", visibleContent: "Olha, eu não sei, mas acho que a gente devia conversar sobre isso amanhã.", privateMotiveSummary: "quero ajudar", personTargets: ["neide"] });
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 1800, completion_tokens: 60 }, model: "stub" })));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return { server, url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1` };
}

function allLinks(): LlmLink[] {
  const raw = env["PERFECTMAN_LLM_CHAIN"];
  if (!raw) throw new Error("PERFECTMAN_LLM_CHAIN is not set (source the llm.env first)");
  const problems: string[] = [];
  const links = parseChain(raw, problems);
  if (problems.length > 0) throw new Error(problems.join("; "));
  return links;
}

async function scenarioBody(): Promise<{ body: { config: { agents: Array<{ id: string; promptProfile: { displayName: string } }> } } & Record<string, unknown> }> {
  const mock: LlmEnv = { provider: "mock", baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
  const svc = new AuthoringService({ llm: mock, apiKey: undefined, presetsRoot: PRESETS });
  const { source } = await svc.preset(SCENE);
  return svc.compile({ source }) as never;
}

type Results = {
  variant: string;
  scenario: Scenario;
  wallSec: number;
  pulses: number;
  calls: { attempts: number; ok: number; failed: number; servedBy: Record<string, number> };
  json: { n: number; cleanPct: number; recoveredPct: number; invalidPct: number; serverFallbackPct: number; providerFailedPct: number };
  /** `blocked` and `validPct` are the engine's verdict on the block (body_blocked events); `stats` is the schema and handle check on what the model wrote. */
  body: { withBody: number; blocked: number; validPct: number | null; stats: BodyStats };
  /** Addressed `say` lines on the wire (chat frames with an addressee), how many stood out of earshot, and what the engine did about far addressees. */
  earshot: { lines: number; violations: number; ratePct: number | null; farLines: number; meanDistance: number | null; deferred: number; blockedNotInEarshot: number };
  /** Listener facing the speaker 3 s after an addressed line, split by who listened: a cast member can be made to turn, a person cannot. */
  facing: { actor: { judged: number; facing: number; ratePct: number | null }; human: { judged: number; facing: number; ratePct: number | null } };
  /** Hotel prompt style the links were sent. */
  promptStyle: Record<string, number>;
  addressed: { lines: number; answeredPct: number; replyP50Ms: number | null; replyP95Ms: number | null; n: number };
  dogPile: { lines: number; unaddressedMulti: number; addressedJumped: number; ratePct: number };
  lang: { lines: number; ptPct: number | null; enPct: number | null; unknown: number };
  d43: { hits: string[]; promptIdentityHits: number };
  embodiment: Array<{ id: string; value: number; ok: boolean }>;
  earshotSayLines: number;
  perLink: Array<{ name: string; calls: number; failures: number; served: number; tokensIn: number; tokensOut: number; costUsd: number; p50Ms?: number; p95Ms?: number; estimateRatio?: number; skipped: Record<string, number>; guarded: Record<string, number> }>;
  /** Prompt size seen by the chain, chars/4 as the builder counts it; skipped = calls the chain passed over a link for size. */
  prompts: { n: number; p50: number | null; p95: number | null; max: number | null; skippedForSize: number };
  chatLines: number;
  costUsd: number;
  rawFailures: string[];
  sampleLines: string[];
};

async function runVariant(variant: Variant, scenario: Scenario, spentSoFar: () => number): Promise<Results> {
  const { body } = await scenarioBody();
  const agents = body.config.agents.map((a) => ({ id: a.id, name: a.promptProfile.displayName }));
  const stub = DRY ? await stubServer() : undefined;
  const links = stub ? variant.links.map((l) => ({ ...l, baseUrl: stub.url, apiKeyEnv: "PROBE_STUB_KEY" })) : variant.links;
  if (stub) env["PROBE_STUB_KEY"] = "stub";
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

  const fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 300 });
  // The earshot scenario puts the human well past the 6-tile say radius of the cast.
  const far = scenario === "earshot";
  fake.addRoom(12, far ? 30 : 12, 10);
  fake.addHuman(12, 9, "ana", far ? 28 : 6, 5);
  const http = fakeHotelHttp({ 31: body });
  const cfg = testConfig(fake.url, { llm });
  const turns = scenario === "turns" || scenario === "earshot";
  let sidecar: Sidecar | undefined;
  const t0 = Date.now();
  try {
    sidecar = await startSidecar(cfg, { fetchImpl: http.fetchImpl, timing: { baseIntervalMs: turns ? 600_000 : 6000 }, statusIntervalMs: 1000, logger: silentLogger });
    await waitFor(() => fake.received.some((f) => f.t === "hello_ack"), "hello_ack", 10_000);
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31, capActors: 12 });
    const run = await waitFor(() => sidecar?.manager?.getRun(7), "the run", 30_000);
    await waitFor(() => run.state === "running", "running", 60_000);
    const chain = run.llmChain();
    if (!chain) throw new Error("no chain on the run");

    // ---- taps: every attempt on every link, every operator event, every chat line ----
    const taps: ChainTap[] = [];
    chain.tap = (e) => taps.push(e);
    const opEvents: Array<{ type: string; data?: Record<string, unknown> | undefined; detail?: string }> = [];
    const gw = run.simulation?.gateways["breaker"];
    if (gw) {
      const original = gw.sendOperatorEvent.bind(gw);
      gw.sendOperatorEvent = (e) => {
        opEvents.push({ type: e.type, data: e.data, detail: e.detail });
        return original(e);
      };
    }
    const chats: ChatSeen[] = [];
    let seenChats = 0;
    const poll = setInterval(() => {
      while (seenChats < fake.chats.length) {
        const c = fake.chats[seenChats++]!;
        chats.push({ at: Date.now(), actor: c.actor, mode: c.mode, text: c.text, to: c.to ?? null });
      }
    }, 40);
    const actorId = (ref: string): number | undefined => fake.avatarByRef(ref)?.id;
    await waitFor(() => agents.every((a) => actorId(a.id) !== undefined), "all spawned", 60_000);
    await new Promise((r) => setTimeout(r, 8000)); // let the cast walk in

    const addressed = { lines: 0, answered: 0, latencies: [] as number[] };
    const dog = { lines: 0, unaddressedMulti: 0, addressedJumped: 0 };
    const over = (): boolean => spentSoFar() + chain.snapshot().links.reduce((n, l) => n + l.costUsd, 0) > MAX_USD;

    if (turns) {
      for (let i = 0; i < LINES && !over(); i++) {
        const isAddressed = i % 5 !== 4 && i % 5 !== 2;
        const target = agents[i % agents.length]!;
        const text = isAddressed ? ADDRESSED[i % ADDRESSED.length]!.replace("{n}", target.name) : UNADDRESSED[i % UNADDRESSED.length]!;
        const from = chats.length;
        const sentAt = Date.now();
        // From across the room a shout is the only line the cast hears clearly; their answers to it are the addressed `say` lines under test.
        fake.humanSay(12, 9, text, far ? "shout" : "say");
        // The line is over once the room has been quiet for 7 s, or after 45 s.
        let last = Date.now();
        let seen = chats.length;
        while (Date.now() - sentAt < 45_000 && Date.now() - last < 7000) {
          await new Promise((r) => setTimeout(r, 100));
          if (chats.length !== seen) {
            seen = chats.length;
            last = Date.now();
          }
        }
        const after = chats.slice(from);
        dog.lines++;
        if (isAddressed) {
          addressed.lines++;
          const tid = actorId(target.id);
          const idx = after.findIndex((c) => c.actor === tid);
          if (idx >= 0) {
            addressed.answered++;
            addressed.latencies.push(after[idx]!.at - sentAt);
          }
          if (after.some((c, j) => c.actor !== tid && (idx === -1 || j < idx))) dog.addressedJumped++;
        } else if (new Set(after.map((c) => c.actor)).size >= 2) dog.unaddressedMulti++;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } else {
      // Embodiment: the base pulses carry the scene. Two lines from the human keep a conversation going.
      let nextLine = 0;
      const startPulse = run.status().pulse;
      const deadline = Date.now() + (PULSES + 10) * 12_000;
      while (run.status().pulse - startPulse < PULSES && Date.now() < deadline && !over()) {
        await new Promise((r) => setTimeout(r, 500));
        const done = run.status().pulse - startPulse;
        if (done >= nextLine * 12 + 6 && nextLine < 3) {
          const target = agents[nextLine % agents.length]!;
          fake.humanSay(12, 9, ADDRESSED[nextLine]!.replace("{n}", target.name));
          nextLine++;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
    clearInterval(poll);
    while (seenChats < fake.chats.length) {
      const c = fake.chats[seenChats++]!;
      chats.push({ at: Date.now(), actor: c.actor, mode: c.mode, text: c.text, to: c.to ?? null });
    }

    // ---- numbers ----
    const skipTaps = taps.filter((t) => t.outcome === "skipped");
    taps.splice(0, taps.length, ...taps.filter((t) => t.outcome !== "skipped"));
    const okTaps = taps.filter((t) => t.outcome === "ok");
    const parsed = okTaps.map((t) => parseLoose(t.content ?? ""));
    const clean = parsed.filter((p) => p.clean).length;
    const recovered = parsed.filter((p) => p.ok && !p.clean).length;
    const intents = opEvents.filter((e) => e.type === "action_intent");
    const motive = (e: (typeof opEvents)[number]): string => String(e.data?.["privateMotiveSummary"] ?? "");
    const fallbacks = intents.filter((e) => motive(e).startsWith("Fallback applied:")).length;
    const providerFailed = intents.filter((e) => motive(e).startsWith("Provider failed:") || motive(e).startsWith("Retry call failed.")).length;
    const bodyOf = (v: Record<string, unknown> | undefined): boolean => {
      const b = v?.["body"];
      return !!b && typeof b === "object" && Object.keys(b as object).length > 0;
    };
    const withBody = parsed.filter((p) => bodyOf(p.value)).length;
    const events = (await run.simulation?.runtime.getEventLog().getCommittedThrough(run.simulation.simulationId, Number.MAX_SAFE_INTEGER)) ?? [];
    const blocked = events.filter((e) => e.type === "body_blocked").length;
    const stats = bodyStats(okTaps.map((t) => t.prompt), parsed.map((p) => p.value));
    const chatFrames = run.frameLog.frames.filter((f) => f.kind === "chat" && f.data["mode"] === "say" && f.data["toRef"] !== undefined && f.data["sameRoom"] !== undefined);
    const dist = chatFrames.map((f) => Number(f.data["distance"])).filter((d) => d >= 0);
    const violations = chatFrames.filter((f) => f.data["sameRoom"] === false || Number(f.data["distance"]) > 6).length;
    const styleSeen: Record<string, number> = {};
    for (const t of okTaps) styleSeen[t.prompt.promptStyle ?? "full"] = (styleSeen[t.prompt.promptStyle ?? "full"] ?? 0) + 1;
    const visible = okTaps.flatMap((_, i) => {
      const v = parsed[i]?.value?.["visibleContent"];
      return typeof v === "string" && v.trim() ? [v] : [];
    });
    const spoken = chats.map((c) => c.text);
    const langs = spoken.map(languageOf);
    const hits = [...new Set([...spoken, ...visible].filter((t) => SELF_REFERENCE.test(t)))];
    const prompts = [...taps, ...skipTaps].map((t) => `${t.prompt.system}\n${t.prompt.user}`);
    const probes = runEmbodimentProbes({ log: run.frameLog, actorIds: agents.map((a) => a.id), prompts });
    const snap = chain.snapshot();
    const pick = (name: string) => probes.find((p) => p.probe === name);
    const sayLines = run.frameLog.frames.filter((f) => f.kind === "chat" && f.data["mode"] === "say" && f.data["toRef"] !== undefined && f.data["sameRoom"] !== undefined).length;
    const lat = addressed.latencies;
    const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

    const sized = [...taps, ...skipTaps];
    if (PROMPT_OUT && sized.length > 0) {
      const biggest = sized.reduce((a, b) => (b.prompt.inputTokensEstimate > a.prompt.inputTokensEstimate ? b : a));
      mkdirSync(dirname(PROMPT_OUT), { recursive: true });
      writeFileSync(PROMPT_OUT, JSON.stringify({ system: biggest.prompt.system, user: biggest.prompt.user, inputTokensEstimate: biggest.prompt.inputTokensEstimate, scene: SCENE }, null, 1));
    }

    const result: Results = {
      variant: variant.name,
      scenario,
      wallSec: Math.round((Date.now() - t0) / 1000),
      pulses: run.status().pulse,
      calls: { attempts: taps.length, ok: okTaps.length, failed: taps.length - okTaps.length, servedBy: Object.fromEntries(snap.links.map((l) => [l.name, l.served])) },
      json: {
        n: okTaps.length,
        cleanPct: pct(clean, okTaps.length),
        recoveredPct: pct(recovered, okTaps.length),
        invalidPct: pct(okTaps.length - clean - recovered, okTaps.length),
        serverFallbackPct: pct(fallbacks, intents.length),
        providerFailedPct: pct(providerFailed, intents.length),
      },
      body: { withBody, blocked, validPct: withBody === 0 ? null : pct(Math.max(0, withBody - blocked), withBody), stats },
      earshot: {
        lines: chatFrames.length,
        violations,
        ratePct: chatFrames.length === 0 ? null : pct(violations, chatFrames.length),
        farLines: chatFrames.filter((f) => Number(f.data["distance"]) > 6).length,
        meanDistance: dist.length === 0 ? null : Math.round((10 * dist.reduce((a, b) => a + b, 0)) / dist.length) / 10,
        deferred: events.filter((e) => e.type === "speech_deferred").length,
        blockedNotInEarshot: events.filter((e) => e.type === "body_blocked" && JSON.stringify(e.payload).includes("not_in_earshot")).length,
      },
      facing: facingSplit(run.frameLog),
      promptStyle: styleSeen,
      addressed: { lines: addressed.lines, answeredPct: pct(addressed.answered, addressed.lines), replyP50Ms: percentile(lat, 50) ?? null, replyP95Ms: percentile(lat, 95) ?? null, n: lat.length },
      dogPile: { ...dog, ratePct: pct(dog.unaddressedMulti + dog.addressedJumped, dog.lines) },
      lang: { lines: spoken.length, ptPct: spoken.length === 0 ? null : pct(langs.filter((l) => l === "pt").length, spoken.length), enPct: spoken.length === 0 ? null : pct(langs.filter((l) => l === "en").length, spoken.length), unknown: langs.filter((l) => l === "unknown").length },
      d43: { hits, promptIdentityHits: Number(pick("prompt-identity-lint")?.measured ?? 0) },
      embodiment: probes.map((p) => ({ id: p.probe, value: p.measured, ok: p.passed })),
      earshotSayLines: sayLines,
      perLink: snap.links.map((l) => ({ name: l.name, calls: l.calls, failures: l.failures, served: l.served, tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd, ...(l.p50Ms !== undefined ? { p50Ms: l.p50Ms } : {}), ...(l.p95Ms !== undefined ? { p95Ms: l.p95Ms } : {}), ...(l.estimateRatio !== undefined ? { estimateRatio: Math.round(l.estimateRatio * 100) / 100 } : {}), skipped: l.skipped as Record<string, number>, guarded: l.guarded as Record<string, number> })),
      prompts: (() => {
        const sizes = [...taps, ...skipTaps].filter((t) => t.link === links[0]!.name).map((t) => t.prompt.inputTokensEstimate);
        return { n: sizes.length, p50: percentile(sizes, 50) ?? null, p95: percentile(sizes, 95) ?? null, max: sizes.length ? Math.max(...sizes) : null, skippedForSize: skipTaps.filter((t) => t.error === "context" && t.link === links[0]!.name).length };
      })(),
      chatLines: chats.length,
      costUsd: Math.round(snap.links.reduce((n, l) => n + l.costUsd, 0) * 1e6) / 1e6,
      rawFailures: okTaps.flatMap((t, i) => (parsed[i]?.ok ? [] : [(t.content ?? "").slice(0, 240)])).slice(0, 4),
      sampleLines: spoken.slice(0, 6),
    };
    return result;
  } finally {
    await sidecar?.close();
    await fake.stop();
    await new Promise<void>((r) => (stub ? stub.server.close(() => r()) : r()));
  }
}

function save(r: Results): void {
  const all: Results[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Results[]) : [];
  const next = all.filter((x) => !(x.variant === r.variant && x.scenario === r.scenario));
  next.push(r);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(next, null, 1));
}

/** PROBE_CTX="mythomax=8192": measure a link as if its window were that big (it still serves, so its answers can be judged). */
function ctxOverrides(): Map<string, number> {
  return new Map((env["PROBE_CTX"] ?? "").split(",").filter(Boolean).map((kv) => [kv.split("=")[0]!.trim(), Number(kv.split("=")[1])] as [string, number]));
}

function variants(): Variant[] {
  const over = ctxOverrides();
  const plain = env["PROBE_HARDEN"] === "0";
  const tag = `${STYLE ? `+${STYLE}` : ""}${NO_BODY_HINT ? "-nohint" : ""}`;
  const links = (DRY ? [{ name: "stub", baseUrl: "http://stub", apiKeyEnv: "PROBE_STUB_KEY", model: "stub", maxContextTokens: 4096 }, { name: "stub2", baseUrl: "http://stub", apiKeyEnv: "PROBE_STUB_KEY", model: "stub2", maxContextTokens: 8192 }] : allLinks()).map((l) => ({ ...(over.has(l.name) ? { ...l, maxContextTokens: over.get(l.name)! } : l), ...(STYLE ? { promptStyle: STYLE } : {}), ...(plain ? { harden: false } : {}) }));
  return WANT.flatMap((w): Variant[] => {
    if (w === "chain") return [{ name: `${plain ? "chain-plain" : "chain"}${tag}`, links }];
    const one = links.find((l) => l.name === w);
    return one ? [{ name: `${over.has(w) ? `${w}@${over.get(w)}` : w}${tag || (one.promptStyle === undefined ? `+${linkPromptStyle(one)}` : "")}${plain ? "-plain" : ""}`, links: [one] }] : [];
  });
}

describe("real-model probe: the hotel on the provider chain", () => {
  let spent = 0;
  for (const variant of variants()) {
    for (const scenario of SCENARIOS) {
      it(`${variant.name} / ${scenario}`, async () => {
        if (spent > MAX_USD) return;
        const r = await runVariant(variant, scenario, () => spent);
        spent += r.costUsd;
        save(r);
        console.log(JSON.stringify(r));
        expect(r.calls.attempts).toBeGreaterThan(0);
      });
    }
  }
});
