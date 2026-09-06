/**
 * The frame around every step.
 *
 * Steps are named rather than numbered. The content genuinely is a sequence, so
 * a progress device earns its place, but `01 / 02 / 03` says nothing the words
 * do not and reads as chrome.
 */
export type StepId = "cast" | "scene" | "run";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "cast", label: "cast" },
  { id: "scene", label: "scene" },
  { id: "run", label: "run" },
];

export function Shell({
  step,
  furthest,
  onStep,
  children,
}: {
  step: StepId;
  /** How far the user has actually got; later steps are not clickable yet. */
  furthest: StepId;
  onStep: (step: StepId) => void;
  children: React.ReactNode;
}): JSX.Element {
  const reached = STEPS.findIndex((s) => s.id === furthest);
  const current = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="shell">
      <header className="shell__bar">
        <span className="shell__mark">perfectman</span>
        <nav className="shell__rail" aria-label="Progress">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`rail__step${i === current ? " rail__step--here" : ""}`}
              aria-current={i === current ? "step" : undefined}
              disabled={i > reached}
              onClick={() => onStep(s.id)}
            >
              <span className="rail__label">{s.label}</span>
              <span className={`rail__line${i <= reached ? " rail__line--done" : ""}`} />
            </button>
          ))}
        </nav>
      </header>
      <main className="shell__body">{children}</main>
    </div>
  );
}
