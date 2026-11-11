import { CLIMAX_VERBS, SHEET_VERSION } from "./types.js";
import type { BeatSheet, SheetBeat } from "./types.js";
import type { ActVerb } from "../space/act-verbs.js";
import { ladderRung } from "../space/act-verbs.js";

/**
 * The deterministic sheet: what the mock provider answers, what the offline sim plays and what the tests start from. No model, no randomness beyond the
 * `seed`. It is a fixed shape (setup, a reveal that starts it, a glare, an insult, a reversal, a shove, the climax, the fallout) filled with the cast's own
 * names, so it passes the validator for any cast of two or more, and it is a plain, useful default rather than a good scene: the model writes the good ones.
 */

export type MockSheetInput = {
  /** Agent ids with the names the scene uses, in cast order. The first two are the pair the climax is between. */
  cast: ReadonlyArray<{ id: string; name: string; objective?: string }>;
  language: "en" | "pt-BR";
  /** Default `slap`. Anything in the contract's physical list. */
  climax?: ActVerb;
  /** Default 170 000. */
  climaxAtMs?: number;
  seed?: number;
  /** Names of places and props to use; the defaults are common to any room. */
  places?: { table?: string; window?: string; prop?: string };
};

const T = {
  "pt-BR": {
    premise: (a: string, b: string) => `${a} cobra de ${b} o que ficou por dizer, e a cena só termina quando alguém cede.`,
    stakes: (a: string, b: string) => `A confiança entre ${a} e ${b}: no fim, um dos dois sai com ela e o outro sem.`,
    fact: (a: string, b: string) => `${a} descobriu que ${b} escondeu a verdade de todos.`,
    turn: (a: string, b: string) => `${b} lembra algo que ${a} também prefere não ver exposto.`,
    setupNote: (goal: string) => `Quer: ${goal}. Ainda não mostra todas as cartas.`,
    pressure: "Aperta sem gritar; cada resposta do outro vira munição.",
    turnNote: "Percebe que tem mais poder do que parecia e usa isso.",
    cornered: "Está acuado e começa a perder o controle.",
    witness: "Vê tudo e não sabe se deve intervir.",
    gistSetup: "Todo mundo chega achando que é uma conversa normal.",
    gistInciting: "Algo vem à tona e ninguém consegue ignorar.",
    gistEsc: "A tensão sobe um degrau por vez.",
    gistRev: "O jogo de poder troca de lado.",
    gistClimax: "O limite estoura num gesto, não numa frase.",
    gistAfter: "O silêncio pesa; cada um mede o que perdeu.",
    cut: "fim da cena",
    prop: "envelope",
    table: "mesa",
    window: "janela",
  },
  en: {
    premise: (a: string, b: string) => `${a} wants from ${b} what was left unsaid, and the scene ends only when someone gives way.`,
    stakes: (a: string, b: string) => `The trust between ${a} and ${b}: by the end one keeps it and the other does not.`,
    fact: (a: string, b: string) => `${a} found out that ${b} hid the truth from everyone.`,
    turn: (a: string, b: string) => `${b} recalls something ${a} would also rather keep hidden.`,
    setupNote: (goal: string) => `Wants: ${goal}. Does not show every card yet.`,
    pressure: "Presses without shouting; every answer becomes ammunition.",
    turnNote: "Realises they hold more power than it seemed and uses it.",
    cornered: "Is cornered and starts to lose control.",
    witness: "Sees it all and cannot decide whether to step in.",
    gistSetup: "Everyone arrives thinking this is an ordinary talk.",
    gistInciting: "Something comes out that nobody can ignore.",
    gistEsc: "The tension rises one rung at a time.",
    gistRev: "The balance of power changes sides.",
    gistClimax: "The limit breaks in a gesture, not in a sentence.",
    gistAfter: "The silence weighs; each one counts what was lost.",
    cut: "end of the scene",
    prop: "envelope",
    table: "table",
    window: "window",
  },
} as const;

