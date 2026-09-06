/**
 * The run.
 *
 * Before it starts this is a short form — who is answering, and how long to let
 * it go. Once it starts the stage takes the screen, and everything technical
 * moves into `details`, still complete, just no longer the thing you are
 * looking at.
 */
import { useState } from "react";
import type { CompileResponse, StartRunRequest } from "@perfectman/shared";
import type { RunStream } from "../api/useRunStream.js";
import type { LiveChannel } from "@perfectman/shared";
import { Stage, type StageAgent } from "../stage/Stage.js";
import { useStageClock } from "../stage/useStageClock.js";
import { useStageBeats } from "./useStageBeats.js";
import { useSoundtrack } from "./useSoundtrack.js";
import { Transport } from "./Transport.js";
import { DetailsDrawer } from "./DetailsDrawer.js";
import { ProviderForm, type ProviderValue, DEFAULT_PROVIDER } from "./ProviderForm.js";

const IDLE_STATES = new Set(["idle", "done", "failed"]);

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
}: {
  compiled: CompileResponse | null;
  stream: RunStream;
  runId: string | null;
  error: string | null;
  onRun: (llm: StartRunRequest["llm"], limits?: StartRunRequest["limits"]) => void;
  onStop: () => void;
  onDismissError: () => void;
}): JSX.Element {
  const [provider, setProvider] = useState<ProviderValue>(DEFAULT_PROVIDER);
  const beats = useStageBeats(stream.replay);
  const clock = useStageClock(beats);
  const running = stream.status ? !IDLE_STATES.has(stream.status.state) : false;
  const sound = useSoundtrack(clock.beat, running || beats.length > 0);

  const started = runId !== null;
  const agents = stream.replay?.agents ?? [];
  const channels = stream.replay?.channels ?? [];
  // Once it has played, it keeps playing: a mid-run dip below the threshold is
  // the queue working, not a reason to pull the curtain back down.
  const [warm, setWarm] = useState(false);
  const ready = warm || beats.length >= WARMUP_BEATS || (!running && beats.length > 0);
  if (ready && !warm) setWarm(true);

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
              Mock replies instantly and needs no key — it is the fastest way to
              see the shape of a run. A real model takes minutes and says
              something worth reading.
            </p>
          </header>
          <ProviderForm
            value={provider}
            onChange={setProvider}
            onRun={() => onRun(provider.llm, provider.maxPulses ? { maxPulses: provider.maxPulses } : undefined)}
            ready={Boolean(compiled?.ok)}
          />
        </>
      ) : !ready ? (
        <Warmup stream={stream} agents={agents} channels={channels} beats={beats.length} />
      ) : (
        <>
          <Stage beat={clock.beat} agents={agents} channels={channels} />
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
            ) : null}
          </div>
          <DetailsDrawer compiled={compiled} stream={stream} runId={runId} />
        </>
      )}
    </section>
  );
}

/**
 * The wait, with something to look at.
 *
 * The cast is already known from `hello`, so the room can be set before anyone
 * has spoken — which also means the first real beat is a continuation rather
 * than the picture appearing from nothing.
 */
function Warmup({
  stream,
  agents,
  channels,
  beats,
}: {
  stream: RunStream;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  beats: number;
}): JSX.Element {
  const state = stream.status?.state;
  return (
    <div className="warmup">
      <Stage beat={undefined} agents={agents} channels={channels} idleChannelId={channels[0]?.id} />
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
    return <span className="alert-inline">The run stopped: {status.error?.message ?? "unknown reason"}</span>;
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
