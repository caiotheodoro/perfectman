import { ACT_TARGET_MODE, ACT_VERBS, PHYSICAL_VERBS, ladderRung } from "../space/act-verbs.js";
import type { ActVerb } from "../space/act-verbs.js";

/**
 * What a drafted story can script (the drafting skill, `safety-and-gates.md`). A model's `beats` are untrusted: `repairBeats` keeps the ones
 * the loader accepts and the ladder allows, repairs what has an obvious repair and drops the rest, so a draft never ships a file that
 * `scenario-beats.ts` or `scenario-drama.ts` rejects or whose script the hotel would refuse. The `drama` block is derived from the beats that
 * survive, never asked of the model: the smallest block that covers them.
 *
 * Pure and idempotent (`repairBeats(repairBeats(x).beats)` changes nothing). Refs are cast names; `roomFiles` turns them into agent ids.
 */

/** A scripted beat as a draft writes it: the second of the run and cast names. A cut is only `at` and `cut`. */
export type DraftBeat = { at: number; actor?: string; verb?: string; with?: string; skip?: boolean; cut?: string };

/** The `drama` block of the scene, by cast name. */
export type DraftDrama = { max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean };

export type RepairedBeats = { beats: DraftBeat[]; drama?: DraftDrama; /** What was changed or dropped, in words (for tests and logs; never shown as story). */ repairs: string[] };

/** The first scripted beat comes no earlier than this (skill: leave the first beat at 15 s or later). */
export const FIRST_BEAT_MIN_S = 15;
/** LAD-3: physical beats (shove, slap, punch, kill) start at least this far apart. */
export const PHYSICAL_SPACING_S = 20;
/** `scene_advance.reason` is cut at 40 characters on the wire. */
export const CUT_REASON_MAX = 40;
/** A draft is a scene, not a script: this many beats at most (the loader's own cap is 40). */
export const MAX_DRAFT_BEATS = 12;
/** The latest second a draft may script (the loader allows 3600). */
const LATEST_S = 3500;
/** How long after a death the cut that ends the scene comes, when the draft wrote none. */
const CUT_AFTER_DEATH_S = 30;
/** Verbs that touch the other person: both must start standing, side by side. */
export const CONTACT_VERBS: readonly ActVerb[] = [...PHYSICAL_VERBS, "hug", "kiss", "restrain"];
/** A death: `kill` (the target dies) or `die` (the actor does). */
const DEATH_VERBS: readonly ActVerb[] = ["kill", "die"];

const HUMAN_REF = "@human";
const CUT_REASON = { en: "end of the scene", "pt-BR": "fim da cena" } as const;
const prose = (value: string): string => value.replace(/\s+/g, " ").trim();
const keyOf = (value: string): string => prose(value).toLowerCase();
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isVerb = (v: string): v is ActVerb => (ACT_VERBS as readonly string[]).includes(v);

type Act = { kind: "act"; at: number; actor: string; verb: ActVerb; with?: string; skip?: true };
type Cut = { kind: "cut"; at: number; reason: string };
type Item = Act | Cut;

/** The verb as a model may spell it ("Kill", "freeze gasp", "turn-back"). */
const verbOf = (raw: unknown): string => (typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "");

function readItems(raw: unknown[], resolve: (name: unknown) => string | undefined, repairs: string[]): Item[] {
  const items: Item[] = [];
  raw.slice(0, MAX_DRAFT_BEATS * 3).forEach((entry, index) => {
    const at = `beats[${index}]`;
    if (!isRecord(entry)) return void repairs.push(`${at}: not an object, dropped`);
    const seconds = entry["at"];
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return void repairs.push(`${at}: no valid second, dropped`);
    const when = Math.min(LATEST_S, Math.round(seconds * 10) / 10);
    if (entry["cut"] !== undefined) {
      const reason = typeof entry["cut"] === "string" ? prose(entry["cut"]).slice(0, CUT_REASON_MAX) : "";
      if (reason === "") return void repairs.push(`${at}: a cut with no reason, dropped`);
      items.push({ kind: "cut", at: when, reason });
      return;
    }
    if ([entry["actor"], entry["with"]].some((ref) => typeof ref === "string" && ref.includes(HUMAN_REF))) return void repairs.push(`${at}: names ${HUMAN_REF}, dropped`);
    const actor = resolve(entry["actor"]);
    if (actor === undefined) return void repairs.push(`${at}: "${String(entry["actor"])}" is not in the cast, dropped`);
    const verb = verbOf(entry["verb"]);
    if (!isVerb(verb)) return void repairs.push(`${at}: "${String(entry["verb"])}" is not one of the ${ACT_VERBS.length} verbs, dropped`);
    if (ACT_TARGET_MODE[verb] === "none") {
      if (entry["with"] !== undefined) repairs.push(`${at}: ${verb} has no target, target removed`);
      items.push({ kind: "act", at: when, actor, verb });
      return;
    }
    const target = resolve(entry["with"]);
    if (target === undefined) return void repairs.push(`${at}: ${verb} needs a target in the cast, dropped`);
    if (target === actor) return void repairs.push(`${at}: nobody aims at themselves, dropped`);
    items.push({ kind: "act", at: when, actor, verb, with: target });
  });
  return items;
}

