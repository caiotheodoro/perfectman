import { describe, expect, it, vi } from "vitest";
import type { DraftStoryRequest } from "@perfectman/shared";
import { draftPrompt, draftStory, extractJson, StoryDraftError, toStoryDraft } from "../story-draft.js";

const REPLY = {
  title: "Blood on the Snow",
  situation: "Four friends are snowed into a cabin. One of them buried a loan shark outside.",
  language: "en",
  people: [
    { name: "Mick", role: "performer", goal: "Pin it on Darla.", voice: "Loud and crude.", lines: ["Shut the fuck up, Rico.", "I'll bury you next."] },
    { name: "Darla", role: "skeptic", goal: "Find who did it.", voice: "Flat, blunt.", lines: ["Who dug the hole?"] },
    { name: "Rico", role: "wizard", goal: "Get the money.", lines: [] },
  ],
};
const request = (llm: Partial<DraftStoryRequest["llm"]> = {}): DraftStoryRequest => ({
  idea: "a murder in a hunting cabin, everyone drunk and scared",
  llm: { providerType: "openai-compatible", baseUrl: "https://llm.test/v1/", modelName: "m", apiKey: "sk-secret-key-123", ...llm },
});
const reply = (content: string, status = 200): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const answer = (content: string, status = 200) => vi.fn<typeof fetch>(async () => reply(content, status));

describe("story draft", () => {
  it("finds the JSON object in prose and code fences, braces inside strings included", () => {
    expect(extractJson('Sure!\n```json\n{"a":"}{","b":{"c":1}}\n```')).toEqual({ a: "}{", b: { c: 1 } });
    expect(() => extractJson("no object here")).toThrow();
    expect(() => extractJson('{"a": 1')).toThrow();
  });

  it("shapes a reply: unknown roles fall back by position, missing voices and lines become empty", () => {
    const draft = toStoryDraft(JSON.stringify(REPLY));
    expect(draft.people.map((p) => p.role)).toEqual(["performer", "skeptic", "performer"]);
    expect(draft.people[2]).toMatchObject({ name: "Rico", voice: "", lines: [] });
    expect(draft.language).toBe("en");
  });

  it("drops repeated names and caps the cast at six", () => {
    const people = Array.from({ length: 9 }, (_, i) => ({ name: i === 1 ? "Mick" : `P${i}`, goal: "g" }));
    const draft = toStoryDraft(JSON.stringify({ ...REPLY, people: [{ name: "Mick", goal: "g" }, ...people] }));
    expect(draft.people).toHaveLength(6);
    expect(new Set(draft.people.map((p) => p.name.toLowerCase())).size).toBe(6);
  });

  it("rejects a draft with fewer than two usable people", () => {
    expect(() => toStoryDraft(JSON.stringify({ ...REPLY, people: [REPLY.people[0]] }))).toThrow();
  });

  it("sends the key as a bearer header to the chat endpoint, with the dark-fiction brief and extra fields", async () => {
    const fetchImpl = answer(JSON.stringify(REPLY));
    const draft = await draftStory(request({ extraBody: { thinking: { type: "disabled" } } }), fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-secret-key-123");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toMatch(/Never soften, moralise/);
    expect(draft.title).toBe("Blood on the Snow");
  });

  it("asks for no response_format when the route says JSON mode is off", async () => {
    const fetchImpl = answer(JSON.stringify(REPLY));
    await draftStory(request({ responseFormatJson: false }), fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).response_format).toBeUndefined();
  });

  it("asks again once when the first reply is unreadable, then gives up with a hint", async () => {
    const flaky = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("I cannot do that.")).mockResolvedValueOnce(reply(JSON.stringify(REPLY)));
    expect((await draftStory(request(), flaky)).people).toHaveLength(3);
    expect(flaky).toHaveBeenCalledTimes(2);
    const never = answer("I cannot do that.");
    await expect(draftStory(request(), never)).rejects.toMatchObject({ status: 502 });
    expect(never).toHaveBeenCalledTimes(2);
  });

  it("explains a refused key, a missing key, a short idea, and an unreachable model; never echoes the key", async () => {
    await expect(draftStory(request(), answer("", 401))).rejects.toThrow(/refused the key/);
    await expect(draftStory(request({ apiKey: "" }), answer(""))).rejects.toMatchObject({ status: 422 });
    await expect(draftStory({ ...request(), idea: "hi" }, answer(""))).rejects.toMatchObject({ status: 422 });
    const down = vi.fn<typeof fetch>().mockRejectedValue(new Error("connect ECONNREFUSED with sk-secret-key-123"));
    const error = await draftStory(request(), down).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoryDraftError);
    expect(JSON.stringify(error)).not.toContain("sk-secret");
    expect((error as Error).message).not.toContain("sk-secret");
  });

  it("asks for the requested number of people, clamped", () => {
    expect(draftPrompt("x", 9).user).toContain("with 6 people");
    expect(draftPrompt("x", 1).user).toContain("with 2 people");
    expect(draftPrompt("x", undefined).user).toContain("three to five people");
  });
});
