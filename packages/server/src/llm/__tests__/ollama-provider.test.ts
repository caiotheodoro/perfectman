import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../ollama-provider.js";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";

const context: AgentRuntimeContext = { pulseIndex: 1, now: Date.now() };
const prompt: BuiltPrompt = {
  system: "sys",
  user: "user",
  inputTokensEstimate: 10,
  purpose: "action_intent",
  version: "v-test",
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    providerType: "ollama",
    baseUrl: "http://localhost:11434",
    modelName: "qwen3:8b",
    maxInputTokens: 1000,
    maxOutputTokens: 200,
    temperature: 1,
    timeoutMs: 5000,
    retryCount: 0,
    responseFormatJson: true,
    ...overrides,
  } as never;
}

const baseInput = {} as never;

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { content }, model: "qwen3:8b", prompt_eval_count: 20, eval_count: 5 }),
  };
}

describe("OllamaProvider", () => {
  it("returns content and uses the schema object as format (not plain \"json\")", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OllamaProvider(config());
    const res = await provider.generateIntent(baseInput, context, prompt);
    expect(res.content).toContain("no_op");
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(firstBody.format).not.toBe("json");
  });

  it("falls back to format \"json\" on a 400 schema rejection", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "schema unsupported" })
      .mockResolvedValueOnce(okResponse('{"intentType":"no_op","privateMotiveSummary":"s"}'));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OllamaProvider(config());
    const res = await provider.generateIntent(baseInput, context, prompt);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(fallbackBody.format).toBe("json");
    expect(res.content).toContain("no_op");
  });
});
