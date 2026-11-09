/**
 * Pure logic behind the local clip labeling tool: manifest parsing, id safety,
 * HTTP range parsing, label status/progress and CLI argument parsing. No I/O,
 * so everything here is unit-testable without a server or a filesystem.
 */
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { DramaAxis } from "../axes.js";
import { FAILURE_CODE_PATTERN, type ClipLabel } from "../label.js";

/** One plain-language question per axis, shown under the axis name. */
export const AXIS_QUESTIONS: Record<DramaAxis, string> = {
  physical_expressiveness: "Do the characters use their bodies (gestures, moves, hits), not just talk?",
  action_legibility: "Can you tell what each physical act was, who did it, and to whom?",
  emotion_action_fit: "Does each act match the emotion and the moment that came before it?",
  reaction_integrity: "When something physical happens, do the target and witnesses visibly react?",
  escalation_arc: "Does the conflict build step by step, instead of jumping or staying flat?",
  restraint: "Are physical acts rare enough that each one still means something?",
};

export const DEFAULT_PORT = 4777;

export interface ClipInfo {
  id: string;
  title: string;
  durationSec: number | null;
  scene: string | null;
  /** Absolute path of the mp4. */
  videoPath: string;
  /** Absolute path of the contact-sheet png, or null when the clip has none. */
  contactPath: string | null;
}

/** What `/api/clips` returns per clip. Deliberately carries no judge or model scores (blind mode). */
export interface ClipListItem {
  id: string;
  title: string;
  durationSec: number | null;
  scene: string | null;
  hasContactSheet: boolean;
}

export interface LabelStatus {
  id: string;
  labeled: boolean;
  /** A label file exists but does not parse; it is not counted as labelled. */
  invalid: boolean;
  labeler: string | null;
  labeledAt: string | null;
  pass: boolean | null;
}

export interface LabelProgress {
  labeled: number;
  total: number;
}

/** Clip ids double as file names, so only a conservative character set is allowed and `..` never is. */
const SAFE_CLIP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeClipId(id: string): boolean {
  return SAFE_CLIP_ID.test(id) && !id.includes("..");
}

const manifestEntrySchema = z
  .object({
    clip: z.string().min(1),
    path: z.string().min(1).optional(),
    symlink: z.string().min(1).optional(),
    contact_sheet: z.string().min(1).nullish(),
    duration_s: z.number().nonnegative().nullish(),
    scene: z.string().nullish(),
    scene_name: z.string().nullish(),
  })
  .passthrough();

const manifestSchema = z.object({ entries: z.array(z.unknown()) }).passthrough();

/**
 * Reads a baseline manifest (`entries[]`). Only the fields the labeler needs are kept:
 * the manifest's judge `scores` are dropped on purpose so they cannot leak into the UI.
 * Relative paths resolve against `baseDir` (the manifest's directory).
 */
export function parseManifest(input: unknown, baseDir: string): ClipInfo[] {
  const manifest = manifestSchema.parse(input);
  const seen = new Set<string>();
  return manifest.entries.map((raw, index) => {
    const parsed = manifestEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`manifest entry ${index} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    const e = parsed.data;
    const id = e.clip.replace(/\.mp4$/i, "");
    if (!isSafeClipId(id)) throw new Error(`manifest entry ${index} has an unsafe clip id: ${JSON.stringify(id)}`);
    if (seen.has(id)) throw new Error(`manifest has a duplicate clip id: ${id}`);
    seen.add(id);
    const video = e.symlink ?? e.path;
    if (video === undefined) throw new Error(`manifest entry ${index} (${id}) has neither "symlink" nor "path"`);
    const abs = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p));
    return {
      id,
      title: e.scene_name ?? id,
      durationSec: e.duration_s ?? null,
      scene: e.scene ?? null,
      videoPath: abs(video),
      contactPath: e.contact_sheet ? abs(e.contact_sheet) : null,
    };
  });
}

export function toClipListItem(clip: ClipInfo): ClipListItem {
  return {
    id: clip.id,
    title: clip.title,
    durationSec: clip.durationSec,
    scene: clip.scene,
    hasContactSheet: clip.contactPath !== null,
  };
}

export function statusForLabel(id: string, label: ClipLabel | null, invalid = false): LabelStatus {
  if (label === null) return { id, labeled: false, invalid, labeler: null, labeledAt: null, pass: null };
  return { id, labeled: true, invalid: false, labeler: label.labeler, labeledAt: label.labeledAt, pass: label.pass };
}

export function summarizeProgress(statuses: readonly LabelStatus[]): LabelProgress {
  return { labeled: statuses.filter((s) => s.labeled).length, total: statuses.length };
}

/** Clip list joined with label status, in manifest order. A clip with no status counts as unlabelled. */
export function mergeClipsWithStatuses(
  clips: readonly ClipInfo[],
  statuses: readonly LabelStatus[],
): Array<ClipListItem & { labeled: boolean }> {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return clips.map((clip) => ({ ...toClipListItem(clip), labeled: byId.get(clip.id)?.labeled ?? false }));
}

function codeOrder(code: string): [string, number] {
  return [code.charAt(0), Number(code.slice(1))];
}

/** Dedupes and sorts failure codes (D1, D2, D10, E3 ...) and drops blank notes, so a saved file is stable. */
export function normalizeLabel(label: ClipLabel): ClipLabel {
  const codes = [...new Set(label.failureCodes)].sort((a, b) => {
    const [fa, na] = codeOrder(a);
    const [fb, nb] = codeOrder(b);
    return fa === fb ? na - nb : fa < fb ? -1 : 1;
  });
  const { notes, ...rest } = label;
  const trimmed = notes?.trim();
  return { ...rest, failureCodes: codes, ...(trimmed ? { notes: trimmed } : {}) };
}

/** True when `code` is a valid free-form catalog failure code such as `E10` or `T3`. */
export function isValidFailureCode(code: string): boolean {
  return FAILURE_CODE_PATTERN.test(code);
}

export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=...` header against a file size.
 * Returns `null` when the header should be ignored (absent, malformed or multi-range: serve the whole file),
 * `"unsatisfiable"` when the range lies outside the file (416), or the inclusive byte range to serve.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(a);
  if (b !== "" && Number(b) < start) return null;
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  return { start, end };
}

export interface LabelCliArgs {
  manifest: string;
  labels: string;
  port: number;
  labeler: string | null;
}

export const LABEL_USAGE =
  "usage: label --manifest <manifest.json> --labels <dir> [--port 4777] [--labeler <name>]";

/** Parses `--key value` / `--key=value` flags. A bare `--` (added by `pnpm run label -- ...`) is ignored. */
export function parseLabelCliArgs(argv: readonly string[]): LabelCliArgs {
  const values = new Map<string, string>();
  const known = new Set(["manifest", "labels", "port", "labeler"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") continue;
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m || !known.has(m[1] as string)) throw new Error(`unknown argument: ${arg}\n${LABEL_USAGE}`);
    const key = m[1] as string;
    let value = m[2];
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value\n${LABEL_USAGE}`);
    }
    values.set(key, value);
  }
  const manifest = values.get("manifest");
  const labels = values.get("labels");
  if (!manifest) throw new Error(`--manifest is required\n${LABEL_USAGE}`);
  if (!labels) throw new Error(`--labels is required\n${LABEL_USAGE}`);
  const portText = values.get("port");
  const port = portText === undefined ? DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be an integer 0-65535, got ${portText}`);
  const labeler = values.get("labeler")?.trim();
  return { manifest, labels, port, labeler: labeler ? labeler : null };
}
