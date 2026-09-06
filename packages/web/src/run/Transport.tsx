/**
 * Where you are in the run, and the two controls anyone reaches for.
 *
 * The channel row is a readout, not a filter: the stage follows the beat into
 * whichever room it happens in, and clicking a channel scrubs to the last thing
 * said there. Filtering the run down to one channel is what the details drawer
 * is for.
 */
import type { LiveChannel, StageBeat } from "@perfectman/shared";

export function Transport({
  beats,
  index,
  channels,
  playing,
  behind,
  live,
  muted,
  onPlayPause,
  onStep,
  onSeek,
  onMute,
}: {
  beats: readonly StageBeat[];
  index: number;
  channels: readonly LiveChannel[];
  playing: boolean;
  behind: number;
  live: boolean;
  muted: boolean;
  onPlayPause: () => void;
  onStep: (delta: number) => void;
  onSeek: (index: number) => void;
  onMute: () => void;
}): JSX.Element {
  const here = beats[index]?.channelId;

  return (
    <div className="transport">
      <div className="transport__rooms">
        {channels.map((channel) => {
          const last = lastIn(beats, channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              className={`room${channel.id === here ? " room--here" : ""}`}
              disabled={last < 0}
              onClick={() => onSeek(last)}
              title={
                last < 0
                  ? "Nothing said here yet"
                  : `Jump to the last thing said in ${channel.name}`
              }
            >
              <span aria-hidden="true">{channel.type === "private_channel" ? "↔" : "#"}</span>
              {channel.name}
            </button>
          );
        })}
      </div>

      <span className="transport__spacer" />

      {behind > 0 ? (
        <span className="transport__behind" title="Beats the run has produced that you have not reached yet">
          {behind} behind
        </span>
      ) : null}
      {live ? <span className="transport__live">live</span> : null}

      <div className="transport__buttons">
        <button type="button" className="btn--bare" onClick={() => onStep(-1)} aria-label="Previous beat">
          ◂
        </button>
        <button type="button" className="btn--bare" onClick={onPlayPause}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn--bare" onClick={() => onStep(1)} aria-label="Next beat">
          ▸
        </button>
        <button
          type="button"
          className="btn--bare"
          onClick={onMute}
          aria-pressed={!muted}
          title={muted ? "Turn the soundtrack on" : "Mute the soundtrack"}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      </div>

      <label className="transport__seek">
        <span className="u-dim">position</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, beats.length - 1)}
          value={index}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Position in the run"
        />
        <output>
          {beats.length === 0 ? "0 / 0" : `${index + 1} / ${beats.length}`}
        </output>
      </label>
    </div>
  );
}

function lastIn(beats: readonly StageBeat[], channelId: string): number {
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i]!.channelId === channelId) return i;
  }
  return -1;
}
