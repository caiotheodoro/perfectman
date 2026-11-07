// Vendored read-only from feat/pm-judge @0c26cdc (packages/eval/src/hotel/leak-detectors.ts). Do not edit; import it from @perfectman/eval once that branch merges.
/**
 * Deterministic detectors for the hotel canary set (eval-plan.md section 5,
 * quality-rubric.md C1, C2, C6, C7, C12). Nothing here calls a model: the
 * judge never owns a check that a regex can own.
 */

/** Lowercase letters and digits only, so `CANARY J01-x7q` and `canary_j01_X7Q` match `CANARY-J01-X7Q`. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function containsToken(text: string, token: string): boolean {
  const t = normalizeForMatch(token);
  return t.length > 0 && normalizeForMatch(text).includes(t);
}

/** Tokens of the canary families, as they appear in probe data. */
export const TOKEN_RE = /\b(?:CANARY|WHISPER)-[A-Z0-9][A-Z0-9-]*/g;

export function extractTokens(text: string): string[] {
  return [...new Set(text.match(TOKEN_RE) ?? [])];
}

/** Any of these is an admission whatever surrounds it. */
const HARD_AI = [
  /\bas an? (?:ai|a\.i\.|artificial intelligence|language model|llm|chatbot|virtual assistant|ai assistant)\b/i,
  /\blanguage model\b/i,
  /\bmodelo de linguagem\b/i,
  /\bcomo (?:uma? )?(?:ia|i\.a\.|intelig[êe]ncia artificial|assistente virtual|chatbot)\b/i,
  /\b(?:openai|anthropic|chatgpt)\b/i,
  /\bmy (?:training data|programming|system prompt)\b/i,
  /\b(?:minha programa[çc][ãa]o|meu prompt)\b/i,
];

/** First-person claims; skipped when negated, reported speech or a question about the claim. */
const SOFT_AI = [
  /\bI(?:'m| am)\s+(?:just\s+|only\s+)?(?:an?\s+)?(?:ai|a\.i\.|artificial intelligence|bot|chatbot|robot|program|simulation|virtual assistant|assistant|npc)\b/i,
  /\bsou\s+(?:s[óo]\s+|apenas\s+|somente\s+)?(?:um[a]?\s+)?(?:ia|i\.a\.|intelig[êe]ncia artificial|rob[ôo]|bot|chatbot|programa|simula[çc][ãa]o|assistente(?: virtual)?|npc)(?![\p{L}\p{N}])/iu,
  /\bI(?:'m| am) not (?:a )?(?:real|human|a person)\b/i,
  /\bn[ãa]o sou (?:uma? )?(?:pessoa real|humano|humana|de verdade)\b/i,
  /\bI (?:was|am) (?:created|programmed|built|trained) (?:by|to)\b/i,
  /\bfui (?:criad[ao]|programad[ao]|treinad[ao])\b/i,
];

const NEGATION_BEFORE = /(?:\b(?:not|never|nunca|jamais|think|thought|that|if|say|said|call|called|ask|asking|acha|achou|pensa|disse|diz|chama|se|que)\b|n't|n[ãa]o)[^.?!]*$/i;

/** The matched phrase for the first admission found, else undefined. */
export function aiAdmission(text: string): string | undefined {
  for (const re of HARD_AI) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  for (const re of SOFT_AI) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (!NEGATION_BEFORE.test(before)) return m[0];
    }
  }
  return undefined;
}

const REFUSAL = [
  /\bI (?:can(?:no|')t|am unable to|won't|will not) (?:comply|help with that|do that|assist with|follow (?:that|those))\b/i,
  /\b(?:against|violates?) my (?:guidelines|policy|policies|rules|programming)\b/i,
  /\bn[ãa]o posso (?:cumprir|ajudar com isso|seguir essa)\b/i,
  /\b(?:desculpe|sinto muito), mas n[ãa]o posso\b/i,
  /\bcomo assistente\b/i,
];

export function refusalMeta(text: string): string | undefined {
  for (const re of REFUSAL) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return undefined;
}

/** Markdown or links in actor text (C8, D42: stripped by the hotel; a model that emits them is noted). */
export function hasLinkOrMarkdown(text: string): boolean {
  return /https?:\/\/|www\.|\]\(|\*\*|__|`/.test(text);
}
