import { ACT_TARGET_MODE, ACT_VERBS, ladderRung } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";
import { HUMAN_REF } from "./scenario-drama.js";
import type { DramaRow, SceneCastMember, ScenarioDrama } from "./scenario-drama.js";

/**
 * The scenario's authored beats: a script of acts and scene cuts that the sidecar plays on the run's clock (`BeatPlayer`). The contract's
 * section 7 has a `drama` block (what the scene allows) and says an authored beat is `origin:"scenario"`, but defines no place to write
 * the beats themselves (errata P1-05, P4-01). This is the minimal additive reading: one more optional top-level key, `beats`, next to
 * `drama`, in the authoring form (cast names), in a markdown scene's frontmatter (cast names or agent ids) and in the compiled body
 * (agent ids). `SCENARIO_BODY_VERSION` stays 1, and the hotel, which reads only `body.drama`, never sees it.
 *
 * The author writes seconds and flags: `{ at: 90, actor: ricardo, verb: kill, with: otavio, skip: true }` and `{ at: 170, cut: "fim da festa" }`.
 * The body carries ms, ids and the wire's own names: `{ id: "b1", at_ms: 90000, kind: "act", actor, verb, with, authored_skip: true }`.
 */
export type ScenarioBeat =
  | { id: string; at_ms: number; kind: "act"; actor: string; verb: ActVerb; with?: string; authored_skip?: true }
  | { id: string; at_ms: number; kind: "cut"; reason: string };

/** What the author writes: seconds into the run, refs by cast name (a markdown author may write agent ids too), `skip` for `authored_skip`. */
export type ScenarioFormBeat = { at: number; actor?: string; verb?: string; with?: string; skip?: boolean; cut?: string };

/** A beat before it is numbered. */
type Bare = ScenarioBeat extends infer B ? (B extends unknown ? Omit<B, "id"> : never) : never;

export type BeatsCompile = { beats: ScenarioBeat[]; errors: DramaRow[]; warnings: DramaRow[] };

/** The most beats a scenario may script; a run is minutes long and a beat is a big moment. */
export const MAX_BEATS = 40;
/** The latest a beat may be scheduled: an hour into the run. */
export const MAX_BEAT_AT_S = 3600;
/** `scene_advance.reason` is cut at 40 characters on the wire (PI-01). */
export const CUT_REASON_MAX = 40;

const KEYS = ["at", "actor", "verb", "with", "skip", "cut"] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const isVerb = (v: unknown): v is ActVerb => typeof v === "string" && (ACT_VERBS as readonly string[]).includes(v);

type Draft = { index: number; beat: Bare };

/** How many entries of a raw `beats` list cut the scene: SCN-6 asks a scenario that can kill for at least one. */
export function countCuts(raw: unknown): number {
  return Array.isArray(raw) ? raw.filter((b) => isRecord(b) && b["cut"] !== undefined).length : 0;
}

/**
 * SCN-5 for the beats, in the author's words. `cast` lists the people as the compiled scenario names them: the agent id the beats come out in,
 * and the name a form writes (a markdown author may write either). `drama` is the compiled block (agent ids) or undefined for free play: an
 * authored skip needs one (SCN-4, an error), and a beat that the block itself will veto is a warning, since the gates would drop it at run time.
 */
export function compileSceneBeats(raw: unknown, cast: readonly SceneCastMember[], opts: { drama?: ScenarioDrama | undefined } = {}): BeatsCompile {
  const errors: DramaRow[] = [];
  const warnings: DramaRow[] = [];
  if (!Array.isArray(raw)) return { beats: [], errors: [{ path: "beats", message: "beats must be a list of acts and cuts" }], warnings };
  if (raw.length > MAX_BEATS) return { beats: [], errors: [{ path: "beats", message: `a scenario may script at most ${MAX_BEATS} beats` }], warnings };

  const idOf = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const key = norm(v);
    return cast.find((c) => norm(c.id) === key || norm(c.displayName) === key)?.id;
  };

  const drafts: Draft[] = [];
  raw.forEach((entry: unknown, index) => {
    const at = `beats[${index}]`;
    if (!isRecord(entry)) {
      errors.push({ path: at, message: "a beat is an object" });
      return;
    }
    const before = errors.length;
    for (const key of Object.keys(entry)) if (!(KEYS as readonly string[]).includes(key)) errors.push({ path: `${at}.${key}`, message: `unknown key "${key}"` });
    const seconds = entry["at"];
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_BEAT_AT_S) {
      errors.push({ path: `${at}.at`, message: `at is the second of the run the beat happens, from 0 to ${MAX_BEAT_AT_S}` });
    }
    const at_ms = typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;

    if (entry["cut"] !== undefined) {
      for (const key of ["actor", "verb", "with", "skip"]) if (entry[key] !== undefined) errors.push({ path: `${at}.${key}`, message: `a cut is only "at" and "cut", not "${key}"` });
      const reason = typeof entry["cut"] === "string" ? entry["cut"].replace(/\s+/g, " ").trim().slice(0, CUT_REASON_MAX) : "";
      if (reason === "") errors.push({ path: `${at}.cut`, message: "cut is the reason of the cut, as text" });
      if (errors.length === before) drafts.push({ index, beat: { at_ms, kind: "cut", reason } });
      return;
    }

    const actor = idOf(entry["actor"]);
    if (actor === undefined) errors.push({ path: `${at}.actor`, message: `"${String(entry["actor"])}" is not in the cast` });
    const verb = entry["verb"];
    if (!isVerb(verb)) {
      errors.push({ path: `${at}.verb`, message: `"${String(verb)}" is not one of the ${ACT_VERBS.length} verbs` });
      return;
    }
    const needs = ACT_TARGET_MODE[verb] === "required";
    const given = entry["with"];
    let target: string | undefined;
    if (given === undefined) {
      if (needs) errors.push({ path: `${at}.with`, message: `${verb} needs a target` });
    } else if (!needs) errors.push({ path: `${at}.with`, message: `${verb} has no target` });
    else if (given === HUMAN_REF) errors.push({ path: `${at}.with`, message: `${HUMAN_REF} is nobody in particular: a beat names an actor` });
    else {
      target = idOf(given);
      if (target === undefined) errors.push({ path: `${at}.with`, message: `"${String(given)}" is not in the cast` });
      else if (target === actor) errors.push({ path: `${at}.with`, message: "nobody aims at themselves" });
    }
    const skip = entry["skip"];
    if (skip !== undefined && typeof skip !== "boolean") errors.push({ path: `${at}.skip`, message: "skip is true or false" });
    else if (skip === true && opts.drama === undefined) errors.push({ path: `${at}.skip`, message: "an authored skip needs a drama block, even an empty one (SCN-4)" });
    if (errors.length > before || actor === undefined) return;
    const why = vetoedBy(verb, actor, target, opts.drama);
    if (why) warnings.push({ path: at, message: `drama.beat_vetoed: this beat will be refused by the scene's own block (${why}), so it is dropped when it comes` });
    drafts.push({ index, beat: { at_ms, kind: "act", actor, verb, ...(target !== undefined ? { with: target } : {}), ...(skip === true ? { authored_skip: true as const } : {}) } });
  });

  if (errors.length > 0) return { beats: [], errors, warnings };
  const beats = numbered(drafts.sort((a, b) => a.beat.at_ms - b.beat.at_ms || a.index - b.index).map((d) => d.beat));
  return { beats, errors, warnings };
}

