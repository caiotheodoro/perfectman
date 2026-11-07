import type { BodyPerception } from "@perfectman/shared";

/**
 * Hotel mode only: how the output contract teaches the optional `body` block.
 * The schema listing alone left small models never emitting one (at most 1 call
 * in 70), so the contract also carries a one-line shape hint and two short
 * in-world examples that use handles from THIS render's `<body>` block, so a
 * copied example is always valid. Nothing here says what the reader is (D43).
 */

type Lang = "pt-BR" | "en";

const SHAPE: Record<Lang, string> = {
  en:
    '"body" is optional and every key in it is optional: "move" ({"kind":"approach","target":"p1"}, {"kind":"go_to","place":"z1"}, {"kind":"follow","target":"p1"}, {"kind":"leave","to":"r1"} or {"kind":"stay"}), ' +
    '"posture" ({"pose":"sit","at":"z1"}; pose is stand, sit or lay), "gesture" ({"kind":"wave","toward":"p1"}; kind is wave, kiss, laugh, thumbs, dance, sign or stop), ' +
    '"expression" (neutral, smile, angry, sad, surprised or sleepy), "face" (a handle), "order" (move_then_speak, speak_then_move or together). ' +
    "Handles (p1, z1, r1) come only from <body>; never invent one. Use it when you would really step closer, walk off, sit, wave or smile. " +
    "If the person you talk to is more than a few steps away, approach them first. Leave \"body\" out when you would stay put.",
  "pt-BR":
    '"body" é opcional e cada chave dele também: "move" ({"kind":"approach","target":"p1"}, {"kind":"go_to","place":"z1"}, {"kind":"follow","target":"p1"}, {"kind":"leave","to":"r1"} ou {"kind":"stay"}), ' +
    '"posture" ({"pose":"sit","at":"z1"}; pose é stand, sit ou lay), "gesture" ({"kind":"wave","toward":"p1"}; kind é wave, kiss, laugh, thumbs, dance, sign ou stop), ' +
    '"expression" (neutral, smile, angry, sad, surprised ou sleepy), "face" (um identificador), "order" (move_then_speak, speak_then_move ou together). ' +
    'Os identificadores (p1, z1, r1) vêm só de <body>; nunca invente um. Use quando você realmente chegaria mais perto, sairia andando, sentaria, acenaria ou sorriria. ' +
    'Se a pessoa com quem você fala está a mais de alguns passos, vá até ela primeiro. Deixe "body" de fora quando ficaria parado(a).',
};

/** Small stable hash, so the examples vary by turn without any randomness (a replayed run renders the same prompt). */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Kind = "walkTalk" | "wave" | "smile" | "laugh" | "thumbs" | "face" | "sit";

/** What each example's private thought says: about the body move itself, so a copy is plausible and harmless. */
const MOTIVE: Record<Lang, Record<Kind, string>> = {
  en: {
    walkTalk: "I would rather say this up close than across the room",
    wave: "I am glad they are here and want them to see it",
    smile: "this feels easy and I let it show",
    laugh: "that was funny and I do not hide it",
    thumbs: "I agree and want them to know without a speech",
    face: "I want to look at them while we talk",
    sit: "I want to settle in and talk sitting down",
  },
  "pt-BR": {
    walkTalk: "prefiro falar isso de perto a gritar daqui",
    wave: "fiquei contente que chegou e quero que perceba",
    smile: "estou à vontade e deixo isso aparecer",
    laugh: "achei graça e não escondo",
    thumbs: "concordo e quero que saibam sem fazer discurso",
    face: "quero olhar para a pessoa enquanto falamos",
    sit: "quero me acomodar e conversar sentado(a)",
  },
};

type Candidate = { kind: Kind; body: Record<string, unknown> };

/**
 * Every example this room's real handles allow, so whichever pair is drawn is a valid, plausible action here
 * (the pool is built from THIS render's people, places and seats, never from invented handles). Anything that
 * ends a scene or touches someone (leave, kiss, dance) is left out: a copied example must be harmless.
 */
