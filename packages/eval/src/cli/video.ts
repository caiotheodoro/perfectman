import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVideo, type VideoOptions } from "../video/project.js";

export const VIDEO_USAGE = `Usage: pnpm video --input <run.json|snapshot.html|script.json> --out <video.mp4>

Convert an existing Perfectman artifact without calling a model.
  --input FILE     Evidence, transcript, events, replay, or perfectman-video-v1 script.
  --scenario ID    Select a scene when the input is narrations.json.
  --out FILE.mp4   New output file. Existing files are never replaced.
  --prepare-only   Write the editable HyperFrames project and storyboard without rendering.
  --help           Show this help.

Run length follows the source. Every event, phase, and text page receives time.`;

export function parseVideoArgs(args: string[]): VideoOptions | undefined {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    scenario: { type: "string" }, input: { type: "string" }, out: { type: "string" }, "prepare-only": { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) return undefined;
  if (!values.input?.trim() || !values.out?.trim()) throw new Error("Both --input and --out are required. Use --help for examples.");
  return { input: values.input, output: values.out, prepareOnly: values["prepare-only"] ?? false, ...(values.scenario ? { scenario: values.scenario } : {}) };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseVideoArgs(args);
  if (!options) { console.log(VIDEO_USAGE); return; }
  const result = await createVideo(options);
  for (const notice of result.storyboard.notices) console.log(`Source note: ${notice}`);
  console.log(`${result.storyboard.steps.length} source steps → ${result.storyboard.beats.length} pages · ${result.storyboard.duration.toFixed(2)} seconds`);
  console.log(`Storyboard: ${resolve(result.project, "storyboard.json")}`);
  console.log(options.prepareOnly ? `Prepared: ${result.project}` : `Video: ${result.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
