/**
 * The run.
 *
 * Before it starts this is a short form — who is answering, and how long to let
 * it go. Once it starts the stage takes the screen, and everything technical
 * moves into `details`, still complete, just no longer the thing you are
 * looking at.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { chipIndexFor, idlePlacement, placeBeats, type CompileResponse, type StartRunRequest } from "@perfectman/shared";
import type { RunStream } from "../api/useRunStream.js";
import type { LiveChannel } from "@perfectman/shared";
import type { StageAgent } from "../stage/Stage.js";
import { Panel } from "../stage/Panel.js";
import { Figure } from "../stage/Figure.js";
import { Attribution } from "../stage/Attribution.js";
import { ContactSheet } from "../stage/ContactSheet.js";
import { frameFor, frameLabel } from "../stage/Frame.js";
import { useStageClock } from "../stage/useStageClock.js";
import { useDocumentVisible, useReadingPosition } from "../stage/motion.js";
import { useStageBeats } from "./useStageBeats.js";
import { useSoundtrack } from "./useSoundtrack.js";
import { Transport } from "./Transport.js";
import { DetailsDrawer } from "./DetailsDrawer.js";
import { useServerBusy } from "./useServerBusy.js";
import { ProviderForm, type ProviderValue, DEFAULT_PROVIDER } from "./ProviderForm.js";

const IDLE_STATES = new Set(["idle", "done", "failed"]);
// Stable empties, so the memos below do not recompute on every render before
// the run has said hello.
const EMPTY_AGENTS: readonly StageAgent[] = [];
const EMPTY_CHANNELS: readonly LiveChannel[] = [];

export function RunScreen({
  sceneTitle,
  visible = true,
  compiled,
  stream,
  runId,
  starting = false,
  cancelling = false,
  error,
  onRun,
  onStop,
  onDismissError,
  onReset,
}: {
  sceneTitle?: string;
  visible?: boolean;
  compiled: CompileResponse | null;
  stream: RunStream;
  runId: string | null;
  starting?: boolean;
  cancelling?: boolean;
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
  const running = stream.status ? !IDLE_STATES.has(stream.status.state) && stream.stoppedReason === null && !stream.error : false;
  const finished = stream.status?.state === "done" || stream.status?.state === "failed" || stream.stoppedReason !== null;
  const ready = runId !== null && beats.length > 0;
  const documentVisible = useDocumentVisible();
  const onStage = ready && visible && documentVisible;
  const clock = useStageClock(beats, { ready: onStage, runId });
  const reading = useReadingPosition(onStage ? clock.beat?.id : undefined);
  const seek = (index: number): void => { clock.seek(index); reading.reveal(); };
  const sound = useSoundtrack(onStage ? clock.beat : undefined, onStage, onStage && clock.playing);

  const started = runId !== null;
  const historyNotice = stream.notices.find((notice) => notice.type === "history_truncated");
  // Only poll while the provider form can be used. Hidden runs stay mounted.
  const server = useServerBusy(visible && !started && !starting);
  useEffect(() => {
    if (!started) setProvider((p) => p.llm.apiKey ? { ...p, llm: { ...p.llm, apiKey: "" } } : p);
  }, [started]);
  const agents = stream.replay?.agents ?? compiled?.summary?.agents ?? EMPTY_AGENTS;
  const preparedChannels = useMemo(() => compiled?.summary?.channels.map((channel) => ({
    id: channel.id, name: channel.name, type: channel.type, memberAgentIds: channel.members,
  })) ?? EMPTY_CHANNELS, [compiled]);
  const channels = stream.replay?.channels ?? preparedChannels;
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
  const status = stream.status;
  const failedEarly = started && beats.length === 0 && (status?.state === "failed" || stream.error !== null);
  const giveUp = useCallback((why: { message: string; hint?: string }): void => {
    setFailure(why);
    onReset();
  }, [onReset]);
  useEffect(() => {
    if (!failedEarly) return;
    giveUp(status?.error ?? { message: stream.error ?? "The run stopped before anything was said." });
  }, [failedEarly, status?.error, stream.error, giveUp]);

  return (
    <section className="step run">
      {historyNotice ? <p className="alert" role="status">{historyNotice.detail}</p> : null}
      {error ? (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button type="button" className="btn--bare" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!started && !starting ? (
        <>
          <header className="step__head">
            <h2>Give your cast a model.</h2>
            <p>
              Connect an OpenAI-compatible endpoint. Each agent will decide
              what to say, what to keep private, and when to stay quiet.
            </p>
          </header>
          <div className="run__cast" role="group" aria-label="Your cast">
            {agents.map((agent) => <Figure key={agent.id} index={chipIndexFor(agent.id, ids)}
              name={agent.displayName} face="neutral" energy={0.3} speaking={false} attentive />)}
          </div>
          {failure ? (
            <div className="alert" role="alert">
              <p>
                The run stopped: {failure.message}
                {failure.hint ? ` ${failure.hint}` : ""} Paste the key again and start over.
              </p>
            </div>
          ) : null}
          {server.busy ? <ServerBusyNotice server={server} /> : null}
          <ProviderForm
            value={provider}
            onChange={setProvider}
            onRun={(next) => {
              // Inside the click, before anything async: this is the gesture
              // the browser will let the soundtrack play under later.
              sound.unlock();
              setFailure(null);
              onRun(next.llm, next.maxPulses ? { maxPulses: next.maxPulses } : undefined);
            }}
            ready={Boolean(compiled?.ok)}
            busy={server.busy}
            focusKey={failure !== null}
          />
        </>
      ) : (
        <>
          <header className="run__title"><h2>{stream.replay?.simulationName ?? sceneTitle ?? "Your scene"}</h2></header>
          {/* One page for the whole run. The warm-up room is the same Panel as
              the first line, so the first beat continues the picture rather
              than replacing it. */}
          <div className="flipbook" ref={reading.ref}>
            <Panel
              playing={onStage && clock.playing}
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
                  onSeek={seek}
                />
              </>
            ) : null}
          </div>
          {!ready ? (
            cancelling ? <p className="warmup" role="status">Cancelling as soon as the server answers…</p>
              : finished ? <p className="warmup" role="status">This run ended without any dialogue.</p>
                : <WarmupNote stream={stream} agents={agents} />
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
                onPlayPause={() => { if (clock.playing) clock.pause(); else { clock.play(); reading.reveal(); } }}
                onStep={(delta) => { clock.step(delta); reading.reveal(); }}
                onSeek={seek}
                onMute={sound.toggle}
              />
            </>
          )}
          <div className="run__foot">
            <RunState stream={stream} running={running} />
            <span className="transport__spacer" />
            {starting || running || (started && !status && !stream.stoppedReason) ? (
              <button type="button" className="btn btn--quiet" onClick={onStop} disabled={cancelling || status?.state === "stopping"}>
                {cancelling || status?.state === "stopping" ? "Stopping…" : ready ? "Stop the run" : "Cancel preparation"}
              </button>
            ) : status?.state === "failed" ? (
              <button type="button" className="btn btn--quiet" onClick={() => giveUp(status.error ?? { message: "The run stopped." })}>
                Try another key
              </button>
            ) : (
              <>
                {beats.length > 0 ? <button type="button" className="btn btn--quiet" onClick={() => { seek(0); clock.play(); }}>Watch again</button> : null}
                <button type="button" className="btn" onClick={onReset}>Start another run</button>
              </>
            )}
          </div>
          {runId ? <DetailsDrawer compiled={compiled} stream={stream} runId={runId} /> : null}
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
}: {
  stream: RunStream;
  agents: readonly StageAgent[];
}): JSX.Element {
  const state = stream.status?.state;
  return (
    <div className="warmup" role="status">
      <p className="warmup__note">
        <span className="warmup__pulse" aria-hidden="true" />
        {stream.helloRunId && !stream.connected && !stream.stoppedReason ? "Connection interrupted. Reconnecting…"
          : state === "health_check"
          ? "Reaching the model…"
          : state === "building"
            ? "Setting the room up…"
            : agents.length === 0
              ? "Starting…"
              : "Waiting for the first line…"}
      </p>
      <p className="u-dim warmup__why">
        The scene starts as soon as the first line arrives. Each line stays
        long enough to read while the model prepares the next turn.
      </p>
    </div>
  );
}

