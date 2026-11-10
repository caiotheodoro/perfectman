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

The text may be English or Portuguese. Answer with the English labels below either way. Work through the fields in this order: driver and target, tactic_verb, status_delta, emotion, action_type, boundary_ok.

1. Driver and target
- A beat is a stretch where one character holds one tactic toward one person. The driver is the speaker whose aim shapes the stretch: the one who wants something from the other, not the one who talks most. The target is the person the driver acts on (null when the driver acts on nobody present).
- When the driver is talking to themselves or to the audience, the target is null.

2. tactic_verb: what the driver is DOING to the target
Decide in this order and stop at the first step that settles it.
 a. Say to yourself what the target has to do, stop doing, know or feel by the end for the driver to get what they want. Put it in a few words ("hand over the letter", "stop asking", "feel safe", "believe the lie").
 b. Pick the group by that effect on the target.
    pressure: the target must give way or act under force. lowering: the target must feel smaller. soft: the target must be moved to give something freely. care: the target must feel held or safe. guard: the target must NOT get something (information, access, a reaction): the driver is protecting a position. truth: the target must come to know something. steer: the target must be led to a conclusion or act while thinking it is their own. end: the target is stopped, punished, left, or the driver gives in or breaks.
 c. Inside the group take the narrowest verb that fits what the speaker is doing in the words, not the situation around them. Check the neighbours in the list before you settle (threaten names a harm to the target; warn names a harm for the target's sake; demand claims what is owed; press keeps pushing against resistance; tease is play, mock is a put-down).
 d. Never choose a verb for a feeling ("to be angry") or a result ("to win"). Use only a verb from the list below; when nothing fits, choose the closest.
- Do NOT default to "to command". Choose it only when an order is the whole point of the beat: the driver has the standing to give it, the target is expected to obey, and whether they obey is what the beat is about. Run this check before you write it: if you took the order away, would the beat still be about something else (a quarrel, a courtship, a plot, a piece of news)? Then use the verb for that something else. A servant sent on an errand, instructions given in passing, "come here / sit down / leave us" are not "to command": pick the verb for what the speaker is really working on, or "to inform" when the speech only passes facts. An order met with resistance is usually "to demand", "to press" or "to dominate".
- "to inform" and "to explain" are not defaults either. Use them only when the speaker is giving facts and wants nothing else from the listener.

3. status_delta: the DRIVER's own movement against the target, start of beat to end of beat
Ask two questions. Is the driver above, below or level with the target at the start (rank, power over the outcome, who needs whom)? Is it the same at the end? Same place gives a STABLE value (EQUAL_STALEMATE only for a true tie, see below). A different place gives an arrow. Most beats are stable: pick an arrow only when someone visibly yields, is cornered, is exposed or turns the tables inside the beat. Do not choose HIGH_STABLE because the driver is loud or speaks most; choose it when the target defers, obeys, is silenced or is kept guessing.
 ${STATUS_DELTAS.join(", ")}
 - HIGH_STABLE: the driver holds the upper hand throughout. Example: an examiner picks apart a candidate's story and the candidate never gets a word in.
 - LOW_STABLE: the driver needs something from the target and stays the one who needs it: asking, pleading, flattering, fearing. Example: a debtor begs for another week and is told to come back tomorrow.
 - EQUAL_STALEMATE: a contest between level opponents that ends where it began: both push, neither gives. Use it rarely. Talk where one side clearly has more leverage, or where one side is just asking, informing or being kind, is not a stalemate: pick the STABLE value of the side the driver is on. Example: two old rivals trade barbs for a page and part exactly as they began.
 - HIGH_TO_LOW: the driver starts above and ends below. Example: a boss sets out terms, then the clerk produces a signed confession and the boss starts bargaining.
 - LOW_TO_HIGH: the driver starts below and ends above. Example: a nervous apprentice is scolded, then reveals she holds the only key and the master asks her politely.
 - EQUALIZE: the gap closes to even. Example: a count talks down to a soldier until the soldier mentions the son they both buried and they speak as two fathers.

4. emotion: the driver's dominant emotion in the beat, from what they say and do, not from the situation. ${EMOTIONS.join(", ")}.
 - anger is hot and wants to hurt; contempt looks down and wants distance; resolve is decided and steady, with no heat; fear is flinching or hiding; shame is wanting to be unseen; neutral only when the driver is businesslike and nothing shows. If you picked neutral, look once more for the feeling behind the aim.

5. action_type: the strongest physical action that HAPPENS in the beat (not one that is only talked about). ${ACTION_TYPES.join(", ")}. DIALOGUE_ONLY when none. actionHint is a keyword guess: confirm or correct it from the text.

6. boundary_ok: is this chunk a usable unit? The chunker cuts by rule, so judge only the cut.
- Set false only for one of these:
   (a) two beats: after a clear turn (a new person takes over, someone leaves or arrives and the pair changes, the driver starts on a different aim) the second half would need a different driver, target or tactic;
   (b) a fragment: it opens or closes in the middle of an exchange, so that you cannot say what the driver wants without text that is not here (it opens on a bare reply to a question you cannot see, or closes on a question left unanswered, or is only stage direction and a line or two).
- Set true, and do not mark down, for: a long beat held on one tactic; a beat that opens with an entrance or closes with an exit; a speech cut short with "[...]"; stage-direction noise or a garbled speaker name inside the text; several short exchanges with the same two people and the same aim; a chunk you find dull.
- When unsure, true. When false, still tag the stretch that has the most lines, and give confidence below 0.5.

confidence: your own, 0 to 1. Use below 0.5 when the beat is unclear.

Tactic verbs (one group per line)
${tacticPromptList()}

Rules: never copy long passages of the text into the output; never invent speakers; one output line per input line, same order; output nothing else.`;

export type SelectionOptions = {
  /** Share of dialogue-only beats to tag (a beat with a physical-action hint is always kept). */
  dialogueFraction: number;
  /** Share for Portuguese dialogue-only beats, whose stage directions rarely name a physical action. Defaults to `dialogueFraction`. */
  dialogueFractionPt?: number;
};

/** Every beat with a physical-action hint, plus a deterministic share of the dialogue-only ones (per language: Portuguese may take more). */
export function selectForTagging(beats: readonly Beat[], opts: SelectionOptions): Beat[] {
  const keep = new Set<string>();
  const pt = beats.filter((b) => b.actionHint === "DIALOGUE_ONLY" && b.language === "pt");
  const other = beats.filter((b) => b.actionHint === "DIALOGUE_ONLY" && b.language !== "pt");
  for (const id of sampleIds(other.map((b) => b.id), opts.dialogueFraction, "kb-dialogue-1")) keep.add(id);
  for (const id of sampleIds(pt.map((b) => b.id), opts.dialogueFractionPt ?? opts.dialogueFraction, "kb-dialogue-1")) keep.add(id);
  return beats.filter((b) => b.actionHint !== "DIALOGUE_ONLY" || keep.has(b.id));
}

/** Holds out a deterministic share of the beats for blind re-tagging. Same selection as the `sample` command (`sampleIds`, default seed). */
export function splitHeldOut(beats: readonly Beat[], fraction: number): { main: Beat[]; heldOut: Beat[] } {
  const held = new Set(sampleIds(beats.map((b) => b.id), fraction));
  return { main: beats.filter((b) => !held.has(b.id)), heldOut: beats.filter((b) => held.has(b.id)) };
}

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
