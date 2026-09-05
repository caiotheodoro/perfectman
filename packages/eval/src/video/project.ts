import { access, copyFile, cp, link, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { renderComposition } from "./composition.js";
import { readVideoSource } from "./read-source.js";
import { planVideo } from "./storyboard.js";
import type { VideoStoryboard } from "./types.js";

const require = createRequire(import.meta.url);
export type VideoOptions = { input: string; output: string; prepareOnly?: boolean; scenario?: string };

async function requireAbsent(path: string): Promise<void> {
  try { await access(path); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
  throw new Error(`Output already exists: ${path}. Choose a new --out path.`);
}

function run(command: string, args: string[], cwd: string, quiet = false): Promise<void> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: quiet ? "ignore" : "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`${basename(command)} failed (${signal ?? code}). The generated project is kept for inspection.`)));
  });
}

export function checkTimes(storyboard: VideoStoryboard): string {
  const beats = storyboard.beats;
  const indexes = [0, Math.floor(beats.length / 3), Math.floor(beats.length * 2 / 3), beats.length - 1];
  return [...new Set(indexes.map(index => {
    const beat = beats[index]!;
    return (beat.start + beat.duration / 2).toFixed(3);
  })), (storyboard.duration - 1).toFixed(3)].join(",");
}

/** Prepare locally, then publish the finished MP4 without replacing existing files. */
export async function createVideo(options: VideoOptions): Promise<{ output: string; project: string; storyboard: VideoStoryboard }> {
  const input = resolve(options.input), output = resolve(options.output);
  if (extname(output).toLowerCase() !== ".mp4") throw new Error("--out must name an .mp4 file");
  const project = output.slice(0, -4) + ".hyperframes";
  await requireAbsent(output);
  await requireAbsent(project);
  const { story, sourceSha256 } = await readVideoSource(input, options.scenario);
  const storyboard = planVideo(story, input, sourceSha256);
  const html = await renderComposition(storyboard);
  if (!options.prepareOnly) await run("ffmpeg", ["-version"], dirname(input), true);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(project);
  const assets = resolve(project, "assets");
  await cp(new URL("../../assets/video/", import.meta.url), assets, { recursive: true, force: false, errorOnExist: true });
  await copyFile(require.resolve("gsap/dist/gsap.min.js"), resolve(assets, "gsap.min.js"));
  await copyFile(require.resolve("@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2"), resolve(assets, "dm-sans-latin-wght-normal.woff2"));
  await copyFile(resolve(dirname(require.resolve("@fontsource-variable/dm-sans/package.json")), "LICENSE"), resolve(assets, "DM-Sans-LICENSE.txt"));
  await copyFile(new URL("../../../../docs/assets/readme-logo.png", import.meta.url), resolve(assets, "perfectman-logo.png"));
  await writeFile(resolve(project, "index.html"), html, { flag: "wx" });
  await writeFile(resolve(project, "storyboard.json"), JSON.stringify(storyboard, null, 2) + "\n", { flag: "wx" });
  await writeFile(resolve(project, "README.md"), `# ${storyboard.title}\n\nSource: ${input}\n\n${storyboard.steps.length} source steps, ${storyboard.beats.length} readable pages, ${storyboard.duration.toFixed(2)} seconds.\n\nThe storyboard preserves source references and raw records.\n\n${storyboard.notices.map(notice => `- ${notice}`).join("\n")}\n`, { flag: "wx" });
  if (!options.prepareOnly) {
    const cli = require.resolve("hyperframes/bin/hyperframes.mjs");
    // Generated runs can exceed the authored-HTML length advisory; verification errors still block output.
    await run(process.execPath, [cli, "check", project, "--at", checkTimes(storyboard), "--snapshots"], project);
    const temporary = resolve(project, "render.mp4");
    await run(process.execPath, [cli, "render", project, "--fps", "30", "--quality", "high", "--workers", "1", "--low-memory-mode", "--strict", "--no-best-effort", "--output", temporary], project);
    if ((await stat(temporary)).size === 0) throw new Error("HyperFrames produced an empty video");
    await link(temporary, output);
    await unlink(temporary);
  }
  return { output, project, storyboard };
}
