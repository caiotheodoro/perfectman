import type { ActionEmotions, AgentState, Presence } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import type { HotelFrame } from "../director/index.js";
import type { ActLedger, OwedDebt } from "./act-ledger.js";
import { chooseReaction } from "./reactions.js";
import type { PlannedCommand } from "./types.js";

export type ReactionDeps = {
  clock: Clock;
  ledger: ActLedger;
  /** The run's own actors: the only ones this planner answers for. */
  isOwn(ref: string): boolean;
  /** The reactor's emotion state, or undefined when it has not been planned yet (it then gets the plain default reaction). */
  state(ref: string): { agentState: AgentState; actionEmotions?: ActionEmotions } | undefined;
  presence(ref: string): Presence | undefined;
  nextActId(): string;
  send(cmds: PlannedCommand[]): void;
};

/**
 * Turns `act_beat.owed` into reactions (REA-1, REA-2, REA-10): for every row that is one of this run's actors, a timer to
 * the reaction `chooseReaction` picks. Nothing is inferred: a human target, a solo verb and a witness list without an
 * `owed` row all produce nothing. A timer that fires after the debt was settled (an `act_reaction`, the table's or ours),
 * after the act closed, or after the actor left or died, sends nothing, so no second command follows a reaction.
 */
export class ReactionScheduler {
  private readonly timers = new Map<string, TimerHandle>();

  constructor(private readonly deps: ReactionDeps) {}

  onBeat(_frame: Extract<HotelFrame, { t: "act_beat" }>, owed: readonly OwedDebt[]): void {
    for (const debt of owed) {
      if (!this.deps.isOwn(debt.who)) continue;
      const st = this.deps.state(debt.who);
      const reaction = chooseReaction({ debt, state: st?.agentState, actionEmotions: st?.actionEmotions, presence: this.deps.presence, nextActId: () => this.deps.nextActId() });
      if (!reaction) continue;
      const key = `${debt.actId}|${debt.who}`;
      this.timers.get(key)?.cancel();
      this.timers.set(
        key,
        this.deps.clock.setTimer(() => {
          this.timers.delete(key);
          // Still owed, still alive, still here (REA-10).
          if (!this.deps.ledger.owedOf(debt.who).some((d) => d.actId === debt.actId) || this.deps.ledger.isDead(debt.who)) return;
          this.deps.send([reaction.cmd]);
        }, reaction.delayMs),
      );
    }
  }

  /** The act closed or the scene was cut: the timers of the acts that ended are dropped. */
  close(actId: string): void {
    for (const [key, t] of this.timers) {
      if (key.startsWith(`${actId}|`)) {
        t.cancel();
        this.timers.delete(key);
      }
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) t.cancel();
    this.timers.clear();
  }
}
