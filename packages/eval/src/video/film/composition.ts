import type { DirectorReplay } from "@perfectman/shared";
import { audioCredits, renderSoundtrack, type AudioCue } from "../soundtrack.js";

/** Seconds the credits hold after the film. The music license asks for them. */
export const OUTRO_SECONDS = 6;
export const FILM_WIDTH = 1920;
export const FILM_HEIGHT = 1080;

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** JSON that can sit inside a script element: no way to close it early, and safe in old engines. */
const safeJson = (value: unknown): string => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

export type FilmCompositionInput = {
  title: string;
  replay: DirectorReplay;
  pace: number;
  huddle: "push" | "door" | "wide";
  fictionOnly: boolean;
  /** Length of the film itself, in seconds, from the timeline. */
  filmSeconds: number;
  cues: AudioCue[];
  fps: number;
};

/** One standalone page: the stage, a single seekable GSAP timeline that draws it, and the audio. */
export function renderFilmComposition(input: FilmCompositionInput): string {
  const total = input.filmSeconds + 0.5 + OUTRO_SECONDS;
  const config = { replay: input.replay, choices: { pace: input.pace, huddle: input.huddle, fictionOnly: input.fictionOnly, fps: input.fps }, film: input.filmSeconds };
  const title = escapeHtml(input.title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${FILM_WIDTH}">
<title>Perfectman · ${title}</title><link rel="stylesheet" href="assets/film.css"><script src="assets/gsap.min.js"></script></head><body>
<main id="stage" data-composition-id="run-video" data-start="0" data-duration="${total}" data-width="${FILM_WIDTH}" data-height="${FILM_HEIGHT}" data-fps="${input.fps}">
  <section id="scene" class="clip" data-start="0" data-duration="${total}" data-track-index="0">
    <header id="film-top"><h1>${title}</h1><p>Perfectman${input.fictionOnly ? " · fiction only" : ""}</p></header>
    <div id="film-host" data-layout-allow-overflow></div>
    <div id="film-outro"><h1>Perfectman</h1><p>${title}</p><div id="credits"><p>${escapeHtml(audioCredits(input.cues))}</p></div></div>
  </section>
${renderSoundtrack(input.cues)}
</main>
<script src="assets/film.js"></script>
<script>
const CONFIG = ${safeJson(config)};
const film = window.PerfectmanFilm.mount(document.getElementById("film-host"), CONFIG.replay, CONFIG.choices);
film.render(0);
const tl = gsap.timeline({ paused: true });
const clock = { t: 0 };
tl.to(clock, { t: film.T.duration, duration: film.T.duration, ease: "none", modifiers: { t: (v) => { film.render(parseFloat(v)); return v; } } }, 0);
tl.to("#film-outro", { opacity: 1, duration: 0.5 }, film.T.duration + 0.3);
tl.set("#film-outro", { opacity: 1 }, ${total});
window.__timelines = window.__timelines || {};
window.__timelines["run-video"] = tl;
</script></body></html>`;
}
