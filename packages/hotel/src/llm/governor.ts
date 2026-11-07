import { LLMHttpError } from "@perfectman/server/hotel";
import type { LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import type { Clock } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";

export type GovernorHooks = {
  onSuccess(result: LLMProviderResult): void;
  onFailure(error: unknown): void;
};

/**
 * Wraps every provider (through the `AgentRuntime` `providerFactory`): a 429
 * opens a penalty window shared by all runs, with jittered exponential backoff,
 * and calls wait it out (bounded) instead of hammering the endpoint. The
 * transport already retries within a call; this is the cross-call memory.
 */
export class LlmGovernor {
  private penaltyUntil = 0;
  private strikes = 0;

  constructor(
    private readonly clock: Clock,
    private readonly rng: () => number = Math.random,
    private readonly opts: { baseMs?: number; maxPenaltyMs?: number; maxWaitMs?: number } = {},
  ) {}

  get penaltyMsLeft(): number {
    return Math.max(0, this.penaltyUntil - this.clock.now());
  }

  wrap(inner: LLMProvider, hooks: GovernorHooks): LLMProvider {
    return {
      generateIntent: async (input, context, prompt) => {
        const wait = Math.min(this.penaltyMsLeft, this.opts.maxWaitMs ?? 8000);
        if (wait > 0) await sleepOn(this.clock, wait);
        try {
          const result = await inner.generateIntent(input, context, prompt);
          this.strikes = 0;
          hooks.onSuccess(result);
          return result;
        } catch (err) {
          if (err instanceof LLMHttpError && err.status === 429) this.penalize();
          hooks.onFailure(err);
          throw err;
        }
      },
    };
  }

  private penalize(): void {
    const base = this.opts.baseMs ?? 1000;
    const exp = Math.min(this.opts.maxPenaltyMs ?? 30_000, base * 2 ** this.strikes);
    this.strikes++;
    const jittered = exp * (0.75 + this.rng() * 0.5);
    this.penaltyUntil = Math.max(this.penaltyUntil, this.clock.now() + jittered);
  }
}
