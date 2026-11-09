/**
 * Fixtures for the act contract (docs/drama/act-contract.md revision 2): the spec's own JSON frames, wrapped in the
 * real `frames.jsonl` wrapper `{conn, dir, frame, run, ts_ms}` and read the way the loader reads them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyFrame } from "@perfectman/shared";
import { normalizeFrame } from "../hotel/index.js";
import { extractDramaEvents, type DramaEvent } from "../drama/index.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../drama/__fixtures__");

export const CONTRACT_FIXTURES = ["contract-slap-human-take", "contract-blocked-aborted", "contract-kill-actor-revive", "contract-kill-human-down"] as const;
export type ContractFixture = (typeof CONTRACT_FIXTURES)[number];

/** The wrapper lines of one fixture, parsed. */
export const contractLines = (name: ContractFixture): Record<string, unknown>[] =>
  readFileSync(join(DIR, `${name}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

export const loadLines = (lines: readonly Record<string, unknown>[]): BodyFrame[] => lines.map((l) => normalizeFrame(l)!);

export const contractFrames = (name: ContractFixture): BodyFrame[] => loadLines(contractLines(name));

export const contractEvents = (name: ContractFixture): DramaEvent[] => extractDramaEvents(contractFrames(name));

/** The inner frame of a wrapper line. */
export const innerOf = (line: Record<string, unknown>): Record<string, unknown> => line["frame"] as Record<string, unknown>;

/** Lines minus those whose frame matches. */
export const without = (lines: readonly Record<string, unknown>[], drop: (frame: Record<string, unknown>) => boolean): Record<string, unknown>[] =>
  lines.filter((l) => !drop(innerOf(l)));

/** Lines with every matching frame replaced by `change(frame)` (the wrapper keeps its `ts_ms`). */
export const mapFrames = (
  lines: readonly Record<string, unknown>[],
  match: (frame: Record<string, unknown>) => boolean,
  change: (frame: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>[] => lines.map((l) => (match(innerOf(l)) ? { ...l, frame: change(innerOf(l)) } : l));

export const of = <K extends DramaEvent["kind"]>(events: readonly DramaEvent[], kind: K): Extract<DramaEvent, { kind: K }>[] =>
  events.filter((e): e is Extract<DramaEvent, { kind: K }> => e.kind === kind);

/** A frame as the loader reads it, for one-off adversarial frames. */
export const wire = (frame: Record<string, unknown>, tsMs: number, dir: "in" | "out" = "out"): BodyFrame => normalizeFrame({ conn: 4, dir, frame, run: 7, ts_ms: tsMs })!;
