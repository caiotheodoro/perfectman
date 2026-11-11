import { describe, expect, it } from "vitest";
import { roomNames } from "@perfectman/shared";
import { findOwnEcho, findPhraseLoop, findTics, stripTics, strikeEcho, voiceOf, type EchoKind } from "../echo-guard.js";
import { isNearRepeat } from "../repetition-guard.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";
import { PERSONA_EXAMPLES } from "./fixtures/persona-examples.js";
import { RUN62, RUN62_NAMES } from "./fixtures/run62-lines.js";

/**
 * Short lines. A median hotel turn is 13 words under a cap of 22, and the echo checks were made for lines of 40: a 6-word shared opening, a 6-word run over 60% of the
 * shorter line, 60% of the trigrams, nothing under 5 words. These tests are the lines that got through that in production run 62 (45 minutes, three bot actors), the
 * ordinary lines that must not be caught, and a replay of the whole run through the new checks.
 */

const NAMES = roomNames(RUN62_NAMES);
const own = (name: string, upTo: number): string[] => RUN62.filter((l) => l.name === name && l.t < upTo).map((l) => l.text);
const at = (name: string, t: number): string => RUN62.find((l) => l.name === name && l.t === t)!.text;

describe("what a short line says, without the address", () => {
  it("takes names and forms of address off the ends of every clause", () => {
    const v = voiceOf("Otávio, meu bem, sente-se. Aceita um cafezinho?", NAMES);
    expect(v.keys).toEqual(["sente", "se", "aceita", "um", "cafezinho"]);
    expect(v.leadTerms).toEqual(["meu bem"]);
    expect(v.trailTerms).toEqual([]);
    const w = voiceOf("Mas o que ele viu, minha cara, você não desmente, rapaz.", NAMES);
    expect(w.keys).toEqual(["mas", "o", "que", "ele", "viu", "voce", "nao", "desmente"]);
    expect(w.trailTerms).toEqual(["rapaz"]);
    expect(w.leadTerms).toEqual([]);
  });

  it("reads a form of address in the middle as address, not as a way the line starts or ends", () => {
    const v = voiceOf("Vinho não, minha cara. O rapaz ali já falou o que precisava.", NAMES);
    expect(v.keys.slice(0, 3)).toEqual(["vinho", "nao", "o"]);
    expect(v.leadTerms).toEqual([]);
    expect(v.trailTerms).toEqual([]);
  });

  it("keeps a word that names something even when it is also a form of address elsewhere: 'o rapaz ali' is a person", () => {
    expect(voiceOf("O rapaz ali já falou.", NAMES).topics).toContain("rapaz");
  });

  it("finds the tag question that ends a line", () => {
    expect(voiceOf("A caneta fica comigo, não fica?", NAMES).tag).toBe(true);
    expect(voiceOf("A gente resolve isso no particular, né?", NAMES).tag).toBe(true);
    expect(voiceOf("Quer repetir isso amanhã, no cartório, com a boca limpa?", NAMES).tag).toBe(false);
    expect(voiceOf("Não pode.", NAMES).tag).toBe(false);
  });

  it("a line that is only address has nothing in it", () => {
    expect(voiceOf("Rapaz.", NAMES).keys).toEqual([]);
    expect(voiceOf("Otávio, querido,", NAMES).keys).toEqual([]);
  });
});

