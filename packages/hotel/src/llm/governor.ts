import { GovernorShared, governProvider } from "@perfectman/server/hotel";
import type { GovernorClock, GovernorOptions, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import type { Clock } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";

export type GovernorHooks = {
  onSuccess(result: LLMProviderResult): void;
  onFailure(error: unknown): void;
};

export type GovernorTuning = Pick<GovernorOptions, "maxRetries" | "baseDelayMs" | "maxDelayMs" | "onThrottle">;

/** The hotel's clock as the server governor's clock, so a test advances both together. */
export function governorClock(clock: Clock): GovernorClock {
  return { now: () => clock.now(), sleep: async (ms) => void (await sleepOn(clock, ms)) };
}

/**
 * Process-wide 429 governance (ADR-0025 D-96). The logic is the server's
 * `governProvider`: it honors `Retry-After` from `LLMHttpError.headers`, falls
 * back to jittered exponential backoff, and keeps one penalty window in a
 * `GovernorShared` so a provider-wide rate limit delays every run. This class
 * owns that shared state for the sidecar and adds the per-run meter hooks.
 *
 * `maxDelayMs` stays well under the 20 s generate deadline: a wait that long
 * would only turn into a missed deadline.
 */
export class LlmGovernor {
  readonly shared = new GovernorShared();
  /** One penalty window per chain link: a 429 from one provider must not delay another. */
  private readonly byLink = new Map<string, GovernorShared>();
  private readonly gov: GovernorClock;

  constructor(
    private readonly clock: Clock,
    private readonly rng: () => number = Math.random,
    private readonly tuning: GovernorTuning = {},
  ) {
    this.gov = governorClock(clock);
  }

  /** Time left on the shared penalty window. */
  get penaltyMsLeft(): number {
    return Math.max(0, this.shared.penaltyUntil - this.clock.now());
  }

  /** The penalty window of one link (created on first use). */
  sharedFor(link: string): GovernorShared {
    let shared = this.byLink.get(link);
    if (!shared) {
      shared = new GovernorShared();
      this.byLink.set(link, shared);
    }
    return shared;
  }

  penaltyLeftFor(link: string): number {
    return Math.max(0, this.sharedFor(link).penaltyUntil - this.clock.now());
  }

  /**
   * `link` picks that link's own penalty window; `tuning` overrides the retry policy for this
   * wrapper (a chain link with a failover behind it retries less and waits less).
   */
  wrap(inner: LLMProvider, hooks: GovernorHooks, link?: string, tuning: GovernorTuning = {}): LLMProvider {
    const shared = link === undefined ? this.shared : this.sharedFor(link);
    const governed = governProvider(inner, shared, { maxDelayMs: 10_000, ...this.tuning, ...tuning, rng: this.rng, clock: this.gov });
    return {
      generateIntent: async (input, context, prompt) => {
        try {
          const result = await governed.generateIntent(input, context, prompt);
          hooks.onSuccess(result);
          return result;
        } catch (err) {
          hooks.onFailure(err);
          throw err;
        }
      },
    };
  }
}
