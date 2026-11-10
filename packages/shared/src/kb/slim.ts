/**
 * The slim reference file: a small, redistributable cut of `packages/kb`'s index (see that package's README, "Slim artifact"). It is the
 * only form in which the KB reaches production, so the format, its reader and the budgets live here, in the one package every image builds.
 * Pure: no file system, no SQLite, no model. The file is read by the server (`PERFECTMAN_KB_SLIM`); this module only validates and indexes
 * what it is handed, and never trusts it: a beat that does not fit the format is dropped, a file that is not the format is refused.
 *
 * The labels mirror `packages/kb/src/taxonomy.ts`; a test in `@perfectman/kb` pins the lists equal.
 */

export const SLIM_FORMAT = "perfectman-kb-slim";
export const SLIM_VERSION = 1;
/** An excerpt is whole lines, at most this many characters. */
export const SLIM_EXCERPT_MAX_CHARS = 420;
/** A quip is the shortest useful cut of a beat, speech lines only, at most this many characters. */
export const SLIM_QUIP_MAX_CHARS = 200;

export const SLIM_ACTIONS = ["KILLING", "KISSING", "HUGGING", "CRYING", "VIOLENT_PUSH", "VIOLENT_STRIKE", "PHYSICAL_RETREAT", "FAINTING", "DIALOGUE_ONLY"] as const;
export type SlimAction = (typeof SLIM_ACTIONS)[number];

export const SLIM_STATUSES = ["HIGH_TO_LOW", "LOW_TO_HIGH", "EQUAL_STALEMATE", "EQUALIZE", "HIGH_STABLE", "LOW_STABLE"] as const;
export type SlimStatus = (typeof SLIM_STATUSES)[number];

export const SLIM_EMOTIONS = ["anger", "contempt", "fear", "sadness", "shame", "joy", "love", "relief", "surprise", "jealousy", "resolve", "neutral"] as const;
export type SlimEmotion = (typeof SLIM_EMOTIONS)[number];

export const SLIM_MEDIUMS = ["THEATRE", "CINEMA"] as const;
export type SlimMedium = (typeof SLIM_MEDIUMS)[number];

/** Only open text is ever exported: public domain in the US, or share-alike. Anything else is refused on read. */
export const SLIM_LICENSES = ["public-domain-us", "cc-by-sa"] as const;
export type SlimLicense = (typeof SLIM_LICENSES)[number];

export const SLIM_LANGUAGES = ["en", "pt"] as const;
export type SlimLanguage = (typeof SLIM_LANGUAGES)[number];

export type SlimWork = { title: string; author: string; license: SlimLicense; language: SlimLanguage };

export type SlimBeat = {
  id: string;
  /** Index into `works`. */
  work: number;
  language: SlimLanguage;
  /** Distinct speakers in the scene, as the text shows. */
  cast: number;
  action: SlimAction;
  status: SlimStatus;
  tactic: string;
  emotion: SlimEmotion;
  medium: SlimMedium;
  confidence: number;
  /** False when the tagger judged the cut wrong (about one beat in four). */
  boundaryOk: boolean;
  /** Whole lines, speakers named A, B, C. */
  excerpt: string;
  /** Speech lines only, for the runtime style reference. Absent when no whole lines fit. */
  quip?: string;
};

export type SlimKb = {
  version: number;
  /** The date the exporter was told, if it was. */
  built?: string;
  /** The notice text the file carries (source and licence terms); repeated wherever an excerpt is redistributed. */
  notice: string;
  /** Licence class to the line a rendering shows. */
  licenses: Readonly<Record<string, string>>;
  /** Tactic verb to its group, so a ranking can credit "same group" without the taxonomy. */
  groups: Readonly<Record<string, string>>;
  works: readonly SlimWork[];
  beats: readonly SlimBeat[];
};

export type SlimParse = { ok: true; kb: SlimKb; dropped: number } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/**
 * Cleans one excerpt for a prompt: NFKC, control and format characters gone (a newline survives as a line break), angle brackets dropped
 * so no tag can close a prompt container, blank lines removed, each line's whitespace collapsed.
 */
