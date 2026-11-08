import type { ActorCmd } from "../director/index.js";

/**
 * Pacing for a replay's commands. The hotel budgets every actor (`crates/server/src/world/actors.rs`,
 * `crates/sim/src/director.rs`) and answers what goes over with `rate_limited` or `slow_down`, dropping it:
 *
 * - chat (thoughts included): 4 lines per 6 s;
 * - everything but chat and typing (walk, sit, action, expression, face, move_room, pair, appearance): 8 per 5 s;
 * - `typing` on: 6 per 10 s;
 * - a door (`move_room`): 200 ms after the actor's last join, a spawn included.
 *
 * A live run stays inside these, but a replay at `4x` squeezes the recorded gaps by four and a lively actor goes
 * over. The replay delays a command until the hotel would take it, so no recorded command is lost (the order per
 * actor stays the recorded one).
 */
export const ACTOR_CHAT_PER_WINDOW = 4;
export const ACTOR_CHAT_WINDOW_MS = 6000;
export const ACTOR_CMDS_PER_WINDOW = 8;
export const ACTOR_CMD_WINDOW_MS = 5000;
export const ACTOR_TYPING_PER_WINDOW = 6;
export const ACTOR_TYPING_WINDOW_MS = 10_000;
export const JOIN_INTERVAL_MS = 200;
/** Slack for the hotel's clock reading a little later than ours. */
const MARGIN_MS = 150;

type Budget = { readonly count: number; readonly windowMs: number };

/** Sliding window of send times: how long until one more fits. */
class Window {
  private sent: number[] = [];

  constructor(private readonly budget: Budget) {}

  waitMs(now: number): number {
    this.sent = this.sent.filter((t) => now - t <= this.budget.windowMs + MARGIN_MS);
    if (this.sent.length < this.budget.count) return 0;
    const oldest = this.sent[this.sent.length - this.budget.count] ?? now;
    return Math.max(0, oldest + this.budget.windowMs + MARGIN_MS - now + 1);
  }

  record(now: number): void {
    this.sent.push(now);
  }
}

/** Which of the hotel's budgets a command spends. */
function budgetsOf(cmd: ActorCmd): { chat: boolean; typing: boolean; counted: boolean; join: boolean } {
  switch (cmd.k) {
    case "chat":
      return { chat: true, typing: false, counted: false, join: false };
    case "typing":
      return { chat: false, typing: cmd.on, counted: false, join: false };
    case "move_room":
      return { chat: false, typing: false, counted: true, join: true };
    default:
      return { chat: false, typing: false, counted: true, join: false };
  }
}

/** One actor's view of the hotel's limits. */
export class ActorPacer {
  private readonly chat = new Window({ count: ACTOR_CHAT_PER_WINDOW, windowMs: ACTOR_CHAT_WINDOW_MS });
  private readonly cmds = new Window({ count: ACTOR_CMDS_PER_WINDOW, windowMs: ACTOR_CMD_WINDOW_MS });
  private readonly typing = new Window({ count: ACTOR_TYPING_PER_WINDOW, windowMs: ACTOR_TYPING_WINDOW_MS });
  private joinedAt: number | undefined;

  /** The actor entered a room (a spawn or a door) at `now`. */
  noteJoin(now: number): void {
    this.joinedAt = now;
  }

  /** How long to hold `cmd` from `now`; 0 when the hotel would take it. */
  waitMs(now: number, cmd: ActorCmd): number {
    const b = budgetsOf(cmd);
    const waits = [
      b.chat ? this.chat.waitMs(now) : 0,
      b.counted ? this.cmds.waitMs(now) : 0,
      b.typing ? this.typing.waitMs(now) : 0,
      b.join && this.joinedAt !== undefined ? Math.max(0, this.joinedAt + JOIN_INTERVAL_MS + MARGIN_MS - now) : 0,
    ];
    return Math.max(...waits);
  }

  /** `cmd` went out at `now`. */
  record(now: number, cmd: ActorCmd): void {
    const b = budgetsOf(cmd);
    if (b.chat) this.chat.record(now);
    if (b.counted) this.cmds.record(now);
    if (b.typing) this.typing.record(now);
    if (b.join) this.noteJoin(now);
  }
}
