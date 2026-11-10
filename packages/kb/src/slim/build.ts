import { SLIM_EXCERPT_MAX_CHARS, SLIM_FORMAT, SLIM_LANGUAGES, SLIM_LICENSES, SLIM_QUIP_MAX_CHARS, SLIM_VERSION, cleanSlimText } from "@perfectman/shared";
import type { SlimLanguage, SlimLicense } from "@perfectman/shared";
import { TACTIC_GROUP_OF } from "../taxonomy.js";
import type { TaggedBeat } from "../types.js";
import { SLIM_LICENSE_LINES, SLIM_NOTICE } from "./notice.js";
import { anonymise, parseBeatLines, pickWindow } from "./window.js";

/**
 * The index to the slim file: only open text, only whole-line excerpts, only the fields retrieval ranks on. Deterministic: works and beats
 * are sorted, numbers are rounded, nothing reads the clock, so the same index and flags give the same bytes.
 */
export type SlimBuildOptions = {
  /** Written into the header as `built` when given; omitted otherwise (the clock is never read). */
  built?: string;
};

export type SlimBuildStats = {
  beats_in: number;
  beats_out: number;
  works: number;
  left_out: { closed_license: number; unknown_language: number; no_window: number };
  with_quip: number;
  by_action: Record<string, number>;
  by_language: Record<string, number>;
};

type Row = { work: string; json: string };

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function languageOf(raw: string): SlimLanguage | undefined {
  const l = raw.toLowerCase();
  if (l === "en" || l.startsWith("en-")) return "en";
  if (l === "pt" || l.startsWith("pt-")) return "pt";
  return undefined;
}

export function buildSlim(beats: readonly TaggedBeat[], opts: SlimBuildOptions = {}): { json: string; stats: SlimBuildStats } {
  const stats: SlimBuildStats = { beats_in: beats.length, beats_out: 0, works: 0, left_out: { closed_license: 0, unknown_language: 0, no_window: 0 }, with_quip: 0, by_action: {}, by_language: {} };
  const workKey = (b: TaggedBeat, language: SlimLanguage): string => JSON.stringify([language, b.title, b.author, b.license_class]);
  const works = new Map<string, { title: string; author: string; license: SlimLicense; language: SlimLanguage }>();
  const kept: Array<{ beat: TaggedBeat; language: SlimLanguage; excerpt: string; quip: string | undefined; key: string }> = [];

  for (const beat of [...beats].sort((a, b) => byCode(a.id, b.id))) {
    if (!(SLIM_LICENSES as readonly string[]).includes(beat.license_class)) {
      stats.left_out.closed_license += 1;
      continue;
    }
    const language = languageOf(beat.language);
    if (language === undefined || !(SLIM_LANGUAGES as readonly string[]).includes(language)) {
      stats.left_out.unknown_language += 1;
      continue;
    }
    // Cleaned the way the reader cleans, before the cut: NFKC can lengthen a line ("…" is three characters), and the caps are on the cleaned text.
    const lines = anonymise(parseBeatLines(cleanSlimText(beat.text), beat.speakers.map((s) => cleanSlimText(s))));
    const physical = beat.tag.action_type !== "DIALOGUE_ONLY";
    const excerpt = pickWindow(lines, SLIM_EXCERPT_MAX_CHARS, { wantDirection: physical, speechOnly: false });
    if (excerpt === undefined) {
      stats.left_out.no_window += 1;
      continue;
    }
    const quip = pickWindow(lines, SLIM_QUIP_MAX_CHARS, { wantDirection: false, speechOnly: true, minChars: 24 });
    const key = workKey(beat, language);
    if (!works.has(key)) works.set(key, { title: beat.title, author: beat.author, license: beat.license_class as SlimLicense, language });
    kept.push({ beat, language, excerpt, quip, key });
  }

  const orderedKeys = [...works.keys()].sort(byCode);
  const indexOf = new Map(orderedKeys.map((k, i) => [k, i]));
  const rows: Row[] = kept.map(({ beat, language, excerpt, quip, key }) => {
    stats.beats_out += 1;
    stats.by_action[beat.tag.action_type] = (stats.by_action[beat.tag.action_type] ?? 0) + 1;
    stats.by_language[language] = (stats.by_language[language] ?? 0) + 1;
    if (quip !== undefined) stats.with_quip += 1;
    return {
      work: key,
      json: JSON.stringify({
        id: beat.id,
        work: indexOf.get(key),
        language,
        cast: beat.castSize,
        action: beat.tag.action_type,
        status: beat.tag.status_delta,
        tactic: beat.tag.tactic_verb,
        emotion: beat.tag.emotion,
        medium: beat.medium,
        confidence: Math.round(beat.tag.confidence * 100) / 100,
        boundaryOk: beat.tag.boundary_ok,
        excerpt,
        ...(quip !== undefined ? { quip } : {}),
      }),
    };
  });
  stats.works = orderedKeys.length;

  const header = {
    format: SLIM_FORMAT,
    version: SLIM_VERSION,
    ...(opts.built !== undefined ? { built: opts.built } : {}),
    notice: SLIM_NOTICE,
    licenses: SLIM_LICENSE_LINES,
    groups: Object.fromEntries(Object.entries(TACTIC_GROUP_OF).sort(([a], [b]) => byCode(a, b))),
    works: orderedKeys.map((k) => works.get(k)),
  };
  // One beat per line, so a diff of two builds reads and `grep` finds an id.
  const head = JSON.stringify(header);
  const json = `${head.slice(0, -1)},"beats":[\n${rows.map((r) => r.json).join(",\n")}\n]}\n`;
  return { json, stats };
}
