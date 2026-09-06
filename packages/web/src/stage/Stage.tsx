/**
 * The run, as a scene.
 *
 * One beat is on stage at a time. Whoever is in the channel stands in their
 * slot; whoever is speaking is lit and the rest recede. A line appears on paper.
 * A thought appears in handwriting, and never on paper, because a thought was
 * not said.
 *
 * Nothing here decides what a beat means — `live-to-beats` already did that.
 * This only places it.
 */
import { useMemo, useRef } from "react";
import {
  assignSlots,
  chipFor,
  chipIndexFor,
  emotionLabel,
  headTopFor,
  faceFor,
  gestureEnergy,
  slotsFor,
  type ChannelKind,
  type LiveChannel,
  type StageBeat,
  type StageSlot,
} from "@perfectman/shared";
import { Figure } from "./Figure.js";
import { roomLabel } from "./room-label.js";

export type StageAgent = { id: string; displayName: string };

export function Stage({
  beat,
  agents,
  channels,
  idleChannelId,
}: {
  beat: StageBeat | undefined;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  /** Who stands in the room before anything has been said. */
  idleChannelId?: string;
}): JSX.Element {
  // Slot assignment is sticky per channel across beats, so a figure only moves
  // when the room actually changes. A ref, not state: it is a memo of where
  // people already are, and writing it must not cause a render.
  const held = useRef(new Map<string, Map<number, number>>());

  const channelId = beat?.channelId ?? idleChannelId ?? channels[0]?.id ?? "";
  const channel = channels.find((c) => c.id === channelId);
  const kind = kindOf(channel?.type, beat);
  const points = slotsFor(kind);

  const placed = useMemo(() => {
    const order = beat
      ? presentOrder(beat, agents)
      : (channel?.memberAgentIds ?? []).map((id) => agents.findIndex((a) => a.id === id)).filter((i) => i >= 0);
    if (order.length === 0) return [];
    const previous = held.current.get(channelId) ?? new Map<number, number>();
    const slots = assignSlots(order, kind, previous);
    held.current.set(channelId, slots);
    return [...slots]
      .map(([agentIndex, slot]) => ({ agentIndex, point: points[slot] }))
      .filter((placement): placement is { agentIndex: number; point: StageSlot } => placement.point !== undefined);
    // Recomputed per beat; `held` carries the memory between them.
  }, [beat, agents, kind, points, channelId, channel]);

  // Who is in the run but not in this room. Naming them is the whole point of a
  // private channel: the interesting fact is not that two people are talking,
  // it is that a third cannot hear it.
  const shutOut = useMemo(
    () => (kind === "private" ? agents.filter((a) => !(channel?.memberAgentIds ?? []).includes(a.id)) : []),
    [kind, agents, channel],
  );

  const caption = emotionLabel(beat?.emotion);
  const ids = useMemo(() => agents.map((a) => a.id), [agents]);
  const speaker = placed.find(({ agentIndex }) => agents[agentIndex]?.id === beat?.actorId);

  return (
    <div className={`stage stage--${kind}`}>
      {/* Keyed on the room, so moving to a private channel re-mounts the box
          and plays its entrance rather than silently swapping the contents. */}
      <div className="stage__room" key={channelId}>
        <p className="stage__where">
          <span aria-hidden="true">{kind === "private" ? "↔" : "#"}</span>
          {roomLabel(channel, agents)}
          {shutOut.length > 0 ? (
            <span className="stage__shut-out">
              {shutOut.map((a) => a.displayName).join(" and ")} cannot see this
            </span>
          ) : null}
        </p>
        {placed.map(({ agentIndex, point }) => {
          const agent = agents[agentIndex]!;
          const isActor = beat?.actorId === agent.id;
          return (
            <div
              key={agent.id}
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
                attentive={!beat || beat.kind !== "silence" || isActor}
              />
            </div>
          );
        })}

        {/* Balloons hang off the speaker's own head, and speech and thought
            are never the same balloon: one was said and one was not, which is
            the single distinction this whole interface exists to draw. When an
            agent does both, the thought sits above the line — further in. */}
        {beat && speaker ? (
          <div
            key={beat.id}
            className={`bubbles bubbles--${speaker.point.x > 0.5 ? "left" : "right"}`}
            style={{
              left: `${speaker.point.x * 100}%`,
              bottom: `${(1 - headTopFor(speaker.point)) * 100 + 2}%`,
            }}
          >
            {beat.kind === "message" && beat.text ? (
              <div className="bubble bubble--speech">
                <p className="bubble__said u-serif">{beat.text}</p>
                <span className="bubble__tail" aria-hidden="true" />
              </div>
            ) : null}
            {beat.thought ? (
              <div className="bubble bubble--thought">
                <p className="bubble__thought u-hand">{beat.thought.text}</p>
                <span className="bubble__tail" aria-hidden="true" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="stage__utterance">
        {!beat && idleChannelId ? null : beat ? (
          <p className="attribution">
            <span
              className="attribution__chip"
              style={{ background: chipFor(chipIndexFor(beat.actorId ?? "", ids)) }}
            />
            <strong>{nameOf(agents, beat.actorId)}</strong>
            <span className="u-dim">{describe(beat, agents, roomLabel(channel, agents))}</span>
            {caption ? <span className="attribution__reading">{caption}</span> : null}
          </p>
        ) : (
          <p className="u-dim">Waiting for the first move.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Who stands where, most important first: the speaker, then whoever the line is
 * aimed at, then everyone else in the room. `assignSlots` caps it.
 */
function presentOrder(beat: StageBeat, agents: readonly StageAgent[]): number[] {
  const ids = [
    ...(beat.actorId ? [beat.actorId] : []),
    ...beat.audienceIds,
    ...beat.participantIds,
  ];
  const seen = new Set<string>();
  const order: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const at = agents.findIndex((a) => a.id === id);
    if (at >= 0) order.push(at);
  }
  return order;
}

/** One plain sentence about what kind of moment this is. */
function describe(beat: StageBeat, agents: readonly StageAgent[], channelName: string | undefined): string {
  if (beat.kind === "silence") return "says nothing this turn";
  if (beat.kind === "event") return `in ${channelName ?? "the room"}`;
  if (beat.audienceIds.length > 0) {
    const who = beat.audienceIds.map((id) => nameOf(agents, id)).join(", ");
    return `— only ${who} can see this`;
  }
  return channelName ? `in ${channelName}` : "";
}

function kindOf(type: string | undefined, beat: StageBeat | undefined): ChannelKind {
  if (beat?.kind === "silence") return "thought";
  if (type === "private_channel") return "private";
  if (type === "operator_channel" || type === "spectator_channel") return "operator";
  return "public";
}

function nameOf(agents: readonly StageAgent[], id: string | undefined): string {
  return agents.find((a) => a.id === id)?.displayName ?? id ?? "someone";
}
