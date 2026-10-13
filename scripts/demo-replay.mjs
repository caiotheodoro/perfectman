/**
 * Writes the landing film's screenplay as a replay.json the film command can draw.
 * No model is involved: the screenplay is hand-written in packages/shared/src/demo.
 *
 *   node scripts/demo-replay.mjs out/demo/replay.json
 *   pnpm video --film --input out/demo/replay.json --out out/demo/party.mp4
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { surpriseParty } from "../packages/shared/dist/index.js";

const target = resolve(process.argv[2] ?? "out/demo/replay.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(surpriseParty(), null, 2)}\n`);
console.log(`wrote ${target}`);
