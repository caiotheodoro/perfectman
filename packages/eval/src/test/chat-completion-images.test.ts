import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "../llm/chat-completion-error.js";

const okResponse = (): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const base = { baseUrl: "http://judge-host/v1", model: "m", label: "Test caller", maxTokens: 50 };

function sentUserMessage(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetchMock.mock.calls[0]! as [string, { body: string }];
  const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> };
  return body.messages.find((m) => m.role === "user");
}

describe("chatCompletion image input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a user message's images as image_url parts after its text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({
      ...base,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "look", images: [{ mediaType: "image/png", base64: "QUJD" }] },
      ],
    });

    expect(sentUserMessage(fetchMock)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      ],
    });
  });

  it("leaves a message without images as the plain string it always was", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...base, messages: [{ role: "system", content: "sys" }, { role: "user", content: "look" }] });

    expect(sentUserMessage(fetchMock)).toEqual({ role: "user", content: "look" });
  });
});
