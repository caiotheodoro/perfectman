import { ACT_TARGET_MODE, ACT_VERBS, PHYSICAL_VERBS, ladderRung } from "../space/act-verbs.js";
import type { ActVerb } from "../space/act-verbs.js";
import { CUT_REASON_MAX } from "../live/draft-beats.js";
import {
  AFTERMATH_MAX_MS,
  CLIMAX_COMFORT_MS,
  CLIMAX_MAX_MS,
  CLIMAX_VERBS,
  INCITING_MAX_MS,
  MAX_SHEET_BEATS,
  PAUSE_MAX_MS,
  REVERSAL_SCENE_MS,
  SHEET_BLOCK_HOWS,
  SHEET_COST_CAP_USD,
  SHEET_CUT_FLOOR_MS,
  SHEET_FACES,
  SHEET_MOVES,
  SHEET_PHASES,
  SHEET_PHYSICAL_SPACING_MS,
  SHEET_PROP_OPS,
  SHEET_REVEAL_VIAS,
  SHEET_SHOTS,
  SHEET_VERSION,
} from "./types.js";
import type { BeatSheet, BeatSheetArc, BeatSheetOrigin, CameraIntent, Phase, RoomBrief, SheetBeat, SheetCastMember, SheetDrama, SheetIssue, SheetPlace } from "./types.js";

/**
 * The beat sheet's validator (Contract A, "Invariants"). Pure. It reads whatever a model or an author wrote, resolves cast names to agent ids, repairs the
 * slips that have one obvious repair (a warning each) and refuses the rest (an error each, in the `DramaRow` style: `{path, message}`, a warning's message
 * starting with its id). A sheet comes back only when there is no error. Dialogue is never accepted: the actors write every word.
 */

export type SheetContext = {
  cast: readonly SheetCastMember[];
  /**
   * The scene's `drama` block with agent ids. `"derive"`: the compile will derive one that covers the sheet (the scene wrote none), so the block never
   * refuses; the ladder still holds. Absent: free play, where a rung of 4 or more and an authored skip have no gate (SCN-1, SCN-4).
   */
  drama?: SheetDrama | "derive" | undefined;
  room?: RoomBrief | undefined;
  /** B2's scene flag: an act may name `@human`. Without it a sheet names actors only. */
  mayTargetHumans?: boolean | undefined;
};

export type SheetCompile = { sheet?: BeatSheet; errors: SheetIssue[]; warnings: SheetIssue[] };

