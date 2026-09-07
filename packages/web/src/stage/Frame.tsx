/**
 * One frame of the contact sheet: a beat as a picture with no words in it.
 *
 * The ground says which kind of room it was, a dot per person says who stood
 * where — the same seating the stage drew, from the same placement — and one
 * dot is ringed for whose moment it was, with a glyph above it for what kind
 * of moment: a box for something said, a cloud for something only thought, an
 * arrow for someone arriving or leaving. Nothing here is readable, on purpose:
 * the strip is for finding your place in the run, not for reading it again.
 */
import { memo } from "react";
import {
  chipFor,
  chipIndexFor,
  FIGURE_HEIGHT_FRACTION,
  type ChannelKind,
  type LiveChannel,
  type Placement,
  type StageBeat,
} from "@perfectman/shared";
import { roomLabel, type NamedAgent } from "./room-label.js";

/** 16:7, like the room, so the dots land where the figures stood. */
export const FRAME_W = 64;
export const FRAME_H = 28;

export type FrameGlyph = "speech" | "thought" | "arrive" | "leave" | "invite" | null;

export type FrameDot = { x: number; y: number; r: number; chip: number; speaker: boolean };

export type FrameModel = {
  id: string;
  kind: ChannelKind;
  glyph: FrameGlyph;
  dots: readonly FrameDot[];
  /** Two frames with the same signature draw the same picture. */
  sig: string;
};

export function frameFor(beat: StageBeat, placement: Placement, ids: readonly string[]): FrameModel {
  const dots = placement.marks.map(({ agentId, point }) => {
    const r = 3 * point.scale;
    return {
      x: point.x * FRAME_W,
      // The dot stands for the whole figure, so it sits at the figure's middle.
      y: (point.y - (FIGURE_HEIGHT_FRACTION * point.scale) / 2) * FRAME_H,
      r,
      chip: chipIndexFor(agentId, ids),
      speaker: agentId === beat.actorId,
    };
  });
  const glyph = glyphFor(beat);
  const sig = [
    placement.kind,
    glyph ?? "-",
    ...dots.map((d) => `${d.chip}:${d.x.toFixed(1)}:${d.y.toFixed(1)}:${d.r.toFixed(1)}:${d.speaker ? 1 : 0}`),
  ].join("|");
  return { id: beat.id, kind: placement.kind, glyph, dots, sig };
}

function glyphFor(beat: StageBeat): FrameGlyph {
  if (beat.kind === "message") return "speech";
  if (beat.kind === "aside" || beat.kind === "silence") return "thought";
  if (beat.kind === "event") return beat.stageAction?.kind ?? null;
  return null;
}

/** What a screen reader gets instead of the picture. */
export function frameLabel(beat: StageBeat, agents: readonly NamedAgent[], channel: LiveChannel | undefined): string {
  const who = agents.find((a) => a.id === beat.actorId)?.displayName ?? beat.actorId ?? "someone";
  const where = roomLabel(channel, agents);
  if (beat.kind === "silence") return `${who} says nothing`;
  if (beat.kind === "aside") return `what ${who} was after`;
  if (beat.kind === "event") {
    if (beat.stageAction?.kind === "leave") return `${who} leaves ${where}`;
    if (beat.stageAction?.kind === "arrive") return `${who} arrives in ${where}`;
    return `${who} opens ${where}`;
  }
  return `${who} speaks in ${where}`;
}

export const Frame = memo(
  function Frame({ model, blank = false }: { model: FrameModel; blank?: boolean }): JSX.Element {
    const speaker = model.dots.find((d) => d.speaker);
    return (
      <svg
        className={`frame frame--${model.kind}${blank ? " frame--blank" : ""}`}
        viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
        aria-hidden="true"
        focusable="false"
      >
        <rect className="frame__ground" x="0.3" y="0.3" width={FRAME_W - 0.6} height={FRAME_H - 0.6} rx="2" />
        {model.kind === "private" ? (
          <rect className="frame__inset" x="2.5" y="2.5" width={FRAME_W - 5} height={FRAME_H - 5} rx="1.2" />
        ) : null}
        {blank
          ? null
          : model.dots.map((d, i) => (
              <circle key={i} className="frame__dot" cx={d.x} cy={d.y} r={d.r} fill={chipFor(d.chip)} />
            ))}
        {!blank && speaker ? (
          <>
            <circle className="frame__ring" cx={speaker.x} cy={speaker.y} r={speaker.r + 1.1} />
            <Glyph kind={model.glyph} x={speaker.x} y={speaker.y - speaker.r - 2.2} />
          </>
        ) : null}
      </svg>
    );
  },
  (a, b) => a.model.sig === b.model.sig && a.blank === b.blank,
);

function Glyph({ kind, x, y }: { kind: FrameGlyph; x: number; y: number }): JSX.Element | null {
  if (kind === "speech") return <rect className="frame__glyph frame__glyph--speech" x={x - 4} y={y - 4} width="8" height="4" rx="1" />;
  if (kind === "thought") return <ellipse className="frame__glyph frame__glyph--thought" cx={x} cy={y - 2} rx="4.2" ry="2.2" />;
  if (kind === "arrive") return <path className="frame__glyph frame__glyph--move" d={`M${x - 3.5} ${y - 2}h5.5m-2.2-2.2l2.2 2.2-2.2 2.2`} />;
  if (kind === "leave") return <path className="frame__glyph frame__glyph--move" d={`M${x + 3.5} ${y - 2}h-5.5m2.2-2.2l-2.2 2.2 2.2 2.2`} />;
  if (kind === "invite") return <path className="frame__glyph frame__glyph--move" d={`M${x} ${y - 4.5}v5m-2.5-2.5h5`} />;
  return null;
}
