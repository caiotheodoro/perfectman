/**
 * The run.
 *
 * Before it starts this is a short form — who is answering, and how long to let
 * it go. Once it starts the stage takes the screen, and everything technical
 * moves into `details`, still complete, just no longer the thing you are
 * looking at.
 */
import { useEffect, useMemo, useState } from "react";
import { idlePlacement, placeBeats, type CompileResponse, type StartRunRequest } from "@perfectman/shared";
import type { RunStream } from "../api/useRunStream.js";
import type { LiveChannel } from "@perfectman/shared";
import type { StageAgent } from "../stage/Stage.js";
import { Panel } from "../stage/Panel.js";
import { Attribution } from "../stage/Attribution.js";
import { ContactSheet } from "../stage/ContactSheet.js";
import { frameFor, frameLabel } from "../stage/Frame.js";
import { useStageClock } from "../stage/useStageClock.js";
import { useStageBeats } from "./useStageBeats.js";
import { useSoundtrack } from "./useSoundtrack.js";
import { Transport } from "./Transport.js";
import { DetailsDrawer } from "./DetailsDrawer.js";
import { ProviderForm, type ProviderValue, DEFAULT_PROVIDER } from "./ProviderForm.js";

const IDLE_STATES = new Set(["idle", "done", "failed"]);
// Stable empties, so the memos below do not recompute on every render before
// the run has said hello.
const EMPTY_AGENTS: readonly StageAgent[] = [];
const EMPTY_CHANNELS: readonly LiveChannel[] = [];

/**
 * How much of the run to have in hand before the stage starts playing.
 *
 * A real model takes tens of seconds per turn. Cutting straight to the stage
 * means watching an empty room and concluding it is broken, and once the first
 * beat finally lands the queue drains faster than the model refills it, so it
 * stutters for the rest of the run. Holding a few beats back costs the viewer
 * nothing — the run is still going — and buys a scene that plays continuously.
 */
const WARMUP_BEATS = 4;

