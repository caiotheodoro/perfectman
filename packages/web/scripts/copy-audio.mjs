/**
 * The soundtrack lives in `packages/eval/assets/video/audio/` because the MP4
 * renderer got there first. Copying it at build keeps one copy in git and one
 * source of truth for the measured levels the mood module encodes.
 *
 * The licence files come along deliberately: the music is CC BY 4.0 and not
 * covered by the repository licence, so it must not be served without them.
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../eval/assets/video/audio");
const to = resolve(here, "../public/audio");

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
process.stdout.write(`audio -> ${to}\n`);
