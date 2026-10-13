import { useEffect, useState } from "react";
import type { RunListEntry } from "@perfectman/shared";
import { listRuns } from "../api/client.js";

const SHOWN = 4;
const time = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today, 9:45 AM", "Yesterday, 3:01 AM", or the date. */
export function whenLabel(ms: number, now: number = Date.now()): string {
  const day = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((day(now) - day(ms)) / 86_400_000);
  if (diff === 0) return `Today, ${time(ms)}`;
  if (diff === 1) return `Yesterday, ${time(ms)}`;
  return `${new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time(ms)}`;
}

/** Runs of the same scene together, scenes ordered by their newest run, runs newest first. */
export function groupRuns(runs: RunListEntry[]): Array<{ name: string; runs: RunListEntry[] }> {
  const groups = new Map<string, RunListEntry[]>();
  for (const r of [...runs].sort((a, b) => b.startedAt - a.startedAt)) groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  return [...groups].map(([name, list]) => ({ name, runs: list }));
}

const how = (r: RunListEntry): string => (r.pulsesRun >= r.maxPulses ? `${r.pulsesRun} pulses` : `${r.pulsesRun} of ${r.maxPulses} pulses, stopped early${r.stopReason ? ` (${r.stopReason.replace(/_/g, " ")})` : ""}`);

export function RunPicker({ onPick }: { onPick: (run: RunListEntry) => void }): JSX.Element {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    listRuns().then((r) => { if (alive) setRuns(r.runs); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) return <p className="alert" role="alert">Could not list the finished runs: {error}.</p>;
  if (!runs) return <p role="status" className="u-dim">Looking for finished runs…</p>;
  const groups = groupRuns(runs.filter((r) => r.pulsesRun > 0));
  if (groups.length === 0) return <p className="u-dim">No finished runs yet. Run a scene first, then come back to watch it.</p>;
  return (
    <div className="runs">
      {groups.map((g) => {
        const expanded = open.has(g.name), shown = expanded ? g.runs : g.runs.slice(0, SHOWN);
        return (
          <section key={g.name} className="runs__group" aria-label={g.name}>
            <h3>{g.name} <span className="u-dim">{g.runs.length === 1 ? "1 run" : `${g.runs.length} runs`}</span></h3>
            <ul>
              {shown.map((r, i) => (
                <li key={r.runId}>
                  <button type="button" className="runs__item" aria-label={`${g.name}, ${whenLabel(r.startedAt)}`} onClick={() => onPick(r)}>
                    <strong>{whenLabel(r.startedAt)}{i === 0 && !expanded ? <em className="runs__new">newest</em> : null}</strong>
                    <span>{how(r)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {g.runs.length > SHOWN ? (
              <button type="button" className="btn--bare" onClick={() => setOpen((o) => { const n = new Set(o); if (expanded) n.delete(g.name); else n.add(g.name); return n; })}>
                {expanded ? "Show fewer" : `Show ${g.runs.length - SHOWN} older`}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
