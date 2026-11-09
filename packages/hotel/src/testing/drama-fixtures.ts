import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The cross-check fixtures of act-contract.md 9.1, `packages/hotel/fixtures/drama/*.jsonl`. A row is
 * `{in, expect}`: the hotel replays `in` and compares `expect` ignoring `seq` and `at`; perfectman feeds `expect`
 * to its extractor and checks `in` with its own types. `given` (blocked-all-reasons only) says in words which
 * world the row presumes, since a blocked reason depends on state the frame cannot carry.
 */
export type FixtureRow = { given?: string; in: Record<string, unknown>; expect: Record<string, unknown>[] };

export const DRAMA_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/drama");

export function readDramaFixture(name: string): FixtureRow[] {
  return readFileSync(join(DRAMA_FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as FixtureRow);
}
