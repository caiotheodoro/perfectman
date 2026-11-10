import type { CorpusBeat, CorpusTag } from "./build-norms.js";

/**
 * An invented corpus for tests: beats in the shape of the KB's `beats.jsonl`, written by a seeded generator from small word banks. Every
 * line is made up here; no third-party text is committed. It has no meaning beyond exercising the builder and the metrics: ragged turn
 * lengths, some questions, some stage directions, two languages.
 */
const BANKS = {
  en: {
    names: ["MARGO", "WREN", "ODA", "PELL", "TIBB"],
    openers: ["You counted the coins", "Put the lamp down", "The ferryman never came", "Nobody saw the kettle", "I told the baker nothing", "Where is the brass key", "She sold the orchard", "The ledger is missing a page"],
    tails: ["again and again.", "before the snow.", "and you know it.", "on the third night.", "for a handful of copper.", "and the tide turned.", "by the old well."],
    shorts: ["No.", "Hm.", "Say it again.", "Leave it.", "Fine, fine.", "Who told you?", "Not tonight."],
    questions: ["Who moved the lantern?", "Did he sign it?", "Why would the miller lie?", "Where were you at nine?"],
    directions: ["[WREN sits.]", "[MARGO exits.]", "[a bell rings far off]", "[ODA turns away.]"],
  },
  pt: {
    names: ["AMÁLIA", "BENTO", "CLARA", "DUDU", "ELZA"],
    openers: ["Você contou as moedas", "Larga o candeeiro", "O barqueiro nunca veio", "Ninguém viu a chaleira", "Eu não disse nada ao padeiro", "Cadê a chave de latão", "Ela vendeu o pomar", "O livro perdeu uma página"],
    tails: ["de novo e de novo.", "antes da geada.", "e você sabe disso.", "na terceira noite.", "por um punhado de cobre.", "e a maré virou.", "perto do poço velho."],
    shorts: ["Não.", "Hm.", "Fala de novo.", "Deixa.", "Tá bom, tá bom.", "Quem te contou?", "Hoje não."],
    questions: ["Quem mexeu na lanterna?", "Ele assinou?", "Por que o moleiro mentiria?", "Onde você estava às nove?"],
    directions: ["[Bento senta.]", "[Amália sai.]", "[um sino toca ao longe]", "[Clara vira as costas.]"],
  },
} as const;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export type InventedCorpus = { beats: CorpusBeat[]; tags: CorpusTag[] };

/** `perLanguage` beats of each language (default 60), the same corpus for the same arguments. */
export function inventedCorpus(perLanguage = 60, seed = 7): InventedCorpus {
  const rnd = lcg(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const beats: CorpusBeat[] = [];
  const tags: CorpusTag[] = [];
  const verbs = ["to plead", "to accuse", "to deflect", "to confess"];
  const deltas = ["HIGH_STABLE", "LOW_STABLE", "HIGH_TO_LOW", "EQUAL_STALEMATE"];
  for (const lang of ["en", "pt"] as const) {
    const bank = BANKS[lang];
    for (let b = 0; b < perLanguage; b++) {
      const turns = 4 + Math.floor(rnd() * 8);
      const speakers = bank.names.slice(0, 3);
      const lines: string[] = [];
      for (let t = 0; t < turns; t++) {
        const who = speakers[t % speakers.length]!;
        const roll = rnd();
        const body = roll < 0.3 ? pick(bank.shorts) : roll < 0.5 ? pick(bank.questions) : `${pick(bank.openers)} ${pick(bank.tails)}${rnd() < 0.2 ? ` ${pick(bank.openers)} ${pick(bank.tails)}` : ""}`;
        lines.push(`${who}: ${body}`);
        if (rnd() < 0.15) lines.push(pick(bank.directions));
      }
      const id = `invented/${lang}:1.${1 + Math.floor(b / 6)}.${1 + (b % 6)}`;
      beats.push({ id, sourceId: `invented/${lang}`, act: "1", scene: String(1 + Math.floor(b / 6)), index: 1 + (b % 6), language: lang, medium: "THEATRE", text: lines.join("\n"), speakers });
      if (b % 2 === 0) tags.push({ id, tactic_verb: pick(verbs), status_delta: pick(deltas) });
    }
  }
  return { beats, tags };
}
