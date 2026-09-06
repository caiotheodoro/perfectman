/**
 * Where the run is, and what it has cost so far.
 *
 * The counters are the honest part: gateway timeouts and dropped frames mean
 * this browser saw less than the stored replay holds, and the UI should say so
 * rather than let a gap read as the simulation going quiet.
 */
import type { RunStatus } from "@perfectman/shared";

export function StatusBar({
  status,
  connected,
  dropped,
  runId,
}: {
  status: RunStatus | null;
  connected: boolean;
  dropped: number;
  runId: string | null;
}): JSX.Element {
  const state = status?.state ?? "idle";
  // The count, not the index: a finished 12-pulse run ends on index 11, and
  // "11 / 12" reads as having stopped one short.
  const pulses = status ? `${status.pulsesRun} / ${status.maxPulses}` : "—";

  return (
    <div className="statusbar">
      <span className={`state state--${state}`}>{state.replace("_", " ")}</span>
      <span className="dim">pulse</span>
      <strong>{pulses}</strong>
      {runId ? <code className="dim">{runId}</code> : null}
      <span className="spacer" />
      {status && status.counters.llmFailures > 0 ? (
        <span className="counter counter--warn">{status.counters.llmFailures} llm failures</span>
      ) : null}
      {status && status.counters.gatewayTimeouts > 0 ? (
        <span className="counter counter--warn">
          {status.counters.gatewayTimeouts} gateway timeouts
        </span>
      ) : null}
      {dropped > 0 ? (
        <span className="counter counter--warn" title="Coalesced away because this tab fell behind — the stored replay has them">
          {dropped} pulses not shown
        </span>
      ) : null}
      <span className={connected ? "dot dot--live" : "dot"}>{connected ? "live" : "offline"}</span>
    </div>
  );
}
