/** The same named steps follow the user from choosing a cast to watching it. */
import { useEffect, useRef } from "react";
export type StepId = "cast" | "scene" | "run";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "cast", label: "Cast" },
  { id: "scene", label: "Scene" },
  { id: "run", label: "Run" },
];

/** An original, small creature in the shape of a P. */
export function BrandMark(): JSX.Element {
  return (
    <span className="brand">
      <svg viewBox="0 0 34 38" aria-hidden="true">
        <path d="M3 35V15C3 5 8 2 18 2s14 5 14 14-6 13-15 13h-5v6Z" fill="currentColor" />
        <ellipse cx="14" cy="13" rx="3" ry="5" fill="var(--paper)" />
        <ellipse cx="24" cy="13" rx="3" ry="5" fill="var(--paper)" />
      </svg>
      <span>perfectman.</span>
    </span>
  );
}

export function Shell({
  step, furthest, onStep, onHome, children,
}: {
  step: StepId;
  /** Later steps are not clickable until the user reaches them. */
  furthest: StepId;
  onStep: (step: StepId) => void;
  onHome: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const reached = STEPS.findIndex((s) => s.id === furthest);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = shell.current?.querySelector<HTMLElement>("main h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    shell.current?.scrollIntoView?.({ block: "start" });
  }, [step]);
  return (
    <div className="shell" ref={shell}>
      <header className="shell__bar">
        <button type="button" className="shell__mark" onClick={onHome} title="Back to the introduction">
          <BrandMark />
        </button>
        <nav className="shell__rail" aria-label="Progress">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`rail__step${s.id === step ? " rail__step--here" : ""}`}
              aria-current={s.id === step ? "step" : undefined}
              disabled={i > reached}
              onClick={() => onStep(s.id)}
            >
              {s.label}
              {i < STEPS.length - 1 ? <span className="rail__arrow" aria-hidden="true">→</span> : null}
            </button>
          ))}
        </nav>
      </header>
      <main className="shell__body">{children}</main>
    </div>
  );
}
