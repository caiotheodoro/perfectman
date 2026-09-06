/**
 * Deterministic pt-BR vs en detection.
 *
 * `PersonaPromptProfile.language` accepts exactly these two values, and the
 * language the agents speak follows what the author wrote in the markdown —
 * not the app's own chrome. Explicit frontmatter always wins; this only runs
 * when the author didn't say.
 *
 * A stopword-frequency count, not a model: it must give the same answer on
 * every run, be explainable to the author ("matched: você, não, que"), and
 * never cost a network call. The UI shows the result with an override, so the
 * cost of a wrong guess is one click.
 */

export type DetectedLanguage = "pt-BR" | "en";

export type LanguageDetection = {
  language: DetectedLanguage;
  /** 0..1 — share of matched markers belonging to the winning language. */
  confidence: number;
  /** Markers that fired, for the UI to show its work. */
  markers: string[];
  source: "frontmatter" | "heuristic" | "override";
};

/**
 * Function words only. Content words would skew on topic (a persona who talks
 * about "samba" is not thereby writing Portuguese), and these are chosen to be
 * words the other language does not share.
 */
const PT_MARKERS = [
  "você", "voce", "não", "nao", "que", "com", "para", "uma", "por", "mais",
  "quando", "porque", "então", "entao", "isso", "ele", "ela", "eles", "elas",
  "está", "esta", "estão", "sempre", "nunca", "tudo", "nada", "muito", "gente",
  "coisa", "sobre", "também", "tambem", "ninguém", "ninguem", "alguém", "alguem",
  "meu", "minha", "seu", "sua", "dele", "dela", "aqui", "ali", "agora", "depois",
];

const EN_MARKERS = [
  "you", "the", "and", "that", "with", "for", "not", "this", "they", "them",
  "when", "because", "then", "always", "never", "everything", "nothing", "very",
  "about", "also", "nobody", "someone", "your", "their", "here", "there", "now",
  "after", "would", "could", "should", "just", "like", "what", "who", "how",
];

/** Characters that essentially never appear in English text. */
const PT_DIACRITICS = /[ãõçáéíóúâêôà]/i;

function countMarkers(words: readonly string[], markers: readonly string[]): { count: number; hit: string[] } {
  const set = new Set(markers);
  const hit = new Set<string>();
  let count = 0;
  for (const word of words) {
    if (set.has(word)) {
      count++;
      hit.add(word);
    }
  }
  return { count, hit: [...hit] };
}

/**
 * Detects the language of a body of authored prose.
 *
 * Ties and empty input resolve to `en`, matching the schema's ordering and
 * making the function total — an empty persona is a diagnostic elsewhere, not
 * a detection failure here.
 */
export function detectLanguage(text: string): LanguageDetection {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);

  const pt = countMarkers(words, PT_MARKERS);
  const en = countMarkers(words, EN_MARKERS);

  // Diacritics are near-conclusive on their own, but they are weighted rather
  // than decisive: an English persona quoting one Portuguese line shouldn't
  // flip the whole file.
  const diacriticBoost = PT_DIACRITICS.test(text) ? Math.max(2, Math.round(words.length * 0.02)) : 0;
  const ptScore = pt.count + diacriticBoost;
  const enScore = en.count;

  const total = ptScore + enScore;
  if (total === 0) {
    return { language: "en", confidence: 0, markers: [], source: "heuristic" };
  }

  const language: DetectedLanguage = ptScore > enScore ? "pt-BR" : "en";
  const winning = Math.max(ptScore, enScore);
  const markers = (language === "pt-BR" ? pt.hit : en.hit).slice(0, 8);
  if (diacriticBoost > 0 && language === "pt-BR") markers.unshift("(accented characters)");

  return {
    language,
    confidence: Number((winning / total).toFixed(3)),
    markers,
    source: "heuristic",
  };
}

/**
 * Resolves the language for one authored file: an explicit value wins, an
 * override wins over that, and detection is the fallback.
 */
export function resolveLanguage(params: {
  explicit?: string | undefined;
  override?: string | undefined;
  proseForDetection: string;
}): LanguageDetection & { invalidExplicit?: string } {
  const { explicit, override, proseForDetection } = params;

  if (override === "pt-BR" || override === "en") {
    return { language: override, confidence: 1, markers: [], source: "override" };
  }
  if (explicit === "pt-BR" || explicit === "en") {
    return { language: explicit, confidence: 1, markers: [], source: "frontmatter" };
  }

  const detected = detectLanguage(proseForDetection);
  // An explicit-but-unsupported value is the author's intent misspelled; report
  // it so they see why their `language: portuguese` did nothing.
  return explicit !== undefined && explicit !== null && explicit !== ""
    ? { ...detected, invalidExplicit: String(explicit) }
    : detected;
}
