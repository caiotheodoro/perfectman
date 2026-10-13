/**
 * Past runs, watched as films. A full-page layer over the workspace: pick a
 * finished run, then watch it.
 */
import { useEffect, useState } from "react";
import type { DirectorReplay, RunListEntry } from "@perfectman/shared";
import { fetchReplay } from "../api/client.js";
import { FilmPlayer } from "./FilmPlayer.js";
import { RunPicker } from "./RunPicker.js";

type Open = { run: RunListEntry; replay: DirectorReplay | null; error: string | null };

export function WatchScreen({ onClose }: { onClose: () => void }): JSX.Element {
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (run: RunListEntry): void => {
    setOpen({ run, replay: null, error: null });
    fetchReplay(run.runId)
      .then((replay) => setOpen((o) => (o && o.run.runId === run.runId ? { ...o, replay } : o)))
      .catch((e: unknown) => setOpen((o) => (o && o.run.runId === run.runId ? { ...o, error: e instanceof Error ? e.message : String(e) } : o)));
  };

  return (
    <div className="watch" role="dialog" aria-modal="true" aria-label="Watch a finished run">
      <div className="watch__panel">
        <header className="watch__head">
          <h2>{open ? open.run.name : "Watch a run"}</h2>
          <div className="watch__actions">
            {open ? <button type="button" className="btn btn--quiet" onClick={() => setOpen(null)}>All runs</button> : null}
            <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
          </div>
        </header>
        {!open ? <RunPicker onPick={pick} /> : null}
        {open?.error ? <p className="alert" role="alert">Could not load this run: {open.error}. <button type="button" className="btn--bare" onClick={() => pick(open.run)}>Try again</button></p> : null}
        {open && !open.error && !open.replay ? <p role="status" className="u-dim">Loading the run…</p> : null}
        {open?.replay ? <FilmPlayer replay={open.replay} title={open.run.name} /> : null}
      </div>
    </div>
  );
}
