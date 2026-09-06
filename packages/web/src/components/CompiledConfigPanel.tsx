/**
 * Read-only proof of what the markdown became, before a run costs model time.
 *
 * The summary is the part an author reads; the raw config is the part they
 * check when the summary looks wrong. Both, never one.
 */
import { useState } from "react";
import type { CompileResponse } from "@perfectman/shared";
import { DiagnosticList } from "./DiagnosticList.js";

export function CompiledConfigPanel({
  result,
  pending,
}: {
  result: CompileResponse | null;
  pending: boolean;
}): JSX.Element {
  const [showRaw, setShowRaw] = useState(false);

  if (pending) return <section className="panel panel--muted">compiling…</section>;
  if (!result) {
    return (
      <section className="panel panel--muted">
        Drop a scenario and its personas to see what they compile to.
      </section>
    );
  }

  const { summary, diagnostics, ok } = result;

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Compiled</h2>
        <span className={ok ? "badge badge--ok" : "badge badge--bad"}>
          {ok ? "runnable" : "blocked"}
        </span>
      </header>

      {summary ? (
        <>
          <dl className="summary">
            <div>
              <dt>seed</dt>
              <dd>{summary.seed}</dd>
            </div>
            <div>
              <dt>max pulses</dt>
              <dd>{summary.maxPulses}</dd>
            </div>
            <div>
              <dt>agents</dt>
              <dd>{summary.agents.length}</dd>
            </div>
            <div>
              <dt>channels</dt>
              <dd>{summary.channels.length}</dd>
            </div>
          </dl>

          <div className="scroller">
            <table className="grid">
            <thead>
              <tr>
                <th>agent</th>
                <th>archetype</th>
                <th>from</th>
                <th>calibration</th>
                <th>language</th>
              </tr>
            </thead>
            <tbody>
              {summary.agents.map((a) => {
                const lang = summary.languages[a.personaFile];
                return (
                  <tr key={a.id}>
                    <td>{a.displayName}</td>
                    <td className="dim">{a.archetype}</td>
                    <td className="dim" title={a.personaFile}>
                      {shortFile(a.personaFile)}
                    </td>
                    <td className="dim" title="Markdown cannot reach the 19 engine calibration fields; they are inherited from this canonical persona.">
                      {a.calibrationFrom}
                    </td>
                    <td>
                      {lang ? (
                        // Source and confidence live in the tooltip: the panel
                        // sits in a narrow column and the code is the answer.
                        <span title={`${lang.source}, confidence ${lang.confidence.toFixed(2)}`}>
                          {lang.language}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          <ul className="channels">
            {summary.channels.map((c) => (
              <li key={c.id}>
                <span className={c.type.includes("private") ? "pill pill--private" : "pill"}>
                  {c.type.includes("private") ? "private" : "public"}
                </span>
                <strong>{c.name}</strong>
                <span className="dim">{c.members.join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <DiagnosticList diagnostics={diagnostics} />

      <button type="button" className="link" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? "hide" : "show"} compiled config
      </button>
      {showRaw ? <pre className="code">{JSON.stringify(result.config, null, 2)}</pre> : null}
    </section>
  );
}

/** `iris.persona.md` → `iris`. The full name is on the cell's tooltip. */
function shortFile(filename: string): string {
  return filename.replace(/\.(persona|scenario)\.md$/i, "").replace(/\.md$/i, "");
}
