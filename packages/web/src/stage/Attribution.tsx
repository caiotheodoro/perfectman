/**
 * One line under the room saying whose moment this is and what kind.
 *
 * Separate from the room so a page turn rotates the picture and not the
 * caption: the caption is the reader's, the picture is the scene's.
 */
import { chipFor, chipIndexFor, emotionLabel, type LiveChannel, type StageBeat } from "@perfectman/shared";
import { roomLabel } from "./room-label.js";
import type { StageAgent } from "./Stage.js";

export function Attribution({
  beat,
  agents,
  channels,
  ids,
}: {
  beat: StageBeat | undefined;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  ids: readonly string[];
}): JSX.Element {
  if (!beat) {
    return (
      <div className="stage__utterance">
        <p className="u-dim">Waiting for the first move.</p>
      </div>
    );
  }
  const channel = channels.find((c) => c.id === beat.channelId);
  const caption = emotionLabel(beat.emotion);
  return (
    <div className="stage__utterance">
      <p className="attribution">
        <span className="attribution__chip" style={{ background: chipFor(chipIndexFor(beat.actorId ?? "", ids)) }} />
        <strong>{nameOf(agents, beat.actorId)}</strong>
        <span className="u-dim">{describe(beat, agents, roomLabel(channel, agents))}</span>
        {caption ? <span className="attribution__reading">{caption}</span> : null}
      </p>
    </div>
  );
}

/** One plain sentence about what kind of moment this is. */
function describe(beat: StageBeat, agents: readonly StageAgent[], channelName: string | undefined): string {
  if (beat.kind === "silence") return "says nothing this turn";
  if (beat.kind === "aside") return "what they were actually after";
  if (beat.kind === "event") return `in ${channelName ?? "the room"}`;
  if (beat.audienceIds.length > 0) {
    const who = beat.audienceIds.map((id) => nameOf(agents, id)).join(", ");
    return `— only ${who} can see this`;
  }
  return channelName ? `in ${channelName}` : "";
}

function nameOf(agents: readonly StageAgent[], id: string | undefined): string {
  return agents.find((a) => a.id === id)?.displayName ?? id ?? "someone";
}
