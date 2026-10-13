/**
 * The film at a glance: the story clock, the camera (wide shots, private huddles,
 * time passing) and a lane per person showing when they speak and when they are
 * reading someone else. Drag anywhere on it to move through the film.
 */
import { useRef, type PointerEvent } from "react";
import { clockText, colorFor, type DirectorReplay, type Timeline } from "@perfectman/shared";

const LABEL_WIDTH = 84;

export function TimelineStrip({ T, replay, t, onSeek }: { T: Timeline; replay: DirectorReplay; t: number; onSeek: (t: number) => void }): JSX.Element {
  const strip = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = (x: number): string => `${(x / T.duration) * 100}%`;
  const short = (id: string): string => (replay.agentProfiles?.[id]?.displayName ?? replay.agentNames[id] ?? id).replace(/^(Dona|Mr\.|Ms\.|Mrs\.|Dr\.)\s+/, "");
  const seekFrom = (e: PointerEvent): void => {
    const r = strip.current!.getBoundingClientRect();
    onSeek(((e.clientX - r.left - LABEL_WIDTH) / Math.max(1, r.width - LABEL_WIDTH)) * T.duration);
  };
  const pulses = replay.pulses.length;
  const ticks = [];
  for (let p = 0; p < pulses; p += Math.max(4, Math.round(pulses / 7))) ticks.push(p);
  const minuteOf = (p: number): number => {
    const k = T.light.find((l) => l.t >= (T.pulseT[p] ?? 0));
    return k ? k.minute : 0;
  };
  return (
    <div
      className="strip"
      ref={strip}
      role="img"
      aria-label="Timeline of the film. Drag to move."
      onPointerDown={(e) => { dragging.current = true; strip.current!.setPointerCapture?.(e.pointerId); seekFrom(e); }}
      onPointerMove={(e) => { if (dragging.current) seekFrom(e); }}
      onPointerUp={() => { dragging.current = false; }}
    >
      <div className="strip__row">
        <span className="strip__name">clock</span>
        <div className="strip__lane">
          {ticks.map((p) => <span key={p} className="strip__tick" style={{ left: pct(T.pulseT[p] ?? 0) }}>{clockText(Math.round(minuteOf(p)))}</span>)}
        </div>
      </div>
      <div className="strip__row">
        <span className="strip__name">camera</span>
        <div className="strip__lane">
          {T.scenes.map((s, i) => (
            <span key={i} className={`strip__seg strip__seg--${s.type}`} style={{ left: pct(s.t0), width: pct(s.t1 - s.t0) }} title={s.type === "huddle" ? s.members.map(short).join(" + ") : "wide shot"} />
          ))}
          {T.lapses.map((l, i) => <span key={`l${i}`} className="strip__seg strip__seg--lapse" style={{ left: pct(l.t0), width: pct(l.t1 - l.t0) }} />)}
        </div>
      </div>
      {replay.agentIds.map((id, i) => (
        <div className="strip__row" key={id} style={{ ["--c" as string]: colorFor(i) }}>
          <span className="strip__name">{short(id)}</span>
          <div className="strip__lane">
            {T.msgs.filter((m) => m.actor !== id && T.scenes[m.sceneIndex]?.members.includes(id)).map((m) => (
              <span key={`h${m.id}`} className="strip__seg strip__seg--hear" style={{ left: pct(m.s0), width: pct(m.readEnd - m.s0) }} />
            ))}
            {T.msgs.filter((m) => m.actor === id).map((m) => (
              <span key={m.id} className="strip__seg strip__seg--speak" style={{ left: pct(m.s0), width: pct(m.readEnd - m.s0) }} title={`${m.wordCount} words, read in ${(m.readEnd - m.s0).toFixed(1)} s`} />
            ))}
          </div>
        </div>
      ))}
      <span className="strip__head" style={{ left: `calc(${LABEL_WIDTH}px + (100% - ${LABEL_WIDTH}px) * ${t / T.duration})` }} />
    </div>
  );
}
