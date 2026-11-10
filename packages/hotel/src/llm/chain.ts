import { LLMError, LLMHttpError, LlmCircuitBreaker, OpenAiCompatibleProvider, retryAfterMs } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult, LlmTransportDeps } from "@perfectman/server/hotel";
import type { AgentRuntimeInput, OperatorEvent } from "@perfectman/shared";
import type { Clock } from "../clock/clock.js";
import type { ModelPrice } from "../config.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { DEFAULT_LINK_TIMEOUT_MS, linkHeaders, linkInputBudget, linkPromptStyle, linkSampling, RETRY_TEMPERATURE_BOOST, RETRY_TEMPERATURE_MAX } from "./chain-config.js";
import type { LlmLink, PromptStyle } from "./chain-config.js";
import { CHAIN_DEADLINE_MS } from "./env.js";
import { guardAnswer, hardenSystem, houseRules, noOpAnswer } from "./guards.js";
import type { GuardHit, GuardReason } from "./guards.js";
import type { GovernorHooks, LlmGovernor } from "./governor.js";
import { LlmMeter } from "./meter.js";

/**
 * The provider chain (docs/plans/hotel-llm-chain.md): one `LLMProvider` that tries
 * the links in order and serves each call from the first one that answers.
 *
 * - Failover per call on any error: 429, 5xx, timeout, network, empty answer, a bad
 *   key, a spent quota. A link whose breaker is open, whose quota is spent, that is
 *   throttled, or whose window the prompt does not fit is skipped without a call.
 * - Each link has its own `LlmCircuitBreaker` (the server's state machine, fed the
 *   same operator events the run-level breaker reads) and its own `GovernorShared`
 *   penalty window. The run-level breaker still sees the chain as one provider: it
 *   counts a call only when every link failed.
 * - Calls always start at link 1. Stickiness is the breaker's: while link 1 is open
 *   the chain sticks with the link that works and does not retry link 1 per call;
 *   one half-open trial after the backoff, and the first good answer closes it and
 *   the chain is back on link 1.
 */

/** Below this much of the generate deadline left, another attempt would only miss it. */
const MIN_ATTEMPT_MS = 1500;
/** A retry within this long of the actor's last answer is a retry of that answer. */
const RETRY_WINDOW_MS = 30_000;
/** Retries needed before one link's copy rate is compared with another's, and by how much it must be worse. */
const REPEAT_SAMPLE = 6;
const REPEAT_MARGIN = 0.25;
/**
 * A body that was not JSON is asked again on the same link only when it came back this fast (a dropped body, a blip).
 * One that took the attempt's whole timeout was a slow link, and asking it again is another timeout on a person who waits.
 */
const BLIP_RETRY_MAX_MS = 2500;
/** A link throttled for longer than this is skipped when another link is behind it. */
const MAX_PENALTY_WAIT_MS = 1500;
const BREAKER_THRESHOLD = 3;
const BREAKER_INITIAL_BACKOFF_MS = 15_000;
const QUOTA_COOLDOWN_MS = 10 * 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;
const MIN_COOLDOWN_MS = 60_000;
/**
 * A 429 is a spent quota only when the provider says so with its own error code or type; loose phrases in a message
 * ("exceeded your ...") also appear in transient rate limits, which take the governor's normal Retry-After backoff.
 * OpenCode Go: `GoUsageLimitError`. OpenRouter: `insufficient_quota` and its daily free-tier cap `free-models-per-day`.
 */
const QUOTA_CODE = /GoUsageLimitError|FreeUsageLimitError|insufficient_quota|billing_hard_limit_reached|credit_limit|free-models-per-day/;
const CONTEXT_MESSAGE = /context[\s_-]?(length|window)|maximum context|too many tokens|prompt is too long|input.{0,20}too long|reduce the length/i;
/** A 429 whose Retry-After is longer than this is a spent quota, whatever its message says (OpenCode Go says 109,869 s for a weekly cap). */
const QUOTA_RETRY_AFTER_MS = 5 * 60_000;
const RECORDS = 1000;
/** Carries what the provider billed for a call (OpenRouter's `usage.cost`), so the meter can prefer it to the price table. */
export const COST_HEADER = "x-pm-cost-usd";

export type SkipReason = "cooldown" | "breaker_open" | "context" | "throttled" | "deadline";

/** A link that cannot serve for a while (spent quota, rejected key): not worth a call until `cooldownMs` passes. */
export class LinkUnavailableError extends LLMError {
  /** Present and not 429 on purpose: the governor must never retry this as a rate limit. */
  readonly status = 402;
  constructor(readonly link: string, readonly kind: "quota" | "auth", readonly cooldownMs: number, detail: string) {
    super(`link ${link} unavailable (${kind}): ${detail}`);
    this.name = "LinkUnavailableError";
  }
}

