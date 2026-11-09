import type { ActionType } from "./taxonomy.js";
import type { Beat, Item, Scene, SourceMeta } from "./types.js";

/**
 * Chunking by beat. A real beat is "a stretch where one tactic is held toward one person" and only a reader can see it, so this is a
 * heuristic and the tagger reports `boundary_ok` to measure it. A beat closes when:
 *  - a stage direction shows a strong physical action (the beat ends on it, plus the next reply, which is its reaction);
 *  - someone new takes the floor after at least `minItems` items (the pair changed);
 *  - an entrance direction arrives after at least `minItems` items;
 *  - the text passes `maxChars`.
 * Beats shorter than `minSpeeches` speeches are merged into the previous one, unless they carry an action cue.
 */

export type ChunkOptions = { maxChars?: number; minItems?: number; minSpeeches?: number; recentWindow?: number };

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

function itemText(it: Item): string {
  return it.kind === "speech" ? `${it.speaker}: ${it.text}` : `[${it.text}]`;
}

export function chunkScene(scene: Scene, meta: Pick<SourceMeta, "title" | "author" | "language" | "medium" | "license_class">, opts: ChunkOptions = {}): Beat[] {
  const maxChars = opts.maxChars ?? 2200;
  const minItems = opts.minItems ?? 4;
  const minSpeeches = opts.minSpeeches ?? 2;
  const recentWindow = opts.recentWindow ?? 6;

  const castSet = new Set(scene.items.flatMap((it) => (it.kind === "speech" ? [it.speaker] : [])));
  const groups: Item[][] = [];
  let cur: Item[] = [];
  let chars = 0;
  const recent: string[] = [];
  const close = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    chars = 0;
  };

  for (let i = 0; i < scene.items.length; i++) {
    const it = scene.items[i] as Item;
    if (it.kind === "speech") {
      const seen = recent.slice(-recentWindow);
      if (cur.length >= minItems && seen.length >= 3 && !seen.includes(it.speaker)) close();
      recent.push(it.speaker);
    } else if (ENTRANCE.test(it.text) && cur.length >= minItems) {
      close();
    }
    if (chars > maxChars && it.kind === "speech") close();
    cur.push(it);
    chars += itemText(it).length + 1;
    if (it.kind === "direction" && STRONG.has(actionHint(it.text))) {
      const next = scene.items[i + 1];
      if (next && next.kind === "speech") {
        cur.push(next);
        recent.push(next.speaker);
        chars += itemText(next).length + 1;
        i++;
      }
      close();
    }
  }
  close();

  // Merge fragments.
  const merged: Item[][] = [];
  for (const g of groups) {
    const speeches = g.filter((x) => x.kind === "speech").length;
    const dirText = g.flatMap((x) => (x.kind === "direction" ? [x.text] : [])).join(" ");
    const hasAction = STRONG.has(actionHint(dirText));
    const prev = merged[merged.length - 1];
    if (speeches < minSpeeches && !hasAction && prev) prev.push(...g);
    else merged.push([...g]);
  }

  // A beat with nobody speaking (stage directions only, no neighbour to merge into) carries nothing to tag.
  return merged.filter((g) => g.some((x) => x.kind === "speech")).map((g, index) => {
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
