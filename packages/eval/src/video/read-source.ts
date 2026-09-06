import { basename, extname } from "node:path";
import type { VideoStory } from "./types.js";
import { normalizeEvidence } from "./evidence.js";
import { normalizeEvents } from "./events.js";
import { normalizeScript } from "./script.js";
import { isReplaySource, normalizeReplaySource } from "./replay.js";
import { isRecord } from "./source-utils.js";
import { readTextSource } from "./source-file.js";
import { readNarrationSource } from "./narration-source.js";

export function normalizeVideoSource(value: unknown, fallbackTitle = "Perfectman run"): VideoStory {
  if (isRecord(value)) {
    if (value.version === "perfectman-video-v1") return normalizeScript(value);
    if (value.version === "narrations-v1") {
      throw new Error("Narrations contain summaries only. Supply the matching scenarios/<scenarioId>.json or novela-run.json transcript to preserve every step.");
    }
    if (isReplaySource(value)) return normalizeReplaySource(value, fallbackTitle);
    if (Array.isArray(value.events)) return normalizeEvents(value, fallbackTitle);
    if (Array.isArray(value.transcript)) return normalizeEvidence(value, fallbackTitle);
  }
  if (Array.isArray(value) && value.length > 0) {
    if (isRecord(value[0]) && "actorId" in value[0]) return normalizeEvents(value, fallbackTitle);
    return normalizeEvidence(value, fallbackTitle);
  }
  throw new Error("Unsupported video input. Use a Perfectman replay JSON/HTML, saved event or transcript JSON, or a perfectman-video-v1 script.");
}

/** Extract data only. Never evaluate the source page or its JavaScript. */
export function parseVideoSourceText(text: string): unknown {
  if (!text.trimStart().startsWith("<")) return JSON.parse(text);
  for (const script of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = script[1] ?? "";
    if (!/\bid\s*=\s*(["'])REPLAY_DATA\1/i.test(attributes)) continue;
    if (!/\btype\s*=\s*(["'])application\/json\1/i.test(attributes)) {
      throw new Error("REPLAY_DATA must be an application/json script element");
    }
    return JSON.parse(script[2]!);
  }
  throw new Error("HTML input has no REPLAY_DATA JSON element. Export a Perfectman replay or use its JSON file.");
}

export async function readVideoSource(input: string, scenario?: string): Promise<{ story: VideoStory; sourceSha256: string }> {
  const source = await readTextSource(input);
  const value = parseVideoSourceText(source.text);
  const story = isRecord(value) && value.version === "narrations-v1"
    ? await readNarrationSource(input, value, source.sha256, scenario)
    : normalizeVideoSource(value, basename(input, extname(input)));
  return { story, sourceSha256: source.sha256 };
}
