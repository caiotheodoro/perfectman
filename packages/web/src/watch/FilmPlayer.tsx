/**
 * The film player: a stage, a clock, and the controls to move through a run.
 *
 * The stage is drawn from `sampleTimeline`, so it is a pure function of the
 * clock: scrubbing, speed and the reading pace all just change the clock or
 * rebuild the timeline, and nothing "triggers".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { type DirectorReplay, type PaceName } from "@perfectman/shared";
import { reducedMotion } from "../stage/motion.js";
import { FilmAudio } from "./film-audio.js";
import { captionAt, type Caption } from "./caption.js";
import { buildFilm, formatDuration, type Film } from "./film.js";
import { FilmClock, type FilmSpeed } from "./FilmClock.js";
import { canvasMeasurer, loadLettering } from "./fonts.js";
import { StageView } from "./StageView.js";
import { TimelineStrip } from "./TimelineStrip.js";

const PACE_LABELS: Array<[PaceName, string]> = [["relaxed", "Relaxed"], ["normal", "Normal"], ["fast", "Fast"]];
const SPEEDS: FilmSpeed[] = [1, 2, 4];

export type FilmPlayerProps = {
  replay: DirectorReplay;
  title: string;
  /** `hero` is the landing page's cut: no timeline, no pace, one switch for what is shown. */
  variant?: "full" | "hero";
  /** Start by itself, silently, unless the viewer asked for less motion. */
  autoplay?: boolean;
  /** Start again a moment after the end. */
  loop?: boolean;
  pace?: PaceName;
  /** The run is still going: it grows, and the viewer keeps their place in it. */
  live?: boolean;
};

/** How long the last frame holds before a looping film starts over. */
const LOOP_REST_MS = 2600;

