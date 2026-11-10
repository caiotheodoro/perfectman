import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/** scripts/run-metrics.mjs shares no code with the packages: it is loaded by path, and every figure below is worked out by hand from the invented lines. */
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scripts", "run-metrics.mjs");
const tool = (await import(pathToFileURL(script).href)) as {
  computeMetrics: (turns: Array<{ speaker: string; text: string; t?: number }>, opts?: { actors?: string[]; events?: unknown }) => Record<string, any>;
  loadInput: (input: string, actors?: string[]) => { turns: Array<{ speaker: string; text: string; t?: number }>; source: string; events?: Record<string, any> };
  isFiller: (text: string) => boolean;
  quantile: (values: number[], q: number) => number;
};

const words = (n: number, tag = "x"): string => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const turn = (speaker: string, text: string, t?: number) => ({ speaker, text, ...(t !== undefined ? { t } : {}) });

describe("run-metrics: words per turn", () => {
  it("gives the median, p75, p90 and the shares over 25 and 40 words, nearest rank", () => {
    const lens = [2, 4, 6, 8, 10, 12, 14, 30, 45, 50];
    const m = tool.computeMetrics(lens.map((n, i) => turn(i % 2 ? "ana" : "bia", `${words(n)}.`, i)));
    expect(m["words"]).toEqual({ median: 12, p75: 30, p90: 50, mean: 18.1, over25: 0.3, over40: 0.2 });
    expect(m["turns"]).toBe(10);
  });

  it("does not count stage directions or laughter as words", () => {
    const m = tool.computeMetrics([turn("ana", "*sorri* Sim, claro [sai] KKKKK (rindo)")]);
    expect(m["words"].median).toBe(2);
  });

  it("keeps only the actors asked for, without case", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pm-runmetrics-"));
    const file = path.join(dir, "t.jsonl");
    const rows = [
      { t: 1, name: "Ana", kind: "say", text: "Oi, gente." },
      { t: 2, name: "Jogador", kind: "say", text: "Eae" },
      { t: 3, name: "Bia", kind: "join", text: "" },
      { t: 4, name: "bia", kind: "say", text: "Chegou tarde." },
    ];
    writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    expect(tool.loadInput(file).turns.map((t) => t.speaker)).toEqual(["Ana", "Jogador", "bia"]);
    expect(tool.loadInput(file, ["ANA", "Bia"]).turns).toEqual([
      { speaker: "Ana", text: "Oi, gente.", t: 1 },
      { speaker: "bia", text: "Chegou tarde.", t: 4 },
    ]);
  });
});

describe("run-metrics: fillers", () => {
  it("are lines of at most 3 interjections, laughter alone included", () => {
    for (const t of ["Ué.", "Hm.", "Tá, tá.", "Ah.", "Sei.", "KKKK", "Ok", "Huh?", "É."]) expect(tool.isFiller(t), t).toBe(true);
    for (const t of ["Tá bom.", "Sei lá o que fazer", "Ué, e agora?", "", "[sai]"]) expect(tool.isFiller(t), t).toBe(false);
  });

  it("are counted with their share, and left out of the content figures", () => {
    const m = tool.computeMetrics([turn("a", `${words(20)}.`, 0), turn("b", "Ué.", 5), turn("a", `${words(24, "y")}.`, 10), turn("b", "Hm.", 15), turn("a", "Ué.", 20)]);
    expect(m["fillers"]).toEqual({ count: 3, share: 0.6, forms: { "Ué.": 2, "Hm.": 1 } });
    expect(m["contentTurns"]).toBe(2);
    // Over all five turns the median is a filler's one word; without them it is 24 (nearest rank over 20 and 24).
    expect(m["words"].median).toBe(1);
    expect(m["wordsContent"].median).toBe(24);
  });
});

describe("run-metrics: novelty against the 6 turns before", () => {
  const long = (a: string) => `${a} lanterna vermelha pendurada escada velha balançava devagar madrugada fria sempre`;

  it("is the share of a turn's 4+ letter words that none of the 6 before used, judged from 7 such words", () => {
    const fresh = tool.computeMetrics([
      turn("a", "Cavalo branco atravessou rio largo depois ponte antiga quebrada"),
      turn("b", "Lanterna vermelha pendurada escada velha balançava devagar madrugada fria"),
    ]);
    expect(fresh["novelty"].mean).toBe(1);
    expect(fresh["novelty"].judgedTurns).toBe(1);
    const echo = tool.computeMetrics([turn("a", long("Ontem")), turn("b", long("Hoje"))]);
    // 11 words of 4+ letters each, only "ontem"/"hoje" differ: 1 of 11 is new.
    expect(echo["novelty"].judgedMean).toBe(0.091);
  });

  it("forgets a turn that is more than 6 turns back, and lets fillers pass without using up a slot", () => {
    const filler = (i: number) => turn("b", "Hm.", i);
    const gap = Array.from({ length: 7 }, (_, i) => filler(i + 1));
    const m = tool.computeMetrics([turn("a", long("Ontem"), 0), ...gap, turn("b", long("Hoje"), 9)]);
    // The 7 fillers are not turns of the look-back, so the first line is still the previous one.
    expect(m["novelty"].judgedMean).toBe(0.091);
    // With 7 content turns between them the first line is out of the look-back: all 11 words of the last one are new.
    const content = Array.from({ length: 7 }, (_, i) => turn("b", `Assunto totalmente diferente ${words(7, `w${i}`)}`, i + 1));
    const far = tool.computeMetrics([turn("a", long("Ontem"), 0), ...content, turn("b", long("Hoje"), 9)]);
    expect(far["novelty"].judgedTurns).toBe(1);
    expect(far["novelty"].judgedMean).toBe(1);
  });
});