/**
 * The server takes one run at a time, and on a shared link the run in progress
 * is usually somebody else's. Say whose, how far in, and offer the only action
 * that helps — rather than letting Start fail with a 409.
 */
function ServerBusyNotice({ server }: { server: ReturnType<typeof useServerBusy> }): JSX.Element {
  const status = server.status;
  const turns =
    status && status.maxPulses > 0 ? `${status.pulsesRun} of ${status.maxPulses} turns in` : "just started";

  return (
    <div className="busy" role="status">
      <div className="busy__words">
        <b>A run is already going.</b>
        <span>
          {turns}. The server takes one at a time, so this one has to finish or
          be stopped first.
        </span>
      </div>
      <button type="button" className="btn btn--quiet" disabled={server.stopping} onClick={() => void server.release()}>
        {server.stopping ? "Stopping…" : "Stop it"}
      </button>
    </div>
  );
}

function RunState({ stream, running }: { stream: RunStream; running: boolean }): JSX.Element {
  if (stream.error) return <span className="alert-inline" role="alert">{stream.error}</span>;
  const status = stream.status;
  if (!status) return <span className="u-dim">{stream.stoppedReason ? "The run has ended." : "Starting…"}</span>;
  if (running) {
    return (
      <span className="u-dim" role="status">
        {!stream.connected ? "Connection interrupted. Reconnecting…" : `${readable(status.state)} · turn ${status.pulsesRun} of ${status.maxPulses}`}
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
