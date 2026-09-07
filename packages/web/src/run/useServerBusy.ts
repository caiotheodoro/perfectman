/**
 * Whether the server is already busy with somebody else's run.
 *
 * The server holds one run at a time, so a second Start comes back `409` — and
 * a shared deployment means the other run is usually not yours and often not
 * even in your browser. Finding that out by pressing the button and reading an
 * error is the wrong order: the answer is knowable before the click, so this
 * asks for it and the form disables Start while it is true.
 *
 * Polling rather than pushing, because there is no stream to subscribe to
 * until a run exists — that is precisely the state being reported on.
 */
import { useCallback, useEffect, useState } from "react";
import type { RunStatus } from "@perfectman/shared";
import { currentStatus, stopRun } from "../api/client.js";

/** Run states where the server will refuse a second start. */
const BUSY_STATES = new Set(["compiling", "validating", "health_check", "building", "running", "stopping"]);

const POLL_MS = 4000;

export type ServerBusy = {
  /** Null until the first answer arrives, so the form can avoid flashing. */
  status: RunStatus | null;
  busy: boolean;
  stopping: boolean;
  /** Resolves once the other run has actually let go, not when stop was accepted. */
  release: () => Promise<void>;
  refresh: () => void;
};

export function useServerBusy(active: boolean): ServerBusy {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [stopping, setStopping] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let live = true;

    const read = async (): Promise<void> => {
      try {
        const next = await currentStatus();
        if (live) setStatus(next);
      } catch {
        // A server that cannot be reached is a different problem, and starting
        // a run will report it properly. Do not block the button for it.
        if (live) setStatus(null);
      }
    };

    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, tick]);

  const busy = status !== null && BUSY_STATES.has(status.state);

  const release = useCallback(async (): Promise<void> => {
    if (!status?.runId) return;
    setStopping(true);
    try {
      await stopRun(status.runId);
      // Stop is accepted immediately but teardown waits for the pulse in
      // flight, which on a real model is minutes. Poll until it lets go rather
      // than re-enabling a button that would only 409 again.
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const next = await currentStatus().catch(() => null);
        if (next) setStatus(next);
        if (!next || !BUSY_STATES.has(next.state)) return;
      }
    } finally {
      setStopping(false);
      setTick((t) => t + 1);
    }
  }, [status?.runId]);

  return { status, busy, stopping, release, refresh: () => setTick((t) => t + 1) };
}
