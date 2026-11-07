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

type Handles = { person: string; far: string; place: string; seat: string | undefined };

function pickHandles(body: BodyPerception | undefined): Handles {
  const people = body?.people ?? [];
  const nearest = people.find((p) => p.pinned) ?? people[0];
  const far = [...people].sort((a, b) => (b.steps ?? 0) - (a.steps ?? 0))[0];
  const places = body?.places ?? [];
  const seat = places.find((p) => p.freeSeats !== undefined && p.freeSeats > 0);
  return {
    person: nearest?.handle ?? "p1",
    far: far?.handle ?? nearest?.handle ?? "p1",
    place: (seat ?? places[0])?.handle ?? "z1",
    seat: seat?.handle,
  };
}

/** Small stable hash, so the pair of examples varies by turn without any randomness. */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Kind = "walkTalk" | "greet" | "sit";

/** What each example's private thought says: about the body move itself, so a copy is plausible and harmless. */
const MOTIVE: Record<Lang, Record<Kind, string>> = {
  en: { walkTalk: "I would rather say this up close than across the room", greet: "I am glad they are here and want them to see it", sit: "I want to settle in and talk sitting down" },
  "pt-BR": { walkTalk: "prefiro falar isso de perto a gritar daqui", greet: "fiquei contente que chegou e quero que perceba", sit: "quero me acomodar e conversar sentado(a)" },
};

/**
 * A whole answer: a bare `{"body":...}` example taught the smallest reader to answer with no intentType, and a "..."
 * placeholder was copied as the line itself. The spoken line is one of the person's OWN tonal samples, so a copy
 * still sounds like them; the thought is about the move, so a copy is harmless.
 */
function example(lang: Lang, kind: Kind, h: Handles, speech: string): string {
  const body =
    kind === "walkTalk"
      ? { move: { kind: "approach", target: h.far }, order: "move_then_speak" }
      : kind === "greet"
        ? { gesture: { kind: "wave", toward: h.person }, expression: "smile" }
        : { move: { kind: "go_to", place: h.seat ?? h.place }, posture: { pose: "sit", at: h.seat ?? h.place }, order: "together" };
  return JSON.stringify({ intentType: "send_message", visibleContent: speech, privateMotiveSummary: MOTIVE[lang][kind], body });
}

const FALLBACK_SPEECH: Record<Lang, string> = { en: "Hey, got a second?", "pt-BR": "Ei, tem um minuto?" };

/** Two examples, never the same pair two turns in a row; "sit" is offered only when a seat is free. */
export function bodyExamples(lang: Lang, body: BodyPerception | undefined, key: string, samples: readonly string[] = []): string[] {
  const h = pickHandles(body);
  const kinds: Kind[] = h.seat ? ["walkTalk", "greet", "sit"] : ["walkTalk", "greet"];
  const first = kinds[seed(key) % kinds.length]!;
  const second = kinds[(kinds.indexOf(first) + 1) % kinds.length]!;
  const short = samples.map((t) => t.replace(/\s+/gu, " ").trim()).filter((t) => t.length >= 3 && t.length <= 70 && !/[{}<>"]/.test(t));
  const speech = (n: number): string => short[(seed(key) + n) % Math.max(1, short.length)] ?? FALLBACK_SPEECH[lang];
  return [example(lang, first, h, speech(0)), example(lang, second, h, speech(1))];
}

/** The shape hint, then one block holding the examples (hotel mode with a body block only). `samples` are the person's own tonal lines. */
export function bodyContractLines(lang: Lang, body: BodyPerception | undefined, key: string, samples: readonly string[] = []): string[] {
  const header = lang === "pt-BR" ? "Exemplos de resposta com body (só o formato: use as suas próprias palavras):" : "Examples of an answer with body (the format only: use your own words):";
  return [SHAPE[lang], [header, ...bodyExamples(lang, body, key, samples)].join("\n")];
}