/** One pass over the items in time order. Returns the items it keeps; `repairs` gets a line for each change. */
function pass(sorted: Item[], repairs: string[]): Item[] {
  // The peak is the highest ladder rung used (the first of equals, which is the death that stays): the one beat an authored skip may carry.
  let peak = -1;
  let peakRung = 0;
  sorted.forEach((item, i) => {
    const rung = item.kind === "act" ? (ladderRung(item.verb) ?? 0) : 0;
    if (rung > peakRung) [peak, peakRung] = [i, rung];
  });

  const out: Item[] = [];
  const rungs = new Map<string, number>();
  let lastPhysical = -Infinity;
  let death = false;
  let firstCut = sorted.findIndex((item) => item.kind === "cut");
  if (firstCut < 0) firstCut = sorted.length;

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    if (item.kind === "cut") {
      out.push(item);
      rungs.clear();
      lastPhysical = -Infinity;
      continue;
    }
    let at = item.at;
    if (i < firstCut && at < FIRST_BEAT_MIN_S) {
      repairs.push(`${item.verb} at ${at}s moved to ${FIRST_BEAT_MIN_S}s (the first beat comes at 15 s or later)`);
      at = FIRST_BEAT_MIN_S;
    }
    if (DEATH_VERBS.includes(item.verb)) {
      if (death) {
        repairs.push(`second death (${item.verb}) dropped: one death per scene`);
        continue;
      }
    }
    if ((PHYSICAL_VERBS as readonly string[]).includes(item.verb) && at - lastPhysical < PHYSICAL_SPACING_S) {
      const moved = Math.round((lastPhysical + PHYSICAL_SPACING_S) * 10) / 10;
      const nextCut = sorted.slice(i + 1).find((later) => later.kind === "cut");
      if (moved > LATEST_S || (nextCut !== undefined && nextCut.at <= moved)) {
        repairs.push(`${item.verb} at ${at}s is under ${PHYSICAL_SPACING_S}s after the last physical beat and cannot move, dropped`);
        continue;
      }
      repairs.push(`${item.verb} at ${at}s moved to ${moved}s (physical beats are ${PHYSICAL_SPACING_S}s apart)`);
      at = moved;
    }
    const rung = ladderRung(item.verb);
    let skip = false;
    if (rung !== undefined) {
      const pair = `${item.actor}|${item.with ?? ""}`;
      const current = rungs.get(pair) ?? 0;
      if (rung > Math.max(current, 1) + 1) {
        if (i === peak) skip = true;
        else {
          repairs.push(`${item.verb} at ${at}s skips the ladder and is not the peak, dropped`);
          continue;
        }
      }
      rungs.set(pair, rung);
    }
    if ((PHYSICAL_VERBS as readonly string[]).includes(item.verb)) lastPhysical = at;
    if (DEATH_VERBS.includes(item.verb)) death = true;
    out.push({ kind: "act", at, actor: item.actor, verb: item.verb, ...(item.with !== undefined ? { with: item.with } : {}), ...(skip ? { skip: true as const } : {}) });
  }
  return out;
}

/** The draft's beats, made safe. `raw` is whatever the model wrote under `beats`; `names` the cast. */
export function repairBeats(raw: unknown, names: readonly string[], language: "en" | "pt-BR" = "en"): RepairedBeats {
  const repairs: string[] = [];
  if (!Array.isArray(raw)) return { beats: [], repairs: raw === undefined || raw === null ? [] : ["beats is not a list, dropped"] };
  const cast = new Map(names.map((name) => [keyOf(name), prose(name)]));
  const resolve = (name: unknown): string | undefined => (typeof name === "string" ? cast.get(keyOf(name)) : undefined);

  let items = readItems(raw, resolve, repairs);
  // Moving a beat for spacing can reorder it past its neighbours, so run to a fixed point (a few rounds at most).
  for (let round = 0; round < 4; round += 1) {
    const sorted = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.at - b.item.at || a.index - b.index).map((entry) => entry.item);
    const next = pass(sorted, repairs);
    const same = next.length === items.length && next.every((item, i) => JSON.stringify(item) === JSON.stringify(items[i]));
    items = next;
    if (same) break;
  }
  items = items.slice(0, MAX_DRAFT_BEATS);

  const acts = items.filter((item): item is Act => item.kind === "act");
  if (acts.length === 0) return { beats: [], repairs: items.length > 0 ? [...repairs, "no act left, the script is dropped"] : repairs };

  // SCN-6: a scene with a death needs a cut after it, or the body stays until the run ends.
  const death = acts.find((act) => DEATH_VERBS.includes(act.verb));
  if (death && !items.some((item) => item.kind === "cut" && item.at > death.at)) {
    repairs.push(`no cut after the death, one added at ${death.at + CUT_AFTER_DEATH_S}s`);
    items.push({ kind: "cut", at: death.at + CUT_AFTER_DEATH_S, reason: CUT_REASON[language] });
    items = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.at - b.item.at || a.index - b.index).map((entry) => entry.item);
  }

  const beats: DraftBeat[] = items.map((item) =>
    item.kind === "cut" ? { at: item.at, cut: item.reason } : { at: item.at, actor: item.actor, verb: item.verb, ...(item.with !== undefined ? { with: item.with } : {}), ...(item.skip ? { skip: true } : {}) },
  );

  const may_target: Array<[string, string]> = [];
  const may_die: string[] = [];
  for (const act of acts) {
    if ((ladderRung(act.verb) ?? 0) >= 4 && act.with !== undefined && !may_target.some(([a, v]) => a === act.actor && v === act.with)) may_target.push([act.actor, act.with]);
    const victim = act.verb === "kill" ? act.with : act.verb === "die" ? act.actor : undefined;
    if (victim !== undefined && !may_die.includes(victim)) may_die.push(victim);
  }
  const drama: DraftDrama = { max_rung: Math.max(0, ...acts.map((act) => ladderRung(act.verb) ?? 0)), may_target, may_die, permadeath: may_die.length > 0 };
  return { beats, drama, repairs };
}
