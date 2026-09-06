/**
 * Every compile problem at once, worst first.
 *
 * The compilers deliberately collect rather than throw, and that only pays off
 * if the panel shows the whole list — an author fixing one line at a time
 * because the UI hid the rest is back to throwing.
 */
import type { Diagnostic, DiagnosticLevel } from "@perfectman/shared";

const ORDER: Record<DiagnosticLevel, number> = { error: 0, warning: 1, info: 2 };

export function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }): JSX.Element | null {
  if (diagnostics.length === 0) return null;
  const sorted = [...diagnostics].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  return (
    <ul className="diagnostics">
      {sorted.map((d, i) => (
        <li key={`${d.file}:${d.line ?? 0}:${i}`} className={`diagnostic diagnostic--${d.level}`}>
          <span className="diagnostic__level">{d.level}</span>
          <div className="diagnostic__body">
            <p className="diagnostic__message">{d.message}</p>
            <p className="diagnostic__where">
              {d.file}
              {d.line !== undefined ? `:${d.line}` : ""}
              {d.path ? ` · ${d.path}` : ""}
            </p>
            {d.hint ? <p className="diagnostic__hint">{d.hint}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
