/**
 * Pacing for a replay's chat. The hotel lets an actor send 4 chat lines (thoughts included) per 6 s and
 * answers the rest with `rate_limited`, dropping them. A live run stays inside that, but a replay at
 * `4x` squeezes the recorded gaps by four and a lively actor goes over. The replay delays a line until the
 * hotel would take it, so no recorded line is lost (the order per actor stays the recorded one).
 */
export const ACTOR_CHAT_PER_WINDOW = 4;
export const ACTOR_CHAT_WINDOW_MS = 6000;
/** Slack for the hotel's clock reading a little later than ours. */
const MARGIN_MS = 150;

export class ChatPacer {
  private sent: number[] = [];

  constructor(private readonly perWindow = ACTOR_CHAT_PER_WINDOW, private readonly windowMs = ACTOR_CHAT_WINDOW_MS) {}

  /** How long to hold the next line from `now`; 0 when it can go. */
  waitMs(now: number): number {
    this.sent = this.sent.filter((t) => now - t <= this.windowMs + MARGIN_MS);
    if (this.sent.length < this.perWindow) return 0;
    const oldest = this.sent[this.sent.length - this.perWindow] ?? now;
    return Math.max(0, oldest + this.windowMs + MARGIN_MS - now + 1);
  }

  /** A line went out at `now`. */
  record(now: number): void {
    this.sent.push(now);
  }
}