export const SHEET_SAME_VERB_COOLDOWN_MS = 60_000;
const HUMAN_REF = "@human";
/** How many rungs of the ladder a sheet act may skip before it is thrown back: the sheet is its own author, so a small skip is marked `authored_skip` for it. */
const SHEET_IMPLIED_SKIP_MAX = 3;
const TOP_KEYS = ["version", "premise", "stakes", "arc", "beats", "generated_by"] as const;
const ARC_KEYS = ["inciting_at_ms", "reversal_at_ms", "climax_at_ms", "aftermath_until_ms"] as const;
const BASE_KEYS = ["id", "at_ms", "phase", "kind", "gist"] as const;
const KIND_KEYS: Record<string, readonly string[]> = {
  act: ["actor", "verb", "with", "authored_skip", "climax"],
  cut: ["reason"],
  block: ["actor", "to", "how"],
  prop: ["actor", "prop", "op", "to"],
  reveal: ["fact", "to", "from", "via"],
  note: ["actor", "objective", "tactic", "subtext", "until_ms"],
  pause: ["ms"],
  expression: ["actor", "face", "ms"],
  camera: ["intent"],
};
/** Keys that would carry a spoken line. A sheet that has one is refused, not trimmed (invariant 7). */
const DIALOGUE_KEYS = new Set(["text", "say", "line", "lines", "dialogue", "speech", "quote", "utterance", "reply"]);
const QUOTED = /["“«]([^"“”«»]{18,})["”»]/u;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const norm = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
const isVerb = (v: unknown): v is ActVerb => typeof v === "string" && (ACT_VERBS as readonly string[]).includes(v);
const isPhysical = (v: ActVerb): boolean => (PHYSICAL_VERBS as readonly string[]).includes(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Slug-like: how a furniture id or a named prop is written. */
const labelKey = (s: string): string => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

const PHASE_INDEX = new Map<Phase, number>(SHEET_PHASES.map((p, i) => [p, i]));

export function validateBeatSheet(raw: unknown, ctx: SheetContext): SheetCompile {
  const errors: SheetIssue[] = [];
  const warnings: SheetIssue[] = [];
  const err = (path: string, message: string): void => void errors.push({ path, message });
  const warn = (path: string, id: string, message: string): void => void warnings.push({ path, message: `${id}: ${message}` });

  if (!isRecord(raw)) return { errors: [{ path: "beat_sheet", message: "beat_sheet must be an object" }], warnings };
  for (const key of Object.keys(raw)) if (!(TOP_KEYS as readonly string[]).includes(key)) warn(`beat_sheet.${key}`, "beat_sheet.unknown_key", `"${key}" is not part of the sheet and is dropped`);
  if (raw["version"] !== undefined && raw["version"] !== SHEET_VERSION) err("beat_sheet.version", `version must be ${SHEET_VERSION}`);

  const cast = ctx.cast;
  const idOf = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const key = norm(v);
    return cast.find((c) => norm(c.id) === key || norm(c.displayName) === key)?.id;
  };

  // ---- the prose: premise and stakes ------------------------------------------------------------------------------
  const prose = (path: string, v: unknown, max: number, required: boolean): string => {
    if (typeof v !== "string" || v.trim() === "") {
      if (required) err(path, `${path.split(".").pop()} is text`);
      return "";
    }
    const t = v.replace(/\s+/g, " ").trim();
    if (QUOTED.test(t) && words(QUOTED.exec(t)?.[1] ?? "") >= 4) err(path, "beat_sheet.dialogue: a sheet steers, it never writes what a person says (no quoted lines)");
    if (t.length > max) {
      warn(path, "beat_sheet.trimmed", `cut to ${max} characters`);
      return t.slice(0, max).replace(/[\s,;:.]+$/u, "");
    }
    return t;
  };
  const premise = prose("beat_sheet.premise", raw["premise"], 200, true);
  const stakes = prose("beat_sheet.stakes", raw["stakes"], 240, true);

  // ---- arc -----------------------------------------------------------------------------------------------------
  const arcRaw = raw["arc"];
  const arcIn: Partial<Record<(typeof ARC_KEYS)[number], number>> = {};
  if (!isRecord(arcRaw)) err("beat_sheet.arc", "arc is an object with inciting_at_ms, climax_at_ms and aftermath_until_ms");
  else {
    for (const key of Object.keys(arcRaw)) if (!(ARC_KEYS as readonly string[]).includes(key)) warn(`beat_sheet.arc.${key}`, "beat_sheet.unknown_key", `"${key}" is dropped`);
    for (const key of ARC_KEYS) {
      const v = arcRaw[key];
      if (v === undefined) {
        if (key !== "reversal_at_ms") err(`beat_sheet.arc.${key}`, `${key} is required (ms on the run clock)`);
      } else if (!isNum(v) || v < 0) err(`beat_sheet.arc.${key}`, `${key} is a number of ms, 0 or more`);
      else arcIn[key] = Math.round(v);
    }
  }

  // ---- beats ---------------------------------------------------------------------------------------------------
  const rawBeats = raw["beats"];
  if (!Array.isArray(rawBeats)) {
    err("beat_sheet.beats", "beats is a list");
    return { errors, warnings };
  }
  if (rawBeats.length === 0) err("beat_sheet.beats", "a sheet needs beats");
  if (rawBeats.length > MAX_SHEET_BEATS) {
    err("beat_sheet.beats", `a sheet has at most ${MAX_SHEET_BEATS} beats`);
    return { errors, warnings };
  }

  type Draft = { index: number; beat: SheetBeat };
  const drafts: Draft[] = [];
  const room = ctx.room;
  const furni = new Set((room?.furni ?? []).flatMap((f) => [labelKey(f.label), ...(f.id !== undefined ? [labelKey(String(f.id))] : [])]));
  const zones = new Set((room?.zones ?? []).flatMap((z) => [labelKey(z.label), ...(z.kind ? [labelKey(z.kind)] : []), ...(z.id ? [labelKey(z.id)] : [])]));
  const places = new Set((room?.places ?? []).map(labelKey));
  const inRoom = (set: Set<string>, name: string): boolean => {
    const k = labelKey(name);
    if (set.has(k)) return true;
    for (const have of set) if (have !== "" && (have.includes(k) || k.includes(have))) return true;
    return false;
  };
  const known = (name: string): boolean => inRoom(furni, name) || inRoom(zones, name) || inRoom(places, name);
  const roomKnown = furni.size + zones.size + places.size > 0;

  rawBeats.forEach((entry: unknown, index) => {
    const at = `beat_sheet.beats[${index}]`;
    if (!isRecord(entry)) return err(at, "a beat is an object");
    const before = errors.length;
    const kind = entry["kind"];
    if (typeof kind !== "string" || !(kind in KIND_KEYS)) return err(`${at}.kind`, `kind is one of ${Object.keys(KIND_KEYS).join(", ")}`);
    for (const key of Object.keys(entry)) {
      if (DIALOGUE_KEYS.has(key)) err(`${at}.${key}`, "beat_sheet.dialogue: a sheet never writes dialogue; the actors improvise every word (use gist / note to steer)");
      else if (!(BASE_KEYS as readonly string[]).includes(key) && !(KIND_KEYS[kind] ?? []).includes(key)) warn(`${at}.${key}`, "beat_sheet.unknown_key", `"${key}" is not a key of a ${kind} beat and is dropped`);
    }
    const at_ms = entry["at_ms"];
    if (!isNum(at_ms) || at_ms < 0 || at_ms > AFTERMATH_MAX_MS) err(`${at}.at_ms`, `at_ms is the ms of the run the beat happens, from 0 to ${AFTERMATH_MAX_MS}`);
    const phase = entry["phase"];
    if (typeof phase !== "string" || !PHASE_INDEX.has(phase as Phase)) err(`${at}.phase`, `phase is one of ${SHEET_PHASES.join(", ")}`);
    const id = typeof entry["id"] === "string" && entry["id"].trim() !== "" ? entry["id"].trim().slice(0, 32) : `s${index + 1}`;
    const gist = entry["gist"] === undefined ? undefined : prose(`${at}.gist`, entry["gist"], 180, false);
    const actorOf = (key: string): string => {
      const v = idOf(entry[key]);
      if (v === undefined) err(`${at}.${key}`, `"${String(entry[key])}" is not in the cast`);
      return v ?? "";
    };
    const base = { id, at_ms: isNum(at_ms) ? Math.round(at_ms) : 0, phase: phase as Phase, ...(gist ? { gist } : {}) };
    let beat: SheetBeat | undefined;

    switch (kind) {
      case "act": {
        const actor = actorOf("actor");
        const verb = entry["verb"];
        if (!isVerb(verb)) {
          err(`${at}.verb`, `"${String(verb)}" is not one of the ${ACT_VERBS.length} verbs`);
          break;
        }
        const needs = ACT_TARGET_MODE[verb] === "required";
        const given = entry["with"];
        let target: string | undefined;
        if (given === undefined) {
          if (needs) err(`${at}.with`, `${verb} needs a target`);
        } else if (!needs) warn(`${at}.with`, "beat_sheet.target_dropped", `${verb} takes no target, so "${String(given)}" is ignored`);
        else if (given === HUMAN_REF) {
          if (ctx.mayTargetHumans === true) target = HUMAN_REF;
          else err(`${at}.with`, `${HUMAN_REF} is nobody in particular: a sheet names actors (the humans are the director's to aim at)`);
        } else {
          target = idOf(given);
          if (target === undefined) err(`${at}.with`, `"${String(given)}" is not in the cast`);
          else if (target === actor) err(`${at}.with`, "nobody aims at themselves");
        }
        const skip = entry["authored_skip"];
        const climax = entry["climax"];
        if (skip !== undefined && skip !== true) err(`${at}.authored_skip`, "authored_skip is true when present");
        if (climax !== undefined && climax !== true) err(`${at}.climax`, "climax is true on the one climax act");
        if (errors.length > before) break;
        beat = { ...base, kind: "act", actor, verb, ...(target !== undefined ? { with: target } : {}), ...(skip === true ? { authored_skip: true as const } : {}), ...(climax === true ? { climax: true as const } : {}) };
        break;
      }
      case "cut": {
        const reason = typeof entry["reason"] === "string" ? entry["reason"].replace(/\s+/g, " ").trim() : "";
        if (reason === "") err(`${at}.reason`, "reason is the text of the cut");
        if (errors.length > before) break;
        beat = { ...base, kind: "cut", reason: reason.slice(0, CUT_REASON_MAX) };
        break;
      }
      case "block": {
        const actor = actorOf("actor");
        const to = readPlace(entry["to"], `${at}.to`, err, idOf);
        const how = entry["how"];
        if (how !== undefined && !(SHEET_BLOCK_HOWS as readonly unknown[]).includes(how)) err(`${at}.how`, `how is one of ${SHEET_BLOCK_HOWS.join(", ")}`);
        if (errors.length > before || to === undefined) break;
        if (roomKnown) {
          if (to.zone !== undefined && !known(to.zone)) warn(`${at}.to.zone`, "beat_sheet.place_unknown", `"${to.zone}" is not in the room; the planner will pick the nearest place`);
          if (to.near !== undefined && idOf(to.near) === undefined && !known(to.near)) warn(`${at}.to.near`, "beat_sheet.place_unknown", `"${to.near}" is not in the room; the planner will pick the nearest place`);
        }
        beat = { ...base, kind: "block", actor, to, ...(how !== undefined ? { how: how as (typeof SHEET_BLOCK_HOWS)[number] } : {}) };
        break;
      }
      case "prop": {
        const actor = actorOf("actor");
        const prop = typeof entry["prop"] === "string" ? entry["prop"].replace(/\s+/g, " ").trim().slice(0, 40) : "";
        if (prop === "") err(`${at}.prop`, "prop is a furniture id or the name of an object");
        const op = entry["op"];
        if (!(SHEET_PROP_OPS as readonly unknown[]).includes(op)) err(`${at}.op`, `op is one of ${SHEET_PROP_OPS.join(", ")}`);
        const toRaw = entry["to"];
        let to: string | undefined;
        if (toRaw !== undefined) {
          if (typeof toRaw !== "string" || toRaw.trim() === "") err(`${at}.to`, "to is a cast member or a place");
          else to = idOf(toRaw) ?? toRaw.replace(/\s+/g, " ").trim().slice(0, 40);
        }
        if ((op === "hand" || op === "show") && to !== undefined && idOf(to) === undefined && cast.length > 0) warn(`${at}.to`, "beat_sheet.prop_target", `${String(op)} goes to a cast member; "${to}" is not one`);
        if (errors.length > before) break;
        if (roomKnown && !known(prop)) warn(`${at}.prop`, "beat_sheet.prop_mimed", `"${prop}" is not in the room's furniture; the planner mimes it`);
        beat = { ...base, kind: "prop", actor, prop, op: op as (typeof SHEET_PROP_OPS)[number], ...(to !== undefined ? { to } : {}) };
        break;
      }
      case "reveal": {
        const fact = prose(`${at}.fact`, entry["fact"], 240, true);
        const toRaw = entry["to"];
        const to: string[] = [];
        if (!Array.isArray(toRaw) || toRaw.length === 0) err(`${at}.to`, "to is the list of cast members who learn it");
        else
          toRaw.forEach((t, i) => {
            const id = idOf(t);
            if (id === undefined) err(`${at}.to[${i}]`, `"${String(t)}" is not in the cast`);
            else if (!to.includes(id)) to.push(id);
          });
        let from: string | undefined;
        if (entry["from"] !== undefined) {
          from = idOf(entry["from"]);
          if (from === undefined) err(`${at}.from`, `"${String(entry["from"])}" is not in the cast`);
        }
        const via = entry["via"];
        if (!(SHEET_REVEAL_VIAS as readonly unknown[]).includes(via)) err(`${at}.via`, `via is one of ${SHEET_REVEAL_VIAS.join(", ")}`);
        if (errors.length > before) break;
        beat = { ...base, kind: "reveal", fact, to, ...(from !== undefined ? { from } : {}), via: via as (typeof SHEET_REVEAL_VIAS)[number] };
        break;
      }
      case "note": {
        const actor = actorOf("actor");
        const objective = prose(`${at}.objective`, entry["objective"], 220, true);
        const tactic = entry["tactic"] === undefined ? undefined : prose(`${at}.tactic`, entry["tactic"], 40, false);
        const subtext = entry["subtext"] === undefined ? undefined : prose(`${at}.subtext`, entry["subtext"], 180, false);
        let until: number | undefined;
        if (entry["until_ms"] !== undefined) {
          if (!isNum(entry["until_ms"]) || (isNum(at_ms) && entry["until_ms"] <= at_ms)) err(`${at}.until_ms`, "until_ms is a time after the note starts");
          else until = Math.round(entry["until_ms"]);
        }
        if (errors.length > before) break;
        beat = { ...base, kind: "note", actor, objective, ...(tactic ? { tactic } : {}), ...(subtext ? { subtext } : {}), ...(until !== undefined ? { until_ms: until } : {}) };
        break;
      }
      case "pause": {
        const ms = entry["ms"];
        if (!isNum(ms) || ms < 500 || ms > PAUSE_MAX_MS) err(`${at}.ms`, `ms is the silence, from 500 to ${PAUSE_MAX_MS}`);
        if (errors.length > before) break;
        beat = { ...base, kind: "pause", ms: Math.round(ms as number) };
        break;
      }
      case "expression": {
        const actor = actorOf("actor");
        const face = entry["face"];
        if (!(SHEET_FACES as readonly unknown[]).includes(face)) err(`${at}.face`, `face is one of ${SHEET_FACES.join(", ")}`);
        const ms = entry["ms"];
        if (ms !== undefined && (!isNum(ms) || ms < 0 || ms > 60_000)) err(`${at}.ms`, "ms is how long the face is held, up to 60000");
        if (errors.length > before) break;
        beat = { ...base, kind: "expression", actor, face: face as (typeof SHEET_FACES)[number], ...(ms !== undefined ? { ms: Math.round(ms as number) } : {}) };
        break;
      }
      case "camera": {
        const intent = readCamera(entry["intent"], `${at}.intent`, err, idOf, (path, message) => warn(path, "beat_sheet.camera_detail_dropped", message));
        if (errors.length > before || intent === undefined) break;
        beat = { ...base, kind: "camera", intent };
        break;
      }
    }
    if (beat !== undefined && errors.length === before) drafts.push({ index, beat });
  });

  if (errors.length > 0) return { errors, warnings };

  const sorted = drafts.sort((a, b) => a.beat.at_ms - b.beat.at_ms || a.index - b.index).map((d) => d.beat);
  const seen = new Set<string>();
  for (const b of sorted) {
    if (seen.has(b.id)) err(`beat_sheet.beats`, `two beats share the id "${b.id}"`);
    seen.add(b.id);
  }

  // ---- phases in order ---------------------------------------------------------------------------------------
  let high = -1;
  let highPhase: Phase = "setup";
  for (const b of sorted) {
    const p = PHASE_INDEX.get(b.phase) ?? 0;
    if (p < high) {
      err(`beat_sheet.beats.${b.id}`, `beat_sheet.phase_order: ${b.phase} at ${b.at_ms} ms comes after ${highPhase}; phases run setup, inciting, escalation, reversal, climax, aftermath in time order`);
      break;
    }
    if (p > high) [high, highPhase] = [p, b.phase];
  }

  // ---- the climax (invariant 1) ----------------------------------------------------------------------------------
  const climaxActs = sorted.filter((b): b is Extract<SheetBeat, { kind: "act" }> => b.kind === "act" && b.climax === true);
  const climax = climaxActs[0];
  if (climaxActs.length !== 1) err("beat_sheet.beats", `beat_sheet.climax: exactly one act has climax:true (found ${climaxActs.length})`);
  if (climax) {
    if (!(CLIMAX_VERBS as readonly string[]).includes(climax.verb)) err(`beat_sheet.beats.${climax.id}`, `beat_sheet.climax: the climax is a physical act (${CLIMAX_VERBS.join(", ")}), not ${climax.verb}`);
    if (climax.phase !== "climax") err(`beat_sheet.beats.${climax.id}`, `beat_sheet.climax: the climax act has phase "climax"`);
    if (climax.at_ms > CLIMAX_MAX_MS) err(`beat_sheet.beats.${climax.id}`, `beat_sheet.climax_late: the physical climax comes by ${CLIMAX_MAX_MS} ms (4:00), not at ${climax.at_ms}`);
    else if (climax.at_ms > CLIMAX_COMFORT_MS) warn(`beat_sheet.beats.${climax.id}`, "beat_sheet.climax_tight", `the climax at ${climax.at_ms} ms leaves under 15 s to force it if the pair is apart or busy`);
  }

  // ---- the arc, reconciled with the beats ----------------------------------------------------------------------
  const inciting = sorted.find((b) => b.phase === "inciting");
  const lastAt = sorted.length > 0 ? sorted[sorted.length - 1]!.at_ms : 0;
  if (!inciting) err("beat_sheet.beats", "beat_sheet.inciting: a beat has phase inciting (the moment the scene stops being small talk)");
  const arc: Partial<BeatSheetArc> = {};
  if (inciting) {
    if (inciting.at_ms > INCITING_MAX_MS) err(`beat_sheet.beats.${inciting.id}`, `beat_sheet.inciting_late: the inciting incident comes by ${INCITING_MAX_MS} ms, not ${inciting.at_ms}`);
    if (arcIn.inciting_at_ms !== undefined && arcIn.inciting_at_ms !== inciting.at_ms) warn("beat_sheet.arc.inciting_at_ms", "beat_sheet.arc_fixed", `set to the first inciting beat, ${inciting.at_ms} ms`);
    arc.inciting_at_ms = inciting.at_ms;
  }
  if (climax) {
    if (arcIn.climax_at_ms !== undefined && arcIn.climax_at_ms !== climax.at_ms) warn("beat_sheet.arc.climax_at_ms", "beat_sheet.arc_fixed", `set to the climax act, ${climax.at_ms} ms`);
    arc.climax_at_ms = climax.at_ms;
  }
  const reversals = sorted.filter((b) => b.phase === "reversal" && (b.kind === "reveal" || b.kind === "note"));
  if (arcIn.reversal_at_ms !== undefined) arc.reversal_at_ms = arcIn.reversal_at_ms;
  if (reversals[0] && arc.reversal_at_ms !== reversals[0].at_ms) {
    if (arcIn.reversal_at_ms !== undefined) warn("beat_sheet.arc.reversal_at_ms", "beat_sheet.arc_fixed", `set to the first reversal beat, ${reversals[0].at_ms} ms`);
    arc.reversal_at_ms = reversals[0].at_ms;
  }
  if (arcIn.aftermath_until_ms !== undefined) {
    arc.aftermath_until_ms = arcIn.aftermath_until_ms;
    if (arc.aftermath_until_ms < lastAt) {
      warn("beat_sheet.arc.aftermath_until_ms", "beat_sheet.arc_fixed", `raised to the last beat, ${lastAt} ms`);
      arc.aftermath_until_ms = lastAt;
    }
  }
  if (climax && arc.aftermath_until_ms !== undefined && arc.aftermath_until_ms <= climax.at_ms) err("beat_sheet.arc.aftermath_until_ms", "beat_sheet.aftermath: aftermath_until_ms comes after the climax");
  if (arc.aftermath_until_ms !== undefined && arc.aftermath_until_ms > AFTERMATH_MAX_MS) err("beat_sheet.arc.aftermath_until_ms", `a sheet scene runs at most ${AFTERMATH_MAX_MS} ms`);

  // ---- ladder, spacing, block (invariant 2) --------------------------------------------------------------------
  const block = ctx.drama;
  const rungs = new Map<string, number>();
  let lastPhysical: { at: number; id: string } | undefined;
  const lastSame = new Map<string, number>();
  let deaths = 0;
  let kills = 0;
  let skips = 0;
  let lastCut: number | undefined;
  for (const b of sorted) {
    if (b.kind === "cut") {
      rungs.clear();
      lastPhysical = undefined;
      lastSame.clear();
      deaths = 0;
      kills = 0;
      if (lastCut !== undefined && b.at_ms - lastCut < SHEET_CUT_FLOOR_MS) err(`beat_sheet.beats.${b.id}`, `beat_sheet.cut_floor: a scene is at least ${SHEET_CUT_FLOOR_MS / 1000} s long (SCENE-5)`);
      lastCut = b.at_ms;
      continue;
    }
    if (b.kind !== "act") continue;
    const where = `beat_sheet.beats.${b.id}`;
    const rung = ladderRung(b.verb);
    const key = `${b.actor}>${b.with ?? ""}`;
    if (rung !== undefined && b.with !== undefined) {
      const cur = rungs.get(key) ?? 0;
      const jump = rung - (Math.max(cur, 1) + 1);
      if (jump > 0 && b.authored_skip !== true) {
        // A sheet is its own author: a small skip (up to three rungs) is read as the skip the model meant and marked so the hotel accepts it; a bigger one is still thrown back.
        if (jump <= SHEET_IMPLIED_SKIP_MAX) {
          (b as { authored_skip?: true }).authored_skip = true;
          warn(where, "beat_sheet.skip_implied", `${b.verb} (rung ${rung}) skips ${jump} rung${jump === 1 ? "" : "s"} of the ladder, so it is marked authored_skip`);
        } else err(where, `beat_sheet.ladder: ${b.verb} (rung ${rung}) skips the ladder, one rung per beat (LAD-1); climb, or mark the one peak authored_skip`);
      }
      rungs.set(key, Math.max(cur, rung));
    }
    if (b.authored_skip === true) {
      skips += 1;
      if (block === undefined) err(where, "beat_sheet.skip: an authored skip needs a drama block (SCN-4)");
      if (rung === undefined) warn(where, "beat_sheet.skip_useless", `authored_skip does nothing on ${b.verb} (it is off the ladder)`);
    }
    if (isPhysical(b.verb)) {
      if (lastPhysical && b.at_ms - lastPhysical.at < SHEET_PHYSICAL_SPACING_MS) err(where, `beat_sheet.spacing: physical beats are ${SHEET_PHYSICAL_SPACING_MS / 1000} s apart (GATE-9); ${lastPhysical.id} is ${(b.at_ms - lastPhysical.at) / 1000} s before`);
      lastPhysical = { at: b.at_ms, id: b.id };
    }
    const same = `${b.actor}|${b.verb}|${b.with ?? ""}`;
    const before = lastSame.get(same);
    if (before !== undefined && b.at_ms - before < SHEET_SAME_VERB_COOLDOWN_MS && ladderRung(b.verb) !== undefined) {
      err(where, `beat_sheet.cooldown: the same verb at the same person is ${SHEET_SAME_VERB_COOLDOWN_MS / 1000} s apart (GATE-10)`);
    }
    lastSame.set(same, b.at_ms);
    if (b.verb === "kill" || b.verb === "die") {
      deaths += 1;
      if (b.verb === "kill") kills += 1;
      if (deaths > 1 || kills > 1) err(where, "beat_sheet.death: one death per scene (LAD-4); cut the scene first");
    }
    if (block !== undefined && block !== "derive") {
      if (rung !== undefined && rung > block.max_rung) err(where, `beat_sheet.max_rung: ${b.verb} is rung ${rung}, the scene allows ${block.max_rung} (GATE-5)`);
      if (rung !== undefined && rung >= 4 && b.with !== undefined && !block.may_target.some(([a, v]) => a === b.actor && v === b.with)) err(where, `beat_sheet.may_target: the scene does not let ${b.actor} aim a ${b.verb} at ${b.with} (GATE-5)`);
      if (b.verb === "kill" && (b.with === undefined || !block.may_die.includes(b.with))) err(where, `beat_sheet.may_die: ${b.with ?? "the victim"} may not die in this scene (GATE-5)`);
      if (b.verb === "die" && !block.may_die.includes(b.actor)) err(where, `beat_sheet.may_die: ${b.actor} may not die in this scene (GATE-5)`);
    } else if (block === undefined) {
      if (rung !== undefined && rung >= 4) err(where, "beat_sheet.free_play: the scene has no drama block, so a slap, punch or kill has no gate (SCN-1)");
      if (b.verb === "kill" || b.verb === "die") err(where, "beat_sheet.free_play: nobody dies in a scene with no drama block (SCN-3)");
    }
  }
  if (skips > 1) warn("beat_sheet.beats", "beat_sheet.skip_many", `${skips} authored skips: the ladder is for climbing, a skip is for the one peak`);

  // a death is followed by a cut (SCN-6, or the body stays until the run ends)
  const death = sorted.find((b) => b.kind === "act" && (b.verb === "kill" || b.verb === "die"));
  if (death && !sorted.some((b) => b.kind === "cut" && b.at_ms > death.at_ms)) warn(`beat_sheet.beats.${death.id}`, "drama.no_scene_cut", "a death with no cut after it: the body stays until the run ends (SCN-6)");

  // ---- setup and aftermath (invariant 3) -----------------------------------------------------------------------
  const firstAct = sorted.find((b) => b.kind === "act");
  if (firstAct && !sorted.some((b) => (b.kind === "note" || b.kind === "reveal") && b.at_ms < firstAct.at_ms)) {
    err(`beat_sheet.beats.${firstAct.id}`, "beat_sheet.setup: an act needs a note or a reveal before it, so the talk builds to it");
  }
  if (climax) {
    if (!sorted.some((b) => (b.kind === "note" || b.kind === "reveal") && b.at_ms < climax.at_ms && b.phase !== "aftermath")) err(`beat_sheet.beats.${climax.id}`, "beat_sheet.setup: the climax needs a note or a reveal before it");
    if (!sorted.some((b) => b.phase === "aftermath" && b.at_ms > climax.at_ms)) err("beat_sheet.beats", "beat_sheet.aftermath: a beat with phase aftermath comes after the climax (a reaction, a note, a cut)");
  }
  if (!sorted.some((b) => b.phase === "setup" && b.at_ms < (arc.inciting_at_ms ?? Infinity))) warn("beat_sheet.beats", "beat_sheet.no_setup", "no setup beat before the inciting incident");

  // ---- the reversal (invariant 4) --------------------------------------------------------------------------------
  const longScene = (arc.aftermath_until_ms ?? lastAt) > REVERSAL_SCENE_MS;
  if (longScene && climax && !reversals.some((b) => b.at_ms < climax.at_ms)) err("beat_sheet.beats", "beat_sheet.reversal: a scene over 2 minutes needs a reveal or note with phase reversal before the climax (who has power changes)");
  if (arc.reversal_at_ms !== undefined && climax && (arc.reversal_at_ms >= climax.at_ms || (arc.inciting_at_ms !== undefined && arc.reversal_at_ms < arc.inciting_at_ms))) {
    err("beat_sheet.arc.reversal_at_ms", "beat_sheet.reversal: reversal_at_ms is between the inciting incident and the climax");
  }

  // ---- not all talk (invariant 5) --------------------------------------------------------------------------------
  const physical = new Set(sorted.filter((b) => b.kind === "block" || b.kind === "prop" || b.kind === "camera").map((b) => `${b.kind}|${"actor" in b ? b.actor : ""}|${b.kind === "prop" ? b.prop : b.kind === "block" ? JSON.stringify(b.to) : JSON.stringify((b as Extract<SheetBeat, { kind: "camera" }>).intent)}`));
  if (physical.size < 3) err("beat_sheet.beats", `beat_sheet.not_all_talk: at least 3 distinct block, prop or camera beats (found ${physical.size})`);

  // ---- cost (invariant 6) ----------------------------------------------------------------------------------------
  const originRaw = raw["generated_by"];
  let generated_by: BeatSheetOrigin | undefined;
  if (originRaw !== undefined) {
    if (!isRecord(originRaw) || typeof originRaw["model"] !== "string" || !isNum(originRaw["cost_usd"]) || !isNum(originRaw["ms"])) err("beat_sheet.generated_by", "generated_by is {model, cost_usd, ms}");
    else if (originRaw["cost_usd"] > SHEET_COST_CAP_USD) err("beat_sheet.generated_by.cost_usd", `beat_sheet.cost: a sheet costs at most $${SHEET_COST_CAP_USD.toFixed(2)} a scene (was $${originRaw["cost_usd"]})`);
    else {
      generated_by = {
        model: originRaw["model"].slice(0, 120),
        cost_usd: originRaw["cost_usd"],
        ms: originRaw["ms"],
        ...(typeof originRaw["input_hash"] === "string" ? { input_hash: originRaw["input_hash"].slice(0, 80) } : {}),
        ...(originRaw["mock"] === true ? { mock: true as const } : {}),
        ...(isNum(originRaw["attempts"]) ? { attempts: originRaw["attempts"] } : {}),
      };
    }
  }

  if (errors.length > 0 || arc.inciting_at_ms === undefined || arc.climax_at_ms === undefined || arc.aftermath_until_ms === undefined) return { errors, warnings };
  const sheet: BeatSheet = {
    version: SHEET_VERSION,
    premise,
    stakes,
    arc: { inciting_at_ms: arc.inciting_at_ms, ...(arc.reversal_at_ms !== undefined ? { reversal_at_ms: arc.reversal_at_ms } : {}), climax_at_ms: arc.climax_at_ms, aftermath_until_ms: arc.aftermath_until_ms },
    beats: sorted,
    ...(generated_by ? { generated_by } : {}),
  };
  return { sheet, errors, warnings };
}

function readPlace(raw: unknown, path: string, err: (p: string, m: string) => void, idOf: (v: unknown) => string | undefined): SheetPlace | undefined {
  if (!isRecord(raw)) {
    err(path, "to is {tile}, {zone} or {near}");
    return undefined;
  }
  const out: SheetPlace = {};
  if (raw["tile"] !== undefined) {
    const t = raw["tile"];
    if (!Array.isArray(t) || t.length !== 2 || !t.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 200)) err(`${path}.tile`, "tile is [x, y], whole numbers");
    else out.tile = [t[0] as number, t[1] as number];
  }
  for (const key of ["zone", "near"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "") err(`${path}.${key}`, `${key} is a name`);
    else out[key] = key === "near" ? (idOf(v) ?? v.replace(/\s+/g, " ").trim().slice(0, 40)) : v.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  if (out.tile === undefined && out.zone === undefined && out.near === undefined) {
    err(path, "to names a tile, a zone or something to stand near");
    return undefined;
  }
  return out;
}

/** A camera beat's shot is its point; `on`, `zoom`, `amount`, `ms` and `move` are polish, so a bad one is dropped with a warning (`soft`) and never sinks the sheet. */
function readCamera(raw: unknown, path: string, err: (p: string, m: string) => void, idOf: (v: unknown) => string | undefined, soft: (p: string, m: string) => void): CameraIntent | undefined {
  if (!isRecord(raw)) {
    err(path, "intent is {shot, on?, zoom?, move?, amount?, ms?}");
    return undefined;
  }
  const shot = raw["shot"];
  if (!(SHEET_SHOTS as readonly unknown[]).includes(shot)) {
    err(`${path}.shot`, `shot is one of ${SHEET_SHOTS.join(", ")}`);
    return undefined;
  }
  const out: CameraIntent = { shot: shot as CameraIntent["shot"] };
  const on = raw["on"];
  if (on !== undefined) {
    const ref = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? (idOf(v) ?? v.replace(/\s+/g, " ").trim().slice(0, 40)) : undefined);
    if (Array.isArray(on)) {
      const a = ref(on[0]);
      const b = ref(on[1]);
      if (on.length !== 2 || a === undefined || b === undefined) soft(`${path}.on`, "on is a name or a pair of names, so it is ignored");
      else out.on = [a, b];
    } else if (ref(on) === undefined) soft(`${path}.on`, "on is a name or a pair of names, so it is ignored");
    else out.on = ref(on) as string;
  }
  const num = (key: "zoom" | "amount" | "ms", lo: number, hi: number): void => {
    const v = raw[key];
    if (v === undefined) return;
    if (!isNum(v) || v < lo || v > hi) soft(`${path}.${key}`, `${key} is a number from ${lo} to ${hi}, so it is ignored`);
    else out[key] = key === "ms" ? Math.round(v) : v;
  };
  num("zoom", 0.25, 4);
  num("amount", 0, 1);
  num("ms", 0, 10_000);
  if (raw["move"] !== undefined) {
    if (!(SHEET_MOVES as readonly unknown[]).includes(raw["move"])) soft(`${path}.move`, `move is one of ${SHEET_MOVES.join(", ")}, so it is ignored`);
    else out.move = raw["move"] as NonNullable<CameraIntent["move"]>;
  }
  return out;
}

