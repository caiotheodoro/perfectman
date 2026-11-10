import type { ProvocationLedger, UnlockLevel } from "./provocation.js";
import type { DramaTuning } from "./tuning.js";

/**
 * Who the scene spine may open the ladder for (errata P8), and why. Pure: the evidence comes from the grievance ledger's log of counted hostile lines, the spine's
 * holders (the people others contend with for the same thing) from the spine, and what the pair has already thrown from the planner side.
 *
 * The aggressor is the one the hostile lines were about, the victim the one who said them: a person cornered by someone's accusation, blackmail, insult or threat is
 * who the scene may let hit back, and the one who cornered them is who they hit. Among the pairs with evidence the holder of the spine comes first (the person who has
 * what the others want and is pressed for it), then the pair whose last charge or demand is the most recent. No evidence, nobody: a friendly scene opens nothing.
 */

export type EscalationPick = {
  /** Who may now go for `offender`: the person the hostile lines were about. */
  observer: string;
  /** Who said them. */
  offender: string;
  level: UnlockLevel;
  /** The evidence in a line, for the run's manifest: `3 hostile lines in 90 s, 2 at person-1 from person-2 (last 14 s ago)`. */
  why: string;
};

export type EscalationQuery = {
  ledger: ProvocationLedger;
  tuning: DramaTuning["provocation"];
  /** `shove` at the turn of the spine, `slap` at its decision. */
  level: UnlockLevel;
  /** Actor ids the spine calls holders. */
  holders: readonly string[];
  /** The highest rung the planner side has seen `observer` start at `offender`, or 0. */
  rungOf: (observer: string, offender: string) => number;
  now: number;
};

/** The rung each level opens. */
export const LEVEL_RUNG: Readonly<Record<UnlockLevel, number>> = { shove: 3, slap: 4 };

/**
 * The pair to open; `already` when the evidence is there but the two have thrown that rung (or one above it) at each other in this scene, so there is nothing left to open (the
 * blow is the climax, a fight that goes on does not earn it again, and the one who was hit does not get the same blow back from the spine); undefined for no evidence.
 *
 * Evidence is read per two people: the counted hostile lines between them in the last `unlock.windowMs`, at least one of them a charge or a demand. The aggressor of a pair is the
 * one the hostile lines were about, the holder of the spine first (it has what the other wants and is pressed for it), else the one whose charge came last on the other.
 */
export function pickEscalation(q: EscalationQuery): EscalationPick | "already" | undefined {
  const u = q.tuning.unlock;
  const seen = new Set<string>();
  type Direction = { observer: string; offender: string; why: string; holder: boolean; at: number };
  const groups = new Map<string, Direction[]>();
  for (const e of q.ledger.events) {
    const key = `${e.observer}>${e.offender}`;
    if (seen.has(key) || e.at < q.now - u.windowMs) continue;
    seen.add(key);
    const ev = q.ledger.evidence(e.observer, e.offender, u.windowMs);
    // A charge or a demand at the observer is what makes them the aggressor; two lines between the pair is what makes it a fight and not one remark.
    if (ev.strong < 1 || ev.between < u.shoveEvents) continue;
    // The slap needs one more line than the shove, or the pair already at the shove: a fight that has been thrown, not only talked about.
    if (q.level === "slap" && ev.between < u.slapEvents && Math.max(q.rungOf(e.observer, e.offender), q.rungOf(e.offender, e.observer)) < 3) continue;
    const ago = Math.round((q.now - (ev.lastStrongAt ?? e.at)) / 1000);
    const group = [e.observer, e.offender].sort().join("|");
    groups.set(group, [
      ...(groups.get(group) ?? []),
      {
        observer: e.observer,
        offender: e.offender,
        why: `${ev.between} hostile lines in ${Math.round(u.windowMs / 1000)} s, ${ev.strong} at ${e.observer} from ${e.offender} (last ${ago} s ago)`,
        holder: q.holders.includes(e.observer),
        at: ev.lastStrongAt ?? e.at,
      },
    ]);
  }
  const best = (dirs: Direction[]): Direction => [...dirs].sort((a, b) => Number(b.holder) - Number(a.holder) || b.at - a.at || a.observer.localeCompare(b.observer))[0]!;
  const open: Direction[] = [];
  let spent = false;
  for (const dirs of groups.values()) {
    const d = best(dirs);
    if (Math.max(q.rungOf(d.observer, d.offender), q.rungOf(d.offender, d.observer)) >= LEVEL_RUNG[q.level]) spent = true;
    else open.push(d);
  }
  open.sort((a, b) => Number(b.holder) - Number(a.holder) || b.at - a.at || a.observer.localeCompare(b.observer) || a.offender.localeCompare(b.offender));
  const pick = open[0];
  if (pick) return { observer: pick.observer, offender: pick.offender, level: q.level, why: pick.why };
  return spent ? "already" : undefined;
}
