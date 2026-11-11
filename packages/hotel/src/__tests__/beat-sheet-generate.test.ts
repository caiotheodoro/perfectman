/**
 * The beat sheet's director step: one brief to one valid sheet through a model (here a fake fetch), told once what was wrong, held to the $0.30 and 25 s
 * of the contract, refusing a sheet that copies a reference scene. The mock mode is deterministic and costs nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { SHEET_COST_CAP_USD, mockBeatSheet, parseSlimKb, slimFixture } from "@perfectman/shared";
import { draftReferences } from "@perfectman/server/hotel";
import type { SlimKb } from "@perfectman/shared";
import { buildSheetPrompt, extractSheetJson, generateBeatSheet, mockSheetFor, sheetInputHashOf, sheetIsCurrent } from "../authoring/beat-sheet-generate.js";
import type { SheetBrief, SheetLink } from "../authoring/beat-sheet-generate.js";

const BRIEF: SheetBrief = {
  title: "Sobremesa na casa do falecido",
  situation: "Depois do enterro de Henrique, a viúva serve café no terraço enquanto o sócio duvida da assinatura nos papéis da firma e um parente diz que viu tudo.",
  language: "pt-BR",
  cast: [
    { id: "person-1", name: "Heloísa", goal: "Segurar a assinatura até segunda.", objective: { description: "ganhar tempo até segunda", costOfExposure: "a assinatura é falsa" } },
    { id: "person-2", name: "Otávio", goal: "Provar que a assinatura é falsa.", objective: { description: "provar a falsificação", constraint: "não pode acusar sem prova" } },
    { id: "person-3", name: "Renato", goal: "Cobrar pelo silêncio.", objective: { description: "vender o que viu" } },
  ],
  drama: "derive",
};
const LINK: SheetLink = { name: "strong", baseUrl: "https://llm.test/v1", model: "big-model", apiKey: "sk-SECRET-123", price: { inUsdPerMTok: 3, outUsdPerMTok: 15 } };
const NAMES = BRIEF.cast.map((c) => ({ id: c.id, name: c.name }));

/** What a model would write: names, not ids. */
const sheetByName = (o: Parameters<typeof mockBeatSheet>[0]["climax"] = "slap"): Record<string, unknown> => {
  const raw = JSON.parse(JSON.stringify(mockBeatSheet({ cast: NAMES, language: "pt-BR", climax: o }))) as { beats: Array<Record<string, unknown>>; generated_by?: unknown };
  delete raw.generated_by;
  const nameOf = (id: unknown): unknown => NAMES.find((n) => n.id === id)?.name ?? id;
  for (const b of raw.beats) for (const k of ["actor", "with", "from"]) if (k in b) b[k] = nameOf(b[k]);
  for (const b of raw.beats) if (Array.isArray(b["to"]) && b["kind"] === "reveal") b["to"] = (b["to"] as unknown[]).map(nameOf);
  return raw;
};

type Reply = { content: string; usage?: { prompt_tokens: number; completion_tokens: number } };
function rig(replies: Array<Reply | Response | Error>, links: SheetLink[] = [LINK], over: { kb?: SlimKb | null; deadlineMs?: number; now?: () => number } = {}) {
  const calls: Array<{ url: string; body: { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number } }> = [];
  let n = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = replies[Math.min(n++, replies.length - 1)]!;
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify({ choices: [{ message: { content: next.content } }], usage: next.usage ?? { prompt_tokens: 2400, completion_tokens: 2200 } }), { status: 200 });
  });
  const run = () => generateBeatSheet(BRIEF, { links, fetchImpl, kb: over.kb ?? null, ...(over.deadlineMs ? { deadlineMs: over.deadlineMs } : {}), ...(over.now ? { now: over.now } : {}) });
  return { calls, fetchImpl, run };
}
const good = (o?: Parameters<typeof sheetByName>[0]): Reply => ({ content: JSON.stringify(sheetByName(o)) });

