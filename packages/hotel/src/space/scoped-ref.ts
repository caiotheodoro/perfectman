/**
 * An actor's ref is the scenario's character id (`person-1`), so two runs of the same scenario, or of two that
 * number their cast alike, share refs. The mirror is shared by every run, so inside it an actor is always keyed by
 * its run-scoped ref `r<run>.<ref>`; a run reads and writes through `ScopedMirror` (scoped-mirror.ts), which speaks the plain ref.
 */
export const scopeRef = (run: number, ref: string): string => `r${run}.${ref}`;

const SCOPED_REF = /^r(\d+)\.(.+)$/s;

/** The run and plain ref behind a run-scoped ref; undefined for a human (`h:<id>`) or an unscoped ref. */
export function parseScopedRef(ref: string): { run: number; ref: string } | undefined {
  const m = SCOPED_REF.exec(ref);
  return m ? { run: Number(m[1]), ref: m[2] as string } : undefined;
}

