import type { useServerBusy } from "../run/useServerBusy.js";

/**
 * The server takes one run at a time, and on a shared link the run in progress
 * is usually somebody else's. Say whose, how far in, and offer the only action
 * that helps — rather than letting Start fail with a 409.
 */
export function ServerBusyNotice({ server }: { server: ReturnType<typeof useServerBusy> }): JSX.Element {
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
