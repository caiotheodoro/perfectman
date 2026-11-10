import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chunkScene, type ChunkOptions } from "../chunk.js";
import type { Beat, Scene, SourceMeta } from "../types.js";
import { parseFountain } from "./fountain.js";
import { parsePlayText, type PlayTextOptions } from "./play-text.js";

export { parseFountain, parsePlayText };

/** A manifest entry may carry `parse: { mixedCaseSpeaker: "<regex source>", notSpeakers: [...], stopBefore: "<regex source>" }` for a file that needs it. */
type ManifestEntry = Partial<SourceMeta> & { file: string; parse?: { mixedCaseSpeaker?: string; notSpeakers?: string[]; stopBefore?: string } };

export type LoadedSource = { id: string; meta: SourceMeta; text: string; parse?: ManifestEntry["parse"] };

/** `corpus/<dir>/manifest.json` files, each a JSON array. Entries without a licence line are refused: no licence, no ingest. */
export function loadCorpus(root: string): { sources: LoadedSource[]; skipped: Array<{ file: string; reason: string }> } {
  const sources: LoadedSource[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  if (!existsSync(root)) return { sources, skipped };
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(root, dir.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    let entries: ManifestEntry[];
    try {
      entries = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
    } catch {
      skipped.push({ file: `${dir.name}/manifest.json`, reason: "manifest is not valid JSON" });
      continue;
    }
    for (const e of entries) {
      const rel = `${dir.name}/${e.file}`;
      const filePath = path.join(root, dir.name, e.file);
      if (!e.license_line || !e.license_class || !e.title || !e.author) {
        skipped.push({ file: rel, reason: "missing title, author, license_line or license_class" });
        continue;
      }
      if (e.license_class === "unclear" || e.license_class === "other") {
        skipped.push({ file: rel, reason: `license_class ${e.license_class}` });
        continue;
      }
      if (!existsSync(filePath)) {
        skipped.push({ file: rel, reason: "file missing" });
        continue;
      }
      const meta: SourceMeta = {
        file: e.file,
        title: e.title,
        author: e.author,
        language: e.language ?? "en",
        medium: e.medium ?? "THEATRE",
        source_url: e.source_url ?? "",
        retrieved: e.retrieved ?? "",
        license_line: e.license_line,
        license_class: e.license_class,
        rights_flag: e.rights_flag ?? null,
        dir: dir.name,
      };
      const id = `${dir.name}/${e.file}`.replace(/\.[^.]+$/, "");
      sources.push({ id, meta, text: readFileSync(filePath, "utf8"), ...(e.parse ? { parse: e.parse } : {}) });
    }
  }
  return { sources, skipped };
}

export function scenesOf(source: LoadedSource): Scene[] {
  const entryParse = source.parse;
  const opts: PlayTextOptions = {};
  if (entryParse?.mixedCaseSpeaker) opts.mixedCaseSpeaker = new RegExp(entryParse.mixedCaseSpeaker);
  if (entryParse?.notSpeakers) opts.notSpeakers = entryParse.notSpeakers;
  if (entryParse?.stopBefore) opts.stopBefore = new RegExp(entryParse.stopBefore, "m");
  return source.meta.file.endsWith(".fountain") ? parseFountain(source.text, source.id) : parsePlayText(source.text, source.id, opts);
}

export function buildBeats(root: string, chunk: ChunkOptions = {}): { beats: Beat[]; skipped: Array<{ file: string; reason: string }>; perSource: Record<string, number> } {
  const { sources, skipped } = loadCorpus(root);
  const beats: Beat[] = [];
  const perSource: Record<string, number> = {};
  for (const s of sources) {
    const scenes = scenesOf(s);
    let n = 0;
    // Two scenes can carry the same act and scene label (a repeated heading, a chorus before scene one). Their beats keep counting
    // on, so an id names exactly one beat.
    const next = new Map<string, number>();
    for (const scene of scenes) {
      const key = `${scene.act}.${scene.scene}`;
      let at = next.get(key) ?? 0;
      for (const b of chunkScene(scene, s.meta, chunk)) {
        at += 1;
        beats.push({ ...b, index: at, id: `${s.id}:${key}.${at}` });
        n += 1;
      }
      next.set(key, at);
    }
    perSource[s.id] = n;
    if (n === 0) skipped.push({ file: s.id, reason: "no beats parsed" });
  }
  return { beats, skipped, perSource };
}
