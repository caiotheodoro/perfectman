import { readFileSync } from "node:fs";

/** A real run of "The cat on the roof", trimmed to what the film reads. */
export const catReplayJson = (): string => readFileSync(new URL("./cat-run.json", import.meta.url), "utf8");
