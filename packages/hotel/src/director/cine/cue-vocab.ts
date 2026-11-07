/**
 * The cue vocabularies (camera-and-audio.md 8, schema/cue-vocab.json). The
 * sidecar emits canonical names only: the client also takes the aliases, but
 * that is a courtesy for older senders, not a contract. `cueViolations` is the
 * check every emitted `ui` goes through in the tests, and `canonicalize` is the
 * runtime net under the planner, so a stray free-text name never reaches a
 * browser.
 */
import type { PerfectmanUi } from "../generated.js";
import { CUT_FX_KINDS, EMOTION_ALIASES, EMOTION_CANONICAL, FACE_STATE_EMOTIONS, FADE_RANGE, SFX_ALIASES, SFX_CANONICAL } from "../cue-vocab.generated.js";

export { EMOTION_CANONICAL, SFX_CANONICAL } from "../cue-vocab.generated.js";

/** The client's matching rule: lower-case, trim, inner spaces and hyphens become `_`. */
export function normaliseCueName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const SFX_SET: ReadonlySet<string> = new Set(SFX_CANONICAL);
const EMOTION_SET: ReadonlySet<string> = new Set(EMOTION_CANONICAL);

export const isCanonicalSfx = (name: string): boolean => SFX_SET.has(name);
export const isCanonicalEmotion = (name: string): boolean => EMOTION_SET.has(name);

/** The canonical `sfx.cue` for a name or alias, or undefined when it is neither. */
export function canonicalSfx(name: string): string | undefined {
  const n = normaliseCueName(name);
  return SFX_SET.has(n) ? n : SFX_ALIASES[n];
}

/** The canonical `cue.emotion` for a name, an alias or a Perfectman face state. */
export function canonicalEmotion(name: string): string | undefined {
  const n = normaliseCueName(name);
  return EMOTION_SET.has(n) ? n : (EMOTION_ALIASES[n] ?? FACE_STATE_EMOTIONS[n]);
}

/** Clamp a fade target to 0..1 (0 clear, 1 black); NaN is 0. */
export function clampFade(to: number): number {
  return Number.isFinite(to) ? Math.min(FADE_RANGE.max, Math.max(FADE_RANGE.min, to)) : FADE_RANGE.min;
}

/** What is wrong with a cue, in words; empty when it is canonical. Cues without a vocabulary are always fine. */
export function cueViolations(ui: PerfectmanUi): string[] {
  const out: string[] = [];
  if (ui.k === "sfx") {
    if (!isCanonicalSfx(ui.cue)) out.push(`sfx.cue "${ui.cue}" is not canonical${canonicalSfx(ui.cue) ? ` (use "${canonicalSfx(ui.cue)}")` : ""}`);
  } else if (ui.k === "cue") {
    if (!isCanonicalEmotion(ui.emotion)) out.push(`cue.emotion "${ui.emotion}" is not canonical${canonicalEmotion(ui.emotion) ? ` (use "${canonicalEmotion(ui.emotion)}")` : ""}`);
  } else if (ui.k === "hud") {
    const to = ui.fade?.to;
    if (to !== undefined && to !== null && !(typeof to === "number" && to >= FADE_RANGE.min && to <= FADE_RANGE.max)) out.push(`hud.fade.to ${String(to)} is outside ${FADE_RANGE.min}..${FADE_RANGE.max}`);
  } else if (ui.k === "cut_fx") {
    if (!CUT_FX_KINDS.includes(ui.kind)) out.push(`cut_fx.kind "${ui.kind}" is not one of ${CUT_FX_KINDS.join(", ")}`);
  }
  return out;
}

/**
 * The cue as it may leave the sidecar: aliases become canonical names, a fade
 * is clamped, and a cue with no canonical form is dropped (undefined).
 */
export function canonicalize(ui: PerfectmanUi): PerfectmanUi | undefined {
  if (ui.k === "sfx") {
    const cue = canonicalSfx(ui.cue);
    return cue ? { ...ui, cue } : undefined;
  }
  if (ui.k === "cue") {
    const emotion = canonicalEmotion(ui.emotion);
    return emotion ? { ...ui, emotion } : undefined;
  }
  if (ui.k === "hud" && ui.fade && typeof ui.fade.to === "number") {
    return { ...ui, fade: { ...ui.fade, to: clampFade(ui.fade.to) } };
  }
  return ui;
}
