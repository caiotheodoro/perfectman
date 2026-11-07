import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthoringService } from "../authoring/authoring-service.js";
import { draftToFiles } from "../authoring/draft-to-files.js";
import { makeBundle } from "../authoring/source-bundle.js";
import type { HotelConfig } from "../config.js";
import type { FetchLike } from "../director/http-client.js";
import type { RunTiming } from "../run/run.js";
import { startSidecar } from "../sidecar.js";
import { silentLogger } from "../util/log.js";
import { FakeDirector } from "./fake-director.js";

export const TEST_SECRET = "0123456789abcdef0123456789abcdef-test";

export function testConfig(directorUrl: string, over: Partial<HotelConfig> = {}): HotelConfig {
  return {
    enabled: true,
    secret: TEST_SECRET,
    directorUrl,
    internalUrl: "http://hotel.test",
    authoringHost: "127.0.0.1",
    authoringPort: 0,
    maxRuns: 3,
    llm: { provider: "mock", baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", models: ["mock"], prices: { mock: { inUsdPerMTok: 1, outUsdPerMTok: 2 } }, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 },
    dataDir: mkdtempSync(join(tmpdir(), "pm-hotel-")),
    healthPort: 0,
    ...over,
  };
}

/** Polls with real timers until `fn` is truthy; the sidecar and the fake hotel talk over a real socket. */
export async function waitFor<T>(fn: () => T | undefined | false, what: string, timeoutMs = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A compiled three-person scenario from the mock draft, the way the authoring route would produce it. */
export function compiledScenario(language: "en" | "pt-BR" = "pt-BR"): { source: string; body: unknown } {
  const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
  const svc = new AuthoringService({ llm, apiKey: undefined });
  const people = [
    { name: "Duda", role: "connector" as const, goal: "Keep the peace.", voice: "", lines: [] as string[] },
    { name: "Rafa", role: "skeptic" as const, goal: "Get a straight answer.", voice: "", lines: [] as string[] },
    { name: "Gabi", role: "performer" as const, goal: "Be the center of attention.", voice: "", lines: [] as string[] },
  ];
  const source = makeBundle(draftToFiles({ title: "Sexta no lounge", situation: "Tres amigos num lounge depois do trabalho.", language, people }));
  return { source, body: svc.compile({ source }).body };
}

export type FakeMemoryRow = { scenario: number; user_id: number; character: string; body: unknown; updated_at: number };

/** The hotel's `scenario_player_memory` table and its internal endpoints (director-protocol.md 11.1), in memory. */
export class FakeMemoryTable {
  readonly rows = new Map<string, FakeMemoryRow>();
  readonly puts: Array<{ scenario: number; user: number; character: string; body: unknown }> = [];
  /** More than this many characters for one person and scenario is 422 memory_full, as the hotel answers. */
  maxCharacters = 12;
  set(scenario: number, user: number, character: string, body: unknown): void {
    this.rows.set(`${scenario}|${user}|${character}`, { scenario, user_id: user, character, body, updated_at: Date.now() });
  }
  get(scenario: number, user: number, character: string): FakeMemoryRow | undefined {
    return this.rows.get(`${scenario}|${user}|${character}`);
  }
}

/** fetch that serves the hotel's internal HTTP surface from memory. The version answer names its scenario (`scenario`). */
export function fakeHotelHttp(versions: Record<number, unknown>, opts: { scenario?: number; memory?: FakeMemoryTable } = {}): { fetchImpl: FetchLike; registered: unknown[]; memory: FakeMemoryTable; memoryCalls: string[] } {
  const registered: unknown[] = [];
  const memory = opts.memory ?? new FakeMemoryTable();
  const memoryCalls: string[] = [];
  const scenario = opts.scenario ?? 5;
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const m = /\/scenario-versions\/(\d+)$/.exec(path);
    if (m?.[1] && versions[Number(m[1])] !== undefined) return new Response(JSON.stringify({ id: Number(m[1]), scenario, body: versions[Number(m[1])] }), { status: 200 });
    if (path === "/internal/v1/memory" && (init?.method ?? "GET") === "GET") {
      memoryCalls.push(`GET ${u.search}`);
      const sc = Number(u.searchParams.get("scenario"));
      const users = new Set((u.searchParams.get("users") ?? "").split(",").map(Number));
      const rows = [...memory.rows.values()].filter((r) => r.scenario === sc && users.has(r.user_id)).map((r) => ({ user_id: r.user_id, character: r.character, body: JSON.stringify(r.body), updated_at: r.updated_at }));
      return new Response(JSON.stringify({ rows }), { status: 200 });
    }
    const put = /\/internal\/v1\/memory\/(\d+)\/(\d+)\/([^/]+)$/.exec(path);
    if (put && init?.method === "PUT") {
      const [, sc, user, character] = put as unknown as [string, string, string, string];
      const body = (JSON.parse(String(init.body ?? "{}")) as { body?: unknown }).body;
      memoryCalls.push(`PUT ${path}`);
      const mine = [...memory.rows.values()].filter((r) => r.scenario === Number(sc) && r.user_id === Number(user));
      if (!memory.get(Number(sc), Number(user), decodeURIComponent(character)) && mine.length >= memory.maxCharacters) return new Response(JSON.stringify({ error: "memory_full" }), { status: 422 });
      if (Buffer.byteLength(JSON.stringify(body)) > 4096) return new Response(JSON.stringify({ error: "too_large" }), { status: 413 });
      memory.puts.push({ scenario: Number(sc), user: Number(user), character: decodeURIComponent(character), body });
      memory.set(Number(sc), Number(user), decodeURIComponent(character), body);
      return new Response("{}", { status: 200 });
    }
    if (/\/runs\/\d+\/artifacts$/.test(path)) {
      registered.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response("{}", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, registered, memory, memoryCalls };
}

export const FAST_TIMING = {
  baseIntervalMs: 150,
  coalesceMs: 20,
  spawnIntervalMs: 5,
  arrivalStaggerMs: [5, 15] as const,
  walkOutTimeoutMs: 2000,
  gateway: { perCharMs: 0, capMs: 0, minTypingMs: 10, roomSpacingMs: 20 },
} as const;

/** The sidecar against a fake Director with one room (12), one human (ana, id 9) and scenario version 31. */
export async function bootSidecar(over: { config?: Partial<HotelConfig>; timing?: Partial<RunTiming>; fake?: FakeDirector; rng?: () => number; versions?: Record<number, unknown>; memory?: FakeMemoryTable; scenario?: number; ackTimeoutMs?: number } = {}) {
  const fake = over.fake ?? (await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, ...(over.ackTimeoutMs !== undefined ? { ackTimeoutMs: over.ackTimeoutMs } : {}) }));
  if (!over.fake) {
    fake.addRoom(12);
    fake.addHuman(12, 9, "ana", 6, 5);
  }
  const http = fakeHotelHttp({ 31: compiledScenario().body, ...over.versions }, { ...(over.memory ? { memory: over.memory } : {}), ...(over.scenario !== undefined ? { scenario: over.scenario } : {}) });
  const cfg = testConfig(fake.url, over.config);
  const acksBefore = fake.received.filter((f) => f.t === "hello_ack").length;
  const sidecar = await startSidecar(cfg, {
    fetchImpl: http.fetchImpl,
    timing: { ...FAST_TIMING, ...over.timing },
    statusIntervalMs: 100,
    ...(over.rng ? { rng: over.rng } : {}),
    logger: silentLogger,
  });
  await waitFor(() => fake.received.filter((f) => f.t === "hello_ack").length > acksBefore, "the sidecar's hello_ack");
  return { fake, http, cfg, sidecar };
}