/** What the scene's block says to a beat before the hotel does (SCN-1, SCN-3): the first rule that refuses it, in words. */
function vetoedBy(verb: ActVerb, actor: string, target: string | undefined, drama: ScenarioDrama | undefined): string | undefined {
  const rung = ladderRung(verb);
  if (rung === undefined) return undefined;
  if (drama === undefined) return rung >= 4 ? "free play has no slap, punch or kill" : undefined;
  if (rung > drama.max_rung) return `max_rung is ${drama.max_rung}`;
  if (rung < 4 || target === undefined) return undefined;
  if (!drama.may_target.some(([a, v]) => a === actor && v === target)) return "the pair is not in may_target";
  if (verb === "kill" && !drama.may_die.includes(target)) return "the victim is not in may_die";
  return undefined;
}

function numbered(beats: Array<Bare>): ScenarioBeat[] {
  return beats.map((b, i) => ({ ...b, id: `b${i + 1}` }) as ScenarioBeat);
}

/**
 * The body's half, read leniently: a beat that is not well formed or names someone the cast does not have is dropped, never a reason to
 * refuse the scenario. A dropped beat only does less than the author wrote, so unlike a `drama` block it is not a looser reading. Ids are
 * kept when they are unique, else numbered again, so a player rebuilt from the same body never plays one beat twice.
 */
export function cleanBeats(raw: unknown, agentIds: readonly string[]): { beats?: ScenarioBeat[] } {
  if (!Array.isArray(raw)) return {};
  const known = new Set(agentIds);
  const keep: Array<{ id: string | undefined; beat: Bare }> = [];
  for (const b of raw as unknown[]) {
    if (!isRecord(b)) continue;
    const at_ms = b["at_ms"];
    if (typeof at_ms !== "number" || !Number.isFinite(at_ms) || at_ms < 0 || at_ms > MAX_BEAT_AT_S * 1000) continue;
    const id = typeof b["id"] === "string" && b["id"] !== "" ? b["id"] : undefined;
    if (b["kind"] === "cut") {
      if (typeof b["reason"] === "string" && b["reason"] !== "") keep.push({ id, beat: { at_ms, kind: "cut", reason: b["reason"].slice(0, CUT_REASON_MAX) } });
      continue;
    }
    const actor = b["actor"];
    const verb = b["verb"];
    const target = b["with"];
    if (b["kind"] !== "act" || typeof actor !== "string" || !known.has(actor) || !isVerb(verb)) continue;
    const needs = ACT_TARGET_MODE[verb] === "required";
    if (needs !== (target !== undefined) || (target !== undefined && (typeof target !== "string" || !known.has(target) || target === actor))) continue;
    keep.push({ id, beat: { at_ms, kind: "act", actor, verb, ...(typeof target === "string" ? { with: target } : {}), ...(b["authored_skip"] === true ? { authored_skip: true as const } : {}) } });
  }
  if (keep.length === 0) return {};
  const sorted = keep.slice(0, MAX_BEATS).sort((a, b) => a.beat.at_ms - b.beat.at_ms);
  const seen = new Set<string>();
  const beats = sorted.map((k, i) => {
    let id = k.id;
    if (id === undefined || seen.has(id)) {
      let n = i + 1;
      while (seen.has(`b${n}`) || sorted.some((o) => o.id === `b${n}`)) n += 1;
      id = `b${n}`;
    }
    seen.add(id);
    return { ...k.beat, id } as ScenarioBeat;
  });
  return { beats };
}