export type ChainAttempt = { link: string; outcome: "ok" | "error" | "skipped"; reason?: string; latencyMs?: number };

/** Every link failed or was skipped. The run-level breaker counts this as one provider failure. */
export class ChainExhaustedError extends LLMError {
  constructor(readonly attempts: readonly ChainAttempt[]) {
    super(`every LLM link failed: ${attempts.map((a) => `${a.link}=${a.outcome === "skipped" ? `skipped(${a.reason})` : a.reason ?? a.outcome}`).join(", ")}`);
    this.name = "ChainExhaustedError";
  }
}

/** One served call, for the run log and the probe. */
export type ServedRecord = {
  at: number;
  link: string;
  model: string;
  agentId: string;
  /** Links passed over (failed or skipped) before this one answered. */
  passedOver: number;
  latencyMs: number;
  linkLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  promptEstimate: number;
  costUsd: number;
};

export type LinkSnapshot = {
  name: string;
  model: string;
  /** Calls made to the link (failures included). Skips are not calls. */
  calls: number;
  failures: number;
  served: number;
  skipped: Partial<Record<SkipReason, number>>;
  /** Answers the output guards held back (never delivered), by guard. */
  guarded: Partial<Record<GuardReason, number>>;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  p50Ms: number | undefined;
  p95Ms: number | undefined;
  breaker: "closed" | "open" | "half_open";
  cooldownMsLeft: number;
  inputBudget: number;
  /** Mean of real prompt tokens over the builder's estimate: how far chars/4 is off for this model. */
  estimateRatio: number | undefined;
};

export type ChainSnapshot = {
  links: LinkSnapshot[];
  /** Served calls that were not served by link 1. */
  failovers: number;
  exhausted: number;
};

/** What the probe and the bench watch: one attempt on one link, with the raw answer. Never used in production. */
export type ChainTap = {
  link: string;
  agentId: string;
  prompt: BuiltPrompt;
  outcome: "ok" | "error" | "skipped" | "guarded";
  latencyMs: number;
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
};

export type MakeProvider = (config: LLMConfig, deps: LlmTransportDeps) => LLMProvider;

export type ChainOptions = {
  links: readonly LlmLink[];
  clock: Clock;
  /** Goes out in each link's `sessionHeader`. */
  runId: string | number;
  /** Keys the per-link breakers; any stable string. */
  simulationId: string;
  governor: LlmGovernor;
  prices: Readonly<Record<string, ModelPrice>>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  makeProvider?: MakeProvider;
  deadlineMs?: number;
  logger?: Logger;
  breaker?: { threshold?: number; initialBackoffMs?: number };
  /**
   * The prompt cap the runtime should trim to changed. The runtime renders a prompt before any
   * link is chosen, so it trims for link 1; when link 1 turns out unable to hold even the
   * untrimmable part of the prompt, the cap moves up to the next link's instead of
   * stripping every event from prompts that link 2 could take whole.
   */
  onCap?: (maxInputTokens: number, promptStyle: PromptStyle) => void;
  /** Run the output guards on every answer. Default true. */
  guards?: boolean;
  /** Is a person waiting on this actor's answer (an addressed line)? Silence is then asked about again on the next link. */
  addressed?: (agentId: string) => boolean;
  /**
   * Renders the actor's prompt again, in a given style and under a given cap (`undefined` is no cap). The runtime
   * renders once, for link 1; a failover link of another window gets its own render through this instead of being
   * skipped for a prompt written for a bigger one. Without it a prompt that does not fit a link skips the link.
   */
  rebuild?: (req: { agentId: string; input: AgentRuntimeInput; maxInputTokens: number | undefined; style: PromptStyle }) => BuiltPrompt | undefined;
};

type LinkState = {
  link: LlmLink;
  breaker: LlmCircuitBreaker;
  meter: LlmMeter;
  inputBudget: number;
  cooldownUntil: number;
  /** A half-open trial call is in flight: other calls pass over the link until it reports. */
  trial: boolean;
  /** A prompt already stripped to its untrimmable part still did not fit this link's budget. */
  unfit: boolean;
  /** Answers of this link that came back as a near-duplicate (the retry that followed them says so). */
  repeats: number;
  served: number;
  skipped: Partial<Record<SkipReason, number>>;
  guarded: Partial<Record<GuardReason, number>>;
  ratioSum: number;
  ratioN: number;
};

const defaultMakeProvider: MakeProvider = (config, deps) => new OpenAiCompatibleProvider(config, deps);