describe("generateBeatSheet", () => {
  it("one call, one valid sheet: ids resolved, the origin recorded (model, cost, ms, input hash), the cap kept", async () => {
    const { run, calls } = rig([good()]);
    const r = await run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://llm.test/v1/chat/completions");
    expect(r.sheet.beats.every((b) => !("actor" in b) || (b as { actor: string }).actor.startsWith("person-"))).toBe(true);
    expect(r.sheet.generated_by).toMatchObject({ model: "big-model", attempts: 1, input_hash: sheetInputHashOf(BRIEF) });
    expect(r.cost_usd).toBeCloseTo((2400 * 3 + 2200 * 15) / 1e6, 6);
    expect(r.cost_usd).toBeLessThanOrEqual(SHEET_COST_CAP_USD);
    expect(r.attempts).toBe(1);
    expect(sheetIsCurrent(r.sheet, BRIEF)).toBe(true);
    expect(sheetIsCurrent(r.sheet, { ...BRIEF, situation: `${BRIEF.situation} Chove.` })).toBe(false);
  });

  it("accepts a reply wrapped in prose or a code fence, or under a beat_sheet key", async () => {
    const wrapped = `Claro:\n\`\`\`json\n${JSON.stringify({ beat_sheet: sheetByName() })}\n\`\`\``;
    const r = await rig([{ content: wrapped }]).run();
    expect(r.ok).toBe(true);
    expect(() => extractSheetJson("sem json")).toThrow(/no JSON/);
  });

  it("tells the model what was wrong, once, with the error list and the sheet it wrote, and takes the corrected one", async () => {
    const late = sheetByName();
    const c = (late["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!;
    c["at_ms"] = 260_000;
    (late["arc"] as Record<string, number>)["climax_at_ms"] = 260_000;
    (late["arc"] as Record<string, number>)["aftermath_until_ms"] = 300_000;
    const { run, calls } = rig([{ content: JSON.stringify(late) }, good()]);
    const r = await run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(2);
    expect(r.sheet.generated_by?.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    const retry = calls[1]!.body.messages;
    expect(retry.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retry[3]!.content).toMatch(/breaks these rules/);
    expect(retry[3]!.content).toMatch(/4:00|aftermath|climax/i);
    // both calls billed
    expect(r.cost_usd).toBeCloseTo(2 * ((2400 * 3 + 2200 * 15) / 1e6), 6);
  });

  it("fails with the reason 'invalid' after the second bad sheet, carrying the errors", async () => {
    const bad = JSON.stringify({ version: 1, premise: "x", stakes: "y", arc: {}, beats: [] });
    const { run, calls } = rig([{ content: bad }, { content: bad }]);
    const r = await run();
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, reason: "invalid", attempts: 2 });
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.detail).toMatch(/strong:/);
  });

  it("refuses a sheet that writes dialogue", async () => {
    const talky = sheetByName();
    ((talky["beats"] as Array<Record<string, unknown>>)[0]!)["text"] = "Otávio, venha sentar e tomar um café comigo.";
    const r = await rig([{ content: JSON.stringify(talky) }, { content: JSON.stringify(talky) }]).run();
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    if (!r.ok) expect(r.errors.map((e) => e.message).join(" ")).toMatch(/never writes dialogue/);
  });

  it("[cost] checks the cap before the call: a model whose worst case does not fit is never called", async () => {
    const dear: SheetLink = { ...LINK, name: "dear", price: { inUsdPerMTok: 60, outUsdPerMTok: 300 } };
    const { run, fetchImpl } = rig([good()], [dear]);
    const r = await run();
    expect(r).toMatchObject({ ok: false, reason: "cost", attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("[cost] shrinks the output allowance to what the cap leaves, and never spends past it on a retry", async () => {
    const pricey: SheetLink = { ...LINK, name: "pricey", price: { inUsdPerMTok: 5, outUsdPerMTok: 60 } };
    const { run, calls } = rig([{ content: "{}", usage: { prompt_tokens: 3000, completion_tokens: 2500 } }], [pricey]);
    const r = await run();
    // first call: 3000 in + 2500 out = 0.015 + 0.15 = 0.165 spent; the retry's prompt is larger and what is left cannot pay for a sheet
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls[0]!.body.max_tokens).toBeLessThanOrEqual(3600);
    expect(r.ok).toBe(false);
    expect(r.cost_usd).toBeLessThanOrEqual(SHEET_COST_CAP_USD + 0.2);
    if (calls.length === 2) expect(calls[1]!.body.max_tokens).toBeLessThan(calls[0]!.body.max_tokens);
  });

  it("[time] a call that times out is reason 'timeout' and the next link is tried", async () => {
    const timeout = Object.assign(new Error("deadline"), { name: "TimeoutError" });
    const second: SheetLink = { ...LINK, name: "second", model: "other-model" };
    const { run, calls } = rig([timeout, good()], [LINK, second]);
    const r = await run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model).toBe("other-model");
    expect(calls.map((c) => c.body.model)).toEqual(["big-model", "other-model"]);
    const only = await rig([timeout]).run();
    expect(only).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("[time] gives up when the deadline is gone, without calling", async () => {
    let t = 1_000;
    const { run, fetchImpl } = rig([good()], [LINK], { deadlineMs: 2_000, now: () => (t += 1_500) });
    const r = await run();
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a link that answers non-2xx hands over to the next, and no key ever reaches the detail", async () => {
    const second: SheetLink = { ...LINK, name: "second", apiKey: "sk-OTHER-456" };
    const down = new Response(JSON.stringify({ error: { message: "bad key sk-SECRET-123" } }), { status: 401 });
    const bad = await rig([down, new Response("nope sk-OTHER-456", { status: 500 })], [LINK, second]).run();
    expect(bad).toMatchObject({ ok: false, reason: "http" });
    if (!bad.ok) {
      expect(bad.detail).not.toContain("sk-SECRET-123");
      expect(bad.detail).not.toContain("sk-OTHER-456");
    }
    const okAfter = await rig([new Response("x", { status: 502 }), good()], [LINK, second]).run();
    expect(okAfter.ok).toBe(true);
  });

  it("no model with a key is reason 'no_model', without a call", async () => {
    const r = await rig([good()], []).run();
    expect(r).toMatchObject({ ok: false, reason: "no_model", attempts: 0 });
  });

  it("[invariant 7] a sheet that repeats five words of a reference scene it was shown is refused; with no KB there is no reference block", async () => {
    const parsed = parseSlimKb(slimFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const brief = { ...BRIEF, language: "en" as const, situation: "Three people argue about a lamp and a debt in a dark room after a long night, and one of them lifts the lamp." };
    const refs = draftReferences(parsed.kb, brief.situation, 3, "en");
    expect(refs).toBeDefined();
    // a line of the first reference scene, as the prompt shows it
    const line = refs!.block.split("\n").find((l) => /^\| [A-Z]: /.test(l))!.replace(/^\| [A-Z]: /, "");
    expect(line.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    const copied = sheetByName();
    ((copied["beats"] as Array<Record<string, unknown>>)[1]!)["gist"] = line;
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_u, init) => {
      calls.push(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(copied) } }], usage: { prompt_tokens: 2000, completion_tokens: 1800 } }), { status: 200 });
    });
    const r = await generateBeatSheet(brief, { links: [LINK], fetchImpl, kb: parsed.kb });
    expect(calls[0]).toContain("Reference scenes");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.message).join(" ")).toMatch(/beat_sheet.copy/);
    expect(buildSheetPrompt(brief).user).not.toContain("Reference scenes");
  });
});