export function cleanSlimText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(CONTROL_OR_FORMAT, " ").replace(/[<>]/g, "").replace(/\s+/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Reads a parsed JSON value as a slim file. A beat that is malformed, over a cap, from an unknown or closed licence, or pointing at no work is dropped and counted. */
export function parseSlimKb(raw: unknown): SlimParse {
  if (!isRecord(raw) || raw["format"] !== SLIM_FORMAT) return { ok: false, error: "not a perfectman KB slim file" };
  if (raw["version"] !== SLIM_VERSION) return { ok: false, error: `unsupported slim version ${String(raw["version"])} (this reader knows ${SLIM_VERSION})` };
  if (!Array.isArray(raw["works"]) || !Array.isArray(raw["beats"])) return { ok: false, error: "works and beats must be lists" };
  const notice = typeof raw["notice"] === "string" ? raw["notice"] : "";
  if (notice === "") return { ok: false, error: "the file carries no notice: it is not redistributable without its attribution" };

  const works: SlimWork[] = [];
  for (const w of raw["works"] as unknown[]) {
    if (isRecord(w) && typeof w["title"] === "string" && typeof w["author"] === "string" && oneOf(SLIM_LICENSES, w["license"]) && oneOf(SLIM_LANGUAGES, w["language"])) {
      works.push({ title: cleanSlimText(w["title"]).replace(/\n/g, " ").slice(0, 120), author: cleanSlimText(w["author"]).replace(/\n/g, " ").slice(0, 80), license: w["license"], language: w["language"] });
    } else {
      // Keep the index of every later work stable: a refused work leaves a hole, and beats that point at it are dropped below.
      works.push({ title: "", author: "", license: "public-domain-us", language: "en" });
    }
  }
  const usable = (index: number): boolean => (works[index]?.title ?? "") !== "";

  const licenses = isRecord(raw["licenses"]) ? Object.fromEntries(Object.entries(raw["licenses"]).filter((e): e is [string, string] => typeof e[1] === "string").map(([k, v]) => [k, cleanSlimText(v).replace(/\n/g, " ").slice(0, 160)])) : {};
  const groups = isRecord(raw["groups"]) ? Object.fromEntries(Object.entries(raw["groups"]).filter((e): e is [string, string] => typeof e[1] === "string")) : {};

  const beats: SlimBeat[] = [];
  let dropped = 0;
  for (const b of raw["beats"] as unknown[]) {
    if (!isRecord(b)) {
      dropped += 1;
      continue;
    }
    const work = b["work"];
    const excerpt = typeof b["excerpt"] === "string" ? cleanSlimText(b["excerpt"]) : "";
    const quip = typeof b["quip"] === "string" ? cleanSlimText(b["quip"]) : "";
    const confidence = typeof b["confidence"] === "number" && Number.isFinite(b["confidence"]) ? Math.min(1, Math.max(0, b["confidence"])) : 0;
    if (
      typeof b["id"] !== "string" || b["id"] === "" ||
      typeof work !== "number" || !Number.isInteger(work) || !usable(work) ||
      !oneOf(SLIM_LANGUAGES, b["language"]) ||
      typeof b["cast"] !== "number" || !Number.isInteger(b["cast"]) || b["cast"] < 1 || b["cast"] > 99 ||
      !oneOf(SLIM_ACTIONS, b["action"]) || !oneOf(SLIM_STATUSES, b["status"]) || !oneOf(SLIM_EMOTIONS, b["emotion"]) || !oneOf(SLIM_MEDIUMS, b["medium"]) ||
      typeof b["tactic"] !== "string" || b["tactic"] === "" || b["tactic"].length > 40 ||
      excerpt === "" || excerpt.length > SLIM_EXCERPT_MAX_CHARS
    ) {
      dropped += 1;
      continue;
    }
    beats.push({
      id: b["id"], work, language: b["language"], cast: b["cast"], action: b["action"], status: b["status"], tactic: b["tactic"].trim().toLowerCase(), emotion: b["emotion"], medium: b["medium"],
      confidence, boundaryOk: b["boundaryOk"] === true, excerpt,
      ...(quip !== "" && quip.length <= SLIM_QUIP_MAX_CHARS ? { quip } : {}),
    });
  }
  const kb: SlimKb = { version: SLIM_VERSION, ...(typeof raw["built"] === "string" ? { built: raw["built"].slice(0, 32) } : {}), notice, licenses, groups, works, beats };
  return { ok: true, kb, dropped };
}