export class LlmChain {
  private readonly states: LinkState[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger: Logger;
  private readonly makeProvider: MakeProvider;
  private readonly deadlineMs: number;
  private readonly baseFetch: typeof fetch;
  private failovers = 0;
  private exhausted = 0;
  /** The link that last served each actor and when: a retry of a near-duplicate goes to a different one. */
  private readonly lastServed = new Map<string, { link: number; at: number }>();
  readonly served: ServedRecord[] = [];
  /** Observer for probes and benches. */
  tap: ((e: ChainTap) => void) | undefined;

  constructor(private readonly o: ChainOptions) {
    this.env = o.env ?? process.env;
    this.logger = o.logger ?? silentLogger;
    this.makeProvider = o.makeProvider ?? defaultMakeProvider;
    this.deadlineMs = o.deadlineMs ?? CHAIN_DEADLINE_MS;
    this.baseFetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
    this.states = o.links.map((link) => ({
      link,
      breaker: new LlmCircuitBreaker({
        clock: () => o.clock.now(),
        threshold: o.breaker?.threshold ?? BREAKER_THRESHOLD,
        initialBackoffMs: o.breaker?.initialBackoffMs ?? BREAKER_INITIAL_BACKOFF_MS,
        // A link opening never pauses the run: the chain fails over. Only an exhausted chain reaches the run-level breaker.
        onOpen: () => false,
        emit: (e) => {
          if (e.type === "llm_circuit_open" || e.type === "llm_circuit_closed") {
            this.logger.warn(`llm link ${link.name}: ${e.type === "llm_circuit_open" ? "breaker open" : "breaker closed"}`, { link: link.name, ...e.data });
          }
        },
      }),
      meter: new LlmMeter(o.prices),
      inputBudget: linkInputBudget(link),
      cooldownUntil: 0,
      trial: false,
      unfit: false,
      served: 0,
      repeats: 0,
      skipped: {},
      guarded: {},
      ratioSum: 0,
      ratioN: 0,
    }));
  }

  get links(): readonly LlmLink[] {
    return this.o.links;
  }

  /** The prompt cap the runtime trims to: the budget of the first link that can hold the untrimmable prompt. */
  get promptCap(): number | undefined {
    return (this.states.find((s) => !s.unfit) ?? this.states[0])?.inputBudget;
  }

  /** The hotel prompt style the runtime writes: that of the first link that can hold the untrimmable prompt. */
  get promptStyle(): PromptStyle | undefined {
    const s = this.states.find((x) => !x.unfit) ?? this.states[0];
    return s ? linkPromptStyle(s.link) : undefined;
  }

  /** `trim.withinCap === false` at this link's own cap means the stripped prompt is still too big for it. */
  private learnFit(prompt: BuiltPrompt): void {
    const trim = prompt.trim;
    if (!trim || trim.withinCap) return;
    const s = this.states.find((x) => !x.unfit);
    if (!s || trim.maxInputTokens > s.inputBudget || this.states.indexOf(s) === this.states.length - 1) return;
    s.unfit = true;
    const cap = this.promptCap;
    this.logger.warn(`llm link ${s.link.name} cannot hold the untrimmable prompt (${trim.finalInputTokensEstimate} > ${s.inputBudget}); prompts are now trimmed for the next link`, { link: s.link.name, cap });
    const style = this.promptStyle;
    if (cap !== undefined && style !== undefined) this.o.onCap?.(cap, style);
  }

  snapshot(): ChainSnapshot {
    const now = this.o.clock.now();
    return {
      failovers: this.failovers,
      exhausted: this.exhausted,
      links: this.states.map((s) => {
        const m = s.meter.snapshot();
        return {
          name: s.link.name,
          model: s.link.model,
          calls: m.calls,
          failures: m.failures,
          served: s.served,
          skipped: { ...s.skipped },
          guarded: { ...s.guarded },
          tokensIn: m.tokensIn,
          tokensOut: m.tokensOut,
          costUsd: m.costUsd,
          p50Ms: m.p50Ms,
          p95Ms: m.p95Ms,
          breaker: s.breaker.getState(this.o.simulationId).phase,
          cooldownMsLeft: Math.max(0, s.cooldownUntil - now),
          inputBudget: s.inputBudget,
          estimateRatio: s.ratioN > 0 ? s.ratioSum / s.ratioN : undefined,
        };
      }),
    };
  }

  /** Flat numbers for the run's artifact counters. */
  counters(): Record<string, number> {
    const snap = this.snapshot();
    const out: Record<string, number> = { llm_failovers: snap.failovers, llm_exhausted: snap.exhausted };
    for (const l of snap.links) {
      out[`llm_served_${l.name}`] = l.served;
      out[`llm_failures_${l.name}`] = l.failures;
      for (const [reason, n] of Object.entries(l.skipped)) out[`llm_skipped_${l.name}_${reason}`] = n ?? 0;
      for (const [reason, n] of Object.entries(l.guarded)) out[`llm_guard_${reason}`] = (out[`llm_guard_${reason}`] ?? 0) + (n ?? 0);
    }
    return out;
  }

  /**
   * Is any link answering? Tries them in order and stops at the first that does.
   * A link in a spent-quota cooldown is not called. This is the run's health check
   * and the run-level breaker's half-open probe.
   */
  async ping(): Promise<boolean> {
    for (const s of this.states) {
      if (this.o.clock.now() < s.cooldownUntil) continue;
      if (await this.pingLink(s)) return true;
    }
    return false;
  }

  private async pingLink(s: LinkState): Promise<boolean> {
    const { link } = s;
    const key = this.env[link.apiKeyEnv];
    if (!key) return false;
    try {
      const res = await this.linkFetch(link)(`${link.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: link.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      const text = await res.text().catch(() => "");
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      const unavailable = this.unavailable(link, new LLMHttpError(res.status, text.slice(0, 300), headers));
      if (unavailable) this.coolDown(s, unavailable);
      return false;
    } catch {
      return false;
    }
  }

  /**
   * The provider the runtime asks for per call. `base` is the host config every actor got
   * (its link-specific fields are replaced per attempt); `hooks` is the run's meter.
   */
  provider(base: LLMConfig, agentId: string, hooks?: GovernorHooks): LLMProvider {
    return {
      generateIntent: async (input, context, prompt) => {
        try {
          const result = await this.call(base, agentId, input, context, prompt);
          hooks?.onSuccess(result);
          return result;
        } catch (err) {
          hooks?.onFailure(err);
          throw err;
        }
      },
    };
  }

  private async call(
    base: LLMConfig,
    agentId: string,
    ...args: Parameters<LLMProvider["generateIntent"]>
  ): Promise<LLMProviderResult> {
    const { clock } = this.o;
    const prompt = args[2];
    this.learnFit(prompt);
    const t0 = clock.now();
    const deadline = t0 + this.deadlineMs;
    const order = this.order(agentId, prompt);
    /** A person is waiting on this answer: an actor that stays silent is asked once more, on the next link. */
    const waiting = this.o.addressed?.(agentId) === true;
    let silent: LLMProviderResult | undefined;
    // A retry of a near-duplicate offers the model "or choose no_op": for a person who is waiting, that is not on offer.
    let answerNote = waiting && prompt.retry === "correction";
    /** The prompt each link is sent: the runtime's own where it fits and is in the link's style, else rendered again for the link. */
    const variants = new Map<LinkState, BuiltPrompt>();
    const promptFor = (s: LinkState): BuiltPrompt => {
      const cached = variants.get(s);
      if (cached) return cached;
      let p = this.fitTo(s, agentId, args[0], prompt, answerNote ? ANSWER_TOKENS : 0);
      if (answerNote) p = answerPrompt(p);
      variants.set(s, p);
      return p;
    };
    /** Links that failed in a way a second try can fix (a body that was not JSON, a dropped connection), first failure first. */
    const transient: LinkState[] = [];
    /** Links that already had their second try on the spot. */
    const retried = new Set<LinkState>();
    const attempts: ChainAttempt[] = [];
    let passedOver = 0;
    let wastedMs = 0;
    const breakerSkipped: LinkState[] = [];
    /** Answers a guard held back in this call: at most one is regenerated on the next link. */
    const held: Array<{ hit: GuardHit; link: LlmLink; inputTokens: number; outputTokens: number; costUsd: number }> = [];
    const noOp = (): LLMProviderResult => {
      const last = held.at(-1)!;
      return {
        content: noOpAnswer(last.hit),
        usage: { inputTokens: held.reduce((n, h) => n + h.inputTokens, 0), outputTokens: held.reduce((n, h) => n + h.outputTokens, 0) },
        latencyMs: wastedMs,
        model: last.link.model,
        requestedModel: base.modelName,
        routedModel: last.link.name,
        fallbackAttempts: passedOver,
        responseHeaders: { "x-pm-link": last.link.name, "x-pm-guard": held.map((h) => h.hit.reason).join(","), [COST_HEADER]: String(held.reduce((n, h) => n + h.costUsd, 0)) },
      };
    };

    const attempt = async (s: LinkState, forced: boolean): Promise<LLMProviderResult | undefined> => {
      const remaining = deadline - clock.now();
      const started = clock.now();
      const hasNext = order.indexOf(s) < order.length - 1;
      const sent = promptFor(s);
      try {
        const result = await this.tryLink(s, base, [args[0], args[1], sent], Math.min(s.link.timeoutMs ?? DEFAULT_LINK_TIMEOUT_MS, remaining), hasNext);
        const linkMs = result.latencyMs;
        attempts.push({ link: s.link.name, outcome: "ok", latencyMs: linkMs });
        this.tap?.({ link: s.link.name, agentId, prompt: sent, outcome: "ok", latencyMs: linkMs, content: result.content, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
        s.breaker.observe(this.probeEvent(true));
        s.trial = false;
        const billed = Number(result.responseHeaders?.[COST_HEADER]);
        const reported = result.responseHeaders?.[COST_HEADER] !== undefined && Number.isFinite(billed) ? billed : undefined;
        s.meter.recordSuccess(s.link.model, result.usage.inputTokens, result.usage.outputTokens, linkMs, reported);
        if (sent.inputTokensEstimate > 0 && result.usage.inputTokens > 0) {
          s.ratioSum += result.usage.inputTokens / sent.inputTokensEstimate;
          s.ratioN++;
        }
        const price = this.o.prices[s.link.model];
        const costUsd = reported ?? (price ? (result.usage.inputTokens * price.inUsdPerMTok + result.usage.outputTokens * price.outUsdPerMTok) / 1_000_000 : 0);
        const hit = this.o.guards === false ? undefined : guardAnswer(result.content, args[0], sent.user);
        if (hit) {
          s.guarded[hit.reason] = (s.guarded[hit.reason] ?? 0) + 1;
          held.push({ hit, link: s.link, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd });
          wastedMs += linkMs;
          this.tap?.({ link: s.link.name, agentId, prompt: sent, outcome: "guarded", latencyMs: linkMs, content: result.content, error: `${hit.reason}: ${hit.detail}` });
          this.logger.warn(`llm link ${s.link.name}: line held back by the ${hit.reason} guard`, { link: s.link.name, agentId, reason: hit.reason, detail: hit.detail });
          attempts.push({ link: s.link.name, outcome: "error", reason: `guard ${hit.reason}`, latencyMs: linkMs });
          passedOver++;
          // One regeneration, on the next link; a second held line, or no link left, is a silent no-op.
          if (held.length > 1 || !hasNext) return noOp();
          return undefined;
        }
        // Somebody spoke to this actor and the answer is "nothing": ask the next link once with the reason spelled out.
        if (waiting && hasNext && !silent && isSilence(result.content)) {
          silent = { ...result, latencyMs: wastedMs + linkMs, model: s.link.model, requestedModel: base.modelName, routedModel: s.link.name, fallbackAttempts: passedOver, responseHeaders: { ...result.responseHeaders, "x-pm-link": s.link.name } };
          wastedMs += linkMs;
          passedOver++;
          attempts.push({ link: s.link.name, outcome: "error", reason: "silent on an addressed line", latencyMs: linkMs });
          answerNote = true;
          variants.clear();
          return undefined;
        }
        s.served++;
        this.lastServed.set(agentId, { link: this.states.indexOf(s), at: clock.now() });
        if (passedOver > 0) this.failovers++;
        const total = wastedMs + linkMs;
        this.served.push({ at: clock.now(), link: s.link.name, model: s.link.model, agentId, passedOver, latencyMs: total, linkLatencyMs: linkMs, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, promptEstimate: sent.inputTokensEstimate, costUsd });
        if (this.served.length > RECORDS) this.served.shift();
        return {
          ...result,
          model: s.link.model,
          requestedModel: base.modelName,
          routedModel: s.link.name,
          fallbackAttempts: passedOver,
          latencyMs: total,
          responseHeaders: { ...result.responseHeaders, "x-pm-link": s.link.name },
        };
      } catch (err) {
        wastedMs += Math.max(0, clock.now() - started);
        passedOver++;
        s.meter.recordFailure();
        const overflow = !(err instanceof LinkUnavailableError) && isContextOverflow(err);
        const reason = describeError(err);
        attempts.push({ link: s.link.name, outcome: "error", reason, latencyMs: clock.now() - started });
        this.tap?.({ link: s.link.name, agentId, prompt: sent, outcome: "error", latencyMs: clock.now() - started, error: reason });
        if (err instanceof LinkUnavailableError) {
          this.coolDown(s, err);
          // A half-open trial that ends in a spent quota or a refused key must still settle the breaker: left half-open,
          // `skipReason` passes the link over as `breaker_open` for the rest of the run, even after its cooldown.
          if (s.trial) s.breaker.observe(this.probeEvent(false));
        } else if (overflow) {
          // The link's real window is smaller than the budget assumed: remember it, and do not blame its health.
          s.inputBudget = Math.max(256, Math.min(s.inputBudget, sent.inputTokensEstimate - 1));
          variants.delete(s);
          this.logger.warn(`llm link ${s.link.name} rejected the prompt for size; its budget is now ${s.inputBudget}`, { link: s.link.name });
          if (forced || s.trial) s.breaker.observe(this.probeEvent(true));
        } else {
          s.breaker.observe(this.probeEvent(false));
          if (isTransient(err) && !transient.includes(s)) transient.push(s);
        }
        s.trial = false;
        // A body that was not JSON, and came back fast, is a blip on the link and not a verdict on it: once more on the same link.
        if (isBlankBody(err) && !retried.has(s) && clock.now() - started <= BLIP_RETRY_MAX_MS && deadline - clock.now() >= MIN_ATTEMPT_MS) {
          retried.add(s);
          passedOver--;
          this.logger.warn(`llm link ${s.link.name} answered with a body that was not JSON, trying it once more`, { link: s.link.name, reason });
          return attempt(s, forced);
        }
        this.logger.warn(`llm link ${s.link.name} failed, ${hasNext ? "failing over" : "no link left"}`, { link: s.link.name, reason });
        return undefined;
      }
    };

    for (const s of order) {
      const own = promptFor(s);
      const skip = this.skipReason(s, own.inputTokensEstimate + (s.link.harden === false ? 0 : houseRulesTokens(own.system)), deadline, order.indexOf(s) < order.length - 1);
      if (skip === "breaker_open") {
        breakerSkipped.push(s);
        s.skipped.breaker_open = (s.skipped.breaker_open ?? 0) + 1;
        attempts.push({ link: s.link.name, outcome: "skipped", reason: skip });
        passedOver++;
        continue;
      }
      if (skip) {
        s.skipped[skip] = (s.skipped[skip] ?? 0) + 1;
        this.tap?.({ link: s.link.name, agentId, prompt: own, outcome: "skipped", latencyMs: 0, error: skip });
        attempts.push({ link: s.link.name, outcome: "skipped", reason: skip });
        passedOver++;
        if (skip === "deadline") break;
        continue;
      }
      const result = await attempt(s, false);
      if (result) return result;
    }
    // Every healthy-looking link was passed over for an open breaker: try the first anyway, rather than fail with no call.
    if (!attempts.some((a) => a.outcome === "error") && breakerSkipped[0] && deadline - clock.now() >= MIN_ATTEMPT_MS) {
      const s = breakerSkipped[0];
      const result = await attempt(s, true);
      if (result) return result;
    }
    // Nothing else could answer: the link that failed on a blip gets one more try while there is time. With a small
    // second link behind a big first one (its window cannot hold the prompt) a blip on link 1 used to mean silence.
    const blip = transient.find((t) => !retried.has(t));
    if (!silent && held.length === 0 && blip && deadline - clock.now() >= MIN_ATTEMPT_MS) {
      retried.add(blip);
      const again = await attempt(blip, false);
      if (again) return again;
    }
    if (silent) return silent;
    if (held.length > 0) return noOp();
    this.exhausted++;
    throw new ChainExhaustedError(attempts);
  }

  /**
   * The prompt this link is sent. The runtime rendered one prompt, for link 1; it is kept for a link that takes
   * its style and holds it, and otherwise rendered again in the link's own style (compact for a small window)
   * under the link's own cap, with the retry correction of the original (if any) put back on the end.
   * A link the render still does not fit is skipped by the caller.
   */
  private fitTo(s: LinkState, agentId: string, input: AgentRuntimeInput, prompt: BuiltPrompt, extraTokens: number): BuiltPrompt {
    const rebuild = this.o.rebuild;
    if (!rebuild) return prompt;
    const style = linkPromptStyle(s.link);
    const harden = (s.link.harden === false ? 0 : houseRulesTokens(prompt.system)) + extraTokens;
    const sameStyle = (prompt.promptStyle === "compact" ? "compact" : "full") === style;
    if (sameStyle && prompt.inputTokensEstimate + harden <= s.inputBudget) return prompt;
    let suffix = "";
    if (prompt.retry === "correction") {
      const plain = rebuild({ agentId, input, maxInputTokens: undefined, style: prompt.promptStyle === "compact" ? "compact" : "full" });
      if (plain && prompt.system.startsWith(plain.system)) suffix = prompt.system.slice(plain.system.length);
    }
    const suffixTokens = Math.ceil(suffix.length / 4);
    const rebuilt = rebuild({ agentId, input, maxInputTokens: Math.max(1, s.inputBudget - harden - suffixTokens), style });
    if (!rebuilt) return prompt;
    const system = rebuilt.system + suffix;
    return {
      ...rebuilt,
      system,
      inputTokensEstimate: Math.ceil((system.length + rebuilt.user.length) / 4),
      ...(prompt.retry ? { retry: prompt.retry } : {}),
    };
  }

  /**
   * The links in the order this call tries them. Always link 1 first, except for a retry of an answer that was
   * not usable (a near-duplicate): the model that gave it is asked last, since asking it again gave a copy
   * 65% of the time on a small model.
   */
  private order(agentId: string, prompt: BuiltPrompt): LinkState[] {
    const last = this.lastServed.get(agentId);
    if (prompt.retry !== "correction" || !last || this.o.clock.now() - last.at > RETRY_WINDOW_MS) return [...this.states];
    const mine = this.states[last.link]!;
    mine.repeats++;
    if (this.states.length < 2) return [...this.states];
    const rotated = [...this.states.slice(last.link + 1), ...this.states.slice(0, last.link + 1)];
    // A link that copies more than this one is no cure for a copy: asking it again is the better bet.
    const rate = (x: LinkState): number => x.repeats / Math.max(1, x.served);
    const other = rotated[0]!;
    if (other !== mine && other.served >= REPEAT_SAMPLE && mine.served >= REPEAT_SAMPLE && rate(other) > rate(mine) + REPEAT_MARGIN) return [mine, ...rotated.filter((x) => x !== mine)];
    return rotated;
  }

  private skipReason(s: LinkState, promptTokens: number, deadline: number, hasNext: boolean): SkipReason | undefined {
    const now = this.o.clock.now();
    if (deadline - now < MIN_ATTEMPT_MS) return "deadline";
    if (promptTokens > s.inputBudget) return "context";
    if (now < s.cooldownUntil) return "cooldown";
    if (hasNext && this.o.governor.penaltyLeftFor(s.link.name) > MAX_PENALTY_WAIT_MS) return "throttled";
    const sim = this.o.simulationId;
    const phase = s.breaker.getState(sim).phase;
    if (phase === "closed") return undefined;
    if (phase === "open" && !s.trial && s.breaker.shouldProbe(sim) && s.breaker.beginProbe(sim)) {
      s.trial = true;
      return undefined;
    }
    return "breaker_open";
  }

  private async tryLink(s: LinkState, base: LLMConfig, args: Parameters<LLMProvider["generateIntent"]>, timeoutMs: number, hasNext: boolean): Promise<LLMProviderResult> {
    const { link } = s;
    const config: LLMConfig = {
      ...base,
      baseUrl: link.baseUrl,
      apiKeyEnv: link.apiKeyEnv,
      modelName: link.model,
      maxInputTokens: s.inputBudget,
      timeoutMs,
      // The failover is the retry; a single link keeps the transport's own.
      retryCount: this.states.length > 1 ? 0 : base.retryCount,
      // Penalties against saying what was just said; the retry of a near-duplicate leans on them harder.
      // A link with its own switch (the picked model's reasoning) uses it instead of the base's, so the next link never inherits it.
      extraBody: mergeExtraBody(link.extraBody ?? base.extraBody, linkSampling(link, args[2].retry === "correction")),
      ...(args[2].retry === "correction" ? { temperature: Math.max(base.temperature, Math.min(RETRY_TEMPERATURE_MAX, base.temperature + RETRY_TEMPERATURE_BOOST)) } : {}),
    };
    const box: { costUsd?: number } = {};
    const inner = this.makeProvider(config, { fetch: this.linkFetch(link, box), env: this.env });
    const guarded: LLMProvider = {
      generateIntent: async (...a) => {
        try {
          return await inner.generateIntent(...a);
        } catch (err) {
          throw this.unavailable(link, err) ?? err;
        }
      },
    };
    // With a link behind it a 429 is retried once and briefly. The last link of a chain waits for as long as the attempt
    // may run (a wait is not cut short by the attempt's own timeout, and used to take a call past its deadline);
    // a lone provider waits like one.
    const tuning = hasNext ? { maxRetries: 1, maxDelayMs: MAX_PENALTY_WAIT_MS } : this.states.length > 1 ? { maxRetries: 1, maxDelayMs: Math.max(MAX_PENALTY_WAIT_MS, timeoutMs) } : {};
    const governed = this.o.governor.wrap(guarded, { onSuccess: () => undefined, onFailure: () => undefined }, link.name, tuning);
    const hardened: Parameters<LLMProvider["generateIntent"]> = link.harden === false ? args : [args[0], args[1], hardenPrompt(args[2])];
    const result = await governed.generateIntent(...hardened);
    return box.costUsd === undefined ? result : { ...result, responseHeaders: { ...result.responseHeaders, [COST_HEADER]: String(box.costUsd) } };
  }

  /** A spent quota or a refused key, which a retry cannot fix and a breaker would take three calls to learn. */
  private unavailable(link: LlmLink, err: unknown): LinkUnavailableError | undefined {
    if (!(err instanceof LLMHttpError)) return undefined;
    const detail = err.message.replace(/^HTTP \d+:\s*/, "").slice(0, 160);
    if (err.status === 402) return new LinkUnavailableError(link.name, "quota", QUOTA_COOLDOWN_MS, detail);
    if (err.status === 401 || err.status === 403) return new LinkUnavailableError(link.name, "auth", QUOTA_COOLDOWN_MS, detail);
    if (err.status === 429) {
      const hinted = retryAfterMs(err, this.o.clock.now());
      if (QUOTA_CODE.test(err.message) || (hinted !== undefined && hinted > QUOTA_RETRY_AFTER_MS)) {
        const cooldown = Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, hinted ?? QUOTA_COOLDOWN_MS));
        return new LinkUnavailableError(link.name, "quota", cooldown, detail);
      }
    }
    return undefined;
  }

  private coolDown(s: LinkState, err: LinkUnavailableError): void {
    s.cooldownUntil = this.o.clock.now() + err.cooldownMs;
    this.logger.warn(`llm link ${s.link.name} is out for ${Math.round(err.cooldownMs / 1000)}s`, { link: s.link.name, kind: err.kind, detail: err.message });
  }

  /** fetch with this link's headers (attribution, session id) added to whatever the transport sends. */
  private linkFetch(link: LlmLink, box?: { costUsd?: number }): typeof fetch {
    const extra = linkHeaders(link, this.o.runId);
    return async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
      const res = await this.baseFetch(input, { ...init, headers });
      if (box && res.ok && /json/i.test(res.headers.get("content-type") ?? "")) {
        try {
          const cost = ((await res.clone().json()) as { usage?: { cost?: unknown } }).usage?.cost;
          if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) box.costUsd = cost;
        } catch {
          /* no usage block: the price table prices the call */
        }
      }
      return res;
    };
  }

  /** The operator event the server breaker classifies: a provider answer or a provider failure. */
  private probeEvent(ok: boolean): OperatorEvent {
    return {
      type: "action_intent",
      simulationId: this.o.simulationId,
      pulseIndex: 0,
      detail: "LLM link call",
      data: { providerFailure: !ok, privateMotiveSummary: ok ? "LLM link answered." : "Provider failed: LLM link call" },
      createdAt: this.o.clock.now(),
    };
  }
}

/** The house rules go to the end of the system prompt, and count toward the prompt's size. */
function hardenPrompt(prompt: BuiltPrompt): BuiltPrompt {
  return { ...prompt, system: hardenSystem(prompt.system), inputTokensEstimate: prompt.inputTokensEstimate + houseRulesTokens(prompt.system) };
}

function houseRulesTokens(system: string): number {
  return Math.ceil(houseRules(system).length / 4);
}

/** The model chose `no_op`: the actor says nothing. */
function isSilence(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    return typeof parsed === "object" && parsed !== null && (parsed as { intentType?: unknown }).intentType === "no_op";
  } catch {
    return false;
  }
}

const ANSWER_PT = "\n\nAlguém falou diretamente com você e espera uma resposta. Responda de verdade, em poucas palavras, na sua voz; não escolha no_op.";
const ANSWER_EN = "\n\nSomeone spoke to you directly and is waiting for your answer. Answer them for real, in a few words, in your own voice; do not choose no_op.";

/** What the reason to speak adds to a prompt, for the room a re-rendered prompt has to leave. */
const ANSWER_TOKENS = Math.ceil(Math.max(ANSWER_PT.length, ANSWER_EN.length) / 4);

/** The prompt with the reason to speak added to the end of the system part. */
function answerPrompt(prompt: BuiltPrompt): BuiltPrompt {
  const note = /pt-BR|português|Portuguese/i.test(prompt.system) ? ANSWER_PT : ANSWER_EN;
  return { ...prompt, system: prompt.system + note, inputTokensEstimate: prompt.inputTokensEstimate + Math.ceil(note.length / 4) };
}

/** The provider answered with a body that was not JSON (a cut-off or empty response): worth one more try on the spot. */
function isBlankBody(err: unknown): boolean {
  return !(err instanceof LLMHttpError) && !(err instanceof LinkUnavailableError) && err instanceof Error && /Invalid JSON response/i.test(err.message);
}

function isContextOverflow(err: unknown): boolean {
  return err instanceof LLMHttpError && (err.status === 400 || err.status === 413 || err.status === 422) && CONTEXT_MESSAGE.test(err.message);
}

/** A failure that says nothing about the link's health or the prompt: worth one more try. */
function isTransient(err: unknown): boolean {
  if (err instanceof LinkUnavailableError || isContextOverflow(err)) return false;
  if (err instanceof LLMHttpError) return err.status >= 500;
  return err instanceof Error && /Invalid JSON response|network|fetch failed|ECONNRESET|socket|Empty/i.test(err.message);
}

function describeError(err: unknown): string {
  if (err instanceof LinkUnavailableError) return `${err.kind}`;
  if (err instanceof LLMHttpError) return `http ${err.status}`;
  if (err instanceof Error) return err.name === "LLMTimeoutError" ? "timeout" : err.message.slice(0, 80);
  return "error";
}

function mergeExtraBody(own: Record<string, unknown> | undefined, sampling: Record<string, number>): Record<string, unknown> | undefined {
  const merged = { ...own, ...sampling };
  return Object.keys(merged).length ? merged : undefined;
}
