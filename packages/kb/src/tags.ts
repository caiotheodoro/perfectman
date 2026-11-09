import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ACTION_TYPES, EMOTIONS, STATUS_DELTAS, TACTIC_GROUP_OF, normaliseTactic, tacticPromptList } from "./taxonomy.js";
import type { Beat, TagRecord } from "./types.js";

/** What a tagger agent is given for one beat. The text is cut, never rewritten. */
export type TaggingInput = { id: string; language: string; medium: string; speakers: string[]; castSize: number; actionHint: string; directions: string[]; text: string };

const MAX_TAG_TEXT = 1800;

export function toTaggingInput(b: Beat): TaggingInput {
  return {
    id: b.id,
    language: b.language,
    medium: b.medium,
    speakers: b.speakers,
    castSize: b.castSize,
    actionHint: b.actionHint,
    directions: b.directions.slice(0, 6),
    text: b.text.length > MAX_TAG_TEXT ? `${b.text.slice(0, MAX_TAG_TEXT)} [...]` : b.text,
  };
}

export const TAGGING_PROMPT = `You tag dramatic beats from plays for a retrieval index. One JSON object per input line.

For every input beat return ONE line of JSON (no markdown, no commentary, no code fence), exactly these keys:
{"id": <same id>, "tactic_verb": "<one verb from the list>", "status_delta": "<one value>", "action_type": "<one value>", "emotion": "<one value>", "driver": "<speaker name from speakers>", "target": "<speaker name or null>", "confidence": <0..1>, "boundary_ok": <true|false>}

Definitions
- A beat is a stretch where one character holds one tactic toward one person. The driver is the speaker whose tactic defines the beat. The target is the person the driver acts on (null when the driver acts on nobody present).
- tactic_verb: what the driver is DOING to the target, an active verb aimed at a person, never a feeling and never a result. Choose from the list only. When nothing fits, choose the closest.
- status_delta: the DRIVER's own movement in social status against the target during the beat. ${STATUS_DELTAS.join(", ")}. HIGH_TO_LOW: the driver starts above and ends below. LOW_TO_HIGH: the reverse. EQUALIZE: the gap closes to even. EQUAL_STALEMATE: level and stuck. HIGH_STABLE / LOW_STABLE: no flip.
- action_type: the strongest physical action that HAPPENS in the beat (not one that is only talked about). ${ACTION_TYPES.join(", ")}. DIALOGUE_ONLY when none. actionHint is a keyword guess: confirm or correct it from the text.
- emotion: the driver's dominant emotion. ${EMOTIONS.join(", ")}.
- confidence: your own, 0 to 1. Use below 0.5 when the beat is unclear.
- boundary_ok: false when the chunk clearly holds two beats (split) or is a fragment of a beat (merge).
- The text may be English or Portuguese. Answer with the English labels above either way.

Tactic verbs (one group per line)
${tacticPromptList()}

Rules: never copy long passages of the text into the output; never invent speakers; one output line per input line, same order; output nothing else.`;

export function writeTaggingBatches(beats: readonly Beat[], dir: string, batchSize: number): string[] {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "PROMPT.md"), `${TAGGING_PROMPT}\n`);
  const files: string[] = [];
  for (let i = 0, n = 1; i < beats.length; i += batchSize, n++) {
    const file = path.join(dir, `batch-${String(n).padStart(4, "0")}.in.jsonl`);
    writeFileSync(file, `${beats.slice(i, i + batchSize).map((b) => JSON.stringify(toTaggingInput(b))).join("\n")}\n`);
    files.push(file);
  }
  return files;
}

export type TagCheck = { ok: true; tag: TagRecord } | { ok: false; errors: string[] };

