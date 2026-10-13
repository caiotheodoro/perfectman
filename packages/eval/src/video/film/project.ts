import { access, copyFile, cp, link, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { buildFilmTimeline, PACES, type PaceName } from "@perfectman/shared";
import { bundleFilmPage } from "./bundle.js";
import { FILM_HEIGHT, FILM_WIDTH, OUTRO_SECONDS, renderFilmComposition } from "./composition.js";
import { readFilmSource } from "./source.js";
import { planFilmSoundtrack } from "./soundtrack.js";

const require = createRequire(import.meta.url);
const web = createRequire(new URL("../../../../web/package.json", import.meta.url));
const FPS = 30;

export type FilmOptions = {
  input: string;
  output: string;
  pace?: PaceName;
  huddle?: "push" | "door" | "wide";
  fictionOnly?: boolean;
  prepareOnly?: boolean;
  /** Only the first N pulses: a short preview of a long run. */
  maxPulses?: number;
};

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

/** The lettering faces: the file to copy and the family name the page uses. */
const FACES: Array<{ pkg: string; file: string; family: string; weight: string }> = [
  { pkg: "@fontsource-variable/shantell-sans", file: "shantell-sans-latin-full-normal.woff2", family: "Shantell Sans Variable", weight: "300 800" },
  { pkg: "@fontsource/special-elite", file: "special-elite-latin-400-normal.woff2", family: "Special Elite", weight: "400" },
  { pkg: "@fontsource/patrick-hand", file: "patrick-hand-latin-400-normal.woff2", family: "Patrick Hand", weight: "400" },
  { pkg: "@fontsource/kalam", file: "kalam-latin-400-normal.woff2", family: "Kalam", weight: "400" },
  { pkg: "@fontsource/londrina-solid", file: "londrina-solid-latin-400-normal.woff2", family: "Londrina Solid", weight: "400" },
  { pkg: "@fontsource/caveat", file: "caveat-latin-400-normal.woff2", family: "Caveat", weight: "400" },
];

async function filmCss(): Promise<string> {
  const faces = FACES.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url(fonts/${f.file}) format("woff2")}`).join("\n");
  const watch = await readFile(new URL("../../../../web/src/watch/watch.css", import.meta.url), "utf8");
  return `${faces}
:root{--serif:"Fraunces",Georgia,serif;--sans:system-ui,sans-serif;--rule:#d6d8ca;--r-xl:8px}
html,body{margin:0;background:#0b1124}
#stage{position:relative;width:${FILM_WIDTH}px;height:${FILM_HEIGHT}px;overflow:hidden;background:#0b1124;color:#f7f5ed;font-family:var(--sans)}
#scene{position:absolute;inset:0}
#film-top{position:absolute;left:0;right:0;top:0;height:60px;display:flex;align-items:center;gap:20px;padding:0 36px;box-sizing:border-box}
#film-top h1{margin:0;font:700 26px/1 var(--sans);letter-spacing:-.02em}
#film-top p{margin:0;color:#aab4d6;font:600 16px/1 var(--sans)}
#film-host{position:absolute;left:0;top:60px;width:${FILM_WIDTH}px}
#film-outro{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;gap:14px;background:#0b1124;opacity:0;text-align:center;padding:0 160px}
#film-outro h1{margin:0;font:800 84px/1 var(--sans);letter-spacing:-.04em}
#film-outro>p{margin:0;font:600 28px/1.2 var(--sans);color:#aab4d6}
#credits{max-width:1200px;margin-top:40px;color:#8d98bc;font:400 17px/1.5 var(--sans)}
#credits p{margin:0}
${watch}
`;
}

/** Prepare the project from a stored replay, then render it with HyperFrames unless asked not to. */
export async function createFilmVideo(options: FilmOptions): Promise<{ output: string; project: string; seconds: number; messages: number; words: number }> {
  const input = resolve(options.input), output = resolve(options.output);
  if (extname(output).toLowerCase() !== ".mp4") throw new Error("--out must name an .mp4 file");
  const project = output.slice(0, -4) + ".hyperframes";
  await requireAbsent(output);
  await requireAbsent(project);
  const source = await readFilmSource(input, options.maxPulses);
  const paceName = options.pace ?? "normal";
  const choices = { pace: PACES[paceName], huddle: options.huddle ?? "push", fictionOnly: options.fictionOnly ?? false };
  const T = buildFilmTimeline(source.replay, choices);
  const total = T.duration + 0.5 + OUTRO_SECONDS;
  const cues = planFilmSoundtrack(T, total);
  const html = renderFilmComposition({ title: source.title, replay: source.replay, ...choices, filmSeconds: T.duration, cues, fps: FPS });
  const page = await bundleFilmPage();
  const css = await filmCss();
  if (!options.prepareOnly) await run("ffmpeg", ["-version"], dirname(input), true);

  await mkdir(dirname(output), { recursive: true });
  await mkdir(project);
  const assets = resolve(project, "assets");
  await cp(new URL("../../../assets/video/audio/", import.meta.url), resolve(assets, "audio"), { recursive: true, force: false, errorOnExist: true });
  await copyFile(require.resolve("gsap/dist/gsap.min.js"), resolve(assets, "gsap.min.js"));
  await mkdir(resolve(assets, "fonts"));
  for (const face of FACES) await copyFile(resolve(dirname(web.resolve(`${face.pkg}/package.json`)), "files", face.file), resolve(assets, "fonts", face.file));
  await writeFile(resolve(assets, "film.js"), page, { flag: "wx" });
  await writeFile(resolve(assets, "film.css"), css, { flag: "wx" });
  await writeFile(resolve(project, "index.html"), html, { flag: "wx" });
  await writeFile(resolve(project, "film.json"), JSON.stringify({
    version: "perfectman-film-v1", title: source.title, sourceFile: input, sourceSha256: source.sha256,
    pace: paceName, wordsPerSecond: choices.pace, huddle: choices.huddle, fictionOnly: choices.fictionOnly,
    pulses: source.replay.pulses.length, messages: T.msgs.length, words: T.wordTotal, filmSeconds: T.duration, totalSeconds: total, fps: FPS,
    scenes: T.scenes.map((s) => ({ type: s.type, members: s.members, start: s.t0, end: s.t1 })),
    audio: cues.map((c) => ({ id: c.id, file: c.file, start: c.start, duration: c.duration, kind: c.kind, reason: c.reason })),
  }, null, 2) + "\n", { flag: "wx" });
  await writeFile(resolve(project, "README.md"), `# ${source.title}\n\nSource: ${input}\n\nA film of a stored run: ${T.msgs.length} messages, ${T.wordTotal} words, read at ${choices.pace} words a second, ${T.duration.toFixed(1)} seconds before the credits.\n\nThe page draws the same stage the web player draws, from the director's timeline. [Audio credits](assets/audio/ATTRIBUTION.md).\n`, { flag: "wx" });

  if (!options.prepareOnly) {
    const cli = require.resolve("hyperframes/bin/hyperframes.mjs");
    // Check where a person would be reading: a balloon fully drawn and its words in, not mid-fade.
    const reading = [0, Math.floor(T.msgs.length / 3), Math.floor((T.msgs.length * 2) / 3), T.msgs.length - 1].map((i) => T.msgs[Math.max(0, i)]).filter((m) => m !== undefined).map((m) => m.s0 + m.timing.reveal + 0.4);
    const at = [...new Set([...reading, total - 2].map((x) => x.toFixed(3)))].join(",");
    await run(process.execPath, [cli, "check", project, "--at", at, "--snapshots"], project);
    const temporary = resolve(project, "render.mp4");
    await run(process.execPath, [cli, "render", project, "--fps", String(FPS), "--quality", "high", "--workers", "1", "--low-memory-mode", "--strict", "--no-best-effort", "--output", temporary], project);
    if ((await stat(temporary)).size === 0) throw new Error("HyperFrames produced an empty video");
    await link(temporary, output);
    await unlink(temporary);
  }
  return { output, project, seconds: total, messages: T.msgs.length, words: T.wordTotal };
}
