/**
 * The film inside a rendered video's page.
 *
 * The video renderer loads one HTML page and asks for a picture at each frame's
 * time. This mounts the same stage the player draws and returns a `render(t)`
 * that depends only on `t`, never on the frames drawn before it.
 */
import { buildFilmTimeline, sampleTimeline, type DirectorReplay, type FilmChoices, type Timeline } from "@perfectman/shared";
import { StageView } from "./StageView.js";

export type MountOptions = FilmChoices & { fps: number };

/** Breath advances by the clock's own rate, so its phase is the sum over every earlier frame; tabulate it once. */
export function breathTable(T: Timeline, fps: number): Record<string, Float32Array> {
  const frames = Math.ceil(T.duration * fps) + 2;
  const table: Record<string, Float32Array> = {};
  for (const id of T.agents) table[id] = new Float32Array(frames);
  for (let i = 1; i < frames; i++) {
    const S = sampleTimeline(T, i / fps);
    for (const id of T.agents) table[id]![i] = table[id]![i - 1]! + (6.283 / fps) / Math.max(1.2, S.chars[id]!.v.breath);
  }
  return table;
}

export function mountFilm(host: HTMLElement, replay: DirectorReplay, opts: MountOptions): { T: Timeline; render: (t: number) => void } {
  host.classList.add("watch-film");
  const T = buildFilmTimeline(replay, opts);
  const stage = new StageView(host, T, replay, { setting: replay.look?.setting, room2: replay.look?.rooms?.[0] });
  const breath = breathTable(T, opts.fps);
  const phase = (t: number, id: string): number => {
    const f = Math.max(0, t * opts.fps), i = Math.floor(f), row = breath[id]!;
    const a = row[Math.min(i, row.length - 1)]!, b = row[Math.min(i + 1, row.length - 1)]!;
    return a + (b - a) * (f - i);
  };
  return { T, render: (t) => { stage.render(Math.min(t, T.duration + 1), { omniscient: !opts.fictionOnly, phase: (id) => phase(t, id) }); } };
}

declare global {
  interface Window { PerfectmanFilm?: { mount: typeof mountFilm } }
}
window.PerfectmanFilm = { mount: mountFilm };
