/** One recorded beat, with separate flow space for its words and its cast. */
import { memo, type CSSProperties } from "react";
import { chipIndexFor, faceFor, gestureEnergy, type LiveChannel, type Placement, type StageBeat } from "@perfectman/shared";
import { Figure } from "./Figure.js";
import { roomLabel } from "./room-label.js";
import { Bubble } from "./Bubble.js";

export type StageAgent = { id: string; displayName: string };
export type StageProps = {
  beat: StageBeat | undefined;
  placement: Placement;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  ids: readonly string[];
  playing?: boolean;
};

/** Fixed reading order at every width; the contact sheet uses these same rows. */
export function castPoint(index: number, count: number): { x: number; y: number; columns: number } {
  const columns = count === 4 ? 2 : Math.max(1, Math.min(count, 3));
  const row = Math.floor(index / columns);
  const inRow = Math.min(columns, count - row * columns);
  return { x: (index % columns + (columns - inRow) / 2 + .5) / columns, y: row, columns };
}

/** Visibility is independent of how many agents fit on the drawing. */
export function audienceFor(beat: StageBeat | undefined, channel: LiveChannel | undefined): string[] {
  if (beat?.kind === "aside" || beat?.kind === "silence") return beat.actorId ? [beat.actorId] : [];
  const audience = beat?.audienceIds.length ? beat.audienceIds
    : beat?.participantIds.length ? beat.participantIds : channel?.memberAgentIds ?? [];
  return [...new Set([...(beat?.actorId ? [beat.actorId] : []), ...audience])];
}

export const Stage = memo(function Stage({ beat, placement, agents, channels, ids, playing = false }: StageProps): JSX.Element {
  const { kind, channelId, marks } = placement;
  const channel = channels.find((c) => c.id === channelId);
  const thought = beat?.kind === "aside" || beat?.kind === "silence";
  const hasThought = thought && Boolean(beat?.thought?.text || beat?.text);
  const audience = audienceFor(beat, channel);
  const isConversation = kind !== "operator" && !thought;
  const shutOut = isConversation && (kind === "private" || Boolean(beat?.audienceIds.length))
    ? agents.filter((a) => !audience.includes(a.id)) : [];
  const overflow = isConversation ? audience.filter((id) => !marks.some((mark) => mark.agentId === id)) : [];
  const name = (id: string): string => agents.find((agent) => agent.id === id)?.displayName ?? id;
  const speakerIndex = marks.findIndex((m) => m.agentId === beat?.actorId);
  const speaker = marks[speakerIndex];
  const speakerPoint = castPoint(speakerIndex, marks.length);
  const listeners = marks.flatMap((mark, i) => mark.agentId !== beat?.actorId && audience.includes(mark.agentId) ? [castPoint(i, marks.length)] : []);
  const target = listeners.length ? {
    x: listeners.reduce((sum, point) => sum + point.x, 0) / listeners.length,
    y: listeners.reduce((sum, point) => sum + point.y, 0) / listeners.length,
  } : undefined;

  return (
    <div className={`stage stage--${kind}${thought ? " stage--unspoken" : ""}${playing ? " stage--playing" : ""}`}>
      <div className="stage__room">
        <p className="stage__where">
          <span className="stage__glyph" aria-hidden="true">{thought ? "○" : kind === "private" ? "↔" : "#"}</span>
          {thought ? hasThought ? "Unspoken thought" : "Silence" : kind === "private" ? "Private conversation" : kind === "operator" ? "Operator record" : "Public conversation"}
          {!thought ? <span className="stage__channel">{roomLabel(channel, agents)}</span> : null}
        </p>
        <div className="stage__dialogue">
          {beat && beat.kind !== "event" && (beat.text || beat.thought) ? (
            <Bubble key={beat.id} name={beat.actorId ? name(beat.actorId) : "System"}
              said={beat.text} thought={thought ? beat.thought?.text ?? beat.text : undefined}
              visibility={kind === "operator" ? "Operator record" : kind === "private" ? "Private" : beat.audienceIds.length ? "Limited audience" : "Out loud"} />
          ) : <p className="stage__pause u-serif">{beat?.kind === "silence" ? `${beat.actorId ? name(beat.actorId) : "An agent"} says nothing this turn.` : beat ? "A change in the conversation." : "Waiting for the first move."}</p>}
        </div>
        <div className="stage__cast" data-count={marks.length} style={{ "--cast-columns": castPoint(0, marks.length).columns } as CSSProperties}>
          {marks.map(({ agentId }, i) => {
            const agent = agents.find((a) => a.id === agentId);
            if (!agent) return null;
            const isActor = beat?.actorId === agent.id;
            const feeling = isActor ? beat?.emotion : beat?.reactions?.[agent.id];
            const point = castPoint(i, marks.length);
            const lookingAt = beat?.kind === "message" && audience.includes(agent.id) && speaker
              ? isActor ? target : speakerPoint : undefined;
            const gaze = lookingAt ? { x: Math.sign(lookingAt.x - point.x), y: Math.sign(lookingAt.y - point.y) } : { x: 0, y: 0 };
            return <div key={agent.id} className="stage__mark" data-agent-id={agent.id} data-visible={audience.includes(agent.id)}>
              <Figure index={chipIndexFor(agent.id, ids)} name={agent.displayName} face={faceFor(feeling)}
                energy={feeling ? gestureEnergy(feeling) : .3} speaking={Boolean(isActor && beat?.kind === "message")}
                attentive={!beat || isActor || (!thought && audience.includes(agent.id))} gaze={gaze} />
              <span className="stage__expression">{!thought && !audience.includes(agent.id) ? "cannot see this" : isActor && thought ? hasThought ? "unspoken" : "silent" : isActor && beat?.kind === "message" ? "speaking" : feeling ? faceFor(feeling) === "smile" ? "smiling" : faceFor(feeling) : ""}</span>
            </div>;
          })}
        </div>
        <div className="stage__visibility">
          {hasThought ? <p>Only you can read this thought. The other agents cannot hear it.</p> : null}
          {shutOut.length > 0 ? <p className="stage__shut-out">{listNames(shutOut.map((a) => a.displayName))} cannot see this</p> : null}
          {overflow.length > 0 ? <p className="stage__overflow">Also in this conversation: {listNames(overflow.map(name))}</p> : null}
        </div>
      </div>
    </div>
  );
});

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