function candidates(body: BodyPerception | undefined): Candidate[] {
  const people = body?.people ?? [];
  const places = body?.places ?? [];
  const out: Candidate[] = [];
  const far = [...people].sort((a, b) => (b.steps ?? 0) - (a.steps ?? 0))[0];
  const withSteps = people.filter((p) => (p.steps ?? 0) >= 3);
  for (const p of withSteps.length > 0 ? withSteps : far ? [far] : []) out.push({ kind: "walkTalk", body: { move: { kind: "approach", target: p.handle }, order: "move_then_speak" } });
  for (const p of people) {
    out.push({ kind: "wave", body: { gesture: { kind: "wave", toward: p.handle }, expression: "smile" } });
    out.push({ kind: "laugh", body: { gesture: { kind: "laugh", toward: p.handle } } });
    out.push({ kind: "thumbs", body: { gesture: { kind: "thumbs", toward: p.handle } } });
    out.push({ kind: "face", body: { face: p.handle, expression: "smile" } });
  }
  // Only a free seat is offered as a place: "walk to a spot" or "follow" reads as a sensible choice anywhere, so a model that
  // picks it is hard to tell from one that copied it.
  for (const pl of places) {
    if (pl.freeSeats !== undefined && pl.freeSeats > 0) out.push({ kind: "sit", body: { move: { kind: "go_to", place: pl.handle }, posture: { pose: "sit", at: pl.handle }, order: "together" } });
  }
  return out;
}

/** A whole answer: a bare `{"body":...}` example taught the smallest reader to answer with no intentType, and a "..." placeholder was copied as the line itself. */
function render(lang: Lang, c: Candidate, speech: string): string {
  return JSON.stringify({ intentType: "send_message", visibleContent: speech, privateMotiveSummary: MOTIVE[lang][c.kind], body: c.body });
}

const FALLBACK_SPEECH: Record<Lang, string> = { en: "Hey, got a second?", "pt-BR": "Ei, tem um minuto?" };

/**
 * Two examples drawn from the pool for this turn (`key`): different kinds, different handles when the room has
 * more than one, and the person's own tonal sample for the words. A model that copies one still does something
 * valid in this room, and the draw changes every turn, so the cast does not move in lockstep.
 */
export function bodyExamples(lang: Lang, body: BodyPerception | undefined, key: string, samples: readonly string[] = []): string[] {
  const pool = candidates(body);
  const short = samples.map((t) => t.replace(/\s+/gu, " ").trim()).filter((t) => t.length >= 3 && t.length <= 70 && !/[{}<>"]/.test(t));
  const speech = (n: number): string => short[(seed(key) + n) % Math.max(1, short.length)] ?? FALLBACK_SPEECH[lang];
  const picks: Candidate[] = [];
  let h = seed(key);
  for (let guard = 0; picks.length < 2 && guard < 64 && pool.length > 0; guard++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const c = pool[h % pool.length]!;
    if (picks.some((p) => p.kind === c.kind || JSON.stringify(p.body) === JSON.stringify(c.body))) continue;
    picks.push(c);
  }
  // A room with one person and no place still gets two different shapes.
  const fallback: Candidate[] = [{ kind: "smile", body: { expression: "smile" } }, { kind: "smile", body: { expression: "neutral" } }];
  while (picks.length < 2) picks.push(fallback[picks.length]!);
  return picks.map((c, n) => render(lang, c, speech(n)));
}

/** The shape hint, then one block holding the examples (hotel mode with a body block only). `samples` are the person's own tonal lines. */
export function bodyContractLines(lang: Lang, body: BodyPerception | undefined, key: string, samples: readonly string[] = []): string[] {
  const header = lang === "pt-BR" ? "Exemplos de resposta com body (só o formato: use as suas próprias palavras):" : "Examples of an answer with body (the format only: use your own words):";
  return [SHAPE[lang], [header, ...bodyExamples(lang, body, key, samples)].join("\n")];
}
