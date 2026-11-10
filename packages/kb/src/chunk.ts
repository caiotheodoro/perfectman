import type { ActionType } from "./taxonomy.js";
import type { Beat, Item, Scene, SourceMeta } from "./types.js";

/**
 * Chunking by beat. A real beat is "a stretch where one tactic is held toward one person" and only a reader can see it, so this is a
 * heuristic and the tagger reports `boundary_ok` to measure it. A beat closes when:
 *  - a stage direction shows a strong physical action (the beat ends on it, plus the next reply, which is its reaction);
 *  - a character who has been speaking in the beat leaves (an exit direction): the pair changed;
 *  - someone new takes the floor after at least `minItems` items and either the recent pair was settled or the beat already holds
 *    `maxSpeakers` distinct speakers;
 *  - an entrance direction arrives after at least `minItems` items;
 *  - a speech of at least `bigSpeech` characters arrives (a monologue is its own beat, closed after the reply it gets);
 *  - the text passes `maxChars`.
 * No beat is longer than `hardMaxChars`: a short leftover is merged into the previous beat only while the result stays under it, a
 * reaction is appended to a strong action only while it fits, and a group still over the cap is cut at item boundaries.
 * Stage directions that sit at the end of a beat but belong to the speech that follows ("[Aside.]", "[Turning to her.]") move to
 * the next beat when the cut is a seam. Beats shorter than `minSpeeches` speeches are merged into the previous one, unless they carry
 * an action cue.
 */

export type ChunkOptions = { maxChars?: number; minItems?: number; minSpeeches?: number; recentWindow?: number; maxSpeakers?: number; bigSpeech?: number; hardMaxChars?: number };

const HINTS: ReadonlyArray<[ActionType, RegExp]> = [
  ["KILLING", /\b(kill(?:s|ed|ing)?|stab(?:s|bed|bing)?|slay(?:s|ing)?|slain|murder(?:s|ed)?|strangl(?:e|es|ed)|smother(?:s|ed)?|shoots? (?:him|her|himself|herself)|dies|falls dead|matou|mata|apunhala|assassina|morre|estrangula|mata-o)\b/i],
  ["FAINTING", /\b(faint(?:s|ed|ing)?|swoon(?:s|ed)?|collapses?|falls senseless|desmaia|desfalece|cai desmaiad[oa])\b/i],
  ["KISSING", /\b(kiss(?:es|ed|ing)?|beija(?:-a|-o|m)?|beijo)\b/i],
  ["VIOLENT_STRIKE", /\b(strikes?|struck|slaps?|slapped|boxes (?:his|her) ears?|hits?|beats?|whips?|lashes|esbofeteia|bofetada|dá um tapa|bate|soco|murro)\b/i],
  ["VIOLENT_PUSH", /\b(push(?:es|ed|ing)?|shoves?|shoved|thrusts? (?:him|her|them)|flings? (?:him|her) |throws? (?:him|her) (?:down|aside)|empurra|empurrão|atira-o)\b/i],
  ["HUGGING", /\b(embrac(?:es|ed|ing)|hugs?|hugged|folds? (?:him|her) in (?:his|her) arms|throws? (?:her|his) arms (?:round|around)|abraça|abraçam|abraço)\b/i],
  ["CRYING", /\b(weep(?:s|ing)?|wept|cries|crying|sobs?|sobbing|bursts? into tears|in tears|chora|choram|soluça|lágrimas)\b/i],
  ["PHYSICAL_RETREAT", /\b(turns? (?:away|her back|his back)|flings? out|storms? out|rushes? out|runs? out|slams? the door|leaves in (?:a )?(?:rage|anger)|sai furios[oa]|vira as costas|bate a porta)\b/i],
];

export function actionHint(directionsText: string): ActionType {
  for (const [type, re] of HINTS) if (re.test(directionsText)) return type;
  return "DIALOGUE_ONLY";
}

const STRONG: ReadonlySet<ActionType> = new Set(["KILLING", "FAINTING", "KISSING", "VIOLENT_STRIKE", "VIOLENT_PUSH", "HUGGING", "CRYING"]);
const ENTRANCE = /^\s*(Enter|Re-?enter|Entra|Entram)\b/i;
/** A direction that takes someone off stage. Exit words in English and Portuguese, and the usual "goes out" phrasings. */
const EXIT = /\b(exit|exits|exeunt|goes (?:out|off|into)|go (?:out|off)|rushes out|runs out|storms out|withdraws?|retires|leaves the room|sai|saem|vai-se|v[aã]o-se|retira-se)\b/i;

