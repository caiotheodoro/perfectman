/**
 * The run, as a scene.
 *
 * One beat is on stage at a time. Whoever is in the channel stands in their
 * slot; whoever is speaking is lit and the rest recede. A line appears on paper.
 * A thought appears in italic, and never on paper, because a thought was not
 * said.
 *
 * Nothing here decides what a beat means — `live-to-beats` already did that —
 * and nothing here decides where anyone stands — `placeBeats` did that for the
 * whole run at once. This only draws the placement it is handed, which is what
 * lets the contact sheet and the room agree, and lets an outgoing page keep
 * drawing a frozen beat while the next one turns in.
 */
import { memo, useMemo, useRef } from "react";
import {
  chipIndexFor,
  faceFor,
  gestureEnergy,
  headTopFor,
  type LiveChannel,
  type Placement,
  type StageBeat,
} from "@perfectman/shared";
import { Figure } from "./Figure.js";
import { roomLabel } from "./room-label.js";
import { Bubble } from "./Bubble.js";

export type StageAgent = { id: string; displayName: string };

export type StageProps = {
  beat: StageBeat | undefined;
  placement: Placement;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  /** Every agent id in the run; chips are assigned from the sorted list. */
  ids: readonly string[];
};

export const Stage = memo(function Stage({ beat, placement, agents, channels, ids }: StageProps): JSX.Element {
  const { kind, channelId, marks, speaker } = placement;
  const channel = channels.find((c) => c.id === channelId);
  // The speaker's mark, so the balloon can measure where the head actually is
  // rather than trusting a constant that assumes a 16:7 room.
  const speakerRef = useRef<HTMLDivElement>(null);

  // Who is in the run but not in this room. Naming them is the whole point of a
  // private channel: the interesting fact is not that two people are talking,
  // it is that a third cannot hear it.
  const shutOut = useMemo(
    () => (kind === "private" ? agents.filter((a) => !(channel?.memberAgentIds ?? []).includes(a.id)) : []),
    [kind, agents, channel],
  );

  return (
    <div className={`stage stage--${kind}`}>
      <div className="stage__room">
        <p className="stage__where">
          <span aria-hidden="true">{kind === "private" ? "↔" : "#"}</span>
          {roomLabel(channel, agents)}
          {shutOut.length > 0 ? (
            <span className="stage__shut-out">
              {shutOut.map((a) => a.displayName).join(" and ")} cannot see this
            </span>
          ) : null}
        </p>
        {marks.map(({ agentId, point }) => {
          const agent = agents.find((a) => a.id === agentId);
          if (!agent) return null;
          const isActor = beat?.actorId === agent.id;
          return (
            <div
              key={agent.id}
              ref={isActor ? speakerRef : undefined}
              className="stage__mark"
              style={{
                left: `${point.x * 100}%`,
                top: `${point.y * 100}%`,
                transform: `translate(-50%, -100%) scale(${point.scale})`,
                zIndex: Math.round(point.y * 100),
              }}
            >
              <Figure
                index={chipIndexFor(agent.id, ids)}
                name={agent.displayName}
                face={isActor ? faceFor(beat?.emotion) : "neutral"}
                energy={isActor ? gestureEnergy(beat?.emotion) : 0.3}
                speaking={Boolean(isActor && beat?.kind === "message")}
                attentive={!beat || (beat.kind !== "silence" && beat.kind !== "aside") || isActor}
              />
            </div>
          );
        })}

        {/* One balloon, hanging off its own speaker's head. Speech and thought
            are never the same balloon and never stacked: one was said and one
            was not, which is the distinction this interface exists to draw, and
            two of them over one head do not fit above a figure at the back of
            the room. */}
        {beat && speaker && (beat.text || beat.thought) ? (
          <Bubble
            key={beat.id}
            speaker={speakerRef}
            headTopGuess={headTopFor(speaker.point)}
            x={speaker.point.x}
            contentKey={beat.id}
            thought={beat.thought?.text}
            said={beat.text}
          />
        ) : null}
      </div>
    </div>
  );
});
