/**
 * The hotel's recorded lifecycles (vendored under packages/hotel/fixtures/drama/hotel, see its PROVENANCE.md), put in the real
 * `frames.jsonl` wrapper `{conn, dir, frame, run, ts_ms}` the way the hotel's frame log writes them, and read the way the loader
 * reads them. The hotel's rows leave `seq` out (and, in the contract-derived files, `at`), so a `seq` is added; `ts_ms` is the
 * frame's own `at`, the same clock the hotel stamped it with. Test support only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyFrame } from "@perfectman/shared";
import { extractDramaEvents, type DramaEvent } from "../drama/index.js";
import { normalizeFrame } from "../hotel/index.js";
import { runDramaProbes } from "../probes/drama.js";
import type { DramaProbeResult } from "../probes/drama.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../hotel/fixtures/drama/hotel");

export const LIFECYCLES = ["slap-human-take", "slap-human-timeout", "kill-actor-revive", "down-human-abort"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const RUN = 7;
export const ROOM = 12;
export const ACTORS = ["person-1", "person-2", "person-3"];

type Row = { in: Record<string, unknown> | null; expect: Record<string, unknown>[] };
export type Line = Record<string, unknown>;

const rows = (name: Lifecycle): Row[] =>
  readFileSync(join(DIR, `${name}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Row);

/** What the hotel logs when a run of three actors opens in room 12: the run, then the three spawns. */
const opening = (at: number): Line[] => [
  { conn: 4, dir: "out", frame: { t: "run_start", seq: 1, run: RUN, room: ROOM, lease: 1, mode: "default", cap_actors: 12, admin: { id: 27, name: "a" } }, run: RUN, ts_ms: at - 100 },
  ...ACTORS.map((ref, i) => ({ conn: 4, dir: "out", frame: { t: "actor_spawned", seq: 2 + i, run: RUN, room: ROOM, actor: -(701 + i), ref, cid: 1 + i, x: i, y: 8, dir: 2 }, run: RUN, ts_ms: at - 90 + i })),
];

/** A lifecycle as `frames.jsonl` lines: the opening, then each row's sidecar frame (`in`) and the hotel's frames (`expect`) in the order they were recorded. */
export function lifecycleLines(name: Lifecycle): Line[] {
  const all = rows(name);
  const first = Number(all.flatMap((r) => r.expect).find((f) => typeof f["at"] === "number")?.["at"] ?? 0);
  const lines = opening(first);
  let seq = 10;
  for (const row of all) {
    const stamp = Number(row.expect.find((f) => typeof f["at"] === "number")?.["at"] ?? first);
    if (row.in) lines.push({ conn: 4, dir: "in", frame: { ...row.in, seq: ++seq }, run: RUN, ts_ms: stamp - 1 });
    for (const f of row.expect) lines.push({ conn: 4, dir: "out", frame: { ...f, seq: ++seq }, run: RUN, ts_ms: typeof f["at"] === "number" ? f["at"] : stamp });
  }
  return lines;
}

export const innerOf = (line: Line): Record<string, unknown> => line["frame"] as Record<string, unknown>;
export const load = (lines: readonly Line[]): BodyFrame[] => lines.map((l) => normalizeFrame(l)!);
export const eventsOf = (lines: readonly Line[]): DramaEvent[] => extractDramaEvents(load(lines));

/** Every drama probe over a set of lines, by name. `runMs` is how long the run lasted when the caller knows (the hotel's recorded run does: its `given.after_ms`); default, the span of the lines, as the harness measures it. */
export function probesOf(lines: readonly Line[], runMs?: number): Map<string, DramaProbeResult> {
  const frames = load(lines);
  const durationMs = runMs ?? Math.max(...frames.map((f) => f.atMs)) - Math.min(...frames.map((f) => f.atMs));
  return new Map(runDramaProbes({ events: extractDramaEvents(frames), actorIds: ACTORS, durationMs }).map((r) => [r.probe, r]));
}

/** Lines minus those whose frame matches. */
export const without = (lines: readonly Line[], drop: (frame: Record<string, unknown>) => boolean): Line[] => lines.filter((l) => !drop(innerOf(l)));

/** Lines with every matching frame replaced by `change(frame)` (the wrapper keeps its `ts_ms`). */
export const mapFrames = (lines: readonly Line[], match: (frame: Record<string, unknown>) => boolean, change: (frame: Record<string, unknown>) => Record<string, unknown>): Line[] =>
  lines.map((l) => (match(innerOf(l)) ? { ...l, frame: change(innerOf(l)) } : l));