function itemText(it: Item): string {
  return it.kind === "speech" ? `${it.speaker}: ${it.text}` : `[${it.text}]`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the direction takes off someone who has been speaking in the current beat. A direction that names only people who have not
 * spoken here (a messenger sent off, a servant leaving) is not a seam; one that names nobody in the cast ("She goes out by the hall door.")
 * is read as the last speaker leaving.
 */
function exitsASpeaker(text: string, cast: readonly string[], inBeat: ReadonlySet<string>): boolean {
  if (!EXIT.test(text)) return false;
  const named = cast.filter((n) => new RegExp(`(?<![\\p{L}])${escapeRe(n)}(?![\\p{L}])`, "iu").test(text));
  return named.length === 0 || named.some((n) => inBeat.has(n));
}

/** Cuts a group longer than `max` at item boundaries into pieces under it. A piece with no speech joins the one after it. */
function splitOversize(g: Item[], max: number): Item[][] {
  const len = (x: Item) => itemText(x).length + 1;
  if (g.reduce((n, x) => n + len(x), 0) <= max) return [g];
  const pieces: Item[][] = [];
  let cur: Item[] = [];
  let n = 0;
  for (const x of g) {
    if (cur.length && n + len(x) > max && cur.some((y) => y.kind === "speech")) {
      pieces.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(x);
    n += len(x);
  }
  if (cur.length) {
    const last = pieces[pieces.length - 1];
    if (last && !cur.some((y) => y.kind === "speech")) last.push(...cur);
    else pieces.push(cur);
  }
  return pieces;
}

export function chunkScene(scene: Scene, meta: Pick<SourceMeta, "title" | "author" | "language" | "medium" | "license_class">, opts: ChunkOptions = {}): Beat[] {
  const maxChars = opts.maxChars ?? 1100;
  const minItems = opts.minItems ?? 4;
  const minSpeeches = opts.minSpeeches ?? 2;
  const recentWindow = opts.recentWindow ?? 6;
  const maxSpeakers = opts.maxSpeakers ?? 3;
  const bigSpeech = opts.bigSpeech ?? 900;
  const hardMax = opts.hardMaxChars ?? 2400;

  const castSet = new Set(scene.items.flatMap((it) => (it.kind === "speech" ? [it.speaker] : [])));
  const cast = [...castSet];
  const groups: Item[][] = [];
  let cur: Item[] = [];
  let chars = 0;
  let closeAfterReply = false;
  const recent: string[] = [];
  const speakersIn = (g: readonly Item[]) => new Set(g.flatMap((x) => (x.kind === "speech" ? [x.speaker] : [])));
  const isAction = (x: Item) => x.kind === "direction" && (STRONG.has(actionHint(x.text)) || EXIT.test(x.text));
  /** Closes the beat. At a seam, directions trailing the last speech belong to the speech that follows, so they move on. */
  const close = (seam = false) => {
    let tail: Item[] = [];
    if (seam) {
      let k = cur.length;
      while (k > 0 && !isAction(cur[k - 1] as Item) && (cur[k - 1] as Item).kind === "direction") k--;
      if (k > 0 && k < cur.length) tail = cur.splice(k);
    }
    if (cur.length) groups.push(cur);
    cur = tail;
    chars = tail.reduce((n, x) => n + itemText(x).length + 1, 0);
  };

  for (let i = 0; i < scene.items.length; i++) {
    const it = scene.items[i] as Item;
    if (it.kind === "speech") {
      const seen = recent.slice(-recentWindow);
      const here = speakersIn(cur);
      if (cur.length >= minItems && seen.length >= 3 && !seen.includes(it.speaker)) close(true);
      else if (cur.length >= minItems && here.size >= maxSpeakers && !here.has(it.speaker)) close(true);
      else if (cur.length >= minItems && it.text.length >= bigSpeech) close(true);
      recent.push(it.speaker);
    } else if (ENTRANCE.test(it.text) && cur.length >= minItems) {
      close(true);
    }
    if (chars > maxChars && it.kind === "speech") close(true);
    cur.push(it);
    chars += itemText(it).length + 1;
    if (it.kind === "speech") {
      if (closeAfterReply) {
        closeAfterReply = false;
        close();
      } else if (it.text.length >= bigSpeech) closeAfterReply = true;
    }
    if (it.kind === "direction" && STRONG.has(actionHint(it.text))) {
      const next = scene.items[i + 1];
      if (next && next.kind === "speech" && chars + itemText(next).length + 1 <= hardMax) {
        cur.push(next);
        recent.push(next.speaker);
        chars += itemText(next).length + 1;
        i++;
      }
      closeAfterReply = false;
      close();
    } else if (it.kind === "direction" && cur.length >= minItems && speakersIn(cur).size >= 2 && exitsASpeaker(it.text, cast, speakersIn(cur))) {
      closeAfterReply = false;
      close();
    }
  }
  close();

  // Merge fragments.
  const size = (g: readonly Item[]) => g.reduce((n, x) => n + itemText(x).length + 1, 0);
  const merged: Item[][] = [];
  for (const g of groups) {
    const speeches = g.filter((x) => x.kind === "speech").length;
    const dirText = g.flatMap((x) => (x.kind === "direction" ? [x.text] : [])).join(" ");
    const hasAction = STRONG.has(actionHint(dirText));
    const prev = merged[merged.length - 1];
    if (speeches < minSpeeches && !hasAction && prev && size(prev) + size(g) <= hardMax) prev.push(...g);
    else merged.push([...g]);
  }
  const capped = merged.flatMap((g) => splitOversize(g, hardMax));

  return capped.filter((g) => g.some((x) => x.kind === "speech")).map((g, index) => {
    const directions = g.flatMap((x) => (x.kind === "direction" ? [x.text] : []));
    const speakers = [...new Set(g.flatMap((x) => (x.kind === "speech" ? [x.speaker] : [])))];
    const text = g.map(itemText).join("\n");
    return {
      id: `${scene.sourceId}:${scene.act}.${scene.scene}.${index + 1}`,
      sourceId: scene.sourceId,
      title: meta.title,
      author: meta.author,
      language: meta.language,
      medium: meta.medium,
      act: scene.act,
      scene: scene.scene,
      index: index + 1,
      speakers,
      castSize: Math.max(castSet.size, speakers.length),
      text,
      directions,
      actionHint: actionHint(directions.join(" ")),
      license_class: meta.license_class,
    } satisfies Beat;
  });
}
