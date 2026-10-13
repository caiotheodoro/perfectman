import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVideo, type VideoOptions } from "../video/project.js";
import { createFilmVideo, type FilmOptions } from "../video/film/project.js";
import { PACES } from "@perfectman/shared";

export const VIDEO_USAGE = `Usage: pnpm video --input <run.json|snapshot.html|script.json> --out <video.mp4>

Convert an existing Perfectman artifact without calling a model.
  --input FILE     Evidence, transcript, events, replay, or perfectman-video-v1 script.
  --scenario ID    Select a scene when the input is narrations.json.
  --out FILE.mp4   New output file. Existing files are never replaced.
  --prepare-only   Write the editable HyperFrames project and storyboard without rendering.
  --film           Draw a stored replay.json as the new film: characters in a place, reading-paced balloons.
    --pace NAME      relaxed, normal (default) or fast: how fast the viewer reads.
    --huddle MODE    push (default), door or wide: how a private talk is staged.
    --fiction-only   Leave the private thoughts out.
    --pulses N       Render only the first N pulses, for a short preview.
  --help           Show this help.

Run length follows the source. Every event, phase, and text page receives time.`;

export type VideoCommand = { kind: "story"; options: VideoOptions } | { kind: "film"; options: FilmOptions };

export function parseVideoArgs(args: string[]): VideoCommand | undefined {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    scenario: { type: "string" }, input: { type: "string" }, out: { type: "string" }, "prepare-only": { type: "boolean" }, help: { type: "boolean" },
    film: { type: "boolean" }, pace: { type: "string" }, huddle: { type: "string" }, "fiction-only": { type: "boolean" }, pulses: { type: "string" },
  } });
  if (values.help) return undefined;
  if (!values.input?.trim() || !values.out?.trim()) throw new Error("Both --input and --out are required. Use --help for examples.");
  if (!values.film) {
    for (const flag of ["pace", "huddle", "fiction-only", "pulses"] as const) if (values[flag] !== undefined) throw new Error(`--${flag} only applies with --film.`);
    return { kind: "story", options: { input: values.input, output: values.out, prepareOnly: values["prepare-only"] ?? false, ...(values.scenario ? { scenario: values.scenario } : {}) } };
  }
  if (values.scenario) throw new Error("--scenario does not apply with --film.");
  if (values.pace !== undefined && !(values.pace in PACES)) throw new Error(`--pace must be one of ${Object.keys(PACES).join(", ")}.`);
  if (values.huddle !== undefined && !["push", "door", "wide"].includes(values.huddle)) throw new Error("--huddle must be push, door or wide.");
  const pulses = values.pulses === undefined ? undefined : Number(values.pulses);
  if (pulses !== undefined && !(Number.isInteger(pulses) && pulses > 0)) throw new Error("--pulses must be a positive whole number.");
  return { kind: "film", options: {
    input: values.input, output: values.out, prepareOnly: values["prepare-only"] ?? false, fictionOnly: values["fiction-only"] ?? false,
    ...(values.pace ? { pace: values.pace as keyof typeof PACES } : {}), ...(values.huddle ? { huddle: values.huddle as "push" | "door" | "wide" } : {}), ...(pulses ? { maxPulses: pulses } : {}),
  } };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = parseVideoArgs(args);
  if (!command) { console.log(VIDEO_USAGE); return; }
  if (command.kind === "film") {
    const film = await createFilmVideo(command.options);
    console.log(`${film.messages} messages, ${film.words} words → ${film.seconds.toFixed(1)} seconds with credits`);
    console.log(command.options.prepareOnly ? `Prepared: ${film.project}` : `Video: ${film.output}`);
    return;
  }
  const options = command.options;
  const result = await createVideo(options);
  for (const notice of result.storyboard.notices) console.log(`Source note: ${notice}`);
  console.log(`${result.storyboard.steps.length} source steps → ${result.storyboard.beats.length} pages · ${result.storyboard.duration.toFixed(2)} seconds`);
  console.log(`Storyboard: ${resolve(result.project, "storyboard.json")}`);
  console.log(`Interactive viewer: ${result.viewer}`);
  console.log(options.prepareOnly ? `Prepared: ${result.project}` : `Video: ${result.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
