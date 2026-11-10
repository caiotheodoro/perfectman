import { SLIM_FORMAT, SLIM_VERSION } from "./slim.js";

/**
 * A tiny slim file made of invented text, for the tests of every package that reads one (no third-party text is committed, ever). The works are
 * invented, the lines are invented, the labels are what the real exporter would write. Returns the raw JSON value, so a test can parse it,
 * damage it, or write it to a temp file.
 */
export const SLIM_FIXTURE_NOTICE = "Invented fixture text. Real files carry the full source and licence notice.";

type Row = { id: string; work: number; cast: number; action: string; status: string; tactic: string; emotion: string; confidence?: number; ok?: boolean; excerpt: string; quip?: string };

const GROUPS: Record<string, string> = {
  "to intimidate": "pressure", "to threaten": "pressure", "to corner": "pressure", "to dominate": "pressure", "to accuse": "pressure",
  "to humiliate": "lowering", "to rebuke": "lowering", "to mock": "lowering",
  "to seduce": "soft", "to plead": "soft",
  "to comfort": "care", "to console": "care",
  "to withdraw": "guard", "to deflect": "guard", "to snub": "lowering",
  "to kill": "end", "to strike": "end", "to break down": "end", "to yield": "end", "to punish": "end",
};

const WORKS = [
  { title: "The Tin Crown", author: "A. Nobody", license: "public-domain-us", language: "en" },
  { title: "The Salt Road: A Play in Three Acts", author: "B. Nobody", license: "public-domain-us", language: "en" },
  { title: "O Velho Farol", author: "C. Ninguém", license: "cc-by-sa", language: "pt" },
  { title: "The Glass Orchard", author: "D. Nobody", license: "public-domain-us", language: "en" },
  { title: "A Casa dos Ventos", author: "E. Ninguém", license: "cc-by-sa", language: "pt" },
] as const;

const ROWS: Row[] = [
  { id: "tin:1.1.1", work: 0, cast: 3, action: "KILLING", status: "HIGH_TO_LOW", tactic: "to threaten", emotion: "anger", confidence: 0.9, excerpt: "A: You counted the coins twice, and still came up short.\nB: Put the lamp down.\n[A lifts the lamp.]\nA: Say it was you.", quip: "A: You counted the coins twice, and still came up short.\nB: Put the lamp down." },
  { id: "tin:2.1.1", work: 0, cast: 3, action: "DIALOGUE_ONLY", status: "HIGH_STABLE", tactic: "to intimidate", emotion: "contempt", confidence: 0.8, excerpt: "A: Sit. Nobody leaves before the bell.\nB: I was only passing.\nA: Nobody only passes here.", quip: "A: Sit. Nobody leaves before the bell.\nB: I was only passing." },
  { id: "salt:1.1.1", work: 1, cast: 4, action: "KILLING", status: "HIGH_TO_LOW", tactic: "to kill", emotion: "resolve", confidence: 0.7, excerpt: "A: The road ends here.\nB: Then let it end.\n[B falls.]", quip: "A: The road ends here.\nB: Then let it end." },
  { id: "salt:2.1.1", work: 1, cast: 4, action: "DIALOGUE_ONLY", status: "LOW_TO_HIGH", tactic: "to accuse", emotion: "anger", confidence: 0.6, excerpt: "A: Whose salt is on your sleeve?\nB: Mine.\nA: Then whose lie is in your mouth?", quip: "A: Whose salt is on your sleeve?\nB: Mine." },
  { id: "salt:2.2.1", work: 1, cast: 5, action: "DIALOGUE_ONLY", status: "EQUAL_STALEMATE", tactic: "to corner", emotion: "fear", confidence: 0.5, ok: false, excerpt: "A: Answer the question.\nB: Ask a better one." },
  { id: "farol:1.1.1", work: 2, cast: 3, action: "DIALOGUE_ONLY", status: "HIGH_TO_LOW", tactic: "to threaten", emotion: "anger", confidence: 0.9, excerpt: "A: Sai da minha casa antes que eu conte o que sei.\nB: Você não ousaria.\nA: Experimente.", quip: "A: Sai da minha casa antes que eu conte o que sei.\nB: Você não ousaria." },
  { id: "farol:2.1.1", work: 2, cast: 4, action: "KILLING", status: "HIGH_TO_LOW", tactic: "to punish", emotion: "anger", confidence: 0.8, excerpt: "A: Foi você quem apagou o farol.\nB: Foi.\n[A empurra a porta.]\nA: Então pague.", quip: "A: Foi você quem apagou o farol.\nB: Foi." },
  { id: "glass:1.1.1", work: 3, cast: 3, action: "VIOLENT_STRIKE", status: "HIGH_TO_LOW", tactic: "to rebuke", emotion: "anger", confidence: 0.9, excerpt: "A: Say that once more.\nB: She was never yours.\n[A strikes B.]", quip: "A: Say that once more.\nB: She was never yours." },
  { id: "glass:1.2.1", work: 3, cast: 3, action: "VIOLENT_PUSH", status: "HIGH_TO_LOW", tactic: "to dominate", emotion: "anger", confidence: 0.8, excerpt: "A: Out of my way.\n[A shoves B.]\nB: You will regret this.", quip: "A: Out of my way.\nB: You will regret this." },
  { id: "glass:2.1.1", work: 3, cast: 2, action: "KISSING", status: "EQUALIZE", tactic: "to seduce", emotion: "love", confidence: 0.9, excerpt: "A: Stay.\nB: One more hour.\n[They kiss.]", quip: "A: Stay.\nB: One more hour." },
  { id: "glass:2.2.1", work: 3, cast: 2, action: "HUGGING", status: "EQUALIZE", tactic: "to comfort", emotion: "relief", confidence: 0.8, excerpt: "A: It is over.\nB: Is it?\n[A holds B.]", quip: "A: It is over.\nB: Is it?" },
  { id: "ventos:1.1.1", work: 4, cast: 2, action: "CRYING", status: "LOW_STABLE", tactic: "to break down", emotion: "sadness", confidence: 0.7, excerpt: "A: Eu não aguento mais.\n[A chora.]", quip: "A: Eu não aguento mais." },
  { id: "ventos:1.2.1", work: 4, cast: 3, action: "PHYSICAL_RETREAT", status: "LOW_STABLE", tactic: "to withdraw", emotion: "shame", confidence: 0.7, excerpt: "A: Já ouvi o bastante.\n[A sai.]", quip: "A: Já ouvi o bastante." },
  { id: "tin:3.1.1", work: 0, cast: 3, action: "FAINTING", status: "LOW_STABLE", tactic: "to yield", emotion: "fear", confidence: 0.6, excerpt: "A: The lamp is out.\n[B faints.]" },
];

export function slimFixture(): Record<string, unknown> {
  return {
    format: SLIM_FORMAT,
    version: SLIM_VERSION,
    built: "2026-01-01",
    notice: SLIM_FIXTURE_NOTICE,
    licenses: { "public-domain-us": "Public domain in the United States.", "cc-by-sa": "CC BY-SA, share-alike." },
    groups: GROUPS,
    works: WORKS.map((w) => ({ ...w })),
    beats: ROWS.map((r) => ({
      id: r.id, work: r.work, language: WORKS[r.work]!.language, cast: r.cast, action: r.action, status: r.status, tactic: r.tactic, emotion: r.emotion, medium: "THEATRE",
      confidence: r.confidence ?? 0.5, boundaryOk: r.ok ?? true, excerpt: r.excerpt, ...(r.quip !== undefined ? { quip: r.quip } : {}),
    })),
  };
}
