import { describe, expect, it } from "vitest";
import { roomNames } from "@perfectman/shared";
import { findOwnEcho, findPhraseLoop, findTics, type EchoKind } from "../echo-guard.js";
import { isNearRepeat } from "../repetition-guard.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";
import { PERSONA_EXAMPLES } from "./fixtures/persona-examples.js";
import { RUN62, RUN62_NAMES } from "./fixtures/run62-lines.js";

/**
 * Short lines. A median hotel turn is 13 words under a cap of 22, and the echo checks were made for lines of 40: a 6-word shared opening, a 6-word run over 60% of the
 * shorter line, 60% of the trigrams, nothing under 5 words. These tests are the ordinary lines that must not be caught (the repo's 128 pt-BR lines and the personas' style examples), and a replay of the whole of run 62 through the new checks.
 */

const NAMES = roomNames(RUN62_NAMES);
const own = (name: string, upTo: number): string[] => RUN62.filter((l) => l.name === name && l.t < upTo).map((l) => l.text);

describe("no ordinary line is flagged", () => {
  const flagged = (lines: readonly string[]): string[] => {
    const out: string[] = [];
    for (const [i, line] of lines.entries()) {
      for (const [j, other] of lines.entries()) {
        if (i === j) continue;
        const hit = findOwnEcho(line, [other]);
        if (hit) out.push(`${hit.kind}: ${line} <-> ${other}`);
      }
    }
    return out;
  };

  /** Every window of 8 own lines (in the order they are written and in rotations of it): an echo, a tic or a phrase loop on the next one. */
  const windows = (lines: readonly string[]): { turns: number; hits: string[] } => {
    const hits: string[] = [];
    let turns = 0;
    for (let shift = 0; shift < lines.length; shift += 7) {
      const rotated = [...lines.slice(shift), ...lines.slice(0, shift)];
      for (let i = 8; i < rotated.length; i++) {
        turns++;
        const prior = rotated.slice(i - 8, i);
        const echo = findOwnEcho(rotated[i]!, prior);
        if (echo) hits.push(`echo ${echo.kind}: ${rotated[i]}`);
        if (findTics(rotated[i]!, prior).length > 0) hits.push(`tic: ${rotated[i]}`);
        if (findPhraseLoop(rotated[i]!, prior.slice(-4))) hits.push(`loop: ${rotated[i]}`);
      }
    }
    return { turns, hits };
  };

  it("the repo's 128 ordinary pt-BR lines: no pair of them, and no window of them", () => {
    expect(NORMAL).toHaveLength(128);
    expect(flagged(NORMAL)).toEqual([]);
    const w = windows(NORMAL);
    expect(w.turns).toBeGreaterThan(2000);
    expect(w.hits).toEqual([]);
  });

  it("the personas' 133 hand-written style examples: none echoes another of its own persona, none is a window hit", () => {
    expect(PERSONA_EXAMPLES).toHaveLength(133);
    const byPersona = new Map<string, string[]>();
    for (const e of PERSONA_EXAMPLES) byPersona.set(`${e.cast}/${e.persona}`, [...(byPersona.get(`${e.cast}/${e.persona}`) ?? []), e.text]);
    expect(byPersona.size).toBe(25);
    const own = [...byPersona.values()].flatMap((lines) => flagged(lines));
    expect(own).toEqual([]);
    const all = PERSONA_EXAMPLES.map((e) => e.text);
    const w = windows([...new Set(all)]);
    expect(w.turns).toBeGreaterThan(1500);
    expect(w.hits).toEqual([]);
  });

  it("across personas the only pairs are two authors' near-identical lines, which are two actors and not one repeating itself", () => {
    // The caio and the iris personas each wrote "this deserves a proper lunch ..."; two casts wrote "i'm fine!! (not fine, ... tell you later)" with a different aside.
    const distinct = [...new Set(PERSONA_EXAMPLES.map((e) => e.text))];
    const pairs = flagged(distinct);
    expect(pairs).toHaveLength(4);
    expect(pairs.every((p) => p.includes("this deserves a proper lunch") || p.includes("i'm fine!!"))).toBe(true);
  });
});

