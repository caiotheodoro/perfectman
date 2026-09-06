/**
 * Ready-made casts and scenes, read off disk.
 *
 * Served rather than bundled: a preset is markdown the user is about to edit,
 * and reading it from `examples/` means someone can add a scene by dropping a
 * folder in without touching the web build. It is also the same text the
 * compiler sees, so what the picker shows and what runs cannot drift.
 *
 * A preset directory holds its `.md` files plus a `preset.json` naming it. The
 * name is not derived from the filename because a good scene title is a
 * sentence, not a slug.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { UploadedFile } from "@perfectman/shared";

export type Preset = {
  id: string;
  title: string;
  blurb: string;
  /**
   * Scenes only: the cast preset this scene was written for. A scene names its
   * people in `cast:` and gives them hidden objectives by id, so it cannot be
   * run against strangers — the picker pairs them instead of letting the
   * compiler reject the combination after the fact.
   */
  cast?: string;
  /** Ordered as authored; the picker shows the first line of each. */
  files: UploadedFile[];
};

export type PresetLibrary = { casts: Preset[]; scenes: Preset[] };

/** Resolves the examples root, defaulting to `examples/presets` at the workspace root. */
export function defaultPresetsRoot(cwd = process.cwd()): string {
  return resolve(cwd, "examples", "presets");
}

export async function loadPresets(root: string): Promise<PresetLibrary> {
  const [casts, scenes] = await Promise.all([
    loadGroup(join(root, "casts")),
    loadGroup(join(root, "scenes")),
  ]);
  return { casts, scenes };
}

async function loadGroup(dir: string): Promise<Preset[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // No presets on disk is a valid state — the picker falls back to writing.
    return [];
  }

  const presets: Preset[] = [];
  for (const id of entries.sort()) {
    const preset = await loadPreset(join(dir, id), id);
    if (preset) presets.push(preset);
  }
  return presets;
}

async function loadPreset(dir: string, id: string): Promise<Preset | null> {
  let meta: { title?: unknown; blurb?: unknown; cast?: unknown };
  try {
    meta = JSON.parse(await readFile(join(dir, "preset.json"), "utf8")) as typeof meta;
  } catch {
    return null;
  }

  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  const files: UploadedFile[] = [];
  for (const filename of names) {
    files.push({ filename, text: await readFile(join(dir, filename), "utf8") });
  }

  return {
    id,
    title: typeof meta.title === "string" ? meta.title : id,
    blurb: typeof meta.blurb === "string" ? meta.blurb : "",
    ...(typeof meta.cast === "string" ? { cast: meta.cast } : {}),
    files,
  };
}
