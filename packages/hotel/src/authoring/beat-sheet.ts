import { createHash } from "node:crypto";
import { deriveSheetDrama, validateBeatSheet } from "@perfectman/shared";
import type { BeatSheet, RoomBrief, SheetBeat } from "@perfectman/shared";
import type { ScenarioBeat } from "./scenario-beats.js";
import type { DramaRow, SceneCastMember, ScenarioDrama } from "./scenario-drama.js";

/**
 * The scenario's beat sheet (Contract A, docs/plans: the cinematic revamp) as the authoring side reads it: the `beat_sheet` key next to `beats` and
 * `drama`, in the form (cast names), in a markdown scene's frontmatter (names or agent ids) and in the compiled body (agent ids). The validator is
 * `@perfectman/shared`'s `validateBeatSheet`; this file maps its rows to the `DramaRow` style the compile uses, settles the scene's `drama` block
 * for it and reads a body leniently, as `cleanBeats` does: a sheet that does not hold is dropped, the old spine plays, and the run says why.
 */

export type SheetCompile = { sheet?: BeatSheet; errors: DramaRow[]; warnings: DramaRow[] };

export type SheetCompileOptions = {
  /** The scene's block with agent ids, `"derive"` when the scene wrote none (the compile widens the default to cover the sheet), undefined for free play. */
  drama?: ScenarioDrama | "derive" | undefined;
  room?: RoomBrief | undefined;
  mayTargetHumans?: boolean | undefined;
};

/** SCN-5's cousin for a sheet: errors and warnings as `{path, message}` rows. A hand-written or generated sheet comes out normalised (ids, order, arc). */
export function compileBeatSheet(raw: unknown, cast: readonly SceneCastMember[], opts: SheetCompileOptions = {}): SheetCompile {
  const r = validateBeatSheet(raw, { cast, drama: opts.drama, room: opts.room, mayTargetHumans: opts.mayTargetHumans });
  return { ...(r.sheet ? { sheet: r.sheet } : {}), errors: r.errors, warnings: r.warnings };
}

/**
 * The body's half. `drama` is the block the body kept: a sheet held against it is the same sheet the compile accepted, because the compile widened the
 * block to cover it. A body with no block (free play), `drama: off`, or authored `beats` takes no sheet: the sheet and the old script would both own the
 * scene's acts. Returns the reason in `beat_sheet_error` for the run's `beat_sheet_fallback` line; a body that was compiled without one (the generator was
 * off, timed out or failed) passes its own `beat_sheet_error` through.
 */
export function cleanBeatSheet(raw: unknown, cast: readonly SceneCastMember[], ctx: { drama?: ScenarioDrama | undefined; off?: boolean; hasBeats?: boolean; error?: unknown }): { beat_sheet?: BeatSheet; beat_sheet_error?: string } {
  const carried = typeof ctx.error === "string" && ctx.error !== "" ? ctx.error.slice(0, 200) : undefined;
  if (raw === undefined || raw === null) return carried ? { beat_sheet_error: carried } : {};
  if (ctx.off === true) return { beat_sheet_error: "drama is off" };
  if (ctx.hasBeats === true) return { beat_sheet_error: "the scene has authored beats" };
  const r = compileBeatSheet(raw, cast, { drama: ctx.drama });
  if (!r.sheet) return { beat_sheet_error: `invalid: ${r.errors.slice(0, 3).map((e) => e.message.replace(/^beat_sheet\.\w+: /, "")).join("; ")}`.slice(0, 200) };
  return { beat_sheet: r.sheet };
}

/**
 * The scene's block once it has a sheet. A block the author wrote is never widened (the sheet is held to it, and a generated sheet that does not fit is
 * regenerated or dropped); the conservative default, or no block at all, is widened to the smallest block that covers the sheet's acts. `mode` is then the
 * body's `drama_mode`: `default` while the block is still the default (the sheet asked for nothing more), absent once it was widened (the sheet's own block).
 */
export function settleSheetDrama(sheet: BeatSheet, block: ScenarioDrama | undefined, mode: "default" | "off" | undefined): { drama: ScenarioDrama; drama_mode?: "default" } | undefined {
  if (mode === "off") return undefined;
  if (block !== undefined && mode !== "default") return { drama: block };
  const widened = deriveSheetDrama(sheet, block);
  const same = block !== undefined && JSON.stringify(widened) === JSON.stringify(block);
  return same ? { drama: block, drama_mode: "default" } : { drama: widened };
}

/** The sheet's acts and cuts as the `BeatPlayer` plays them (`ScenarioBeat`: ids are the sheet's own, so a rebuilt player never plays one twice). */
export function sheetScenarioBeats(sheet: BeatSheet): ScenarioBeat[] {
  const out: ScenarioBeat[] = [];
  for (const b of sheet.beats) {
    if (b.kind === "act") out.push({ id: b.id, at_ms: b.at_ms, kind: "act", actor: b.actor, verb: b.verb, ...(b.with !== undefined ? { with: b.with } : {}), ...(b.authored_skip === true ? { authored_skip: true as const } : {}) });
    else if (b.kind === "cut") out.push({ id: b.id, at_ms: b.at_ms, kind: "cut", reason: b.reason });
  }
  return out;
}

/** The ids of the climax act (there is one in a valid sheet): the beat the player forces. */
export function climaxBeat(sheet: BeatSheet): Extract<SheetBeat, { kind: "act" }> | undefined {
  return sheet.beats.find((b): b is Extract<SheetBeat, { kind: "act" }> => b.kind === "act" && b.climax === true);
}

/**
 * What a sheet was written from: the situation, each person's goal and hidden objective, the language, the scene's own block and the room, hashed. A saved
 * sheet whose hash no longer matches was written for a scenario that has since changed and is written again; a sheet with no `generated_by` is the author's
 * and is never touched.
 */
export function sheetInputHash(input: { situation: string; language: string; cast: ReadonlyArray<{ name: string; goal?: string | undefined; objective?: string | undefined; voice?: string | undefined }>; drama?: unknown; room?: unknown; version?: number }): string {
  const text = JSON.stringify([input.version ?? 1, input.situation.replace(/\s+/g, " ").trim(), input.language, input.cast.map((c) => [c.name, c.goal ?? "", c.objective ?? "", c.voice ?? ""]), input.drama ?? null, input.room ?? null]);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