/** The sheet's acts and cuts in the shape the hotel's `BeatPlayer` plays (`ScenarioBeat`), and nothing else. */
export function sheetActs(sheet: BeatSheet): Array<Extract<SheetBeat, { kind: "act" | "cut" }>> {
  return sheet.beats.filter((b): b is Extract<SheetBeat, { kind: "act" | "cut" }> => b.kind === "act" || b.kind === "cut");
}

/**
 * The smallest `drama` block that covers a sheet's acts, merged into `base` (the scene's own block, the conservative default when it wrote none): the highest rung, every
 * pair that aims a rung of 4 or more, every victim of a `kill` or a `die`. Never narrower than `base`.
 */
export function deriveSheetDrama(sheet: BeatSheet, base: { max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean } | undefined): { max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean } {
  const out = { max_rung: base?.max_rung ?? 3, may_target: [...(base?.may_target ?? [])].map(([a, v]) => [a, v] as [string, string]), may_die: [...(base?.may_die ?? [])], permadeath: base?.permadeath ?? false };
  for (const b of sheet.beats) {
    if (b.kind !== "act") continue;
    const rung = ladderRung(b.verb);
    if (rung !== undefined) out.max_rung = Math.max(out.max_rung, rung);
    if (rung !== undefined && rung >= 4 && b.with !== undefined && !out.may_target.some(([a, v]) => a === b.actor && v === b.with)) out.may_target.push([b.actor, b.with]);
    const victim = b.verb === "kill" ? b.with : b.verb === "die" ? b.actor : undefined;
    if (victim !== undefined && !out.may_die.includes(victim)) {
      out.may_die.push(victim);
      out.permadeath = true;
    }
  }
  return out;
}

/** Counts a report can show (and a test can pin): beats by kind and by phase. */
export function sheetStats(sheet: BeatSheet): { beats: number; byKind: Record<string, number>; byPhase: Record<string, number>; acts: number; climax_at_ms: number; inciting_at_ms: number } {
  const byKind: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  for (const b of sheet.beats) {
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
    byPhase[b.phase] = (byPhase[b.phase] ?? 0) + 1;
  }
  return { beats: sheet.beats.length, byKind, byPhase, acts: byKind["act"] ?? 0, climax_at_ms: sheet.arc.climax_at_ms, inciting_at_ms: sheet.arc.inciting_at_ms };
}
