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

/** fetch that serves the hotel's internal HTTP surface from memory. */
export function fakeHotelHttp(versions: Record<number, unknown>): { fetchImpl: FetchLike; registered: unknown[] } {
  const registered: unknown[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const m = /\/scenario-versions\/(\d+)$/.exec(path);
    if (m?.[1] && versions[Number(m[1])] !== undefined) return new Response(JSON.stringify({ id: Number(m[1]), body: versions[Number(m[1])] }), { status: 200 });
    if (/\/runs\/\d+\/artifacts$/.test(path)) {
      registered.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response("{}", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, registered };
}

export const FAST_TIMING = {
  baseIntervalMs: 150,
  coalesceMs: 20,
  spawnIntervalMs: 5,
  walkOutTimeoutMs: 2000,
  gateway: { perCharMs: 0, capMs: 0, minTypingMs: 10, roomSpacingMs: 20 },
} as const;

/** The sidecar against a fake Director with one room (12), one human (ana, id 9) and scenario version 31. */
export async function bootSidecar(over: { config?: Partial<HotelConfig>; timing?: Partial<RunTiming>; fake?: FakeDirector; rng?: () => number } = {}) {
  const fake = over.fake ?? (await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 }));
  if (!over.fake) {
    fake.addRoom(12);
    fake.addHuman(12, 9, "ana", 6, 5);
  }
  const http = fakeHotelHttp({ 31: compiledScenario().body });
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