describe("generateBeatSheet: the mock", () => {
  it("is deterministic, free and valid, and its climax follows the story and what the scene allows", async () => {
    const a = await generateBeatSheet(BRIEF, { links: [], mock: true });
    const b = await generateBeatSheet(BRIEF, { links: [], mock: true });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.sheet)).toBe(JSON.stringify(b.sheet));
    expect(a.cost_usd).toBe(0);
    expect(a.sheet.generated_by).toMatchObject({ model: "mock", mock: true, input_hash: sheetInputHashOf(BRIEF) });
    expect(mockSheetFor({ ...BRIEF, situation: "Eles se beijam no fim." }).beats.find((x) => x.kind === "act" && x.climax)).toMatchObject({ verb: "kiss" });
    // a scene capped under the slap gets a shove at the peak
    const low = { ...BRIEF, drama: { max_rung: 3, may_target: [], may_die: [], permadeath: false } };
    const c = await generateBeatSheet(low, { links: [], mock: true });
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.sheet.beats.find((x) => x.kind === "act" && x.climax)).toMatchObject({ verb: "shove" });
  });
});

describe("buildSheetPrompt", () => {
  const p = buildSheetPrompt(BRIEF, "Reference scenes (x): 1. A play");

  it("carries the situation, every person with what they want and fear, the contract's hard numbers and the no-dialogue rule", () => {
    expect(p.user).toContain("Sobremesa na casa do falecido");
    for (const c of BRIEF.cast) expect(p.user).toContain(c.name);
    expect(p.user).toContain("a assinatura é falsa");
    expect(p.user).toContain("240000");
    expect(p.user).toContain("90000");
    expect(p.user).toMatch(/NO DIALOGUE/);
    expect(p.user).toContain("Brazilian Portuguese");
    expect(p.user).toContain("Reference scenes (x)");
    expect(p.system).toMatch(/JSON/);
  });

  it("says what the scene allows when it wrote a block, and a room it knows", () => {
    const withBlock = buildSheetPrompt({ ...BRIEF, drama: { max_rung: 4, may_target: [["person-1", "person-2"]], may_die: [] , permadeath: false }, room: { furni: [{ label: "mesa" }, { label: "cofre" }], zones: [{ label: "varanda" }] } });
    expect(withBlock.user).toContain("up to rung 4");
    expect(withBlock.user).toContain("person-1 to person-2");
    expect(withBlock.user).toContain("nobody (no kill, no die)");
    expect(withBlock.user).toContain("mesa, cofre");
    expect(withBlock.user).toContain("varanda");
  });

  it("is not unbounded: the prompt stays near 2.5k tokens for a six-person cast", () => {
    const big = { ...BRIEF, cast: Array.from({ length: 6 }, (_, i) => ({ id: `person-${i + 1}`, name: `Pessoa ${i + 1}`, goal: "x".repeat(200), objective: { description: "y".repeat(200), costOfExposure: "z".repeat(200) } })) };
    const q = buildSheetPrompt(big, "r".repeat(1500));
    expect((q.system.length + q.user.length) / 3.2).toBeLessThan(4000);
  });
});
