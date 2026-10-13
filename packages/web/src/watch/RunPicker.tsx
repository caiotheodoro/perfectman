import { useEffect, useState } from "react";
import type { RunListEntry } from "@perfectman/shared";
import { listRuns } from "../api/client.js";

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function RunPicker({ onPick }: { onPick: (run: RunListEntry) => void }): JSX.Element {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listRuns().then((r) => { if (alive) setRuns(r.runs); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) return <p className="alert" role="alert">Could not list the finished runs: {error}.</p>;
  if (!runs) return <p role="status" className="u-dim">Looking for finished runs…</p>;
  const watchable = runs.filter((r) => r.pulsesRun > 0);
  if (watchable.length === 0) return <p className="u-dim">No finished runs yet. Run a scene first, then come back to watch it.</p>;
  return (
    <ul className="runs">
      {watchable.map((r) => (
        <li key={r.runId}>
          <button type="button" className="runs__item" onClick={() => onPick(r)}>
            <strong>{r.name}</strong>
            <span>{when(r.startedAt)} · {r.pulsesRun} of {r.maxPulses} pulses{r.stopReason ? ` · ${r.stopReason}` : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
