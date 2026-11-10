import type { SlimPick } from "./slim-select.js";
import type { SlimLicense } from "./slim.js";

/**
 * How reference text is shown to a model. Two renderings, both capped, both naming the work, the author and the licence of every excerpt
 * (the share-alike ones say so): the reference scenes of a draft prompt, and the short style lines of an actor's prompt.
 */

/** The whole reference block of a draft prompt, header and attributions included. The draft prompt itself is about 3,000 characters. */
export const DRAFT_REFERENCE_MAX_CHARS = 1500;
/** What an authored beat adds to an actor's compact scene-craft digest, in total. */
export const BEAT_CRAFT_MAX_CHARS = 600;

export const DRAFT_REFERENCE_HEADER = "Reference scenes (study the pressure and the turn, never copy lines or names):";
const STYLE_HEADER = {
  en: "Style reference, for the pressure and pace of the talk only, never quoted:",
  "pt-BR": "Referência de estilo, só para a pressão e o ritmo da fala, nunca citada:",
} as const;

const LICENSE_LABEL: Record<SlimLicense, string> = { "public-domain-us": "public domain", "cc-by-sa": "CC BY-SA, share-alike" };
/** The same, shorter, for a line that has a budget. */
const LICENSE_SHORT: Record<SlimLicense, string> = { "public-domain-us": "public domain", "cc-by-sa": "CC BY-SA" };

/** "Plays: The Father; Countess Julie; ..." shows as "Plays". */
function shortTitle(title: string): string {
  const head = title.split(/[:;(]/)[0]?.trim() ?? title;
  return (head === "" ? title : head).slice(0, 40).trim();
}

/**
 * The reference scenes of a draft prompt: a header, then per pick a numbered attribution line and the excerpt, each excerpt line quoted with
 * `| `. Picks are added in order while the whole block stays within `maxChars`; the first that does not fit ends the list. Undefined when
 * not even one fits.
 */
export function renderReferenceScenes(picks: readonly SlimPick[], maxChars: number = DRAFT_REFERENCE_MAX_CHARS): { text: string; used: SlimPick[] } | undefined {
  let text = DRAFT_REFERENCE_HEADER;
  const used: SlimPick[] = [];
  for (const pick of picks) {
    const entry = [`${used.length + 1}. ${pick.work.title}, ${pick.work.author} (${LICENSE_LABEL[pick.work.license]})`, ...pick.beat.excerpt.split("\n").map((line) => `| ${line}`)].join("\n");
    if (text.length + 1 + entry.length > maxChars) break;
    text += `\n${entry}`;
    used.push(pick);
  }
  return used.length === 0 ? undefined : { text, used };
}

/**
 * The style lines of an authored beat: a header and one bullet per pick (its quip on one line, then `(title, author, licence)`), within `maxChars`
 * in total. Picks without a quip are skipped. Undefined when nothing fits.
 */
export function renderStyleReference(picks: readonly SlimPick[], language: "en" | "pt-BR", maxChars: number = BEAT_CRAFT_MAX_CHARS): { text: string; used: SlimPick[] } | undefined {
  let text: string = STYLE_HEADER[language];
  const used: SlimPick[] = [];
  for (const pick of picks) {
    if (pick.beat.quip === undefined) continue;
    const entry = `- ${pick.beat.quip.replace(/\n/g, " / ")} (${shortTitle(pick.work.title)}, ${pick.work.author.slice(0, 30)}, ${LICENSE_SHORT[pick.work.license]})`;
    if (text.length + 1 + entry.length > maxChars) break;
    text += `\n${entry}`;
    used.push(pick);
  }
  return used.length === 0 ? undefined : { text, used };
}
