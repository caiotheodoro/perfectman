import { DRAMA_HOTEL_TYPES } from "../director/drama-frames.js";
import type { HotelFrame, HotelMsg } from "../director/index.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { checkFrame } from "./frame-schema.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The hotel's own recorded fixtures, vendored read-only under `fixtures/drama/hotel/` (see its PROVENANCE.md). A row is
 * `{given?, in, expect}`: `in` is the sidecar's frame (`null`: the connection was just opened), `expect` the hotel's frames
 * in order, and `given` the hotel's structured description of the world the row ran in (the hotel's README, D55 reading 2).
 * Test support only.
 */
export type HotelRow = { given?: Record<string, unknown>; in: Record<string, unknown> | null; expect: Record<string, unknown>[] };

export const HOTEL_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/drama/hotel");

/** Every file the hotel wrote, which PROVENANCE.md pins by sha256. */
export const HOTEL_FIXTURE_FILES = [
  "hello-offer.jsonl",
  "act-validation.jsonl",
  "blocked-all-reasons.jsonl",
  "slap-human-take.jsonl",
  "slap-human-timeout.jsonl",
  "kill-actor-revive.jsonl",
  "down-human-abort.jsonl",
  "hello-v1.json",
  "wire-examples.json",
  "HOTEL-README.md",
] as const;

/** The four behaviour-derived lifecycles H2 recorded from its sequencer. */
export const LIFECYCLES = ["slap-human-take", "slap-human-timeout", "kill-actor-revive", "down-human-abort"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export function readHotelRows(name: string): HotelRow[] {
  return readFileSync(join(HOTEL_FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as HotelRow);
}

export const hotelSha256 = (name: string): string => createHash("sha256").update(readFileSync(join(HOTEL_FIXTURE_DIR, name))).digest("hex");

/** `file -> sha256` as PROVENANCE.md pins them. */
export function pinnedShas(): Record<string, string> {
  const text = readFileSync(join(HOTEL_FIXTURE_DIR, "PROVENANCE.md"), "utf8");
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)) out[m[1] as string] = m[2] as string;
  return out;
}

/** The hotel's `expect` frames of every row of a lifecycle, in the order the hotel sent them (a row of one file continues the world of the row before). */
export const lifecycleFrames = (name: Lifecycle): Record<string, unknown>[] => readHotelRows(`${name}.jsonl`).flatMap((r) => r.expect);

const DRAMA_FRAMES_WITH_AT: ReadonlySet<string> = new Set(DRAMA_HOTEL_TYPES);

/**
 * A fixture frame as the hotel would put it on the wire. The hotel's rows are compared ignoring `seq`, `at` and a
 * `hello`'s `session` (its README), so the rows of the contract-derived files leave those out; the fields are put back
 * with neutral values so the frame can be checked against the schema. A recorded row keeps its `at`.
 */
export function asWire(frame: Record<string, unknown>, seq: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...frame, seq };
  if (DRAMA_FRAMES_WITH_AT.has(String(frame["t"])) && out["at"] === undefined) out["at"] = 0;
  if (frame["t"] === "hello" && out["session"] === undefined) out["session"] = "SESSION";
  return out;
}

/** The frames of a lifecycle as typed hotel messages: each one is checked against the real schema first, so the single cast is a validated one. */
export function lifecycleMsgs(name: Lifecycle): HotelMsg[] {
  return lifecycleFrames(name).map((frame, i) => asHotelMsg(frame, i + 1, `${name} frame ${i}`));
}

/** One fixture frame as a typed hotel message with its envelope `seq`, after the real schema has accepted it. */
export function asHotelFrame(frame: Record<string, unknown>, seq: number, what = "frame"): HotelFrame {
  return { ...asHotelMsg(frame, seq, what), seq };
}

function asHotelMsg(frame: Record<string, unknown>, seq: number, what: string): HotelMsg {
  const wire = asWire(frame, seq);
  const check = checkFrame("hotel_to_sidecar", wire);
  if (!check.ok) throw new Error(`${what} (${String(frame["t"])}) is not a HotelMsg: ${check.errors.join("; ")}`);
  return wire as unknown as HotelMsg;
}

/** A drama frame sink that writes the `t` of every frame it is handed (and `session` for the hello's state) to `seen`, in order. */
export function recordingSink(seen: string[]): DramaFrameSink {
  const note = (f: { t: string }): void => void seen.push(f.t);
  return {
    onSession: () => void seen.push("session"),
    onActStarted: note,
    onActBeat: note,
    onActReaction: note,
    onActDone: note,
    onDramaConsent: note,
    onActorDeath: note,
    onActorRevive: note,
    onHumanDown: note,
    onHumanUp: note,
    onSceneCut: note,
    onDramaState: note,
  };
}
