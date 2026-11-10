/**
 * The builder's draft runs over the configured model chain, link by link, the way the live actors do: each link's own
 * base URL, key (read from its env var), headers (the session header OpenCode Go demands), `extraBody` and a draft-sized
 * timeout; a failing link hands over to the next, and when all fail the error says why per link. The model is mocked.
 */
import { describe, expect, it, vi } from "vitest";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import type { LlmLink } from "../llm/chain-config.js";

const OR_KEY = "sk-or-SECRET-111";
const OC_KEY = "sk-oc-SECRET-222";
const LEGACY_KEY = "sk-legacy-SECRET-333";
const SECRETS = [OR_KEY, OC_KEY, LEGACY_KEY];

const person = (name: string, standing: "high" | "low") => ({ name, role: "connector", goal: `Fazer ${name === "Rocha" ? "a Dalila" : "o Rocha"} responder.`, standing, voice: "Seca.", lines: ["Olha pra mim.", "Responde."] });
const STORY = { title: "O livro-caixa", situation: "Fim do expediente. A conta não fecha.", language: "pt-BR", people: [person("Rocha", "high"), person("Dalila", "low"), person("Kleber", "low")], beats: [] };

const opencode: LlmLink = { name: "opencode-deepseek", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OPENCODE_API_KEY", model: "deepseek-v4.1-flash", sessionHeader: "x-opencode-session", timeoutMs: 60000, extraBody: { thinking: { type: "disabled" } } };
const lunaris: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "sao10k/l3-lunaris-8b" };
const mythomax: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "gryphe/mythomax-l2-13b" };

const ENV: Record<string, string> = { OPENROUTER_API_KEY: OR_KEY, OPENCODE_API_KEY: OC_KEY };
const llmEnv = (chain?: LlmLink[]) => ({ provider: "openai-compatible" as const, baseUrl: "https://legacy.test/v1", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", models: ["legacy-model"], ...(chain ? { chain } : {}), prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });

type Call = { url: string; headers: Headers; body: Record<string, unknown> };
type Handler = (call: Call, n: number) => Response;
const ok = (content: unknown = STORY): Response => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
const fail = (status: number, body: unknown): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
/** OpenCode Go as it answered in production: 400 unless the session header rides along. */
const MISSING_SESSION = { type: "error", error: { type: "MissingSessionID", message: "Request is missing x-opencode-session header" } };

function rig(chain: LlmLink[] | undefined, handler: Handler, env: Record<string, string> = ENV, apiKey?: string) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    calls.push(call);
    return handler(call, calls.length);
  });
  const service = new AuthoringService({ llm: llmEnv(chain), apiKey, fetchImpl, env: (name) => env[name] });
  return { service, calls, fetchImpl };
}
const brief = { brief: "uma contadora e o chefe, fim do expediente", language: "pt-BR" };
const failure = async (promise: Promise<unknown>): Promise<AuthoringError> => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(AuthoringError);
  return error as AuthoringError;
};