/** A tag is stored only if every field is on the controlled lists and the driver and target are speakers in the beat. */
export function validateTag(raw: unknown, beat: Beat, taggedBy: string): TagCheck {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["not an object"] };
  const r = raw as Record<string, unknown>;
  const tactic = normaliseTactic(r["tactic_verb"]);
  if (!tactic) errors.push(`tactic_verb ${JSON.stringify(r["tactic_verb"])} is not on the list`);
  if (!(STATUS_DELTAS as readonly string[]).includes(String(r["status_delta"]))) errors.push(`status_delta ${JSON.stringify(r["status_delta"])} invalid`);
  if (!(ACTION_TYPES as readonly string[]).includes(String(r["action_type"]))) errors.push(`action_type ${JSON.stringify(r["action_type"])} invalid`);
  if (!(EMOTIONS as readonly string[]).includes(String(r["emotion"]))) errors.push(`emotion ${JSON.stringify(r["emotion"])} invalid`);
  const speakers = beat.speakers.map((s) => s.toLowerCase());
  const driver = typeof r["driver"] === "string" ? r["driver"] : "";
  if (!speakers.includes(driver.toLowerCase())) errors.push(`driver ${JSON.stringify(driver)} is not a speaker in the beat`);
  const target = r["target"] === null || r["target"] === undefined ? null : String(r["target"]);
  if (target !== null && !speakers.includes(target.toLowerCase())) errors.push(`target ${JSON.stringify(target)} is not a speaker in the beat`);
  if (target !== null && target.toLowerCase() === driver.toLowerCase()) errors.push("target equals driver");
  const confidence = Number(r["confidence"]);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence must be 0 to 1");
  if (typeof r["boundary_ok"] !== "boolean") errors.push("boundary_ok must be a boolean");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    tag: {
      id: beat.id,
      tactic_verb: tactic as string,
      status_delta: r["status_delta"] as TagRecord["status_delta"],
      action_type: r["action_type"] as TagRecord["action_type"],
      emotion: r["emotion"] as TagRecord["emotion"],
      driver: beat.speakers.find((s) => s.toLowerCase() === driver.toLowerCase()) as string,
      target: target === null ? null : (beat.speakers.find((s) => s.toLowerCase() === target.toLowerCase()) as string),
      confidence,
      boundary_ok: r["boundary_ok"] as boolean,
      tagged_by: taggedBy,
    },
  };
}

/** Parses tagger output lines. Lines that are not JSON, or name an unknown beat, are reported, never guessed at. */
export function importTagLines(lines: readonly string[], beatsById: ReadonlyMap<string, Beat>, taggedBy: string): { tags: TagRecord[]; errors: Array<{ id: string; errors: string[] }> } {
  const tags: TagRecord[] = [];
  const errors: Array<{ id: string; errors: string[] }> = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(t.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      errors.push({ id: "?", errors: [`not JSON: ${t.slice(0, 60)}`] });
      continue;
    }
    const id = typeof obj === "object" && obj !== null ? String((obj as Record<string, unknown>)["id"] ?? "?") : "?";
    const beat = beatsById.get(id);
    if (!beat) {
      errors.push({ id, errors: ["unknown beat id"] });
      continue;
    }
    const res = validateTag(obj, beat, taggedBy);
    if (res.ok) tags.push(res.tag);
    else errors.push({ id, errors: res.errors });
  }
  return { tags, errors };
}

/** Deterministic sample: a beat is in when the hash of seed+id falls under the fraction. Same ids, same seed, same sample. */
export function sampleIds(ids: readonly string[], fraction: number, seed = "kb-verify-1"): string[] {
  const cutoff = Math.floor(fraction * 0xffffffff);
  return ids.filter((id) => createHash("sha256").update(`${seed}:${id}`).digest().readUInt32BE(0) <= cutoff);
}

export type Agreement = { n: number; tactic_exact: number; tactic_group: number; action_type: number; status_delta: number; emotion: number };

/** Share of beats on which two taggers agree, over the ids both tagged. */
export function agreement(a: readonly TagRecord[], b: readonly TagRecord[]): Agreement {
  const bById = new Map(b.map((t) => [t.id, t]));
  let n = 0;
  const hit = { tactic_exact: 0, tactic_group: 0, action_type: 0, status_delta: 0, emotion: 0 };
  for (const x of a) {
    const y = bById.get(x.id);
    if (!y) continue;
    n++;
    if (x.tactic_verb === y.tactic_verb) hit.tactic_exact++;
    if (TACTIC_GROUP_OF[x.tactic_verb] === TACTIC_GROUP_OF[y.tactic_verb]) hit.tactic_group++;
    if (x.action_type === y.action_type) hit.action_type++;
    if (x.status_delta === y.status_delta) hit.status_delta++;
    if (x.emotion === y.emotion) hit.emotion++;
  }
  const r = (v: number) => (n === 0 ? 0 : Math.round((v / n) * 1000) / 1000);
  return { n, tactic_exact: r(hit.tactic_exact), tactic_group: r(hit.tactic_group), action_type: r(hit.action_type), status_delta: r(hit.status_delta), emotion: r(hit.emotion) };
}