export function mockBeatSheet(input: MockSheetInput): BeatSheet {
  const t = T[input.language];
  const [A, B, ...rest] = input.cast;
  if (!A || !B) throw new Error("a sheet needs two people");
  const climaxVerb: ActVerb = input.climax && (CLIMAX_VERBS as readonly string[]).includes(input.climax) ? input.climax : "slap";
  const climaxAt = Math.min(235_000, Math.max(60_000, input.climaxAtMs ?? 170_000));
  const table = input.places?.table ?? t.table;
  const win = input.places?.window ?? t.window;
  const prop = input.places?.prop ?? t.prop;
  // The ladder before the climax, scaled to leave 20 s between the physical beats and a cooldown of 60 s between the same verbs.
  const shoveAt = climaxAt - 35_000;
  const insultAt = Math.max(50_000, shoveAt - 40_000);
  const glareAt = Math.max(30_000, insultAt - 30_000);
  const reverseAt = Math.max(glareAt + 10_000, Math.min(insultAt + 15_000, shoveAt - 10_000));
  const climaxRung = ladderRung(climaxVerb) ?? 0;
  const beats: SheetBeat[] = [];
  const push = (b: SheetBeat): void => void beats.push(b);
  let n = 0;
  const id = (): string => `m${++n}`;

  push({ id: id(), at_ms: 0, phase: "setup", kind: "note", actor: A.id, objective: t.setupNote(A.objective ?? (input.language === "pt-BR" ? `conseguir uma resposta de ${B.name}` : `get an answer from ${B.name}`)), gist: t.gistSetup });
  push({ id: id(), at_ms: 0, phase: "setup", kind: "note", actor: B.id, objective: t.setupNote(B.objective ?? (input.language === "pt-BR" ? "sair dessa conversa sem se comprometer" : "leave this talk without committing")) });
  push({ id: id(), at_ms: 3_000, phase: "setup", kind: "camera", intent: { shot: "establishing" } });
  push({ id: id(), at_ms: 6_000, phase: "setup", kind: "block", actor: A.id, to: { near: table }, how: "enter" });
  push({ id: id(), at_ms: 9_000, phase: "setup", kind: "prop", actor: A.id, prop, op: "take" });
  push({ id: id(), at_ms: 12_000, phase: "setup", kind: "block", actor: B.id, to: { zone: win }, how: "walk" });
  push({ id: id(), at_ms: 20_000, phase: "inciting", kind: "reveal", fact: t.fact(A.name, B.name), to: [A.id], from: B.id, via: "show", gist: t.gistInciting });
  push({ id: id(), at_ms: 24_000, phase: "inciting", kind: "camera", intent: { shot: "two_shot", on: [A.id, B.id] } });
  push({ id: id(), at_ms: 26_000, phase: "inciting", kind: "note", actor: A.id, objective: t.pressure, tactic: "to accuse", subtext: input.language === "pt-BR" ? "quer ouvir B confessar" : "wants B to confess" });
  push({ id: id(), at_ms: glareAt, phase: "escalation", kind: "act", actor: A.id, verb: "glare", with: B.id, gist: t.gistEsc });
  push({ id: id(), at_ms: glareAt + 8_000, phase: "escalation", kind: "prop", actor: A.id, prop, op: "show", to: B.id });
  push({ id: id(), at_ms: insultAt, phase: "escalation", kind: "act", actor: A.id, verb: "insult", with: B.id });
  push({ id: id(), at_ms: reverseAt, phase: "reversal", kind: "reveal", fact: t.turn(A.name, B.name), to: [A.id, B.id, ...rest.map((r) => r.id)], from: B.id, via: "say", gist: t.gistRev });
  push({ id: id(), at_ms: reverseAt + 1_000, phase: "reversal", kind: "note", actor: B.id, objective: t.turnNote, tactic: "to expose" });
  push({ id: id(), at_ms: reverseAt + 2_000, phase: "reversal", kind: "note", actor: A.id, objective: t.cornered, tactic: "to threaten" });
  push({ id: id(), at_ms: reverseAt + 4_000, phase: "reversal", kind: "expression", actor: A.id, face: "angry", ms: 8_000 });
  for (const w of rest) push({ id: id(), at_ms: reverseAt + 3_000, phase: "reversal", kind: "note", actor: w.id, objective: t.witness });
  push({ id: id(), at_ms: shoveAt - 6_000, phase: "reversal", kind: "camera", intent: { shot: "close_up", on: A.id, move: "dolly_in", amount: 0.4 } });
  push({ id: id(), at_ms: shoveAt, phase: "reversal", kind: "act", actor: A.id, verb: "shove", with: B.id });
  if (climaxVerb !== "shove") {
    push({
      id: id(),
      at_ms: climaxAt,
      phase: "climax",
      kind: "act",
      actor: A.id,
      verb: climaxVerb,
      ...(climaxVerb === "die" ? {} : { with: B.id }),
      climax: true,
      ...(climaxRung > 4 ? { authored_skip: true as const } : {}),
      gist: t.gistClimax,
    } as SheetBeat);
  } else {
    // the shove is the climax: the one before it is the insult's successor, so rewrite the previous beat as the climax
    const last = beats.pop() as Extract<SheetBeat, { kind: "act" }>;
    push({ ...last, phase: "climax", at_ms: climaxAt, climax: true, gist: t.gistClimax });
  }
  push({ id: id(), at_ms: climaxAt + 600, phase: "aftermath", kind: "camera", intent: { shot: "reaction", on: B.id, move: "hitstop", amount: 0.5, ms: 400 } });
  push({ id: id(), at_ms: climaxAt + 2_000, phase: "aftermath", kind: "pause", ms: 4_000, gist: t.gistAfter });
  push({ id: id(), at_ms: climaxAt + 2_500, phase: "aftermath", kind: "expression", actor: B.id, face: "surprised", ms: 6_000 });
  if (climaxVerb === "kill" || climaxVerb === "die") push({ id: id(), at_ms: climaxAt + 30_000, phase: "aftermath", kind: "cut", reason: t.cut });
  const first = rest[0];
  if (first) push({ id: id(), at_ms: climaxAt + 5_000, phase: "aftermath", kind: "act", actor: first.id, verb: "freeze_gasp" });
  const until = climaxAt + (climaxVerb === "kill" || climaxVerb === "die" ? 45_000 : 40_000);
  beats.sort((a, b) => a.at_ms - b.at_ms);
  return {
    version: SHEET_VERSION,
    premise: t.premise(A.name, B.name),
    stakes: t.stakes(A.name, B.name),
    arc: { inciting_at_ms: 20_000, reversal_at_ms: reverseAt, climax_at_ms: climaxAt, aftermath_until_ms: until },
    beats,
    generated_by: { model: "mock", cost_usd: 0, ms: 0, mock: true },
  };
}