describe("run-metrics: demand loops", () => {
  it("flags one actor making the same demand 3 times inside 90 s, and not 100 s apart or by three different actors", () => {
    const ask = (who: string, t: number, tail: string) => turn(who, `Heloísa, cofre hoje ${tail}, senão eu conto tudo pra mesa.`, t);
    const loop = tool.computeMetrics([ask("renato", 0, "agora"), turn("otavio", "Outra conversa completamente diferente.", 20), ask("renato", 40, "mesmo"), ask("renato", 80, "já")]);
    expect(loop["demandLoops"]).toHaveLength(1);
    expect(loop["demandLoops"][0]).toMatchObject({ speaker: "renato", turns: 3, from: 0, to: 80 });
    const slow = tool.computeMetrics([ask("renato", 0, "agora"), ask("renato", 100, "mesmo"), ask("renato", 200, "já")]);
    expect(slow["demandLoops"]).toEqual([]);
    const three = tool.computeMetrics([ask("ana", 0, "agora"), ask("bia", 10, "agora"), ask("caio", 20, "agora")]);
    expect(three["demandLoops"]).toEqual([]);
  });
});

describe("run-metrics: single-word tics", () => {
  const lines = (word: string, n: number) =>
    Array.from({ length: n }, (_, i) => [turn("otavio", `Aquilo ${["ficou", "parou", "passou", "voltou", "sumiu", "achou", "pediu", "tentou"][i % 8]} ${["quieto", "cansado", "molhado", "trancado", "vazio", "partido", "escuro", "sozinho"][i % 8]}, ${word}.`, i * 10), turn("bia", `Assunto diferente numero ${i} sobre ${["jardim", "sapato", "motor", "festa", "livro", "mapa", "corda", "tinta"][i % 8]}.`, i * 10 + 5)]).flat();

  it("ranks each actor's 5 most used words by turns, and flags a word in 5 or more turns inside the window", () => {
    const m = tool.computeMetrics(lines("rapaz", 6));
    expect(m["topWords"]["otavio"][0]).toEqual({ word: "rapaz", turns: 6, share: 1 });
    expect(m["topWords"]["otavio"]).toHaveLength(5);
    expect(m["tics"]).toContainEqual({ speaker: "otavio", word: "rapaz", turns: 6 });
  });

  it("does not flag 4 uses, a form of address, or a name", () => {
    expect(tool.computeMetrics(lines("rapaz", 4))["tics"].filter((t: { word: string }) => t.word === "rapaz")).toEqual([]);
    expect(tool.computeMetrics(lines("senhor", 8))["tics"].filter((t: { word: string }) => t.word === "senhor")).toEqual([]);
    expect(tool.computeMetrics(lines("Elvsted", 8))["tics"].filter((t: { word: string }) => t.word === "elvsted")).toEqual([]);
  });
});

describe("run-metrics: an events.jsonl and the command line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-runmetrics-ev-"));
  const events = [
    { type: "simulation_started", actorId: "system", createdAt: 1_000_000 },
    { type: "message_sent", actorId: "ana", createdAt: 1_005_000, payload: { content: "Oi, gente, cheguei cedo hoje.", senderName: "Ana" } },
    { type: "no_op_recorded", actorId: "bia", createdAt: 1_006_000, payload: {} },
    { type: "body_arrived", actorId: "bia", createdAt: 1_007_000, payload: {} },
    { type: "message_sent", actorId: "host", createdAt: 1_008_000, payload: { content: "steer" } },
    { type: "reply_sent", actorId: "bia", createdAt: 1_020_000, payload: { content: "Chegou tarde, como sempre.", senderName: "Bia" } },
    { type: "body_action_committed", actorId: "ana", createdAt: 1_030_000, payload: { commands: ["pair"] } },
    { type: "body_action_committed", actorId: "ana", createdAt: 1_031_000, payload: { commands: ["walk", "gesture"] } },
    { type: "no_op_recorded", actorId: "bia", createdAt: 1_040_000, payload: {} },
    { type: "body_action_committed", actorId: "bia", createdAt: 1_050_000, payload: { commands: ["act"] } },
  ];
  writeFileSync(path.join(dir, "events.jsonl"), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);

  it("counts acts and the first act's time, body moves, and no-ops per message, leaving the host out", () => {
    const loaded = tool.loadInput(dir);
    expect(loaded.turns.map((t) => [t.speaker, t.t])).toEqual([["Ana", 5], ["Bia", 20]]);
    const m = tool.computeMetrics(loaded.turns, { events: loaded.events });
    expect(m["events"]).toEqual({ acts: 2, firstActAt: 30, bodyMoves: 2, noOps: 2, messages: 2, noOpPerMessage: 1 });
  });

  it("prints the same as JSON from the command line, and exits 2 with no input", () => {
    const out = JSON.parse(execFileSync("node", [script, dir, "--json"], { encoding: "utf8" })) as Record<string, any>;
    expect(out["turns"]).toBe(2);
    expect(out["events"].acts).toBe(2);
    expect(out["source"]).toMatch(/^events /);
    const text = execFileSync("node", [script, path.join(dir, "events.jsonl"), "--actors", "Ana"], { encoding: "utf8" });
    expect(text).toMatch(/1 turns/);
    expect(() => execFileSync("node", [script], { stdio: "pipe" })).toThrow(/usage|status 2/);
  });
});