describe("the lines of run 62 that got through, as candidates", () => {
  const H22 = at("Heloísa", 22);
  const H27 = at("Heloísa", 27);

  it("Heloísa 22 s then 27 s: the same 'Otávio, meu bem, sente-se.' opens an 11-word and a 7-word line", () => {
    // The sequence rules (a 6-word shared opening, run or trigram share) and the set rule (0.7) of before all miss it.
    expect(findOwnEcho(H27, [H22], 8, NAMES, false)).toBeUndefined();
    expect(isNearRepeat(H27, [H22])).toBe(false);
    expect(findOwnEcho(H27, [H22], 8, NAMES)).toMatchObject({ kind: "lead", prior: H22 });
    // The names are the room's: without them the same pair is caught by its 3 opening words and the topic words they share.
    expect(findOwnEcho(H27, [H22])).toMatchObject({ kind: "open" });
  });

  it("Otávio 'Bêbado, sim. Mas viu o que você escondeu' then 'Bêbado, sim. Mas o que ele viu, minha cara': the same 3 opening words and 2 of 3 topic words", () => {
    const first = at("Otávio", 177);
    const second = at("Otávio", 189);
    expect(findOwnEcho(second, [first], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(second, [first], 8, NAMES)).toMatchObject({ kind: "open", prior: first });
  });

  it("Otávio 'Vinho não' three times: no pair of them is an echo, the third is a shared opening frame", () => {
    const [v0, v1, v2] = [at("Otávio", 215), at("Otávio", 233), at("Otávio", 255)];
    expect(findOwnEcho(v1, [v0], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho(v2, [v1], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho(v2, [v0, v1], 8, NAMES)).toMatchObject({ kind: "frame" });
    // "Mas vinho não" opens like "Vinho não": a leading connector is skipped.
    expect(findOwnEcho("Vinho não, minha cara. Já falei.", [v0, "Fale com ela agora, antes da meia-noite.", v1, "Papel é papel, rapaz."], 8, NAMES)).toMatchObject({ kind: "frame" });
  });

  it("Renato 'Cofre nunca fechou pra mim', 'Pudim não, mano. Quero o cofre aberto', 'Cofre aberto, é? Então abre, pô': the third says what the second said", () => {
    const a = "Cofre nunca fechou pra mim, é? Então abre agora, na frente do Otávio.";
    const b = "Pudim não, mano. Quero o cofre aberto agora, na minha frente.";
    const c = "Cofre aberto, é? Então abre, pô. Hoje. Sem pudim na frente.";
    expect(findOwnEcho(c, [a, b], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(c, [a, b], 8, NAMES)).toMatchObject({ kind: "set", prior: b });
    // The first two share one word that names something besides the object: that is a scene about a safe, not an echo.
    expect(findOwnEcho(b, [a], 8, NAMES)).toBeUndefined();
  });

  it("a line with the same words in another order is an echo", () => {
    const a = "O recibo dobrado sumiu do bolso do Caco depois do jantar no bar.";
    const b = "Depois do jantar no bar, o Caco perdeu o recibo dobrado do bolso.";
    expect(findOwnEcho(b, [a], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(b, [a], 8, NAMES)).toMatchObject({ kind: "set", prior: a });
  });

  it("the address is not the point: 'Vinho não, minha cara.' says what 'Vinho não.' says", () => {
    expect(findOwnEcho("Vinho não, minha cara.", ["Vinho não."], 8, NAMES)).toMatchObject({ kind: "exact" });
  });

  it("a line of fewer than 3 topic words is never an echo of anything but an exact copy", () => {
    expect(findOwnEcho("Sim, claro, com certeza.", ["Sim, claro."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Verdade, cara.", ["Verdade, cara."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Não pode, minha cara.", ["Não pode, minha cara. A sobremesa sou eu que sirvo."], 8, NAMES)).toBeUndefined();
  });

  it("two ordinary replies to the same person are not an echo of each other", () => {
    expect(findOwnEcho("Renato, querido, o cofre abre amanhã às nove.", ["Renato, querido, onde você estava ontem à noite?"], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Calma, Beatriz. Sente-se.", ["Calma, Beatriz. Eu explico o que posso."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Eu acho que você tem razão, mas só em parte do que disse ontem.", ["Eu acho que você tem medo de perder tudo isso."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Otávio, meu bem, a carta pode esperar a sobremesa.", [H22], 8, NAMES)).toBeUndefined();
  });

  it("the old thresholds are untouched for a long line", () => {
    const long = "Eu te digo uma coisa que ninguém nesta casa quer ouvir, e é que o testamento não foi escrito por quem a senhora pensa que escreveu.";
    expect(findOwnEcho(long, [long], 8, NAMES, false)).toMatchObject({ kind: "exact" });
    expect(findOwnEcho(`${long} Pergunte ao notário.`, [long], 8, NAMES, false)).toMatchObject({ kind: "prefix" });
  });
});

describe("tics: a form of address or an opening word in 4 of the actor's last 6 turns", () => {
  const rapaz = (i: number): string => `Rapaz, a coisa número ${["um", "dois", "três", "quatro", "cinco"][i]} é essa aqui.`;

  it("Otávio's 'Rapaz' is a tic from its fourth use in six turns, and not before", () => {
    const priors = [rapaz(0), "Não.", rapaz(1), "Ela mentiu para todos nós.", rapaz(2)];
    expect(findTics("Rapaz, sua parte sai do bolso dela e eu sei qual é.", priors.slice(0, 3), NAMES)).toEqual([]);
    expect(findTics("Rapaz, sua parte sai do bolso dela e eu sei qual é.", priors, NAMES)).toEqual([{ kind: "address", term: "rapaz", count: 4 }]);
    // A line that already dropped it is clean.
    expect(findTics("Sua parte sai do bolso dela e eu sei qual é.", priors, NAMES)).toEqual([]);
  });

  it("counts the form of address at either end, and the pair 'minha cara' as one", () => {
    const priors = ["Vinho não, minha cara.", "Assinatura eu não dou, minha cara.", "Segunda às oito é tarde demais, minha cara.", "Fecha com ele agora mesmo."];
    expect(findTics("Fecha comigo antes da meia-noite, minha cara.", priors, NAMES)).toEqual([{ kind: "address", term: "minha cara", count: 4 }]);
  });

  it("a name is address, not a tic", () => {
    const priors = Array.from({ length: 5 }, (_, i) => `Otávio, ${["a carta", "o vinho", "a firma", "o cofre", "a pasta"][i]} está aqui na mesa.`);
    expect(findTics("Otávio, a chave está no vaso da sala.", priors, NAMES)).toEqual([]);
  });

  it("an opening word that names something, 4 of 6 times, is a tic that cannot be stripped", () => {
    const priors = ["Bêbado não erra assinatura. Erra quem forjou.", "Bêbado vê o que sóbrio não quer ver.", "Rapaz, repete o que você disse.", "Bêbado, sim. Mas viu o que escondeu."];
    expect(findTics("Bêbado, sim. Mas o que ele viu, minha cara, você não desmente.", priors, NAMES)).toEqual([{ kind: "opener", term: "bebado", count: 4 }]);
  });

  it("a tag question ending 4 of 6 turns is a tic", () => {
    const priors = ["Querido, o café esfria, não esfria?", "A carta pode esperar, não pode?", "Você bebeu desde o almoço.", "Eu falei com ele ontem, não falei?"];
    expect(findTics("Eu guardei a chave, não guardei?", priors, NAMES)).toEqual([{ kind: "tag", term: "tag", count: 4 }]);
  });

  it("nothing is flagged on a line of fewer than 3 words", () => {
    expect(findTics("Rapaz.", [rapaz(0), rapaz(1), rapaz(2), rapaz(3), rapaz(4)], NAMES)).toEqual([]);
  });
});

describe("taking a tic off a line", () => {
  const address = (term: string) => [{ kind: "address" as const, term, count: 5 }];

  it("takes the form of address off the start and the end, and keeps names and everything else", () => {
    expect(stripTics("Rapaz, ela escondeu o caixa e você vai levar a culpa junto.", address("rapaz"), NAMES)).toBe("Ela escondeu o caixa e você vai levar a culpa junto.");
    expect(stripTics("Rapaz. Antes do cofre, senta aqui e me escuta.", address("rapaz"), NAMES)).toBe("Antes do cofre, senta aqui e me escuta.");
    expect(stripTics("Otávio, querido, a firma fecha às seis. Ninguém assina nada depois.", address("querido"), NAMES)).toBe("Otávio, a firma fecha às seis. Ninguém assina nada depois.");
    expect(stripTics("Ela trancou a chave. Senta, ela conta o caixa, ou eu conto do dedo, rapaz!", address("rapaz"), NAMES)).toBe("Ela trancou a chave. Senta, ela conta o caixa, ou eu conto do dedo!");
    expect(stripTics("Mana, ele tá de caneta na mão! Cinquenta e eu pego ela pra você, agora.", address("mana"), NAMES)).toBe("Ele tá de caneta na mão! Cinquenta e eu pego ela pra você, agora.");
  });

  it("takes only the tic: another form of address stays", () => {
    expect(stripTics("Rapaz, minha cara, a conta não fecha.", address("rapaz"), NAMES)).toBe("Minha cara, a conta não fecha.");
  });

  it("leaves a vocative in the middle of the line, which is a way to talk and not a way to open or close", () => {
    expect(stripTics("Mas o que ele viu, minha cara, você não desmente, rapaz.", address("rapaz"), NAMES)).toBe("Mas o que ele viu, minha cara, você não desmente.");
  });

  it("takes off a tag question and ends the line as a statement", () => {
    expect(stripTics("Mas a caneta fica comigo, não fica?", [{ kind: "tag", term: "tag", count: 4 }], NAMES)).toBe("Mas a caneta fica comigo.");
  });

  it("does nothing when fewer than 3 words would be left, when a quote or a bracket is in the line, or when the tic is not on it", () => {
    expect(stripTics("Rapaz, vem cá.", address("rapaz"), NAMES)).toBeUndefined();
    expect(stripTics('Rapaz, ela disse "vem cá, mano" ontem à noite.', address("rapaz"), NAMES)).toBeUndefined();
    expect(stripTics("Sua parte sai do bolso dela.", address("rapaz"), NAMES)).toBeUndefined();
  });
});

describe("repairing a repeat instead of dropping it", () => {
  const priors = [at("Otávio", 177), at("Otávio", 189)];

  it("keeps what is new in a line whose first clause repeats", () => {
    const text = "Bêbado, sim. Mas viu o que você escondeu, minha cara. Eu guardo o recibo da firma no cartório de segunda.";
    expect(strikeEcho(text, priors, NAMES)).toBe("Eu guardo o recibo da firma no cartório de segunda.");
  });

  it("takes the vocative that was left before a struck sentence with it", () => {
    const heloisa = [at("Heloísa", 22)];
    const text = "Otávio, meu bem, sente-se. Um café antes de qualquer palavra? A firma fecha às seis e ninguém assina nada depois.";
    expect(strikeEcho(text, heloisa, NAMES)).toBe("A firma fecha às seis e ninguém assina nada depois.");
  });

  it("says nothing was left when fewer than 4 words are new: Heloísa's 27 s line", () => {
    expect(strikeEcho(at("Heloísa", 27), [at("Heloísa", 22)], NAMES)).toBeUndefined();
  });

  it("says nothing was left when every clause repeats: Otávio's 189 s line", () => {
    expect(strikeEcho(at("Otávio", 189), [at("Otávio", 177), at("Otávio", 158), at("Otávio", 147)], NAMES)).toBeUndefined();
  });

  it("never counts the scene's own topic word as already said", () => {
    const cofre = ["O cofre está aberto, mas a chave sumiu da sala.", "Ninguém toca no cofre antes da meia-noite."];
    const text = "O cofre vale mais que a firma inteira, Heloísa, e o notário já sabe disso.";
    expect(strikeEcho(text, cofre, NAMES)).toBeUndefined();
    expect(strikeEcho("O cofre está aberto, mas a chave sumiu da sala. Eu vi o recibo dobrado no bolso do Caco.", cofre, NAMES, new Set(["cofre"]))).toBe("Eu vi o recibo dobrado no bolso do Caco.");
  });
});

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