describe("the whole of run 62, line by line, as candidates", () => {
  type Row = { name: string; kind: string; t: number; text: string; echo?: EchoKind; old: boolean; tics: string[] };

  const replay = (): Row[] => {
    const history = new Map<string, string[]>();
    return RUN62.map((l) => {
      const prior = history.get(l.name) ?? [];
      history.set(l.name, [...prior, l.text]);
      const echo = findOwnEcho(l.text, prior, 8, NAMES);
      const oldEcho = findOwnEcho(l.text, prior, 8, NAMES, false);
      const old = oldEcho !== undefined || isNearRepeat(l.text, prior.slice(-12)) || findPhraseLoop(l.text, prior) !== undefined;
      return { ...l, ...(echo ? { echo: echo.kind } : {}), old, tics: findTics(l.text, prior, NAMES).map((t) => `${t.kind}:${t.term}`) };
    });
  };

  it("the lines the deployed guard let through are flagged by the new checks, most of them by a tic", () => {
    const rows = replay();
    expect(rows).toHaveLength(207);
    // Every line here was committed, so the old checks flagged (almost) none of them.
    expect(rows.filter((r) => r.old)).toHaveLength(1);
    const echoes = rows.filter((r) => r.echo);
    const tics = rows.filter((r) => r.tics.length > 0);
    const any = rows.filter((r) => r.echo || r.tics.length > 0 || r.old);
    expect(echoes.length).toBe(19);
    expect(tics.length).toBe(125);
    expect(any.length).toBe(129);
    const byRule = (kind: EchoKind): number => echoes.filter((r) => r.echo === kind).length;
    expect({ lead: byRule("lead"), open: byRule("open"), set: byRule("set"), frame: byRule("frame"), exact: byRule("exact") }).toEqual({ lead: 15, open: 2, set: 1, frame: 1, exact: 0 });
    const ticKinds = (prefix: string): number => tics.filter((r) => r.tics.some((t) => t.startsWith(prefix))).length;
    expect({ address: ticKinds("address"), tag: ticKinds("tag"), opener: ticKinds("opener") }).toEqual({ address: 123, tag: 3, opener: 1 });
  });

  it("the three lines the brief names are among them: Heloísa 27 s, Otávio 189 s and 255 s", () => {
    const rows = replay();
    const flaggedAt = (name: string, t: number): Row => rows.find((r) => r.name === name && r.t === t)!;
    expect(flaggedAt("Heloísa", 27).echo).toBe("lead");
    expect(flaggedAt("Otávio", 189).echo).toBe("open");
    expect(flaggedAt("Otávio", 255).echo).toBe("frame");
  });

  it("'Rapaz' opens Otávio's lines in the replay from the 4th turn on, 'querido' Heloísa's, 'mana' Renato's", () => {
    const rows = replay();
    const firstTic = (name: string, term: string): number => rows.find((r) => r.name === name && r.tics.includes(`address:${term}`))!.t;
    expect(firstTic("Otávio", "rapaz")).toBe(304);
    expect(firstTic("Heloísa", "querido")).toBe(106);
    expect(firstTic("Renato", "mana")).toBe(673);
    expect(rows.filter((r) => r.name === "Otávio" && r.tics.includes("address:rapaz")).length).toBeGreaterThanOrEqual(22);
  });

  it("the lines said in the room (63 of the 207, the earlier part of the run) are flagged at 37%, the whispers at 74%", () => {
    const say = replay().filter((r) => r.kind === "say");
    expect(say).toHaveLength(63);
    const flagged = say.filter((r) => r.echo || r.tics.length > 0 || r.old);
    expect(flagged.length).toBe(23);
    expect(say.filter((r) => r.echo)).toHaveLength(6);
  });

  it("a line before its actor's history has any weight is never a tic or a short-line echo", () => {
    expect(own("Renato", 40)).toHaveLength(1);
    const first = RUN62.find((l) => l.name === "Renato")!;
    expect(findOwnEcho(first.text, [], 8, NAMES)).toBeUndefined();
    expect(findTics(first.text, [], NAMES)).toEqual([]);
  });
});