export function RunScreen({
  compiled,
  stream,
  runId,
  error,
  onRun,
  onStop,
  onDismissError,
  onReset,
}: {
  compiled: CompileResponse | null;
  stream: RunStream;
  runId: string | null;
  error: string | null;
  onRun: (llm: StartRunRequest["llm"], limits?: StartRunRequest["limits"]) => void;
  onStop: () => void;
  onDismissError: () => void;
  /** Forget the current run id, so the form comes back. */
  onReset: () => void;
}): JSX.Element {
  const [provider, setProvider] = useState<ProviderValue>(DEFAULT_PROVIDER);
  // What the last run died of, kept across the reset that brings the form
  // back. The key is cleared with it: when the model, the key or the output
  // format does not work, the fix is almost always the key.
  const [failure, setFailure] = useState<{ message: string; hint?: string } | null>(null);
  const beats = useStageBeats(stream.replay);
  const clock = useStageClock(beats);
  const running = stream.status ? !IDLE_STATES.has(stream.status.state) : false;
  const sound = useSoundtrack(clock.beat, running || beats.length > 0, clock.playing);

  const started = runId !== null;
  const agents = stream.replay?.agents ?? EMPTY_AGENTS;
  const channels = stream.replay?.channels ?? EMPTY_CHANNELS;
  const ids = useMemo(() => agents.map((a) => a.id), [agents]);
  // Seating for the whole run, decided once. The idle room seeds it so the
  // first line is a continuation of the warm-up picture, not a reshuffle.
  const idle = useMemo(() => idlePlacement(channels[0], agents), [channels, agents]);
  const placements = useMemo(() => placeBeats(beats, agents, channels, { seed: idle }), [beats, agents, channels, idle]);
  const placement = placements[clock.index] ?? idle;
  const frames = useMemo(() => beats.map((b, i) => frameFor(b, placements[i] ?? idle, ids)), [beats, placements, idle, ids]);
  const labels = useMemo(
    () => beats.map((b) => frameLabel(b, agents, channels.find((c) => c.id === b.channelId))),
    [beats, agents, channels],
  );
  // Once it has played, it keeps playing: a mid-run dip below the threshold is
  // the queue working, not a reason to pull the curtain back down.
  const [warm, setWarm] = useState(false);
  const ready = warm || beats.length >= WARMUP_BEATS || (!running && beats.length > 0);
  if (ready && !warm) setWarm(true);

  const status = stream.status;
  const failedEarly = started && !warm && (status?.state === "failed" || stream.error !== null);
  const giveUp = (why: { message: string; hint?: string }): void => {
    setFailure(why);
    setProvider((p) => ({ ...p, llm: { ...p.llm, apiKey: "" } }));
    onReset();
  };
  useEffect(() => {
    if (!failedEarly) return;
    giveUp(status?.error ?? { message: stream.error ?? "The run stopped before anything was said." });
    // The reset changes `started`; the effect must not fire again for the same failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedEarly]);

  return (
    <section className="step run">
      {error ? (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button type="button" className="btn--bare" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!started ? (
        <>
          <header className="step__head">
            <h2>Who is answering?</h2>
            <p>
              An OpenAI-compatible endpoint and a key. A real model takes a
              while per turn and says something worth reading.
            </p>
          </header>
          {failure ? (
            <div className="alert" role="alert">
              <p>
                The run stopped: {failure.message}
                {failure.hint ? ` ${failure.hint}` : ""} Paste the key again and start over.
              </p>
            </div>
          ) : null}
          <ProviderForm
            value={provider}
            onChange={setProvider}
            onRun={() => {
              // Inside the click, before anything async: this is the gesture
              // the browser will let the soundtrack play under later.
              sound.unlock();
              setFailure(null);
              onRun(provider.llm, provider.maxPulses ? { maxPulses: provider.maxPulses } : undefined);
            }}
            ready={Boolean(compiled?.ok)}
            focusKey={failure !== null}
          />
        </>
      ) : (
        <>
          {/* One page for the whole run. The warm-up room is the same Panel as
              the first line, so the first beat continues the picture rather
              than replacing it. */}
          <div className="flipbook">
            <Panel
              beat={ready ? clock.beat : undefined}
              placement={ready ? placement : idle}
              index={ready ? clock.index : 0}
              agents={agents}
              channels={channels}
              ids={ids}
            />
            {ready ? (
              <>
                <Attribution beat={clock.beat} agents={agents} channels={channels} ids={ids} />
                <ContactSheet
                  frames={frames}
                  labels={labels}
                  index={clock.index}
                  reached={clock.reached}
                  live={running}
                  onSeek={clock.seek}
                />
              </>
            ) : null}
          </div>
          {!ready ? (
            <WarmupNote stream={stream} agents={agents} beats={beats.length} />
          ) : (
            <>
              <Transport
                beats={beats}
                index={clock.index}
                channels={channels}
                agents={agents}
                playing={clock.playing}
                behind={clock.behind}
                live={running}
                muted={sound.muted}
                onPlayPause={() => (clock.playing ? clock.pause() : clock.play())}
                onStep={clock.step}
                onSeek={clock.seek}
                onMute={sound.toggle}
              />
              <div className="run__foot">
                <RunState stream={stream} running={running} />
                <span className="transport__spacer" />
                {running ? (
                  <button type="button" className="btn--quiet" onClick={onStop}>
                    Stop the run
                  </button>
                ) : status?.state === "failed" ? (
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => giveUp(status.error ?? { message: "The run stopped." })}
                  >
                    Try another key
                  </button>
                ) : null}
              </div>
              <DetailsDrawer compiled={compiled} stream={stream} runId={runId} />
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The wait, with something to look at.
 *
 * The cast is already known from `hello`, so the room above is set before
 * anyone has spoken — which also means the first real beat is a continuation
 * rather than the picture appearing from nothing. This is only the note.
 */
function WarmupNote({
  stream,
  agents,
  beats,
}: {
  stream: RunStream;
  agents: readonly StageAgent[];
  beats: number;
}): JSX.Element {
  const state = stream.status?.state;
  return (
    <div className="warmup">
      <p className="warmup__note">
        <span className="warmup__pulse" aria-hidden="true" />
        {state === "health_check"
          ? "Reaching the model…"
          : state === "building"
            ? "Setting the room up…"
            : agents.length === 0
              ? "Starting…"
              : `Letting the first few turns play out — ${beats} of ${WARMUP_BEATS} ready`}
      </p>
      <p className="u-dim warmup__why">
        A real model thinks for a while before anyone speaks. Waiting for a few
        turns means the scene plays through instead of stopping between lines.
      </p>
    </div>
  );
}

function RunState({ stream, running }: { stream: RunStream; running: boolean }): JSX.Element {
  const status = stream.status;
  if (!status) return <span className="u-dim">Starting…</span>;
  if (running) {
    return (
      <span className="u-dim">
        {readable(status.state)} · turn {status.pulsesRun} of {status.maxPulses}
      </span>
    );
  }
  if (status.state === "failed") {
    return (
      <span className="alert-inline">
        The run stopped: {status.error?.message ?? "unknown reason"}
        {status.error?.hint ? ` ${status.error.hint}` : ""}
      </span>
    );
  }
  return (
    <span className="u-dim">
      Finished after {status.pulsesRun} turn{status.pulsesRun === 1 ? "" : "s"}
      {stream.dropped > 0 ? ` · ${stream.dropped} not shown here, saved in the replay` : ""}
    </span>
  );
}

/** Run states are internal words; the screen should not read like a state machine. */
function readable(state: string): string {
  const words: Record<string, string> = {
    compiling: "Reading the files",
    validating: "Checking",
    health_check: "Reaching the model",
    building: "Setting the room up",
    running: "Running",
    stopping: "Finishing the turn",
  };
  return words[state] ?? state;
}