export function FilmPlayer({ replay, title, variant = "full", autoplay = false, loop = false, pace: initialPace = "normal", live = false }: FilmPlayerProps): JSX.Element {
  const hero = variant === "hero";
  const [pace, setPace] = useState<PaceName>(initialPace);
  const [omniscient, setOmniscient] = useState(true);
  const [speed, setSpeed] = useState<FilmSpeed>(1);
  const [voices, setVoices] = useState(false);
  const [sound, setSound] = useState(false);
  const [film, setFilm] = useState<Film | null>(null);
  const [view, setView] = useState({ t: 0, playing: false });
  const [narrow, setNarrow] = useState(false);
  const [caption, setCaption] = useState<Caption | null>(null);
  const lastCaption = useRef('');
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<StageView | null>(null);
  const clock = useRef(new FilmClock(1));
  const lens = useRef(true);
  const restart = useRef<number | undefined>(undefined);
  // Keyed on who is in the room, not on the replay object, so a growing run keeps the same audio.
  const people = replay.agentIds.join("|");
  const audio = useMemo(() => new FilmAudio((id) => replay.agentIds.indexOf(id)), [people]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    void loadLettering().then(() => {
      if (alive) setFilm(buildFilm(replay, { pace, measure: canvasMeasurer() }));
    });
    return () => { alive = false; };
  }, [replay, pace]);

  // A phone cannot read a balloon drawn at a third of its size, so below this width the line is also set as a caption.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth > 0 && el.clientWidth < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!film || !host.current) return;
    const s = new StageView(host.current, film.T, replay, { setting: replay.look?.setting, room2: replay.look?.rooms?.[0] });
    stage.current = s;
    if (live) clock.current.extend(film.T.duration);
    else clock.current.retime(film.T.duration);
    s.render(clock.current.t, { omniscient: lens.current });
    if (autoplay && !reducedMotion() && clock.current.t === 0) clock.current.playing = true;
    setView({ t: clock.current.t, playing: clock.current.playing });
    return () => { s.destroy(); stage.current = null; };
  }, [film, replay, autoplay, live]);

  useEffect(() => {
    if (!film) return;
    let raf = 0, last: number | null = null, shown = 0;
    const frame = (now: number): void => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const c = clock.current, before = c.t;
      if (c.tick(dt) && loop && restart.current === undefined) {
        restart.current = window.setTimeout(() => { restart.current = undefined; c.seek(0); c.playing = true; }, LOOP_REST_MS);
      }
      const S = stage.current?.render(c.t, { omniscient: lens.current });
      if (S) {
        audio.frame(film.T, S, before, c.t, Math.min(dt, 0.1), c.playing);
        const cap = captionAt(S, (id) => (replay.agentProfiles?.[id]?.displayName ?? replay.agentNames[id] ?? id).replace(/^(Dona|Mr\.|Ms\.|Mrs\.|Dr\.)\s+/, ""));
        const key = cap ? `${cap.name}|${cap.text}` : "";
        if (key !== lastCaption.current) { lastCaption.current = key; setCaption(lens.current || cap?.kind !== "thought" ? cap : null); }
      }
      if (now - shown > 120) { shown = now; setView({ t: c.t, playing: c.playing }); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [film, audio, replay, loop]);

  useEffect(() => () => { window.clearTimeout(restart.current); restart.current = undefined; }, []);
  useEffect(() => () => audio.destroy(), [audio]);

  const seek = useCallback((t: number) => {
    clock.current.seek(t);
    setView({ t: clock.current.t, playing: clock.current.playing });
  }, []);
  const toggle = useCallback(() => {
    clock.current.toggle();
    setView({ t: clock.current.t, playing: clock.current.playing });
  }, []);
  const onKey = (e: KeyboardEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type === "range") return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek(clock.current.t - 5); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seek(clock.current.t + 5); }
  };

  const duration = film?.T.duration ?? 0;
  const stats = film ? `${film.T.msgs.length} messages, ${film.T.wordTotal.toLocaleString()} words, read at ${film.T.pace.toFixed(1)} words a second.` : "";

  return (
    <section className={`film${narrow ? " film--narrow" : ""}${hero ? " film--hero" : ""}`} aria-label={`Film of ${title}`} onKeyDown={onKey}>
      <div className="film__stage" ref={host} role="img" aria-label={`${title}, drawn as a film`}>
        {!film ? <p className="film__loading" role="status">Setting the stage…</p> : null}
      </div>
      {narrow ? (
        <p className={`film__caption film__caption--${caption?.kind ?? "none"}`} aria-live="off">
          {caption ? <><span className="film__who">{caption.name}</span> {caption.text}</> : <span className="u-dim">Press play.</span>}
        </p>
      ) : null}
      {hero ? (
        <div className="film__hero-bar">
          <button type="button" className="btn" disabled={!film} onClick={toggle}>{view.playing ? "Pause" : view.t >= duration && duration > 0 ? "Watch again" : "Play"}</button>
          <div className="lens" role="group" aria-label="What you can see">
            <button type="button" aria-pressed={!omniscient} onClick={() => { lens.current = false; setOmniscient(false); }}>What they say</button>
            <button type="button" aria-pressed={omniscient} onClick={() => { lens.current = true; setOmniscient(true); }}>What they think</button>
          </div>
          <button type="button" aria-pressed={sound} className="film__opt film__opt--solo" onClick={() => { audio.setSound(!sound); setSound(!sound); }}>{sound ? "Sound on" : "Sound off"}</button>
          <input
            className="film__scrub" type="range" min={0} max={1000} step={1} aria-label="Position in the film" disabled={!film}
            value={duration > 0 ? Math.round((view.t / duration) * 1000) : 0}
            onChange={(e) => seek((Number(e.target.value) / 1000) * duration)}
          />
        </div>
      ) : (
      <>
      <div className="film__bar">
        <button type="button" className="btn" disabled={!film} onClick={toggle}>{view.playing ? "Pause" : view.t >= duration && duration > 0 ? "Watch again" : "Play"}</button>
        <button type="button" className="btn btn--quiet" disabled={!film} onClick={() => seek(clock.current.t - 5)} aria-label="Back five seconds">−5 s</button>
        <button type="button" className="btn btn--quiet" disabled={!film} onClick={() => seek(clock.current.t + 5)} aria-label="Forward five seconds">+5 s</button>
        <input
          className="film__scrub" type="range" min={0} max={1000} step={1} aria-label="Position in the film" disabled={!film}
          value={duration > 0 ? Math.round((view.t / duration) * 1000) : 0}
          onChange={(e) => seek((Number(e.target.value) / 1000) * duration)}
        />
        <span className="film__time">{formatDuration(view.t)} / {formatDuration(duration)}</span>
        {live ? <button type="button" className="btn btn--quiet film__live" disabled={!film || view.t >= duration - 1} onClick={() => seek(duration)}>Jump to latest</button> : null}
      </div>
      <div className="film__opts">
        <div className="film__group" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} className="film__opt" onClick={() => { clock.current.speed = s; setSpeed(s); }}>{s}x</button>
          ))}
        </div>
        <div className="film__group" role="group" aria-label="Reading pace">
          {PACE_LABELS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={pace === id} className="film__opt" onClick={() => setPace(id)}>{label}</button>
          ))}
        </div>
        <div className="film__group" role="group" aria-label="What you can see">
          <button type="button" aria-pressed={omniscient} className="film__opt" onClick={() => { lens.current = true; setOmniscient(true); }}>Omniscient</button>
          <button type="button" aria-pressed={!omniscient} className="film__opt" onClick={() => { lens.current = false; setOmniscient(false); }}>Fiction only</button>
        </div>
        <button
          type="button" aria-pressed={sound} className="film__opt"
          onClick={() => { audio.setSound(!sound); setSound(!sound); }}
        >Sound</button>
        <button
          type="button" aria-pressed={voices} className="film__opt"
          onClick={() => { audio.setVoices(!voices); setVoices(!voices); }}
        >Voices</button>
      </div>
      {film ? <TimelineStrip T={film.T} replay={replay} t={view.t} onSeek={seek} /> : null}
      <p className="film__stats u-dim">{stats} A balloon stays up until its words are read; the next one lands as the last is being finished.</p>
      </>
      )}
    </section>
  );
}