describe("AuthoringService.draft over the model chain", () => {
  it("tries the links in order and stops at the first that answers", async () => {
    const { service, calls } = rig([lunaris, opencode], () => ok());
    await service.draft(brief);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("sao10k/l3-lunaris-8b");
  });

  it("fails over past 400, 401, 402, 429, 5xx, a network error, a timeout and an empty reply, in chain order", async () => {
    const chain = ["a", "b", "c", "d", "e", "f", "g", "h"].map((name): LlmLink => ({ ...lunaris, name, baseUrl: `https://${name}.test/v1` }));
    const answers: Array<() => Response> = [
      () => fail(400, { error: { message: "bad" } }),
      () => fail(401, { error: { message: "no" } }),
      () => fail(402, { error: { message: "pay" } }),
      () => fail(429, { error: { message: "slow down" } }),
      () => fail(503, "upstream down"),
      () => { throw new TypeError("fetch failed"); },
      () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); },
      () => ok(""),
    ];
    const { service, calls } = rig([...chain, { ...opencode, name: "last" }], (_call, n) => (n <= answers.length ? answers[n - 1]!() : ok()));
    await service.draft(brief);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([...chain.map((l) => `${l.name}.test`), "opencode.ai"]);
  });

  it("an unreadable reply is asked for once more on the same link, a second one moves on", async () => {
    const { service, calls } = rig([lunaris, opencode], (call) => (new URL(call.url).hostname === "openrouter.ai" ? ok("I cannot do that.") : ok()));
    await service.draft(brief);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["openrouter.ai", "openrouter.ai", "opencode.ai"]);
    const flaky = rig([lunaris, opencode], (_call, n) => (n === 1 ? ok("not json") : ok()));
    await flaky.service.draft(brief);
    expect(flaky.calls).toHaveLength(2);
    expect(flaky.calls[1]!.url).toContain("openrouter.ai");
  });

  it("stops on a validation error: a one-word brief reaches no link", async () => {
    const { service, calls } = rig([lunaris, opencode], () => ok());
    await expect(service.draft({ brief: "oi" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("sends the link's session header, fresh per draft, and the key of the link's own env var", async () => {
    const { service, calls } = rig([opencode, lunaris], () => ok());
    await service.draft(brief);
    await service.draft(brief);
    const first = calls[0]!.headers.get("x-opencode-session");
    const second = calls[1]!.headers.get("x-opencode-session");
    expect(first).toMatch(/\S{8,}/);
    expect(second).toMatch(/\S{8,}/);
    expect(first).not.toBe(second);
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${OC_KEY}`);
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
  });

  it("each link gets its own key and headers: OpenRouter's attribution, no session header on a link without one", async () => {
    const { service, calls } = rig([opencode, lunaris], (call) => (call.headers.has("x-opencode-session") ? fail(429, { error: { message: "quota" } }) : ok()));
    await service.draft(brief);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([`Bearer ${OC_KEY}`, `Bearer ${OR_KEY}`]);
    expect(calls[1]!.headers.has("x-opencode-session")).toBe(false);
    expect(calls[1]!.headers.get("x-title")).toBe("CMB");
  });

  it("the legacy PERFECTMAN_LLM_API_KEY is not used for a chain link", async () => {
    const { service, calls } = rig([opencode], () => ok(), ENV, LEGACY_KEY);
    await service.draft(brief);
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${OC_KEY}`);
  });

  it("merges the link's extraBody into the request, over the draft's own fields, and the link's model", async () => {
    const { service, calls } = rig([opencode], () => ok());
    await service.draft(brief);
    const body = calls[0]!.body;
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(3200);
  });

  it("reproduces the production 400: OpenCode Go answers MissingSessionID without the header, and the draft now succeeds", async () => {
    const gateway: Handler = (call) => (call.headers.has("x-opencode-session") ? ok() : fail(400, MISSING_SESSION));
    const { service, calls } = rig([opencode], gateway);
    const { source } = await service.draft(brief);
    expect(calls).toHaveLength(1);
    expect(source).toContain("Rocha");
    // the same gateway against a link that lost its session header shows what the bug looked like
    const { sessionHeader: _gone, ...bare } = opencode;
    const broken = rig([bare], gateway);
    const error = await failure(broken.service.draft(brief));
    expect(error.errors?.[0]?.message).toContain("opencode-deepseek: 400 MissingSessionID");
  });

  it("gives a draft-sized timeout: never under 60 s, never over the 90 s request ceiling", async () => {
    const timeouts: Array<number | undefined> = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => { timeouts.push(ms); return new AbortController().signal; });
    try {
      const { service } = rig([lunaris, { ...opencode, timeoutMs: 5000 }, { ...mythomax, timeoutMs: 600000 }], (_c, n) => (n < 3 ? fail(500, "x") : ok()));
      await service.draft(brief);
    } finally {
      spy.mockRestore();
    }
    expect(timeouts).toEqual([60_000, 60_000, 90_000]);
  });

  it("when every link fails the detail names each link with the provider's own message, and holds no key", async () => {
    const echo = { error: { message: `Incorrect API key provided: ${OR_KEY}` } };
    const { service } = rig([opencode, lunaris, mythomax], (call) => (call.headers.has("x-opencode-session") ? fail(400, MISSING_SESSION) : new URL(call.url).hostname === "openrouter.ai" && call.body.model === "sao10k/l3-lunaris-8b" ? fail(429, { error: { message: "Rate limit exceeded: free-models-per-day" } }) : fail(401, echo)));
    const error = await failure(service.draft(brief));
    expect(error.status).toBe(503);
    expect(error.code).toBe("llm_unavailable");
    expect(error.message).toBe("No model could draft this story.");
    const detail = error.errors?.[0]?.message ?? "";
    expect(detail).toContain("opencode-deepseek: 400 MissingSessionID Request is missing x-opencode-session header");
    expect(detail).toContain("lunaris: 429 Rate limit exceeded: free-models-per-day");
    expect(detail).toMatch(/mythomax: 401 Incorrect API key provided: \[key\]/);
    expect(detail.indexOf("opencode-deepseek")).toBeLessThan(detail.indexOf("lunaris"));
    expect(detail.indexOf("lunaris")).toBeLessThan(detail.indexOf("mythomax"));
    for (const secret of SECRETS) expect(JSON.stringify(error) + error.message + detail).not.toContain(secret);
  });

  it("caps a provider's non-JSON body at 160 characters and says a network error plainly", async () => {
    const { service } = rig([lunaris, opencode], (call) => (call.url.includes("openrouter") ? fail(502, `<html>${"x".repeat(500)}</html>`) : (() => { throw new Error(`connect ECONNREFUSED with ${OC_KEY}`); })()));
    const detail = (await failure(service.draft(brief))).errors?.[0]?.message ?? "";
    const [first, second] = detail.split("; ");
    expect(first!.length).toBeLessThanOrEqual("lunaris: ".length + 160);
    expect(first).toMatch(/^lunaris: 502 <html>x+/);
    expect(second).toBe("opencode-deepseek: could not be reached");
    expect(detail).not.toContain(OC_KEY);
  });

  it("skips a link whose key variable is empty, and says so when the others fail too", async () => {
    const { service, calls } = rig([opencode, lunaris], () => fail(500, "boom"), { OPENROUTER_API_KEY: OR_KEY, OPENCODE_API_KEY: "  " });
    const detail = (await failure(service.draft(brief))).errors?.[0]?.message ?? "";
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("openrouter.ai");
    expect(detail).toContain("opencode-deepseek: OPENCODE_API_KEY is empty, skipped");
    expect(detail).toContain("lunaris: 500 boom");
  });

  it("an empty-key link is passed over for the next one that works", async () => {
    const { service, calls } = rig([opencode, lunaris], () => ok(), { OPENROUTER_API_KEY: OR_KEY });
    await service.draft(brief);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${OR_KEY}`);
  });

  it("with no key in the whole chain it reaches nothing and names every variable", async () => {
    const { service, calls } = rig([opencode, lunaris], () => ok(), {});
    const error = await failure(service.draft(brief));
    expect(calls).toHaveLength(0);
    expect(error.status).toBe(503);
    expect(error.errors?.[0]?.message).toBe("opencode-deepseek: OPENCODE_API_KEY is empty, skipped; lunaris: OPENROUTER_API_KEY is empty, skipped");
  });

  it("without a chain it is the single legacy request: base URL, PERFECTMAN_LLM_API_KEY, no extra headers, the old short error", async () => {
    const { service, calls } = rig(undefined, () => ok(), ENV, LEGACY_KEY);
    await service.draft(brief);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://legacy.test/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("legacy-model");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${LEGACY_KEY}`);
    expect([...calls[0]!.headers.keys()].sort()).toEqual(["authorization", "content-type"]);
    const down = rig(undefined, () => fail(400, MISSING_SESSION), ENV, LEGACY_KEY);
    const error = await failure(down.service.draft(brief));
    expect(error.message).toBe("The model answered 400.");
    expect(error.errors).toBeUndefined();
    expect(down.calls).toHaveLength(1);
  });
});
