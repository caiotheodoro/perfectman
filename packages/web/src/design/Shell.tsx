/** Two named steps follow the user from setting a room up to watching it. */
import { useEffect, useRef } from "react";
export type StepId = "setup" | "run";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "setup", label: "Set up" },
  { id: "run", label: "Watch" },
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
  step, furthest, onStep, onHome, onWatch, liveRun, onWatchLive, children,
}: {
  step: StepId;
  /** Later steps are not clickable until the user reaches them. */
  furthest: StepId;
  onStep: (step: StepId) => void;
  onHome: () => void;
  /** Opens the past runs, to watch as films. */
  onWatch?: () => void;
  /** A run is going on the server and this tab is not showing it. */
  liveRun?: { pulsesRun: number; maxPulses: number } | null;
  onWatchLive?: () => void;
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
        {liveRun && onWatchLive && step !== "run" ? (
          <button type="button" className="btn shell__live" onClick={onWatchLive}>
            <span className="shell__dot" aria-hidden="true" />Watch the run in progress{liveRun.maxPulses > 0 ? ` · ${liveRun.pulsesRun} of ${liveRun.maxPulses}` : ""}
          </button>
        ) : null}
        {onWatch ? <button type="button" className="btn btn--quiet shell__watch" onClick={onWatch}>Watch a past run</button> : null}
      </header>
      <main className="shell__body">{children}</main>
    </div>
  );
}
