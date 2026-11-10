import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_REFERENCE_HEADER, DRAFT_REFERENCE_MAX_CHARS, SLIM_EXCERPT_MAX_CHARS, parseSlimKb, slimFixture } from "@perfectman/shared";
import type { DraftStoryRequest, SlimKb, StoryDraft } from "@perfectman/shared";
import { KB_SLIM_ENV, loadSlimKbFromEnv, resetSlimKbCache } from "../../kb/slim-file.js";
import { draftReferences, guardDraft, inferDraftIntent } from "../draft-references.js";
import { draftPrompt, draftStory } from "../story-draft.js";

function kbOf(raw: unknown = slimFixture()): SlimKb {
  const parsed = parseSlimKb(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.kb;
}

const kb = kbOf();
const IDEA = "a murder in a hunting cabin, everyone drunk and scared";

describe("inferDraftIntent: the peak, the tactics and the cast an idea hints at", () => {
  it("reads a killing from the verbs, defaults the tactics from the peak, and takes four people when none are asked for", () => {
    expect(inferDraftIntent(IDEA)).toEqual({ cast: 4, peak: "KILLING", tactics: ["to threaten", "to accuse", "to confront"] });
  });

  it("puts the tactics the idea names first, in the order it says them, and keeps the strongest peak", () => {
    const intent = inferDraftIntent("She slaps him after he lies about the affair, and he begs her to stay", 3);
    expect(intent.peak).toBe("VIOLENT_STRIKE");
    expect(intent.tactics.slice(0, 2)).toEqual(["to expose", "to plead"]);
    expect(intent.cast).toBe(3);
  });

  it("reads Brazilian Portuguese with its accents", () => {
    const intent = inferDraftIntent("Ele a traiu e ela ameaça matá-lo na festa de casamento", 2);
    expect(intent.peak).toBe("KILLING");
    expect(intent.tactics).toContain("to threaten");
  });

  it("takes an emotion when the idea names one, a dialogue-only scene when nothing physical is hinted, and keeps the cast in range", () => {
    expect(inferDraftIntent("two sisters, furious about the will").emotion).toBe("anger");
    const plain = inferDraftIntent("two sisters talk about the will");
    expect(plain).toMatchObject({ peak: "DIALOGUE_ONLY", tactics: ["to confront", "to accuse", "to press"] });
    expect(plain).not.toHaveProperty("emotion");
    expect(inferDraftIntent(IDEA, 1).cast).toBe(2);
    expect(inferDraftIntent(IDEA, 20).cast).toBe(6);
  });
});

describe("draftReferences", () => {
  it("is the header, then up to three scenes from different plays, the peak first, each with its work, author and licence", () => {
    const refs = draftReferences(kb, IDEA, 4, "en")!;
    const lines = refs.block.split("\n");
    expect(lines[0]).toBe(DRAFT_REFERENCE_HEADER);
    expect(refs.ids).toHaveLength(3);
    expect(refs.ids[0]).toMatch(/^(tin|salt):1\.1\.1$/);
    expect(lines.filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    expect(refs.block).toMatch(/\(public domain\)/);
    const works = new Set(refs.ids.map((id) => id.split(":")[0]));
    expect(works.size).toBe(3);
    expect(refs.block.length).toBeLessThanOrEqual(DRAFT_REFERENCE_MAX_CHARS);
  });

  it("matches the draft's language when it can: a pt-BR draft starts from the Portuguese play, and an unpinned draft follows the idea", () => {
    expect(draftReferences(kb, IDEA, 4, "pt-BR")!.ids[0]).toBe("farol:2.1.1");
    expect(draftReferences(kb, "um assassinato na casa de campo, e você não vai sair daqui", 4, undefined)!.ids[0]).toBe("farol:2.1.1");
    expect(draftReferences(kb, IDEA, 4, "en")!.ids[0]).not.toMatch(/^farol/);
  });

  it("is deterministic, and is nothing when the KB holds nothing the ask can use", () => {
    expect(draftReferences(kb, IDEA, 4, "en")).toEqual(draftReferences(kb, IDEA, 4, "en"));
    const kisses = kbOf({ ...slimFixture(), beats: slimFixture().beats.filter((b) => b.action === "KISSING") });
    expect(draftReferences(kisses, IDEA, 4, "en")).toBeUndefined();
  });

  it("never lets the block pass its cap, even from full-length excerpts", () => {
    const line = "A: ".padEnd(100, "x");
    const fat = slimFixture().beats.map((b) => ({ ...b, excerpt: [line, line, line, line].join("\n").slice(0, SLIM_EXCERPT_MAX_CHARS) }));
    const refs = draftReferences(kbOf({ ...slimFixture(), beats: fat }), IDEA, 4, "en")!;
    expect(refs.block.length).toBeLessThanOrEqual(DRAFT_REFERENCE_MAX_CHARS);
    expect(refs.ids.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the draft prompt with references", () => {
  const base = draftPrompt(IDEA, 3, "en");
  const refs = draftReferences(kb, IDEA, 3, "en")!;

  it("is byte-identical without them, and with them adds one block at the end and changes nothing else", () => {
    expect(draftPrompt(IDEA, 3, "en", undefined)).toEqual(base);
    const withRefs = draftPrompt(IDEA, 3, "en", refs.block);
    expect(withRefs.system).toBe(base.system);
    expect(withRefs.user).toBe(`${base.user}\n\n${refs.block}`);
  });

  it("stays inside the budget: the block adds at most 1,502 characters, and the whole prompt stays under 4,700 (about 1,200 tokens at four characters each)", () => {
    for (const language of ["en", "pt-BR"] as const) {
      const fat = slimFixture().beats.map((b) => ({ ...b, excerpt: Array.from({ length: 4 }, (_, i) => `${"AB"[i % 2]}: ${"y".repeat(97)}`).join("\n") }));
      const worst = draftReferences(kbOf({ ...slimFixture(), beats: fat }), "x".repeat(2000), 3, language)!;
      const plain = draftPrompt("x".repeat(2000), 3, language);
      const full = draftPrompt("x".repeat(2000), 3, language, worst.block);
      expect(full.user.length - plain.user.length).toBeLessThanOrEqual(DRAFT_REFERENCE_MAX_CHARS + 2);
      expect(full.system.length + full.user.length - 2000).toBeLessThan(4700);
    }
  });
});

describe("draftStory with and without the KB", () => {
  const REPLY = {
    title: "Blood on the Snow",
    situation: "Four friends are snowed into a cabin. One of them buried a loan shark outside.",
    language: "en",
    people: [
      { name: "Mick", role: "performer", goal: "Pin it on Darla.", voice: "Loud and crude.", lines: ["Shut it, Rico.", "I'll bury you next."] },
      { name: "Darla", role: "skeptic", goal: "Find who did it.", voice: "Flat, blunt.", lines: ["Who dug the hole?"] },
    ],
  };
  const request = (): DraftStoryRequest => ({ idea: IDEA, people: 3, language: "en", llm: { providerType: "openai-compatible", baseUrl: "https://llm.test/v1/", modelName: "m", apiKey: "sk-secret-key-123" } });
  const answer = (content: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));
  const sent = (fetchImpl: ReturnType<typeof answer>) => JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
  const chain = { links: [{ name: "a", baseUrl: "https://llm.test/v1", model: "m", apiKey: "sk-secret-key-123" }] };

  it("sends exactly the old prompt when there is no KB, whether it is switched off or just not there", async () => {
    const off = answer(REPLY);
    await draftStory(request(), off, undefined, null);
    const unset = answer(REPLY);
    await draftStory(request(), unset);
    const viaChain = answer(REPLY);
    await draftStory(request(), viaChain, chain, null);
    const expected = draftPrompt(IDEA, 3, "en");
    for (const fetchImpl of [off, unset, viaChain]) {
      expect(sent(fetchImpl).messages.map((m) => m.content)).toEqual([expected.system, expected.user]);
    }
    expect(expected.user).not.toContain("Reference scenes");
  });

  it("sends the reference block at the end of the user message when there is a KB, on both paths", async () => {
    const refs = draftReferences(kb, IDEA, 3, "en")!;
    const single = answer(REPLY);
    await draftStory(request(), single, undefined, kb);
    const overChain = answer(REPLY);
    await draftStory(request(), overChain, chain, kb);
    for (const fetchImpl of [single, overChain]) {
      const [system, user] = sent(fetchImpl).messages.map((m) => m.content);
      expect(system).toBe(draftPrompt(IDEA, 3, "en").system);
      expect(user!.endsWith(`\n\n${refs.block}`)).toBe(true);
      expect(user).toContain("Reference scenes (study the pressure and the turn, never copy lines or names):");
    }
  });

  it("holds the reply against what the model was shown: a copied line is cut, copied prose is an unusable draft, a clean draft is untouched", async () => {
    const refs = draftReferences(kb, IDEA, 3, "en")!;
    const copied = refs.block.split("\n").filter((l) => l.startsWith("| ")).map((l) => l.replace(/^\| [A-Z?]: /, "")).find((l) => l.split(" ").length >= 6)!;
    const dirty = { ...REPLY, people: [{ ...REPLY.people[0]!, lines: ["Shut it, Rico.", copied] }, REPLY.people[1]!] };
    const draft = await draftStory(request(), answer(dirty), undefined, kb);
    expect(draft.people[0]!.lines).toEqual(["Shut it, Rico."]);
    expect(draft.people[1]!.lines).toEqual(["Who dug the hole?"]);
    const clean = await draftStory(request(), answer(REPLY), undefined, kb);
    expect(clean).toEqual(await draftStory(request(), answer(REPLY), undefined, null));

    const prose = answer({ ...REPLY, situation: `Four friends. ${copied} Then the lights go out.` });
    await expect(draftStory(request(), prose, undefined, kb)).rejects.toMatchObject({ detail: undefined, message: expect.stringContaining("unusable") });
    expect(prose).toHaveBeenCalledTimes(2);
    const overChain = answer({ ...REPLY, situation: `Four friends. ${copied} Then the lights go out.` });
    await expect(draftStory(request(), overChain, chain, kb)).rejects.toMatchObject({ detail: expect.stringContaining("copies a reference scene") });
  });
});

describe("guardDraft", () => {
  const refs = draftReferences(kb, IDEA, 3, "en")!;
  const copied = refs.block.split("\n").filter((l) => l.startsWith("| ")).map((l) => l.replace(/^\| [A-Z?]: /, "")).find((l) => l.split(" ").length >= 6)!;
  const draft: StoryDraft = {
    title: "The Cabin",
    situation: "Four friends in a cabin.",
    language: "en",
    people: [
      { name: "Mick", role: "performer", goal: "Pin it on Darla.", voice: "Loud.", lines: ["Shut it.", copied.toUpperCase()] },
      { name: "Darla", role: "skeptic", goal: "Find who did it.", voice: "Flat.", lines: ["Who dug the hole?"] },
    ],
  };

  it("cuts a line that repeats five words in a row of a reference, whatever its case or punctuation, and keeps the rest", () => {
    const out = guardDraft(draft, refs.guard, IDEA);
    expect(out.people[0]!.lines).toEqual(["Shut it."]);
    expect(out.people[1]).toBe(draft.people[1]);
  });

  it("lets four words in a row through, and leaves a draft that copies nothing as the same object", () => {
    const four = copied.split(" ").slice(0, 4).join(" ");
    const near = { ...draft, people: [{ ...draft.people[0]!, lines: [four] }, draft.people[1]!] };
    expect(guardDraft(near, refs.guard, IDEA)).toBe(near);
  });

  it("refuses copied prose in any field, and a person named by a word of a shown play's title or author", () => {
    const prose = (field: "situation" | "title") => ({ ...draft, [field]: `Then ${copied} said nobody.` });
    expect(() => guardDraft(prose("situation"), refs.guard, IDEA)).toThrow(/copies a reference scene \(situation\)/);
    expect(() => guardDraft(prose("title"), refs.guard, IDEA)).toThrow(/title/);
    expect(() => guardDraft({ ...draft, people: [{ ...draft.people[0]!, goal: copied }, draft.people[1]!] }, refs.guard, IDEA)).toThrow(/goal/);
    const word = [...refs.guard.names][0]!;
    const named = { ...draft, people: [{ ...draft.people[0]!, lines: ["Shut it."], name: word[0]!.toUpperCase() + word.slice(1) }, draft.people[1]!] };
    expect(() => guardDraft(named, refs.guard, IDEA)).toThrow(/the name/);
    expect(guardDraft(named, refs.guard, `a play with ${word} in it`)).toBe(named);
  });
});

describe("loadSlimKbFromEnv", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "slim-"));
    resetSlimKbCache();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const env = (file?: string): NodeJS.ProcessEnv => (file === undefined ? {} : { [KB_SLIM_ENV]: file });

  it("is nothing when the variable is unset or empty, and says nothing", () => {
    const warn = vi.fn();
    expect(loadSlimKbFromEnv({ env: env(), warn })).toBeUndefined();
    expect(loadSlimKbFromEnv({ env: env("  "), warn })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("is nothing, with one warning per file, when the file is missing, not JSON, or not the format", () => {
    const warn = vi.fn();
    const missing = path.join(dir, "nope.json");
    expect(loadSlimKbFromEnv({ env: env(missing), warn })).toBeUndefined();
    expect(loadSlimKbFromEnv({ env: env(missing), warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const junk = path.join(dir, "junk.json");
    writeFileSync(junk, "{not json");
    expect(loadSlimKbFromEnv({ env: env(junk), warn })).toBeUndefined();
    const other = path.join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ format: "something-else" }));
    expect(loadSlimKbFromEnv({ env: env(other), warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("the reference KB is off");
  });

  it("reads a good file, reads it once, and reads a replaced file again", () => {
    const warn = vi.fn();
    const file = path.join(dir, "kb-slim.json");
    writeFileSync(file, JSON.stringify(slimFixture()));
    const first = loadSlimKbFromEnv({ env: env(file), warn });
    expect(first?.beats.length).toBe(slimFixture().beats.length);
    expect(loadSlimKbFromEnv({ env: env(file), warn })).toBe(first);
    const fewer = { ...slimFixture(), beats: slimFixture().beats.slice(0, 3) };
    writeFileSync(file, JSON.stringify(fewer));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(loadSlimKbFromEnv({ env: env(file), warn })?.beats).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
  });
});
