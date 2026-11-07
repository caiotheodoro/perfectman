/**
 * Circuit breaker on provider failures (ADR-0025 D-95, decision D49).
 *
 * Observes operator events through a listening gateway (the `LlmHealthGateway`
 * pattern), counts consecutive PROVIDER failures per run, and after five opens:
 * the hotel pauses the run (`onOpen`), probes again after 15 s, 30 s, 60 s ...
 * up to 5 min, and the first success while half-open closes the breaker
 * (`onClose`). A run is resumed only when the breaker was the reason it paused
 * (`BreakerState.pausedRun`); the breaker never touches an admin or idle pause.
 *
 * What counts is read from structured fields, never from model-authored text:
 * - `action_intent` with `data.providerFailure === true` -> provider failure (timeouts, 5xx, 429, network)
 * - `action_intent` with `data.providerFailure === false` -> the provider answered (a parse fallback is reachable, not a failure)
 * - operator `llm_failure` with `data.stage === "generate"` and `data.providerFailure === true` -> the call
 *   threw a provider / transport error (or missed its deadline) before the step ran, so no `action_intent`
 *   follows; our own bugs (`providerFailure: false`) are ignored
 * - `LLM budget exceeded:` -> no call was made: ignored
 *
 * Synthetic events without the structured field (the hotel's probe) fall back to
 * the engine-authored motive prefixes; the scheduler always sets the field, so
 * model text can never reach that path.
 */
import type { ChannelType, EndReason, EndingOffer, OperatorEvent, SpectatorEvent } from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";
import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_INITIAL_BACKOFF_MS,
  BREAKER_MAX_BACKOFF_MS,
  type BreakerState,
  type LlmCircuitBreakerApi,
} from "../simulation/hotel-runtime-api.js";

const PROVIDER_FAILURE_PREFIXES = ["Provider failed:", "Retry call failed."];
const PARSE_FALLBACK_PREFIX = "Fallback applied:";
const BUDGET_PREFIX = "LLM budget exceeded:";

export type CallVerdict = "provider_failure" | "provider_ok" | "ignore";

/** Classifies one operator event as a provider-level success, failure, or noise. */
export function classifyLlmCall(event: OperatorEvent): CallVerdict {
  // A call that threw out of `generateIntent`, or missed its deadline, never
  // reaches the step, so no `action_intent` follows: the scheduler's own
  // `llm_failure` (stage "generate", projected to the operator stream) is the
  // only trace, and it is a provider-level failure.
  if (event.type === "llm_failure") {
    return event.data?.["stage"] === "generate" && event.data["providerFailure"] === true ? "provider_failure" : "ignore";
  }
  if (event.type !== "action_intent") return "ignore";
  const structured = event.data?.["providerFailure"];
  if (typeof structured === "boolean") return structured ? "provider_failure" : "provider_ok";
  const motive = typeof event.data?.["privateMotiveSummary"] === "string" ? (event.data["privateMotiveSummary"] as string) : "";
  if (PROVIDER_FAILURE_PREFIXES.some((prefix) => motive.startsWith(prefix))) return "provider_failure";
  if (motive.startsWith(BUDGET_PREFIX)) return "ignore";
  return "provider_ok"; // includes parse fallbacks: the provider answered
}

export type LlmCircuitBreakerOptions = {
  /** Wall-clock ms. Injectable for tests. */
  clock?: () => number;
  threshold?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * The breaker opened: pause the run. Return `false` when the run was NOT
   * paused for this breaker (already paused by an admin); anything else means
   * the breaker owns the pause. `state.pausedRun` reflects the answer.
   */
  onOpen?: (simulationId: string, state: BreakerState) => boolean | void;
  /** First good half-open call: resume the run iff `state.pausedRun` was true (state is the pre-close snapshot's `pausedRun`). */
  onClose?: (simulationId: string, state: BreakerState) => void;
  /** Sink for `llm_circuit_open` / `llm_circuit_closed` (admin notices). */
  emit?: (event: OperatorEvent) => void;
};

function freshState(initialBackoffMs: number): BreakerState {
  return { phase: "closed", consecutiveFailures: 0, backoffMs: initialBackoffMs, pausedRun: false };
}

export class LlmCircuitBreaker implements IDeliveryGateway, LlmCircuitBreakerApi {
  private readonly states = new Map<string, BreakerState>();
  private readonly clock: () => number;
  private readonly threshold: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly options: LlmCircuitBreakerOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.threshold = options.threshold ?? BREAKER_FAILURE_THRESHOLD;
    this.initialBackoffMs = options.initialBackoffMs ?? BREAKER_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? BREAKER_MAX_BACKOFF_MS;
  }

  getState(simulationId: string): BreakerState {
    return { ...this.ensure(simulationId) };
  }

  /** True when the breaker is open and the next probe is due; the hotel's loop then calls `beginProbe`. */
  shouldProbe(simulationId: string): boolean {
    const state = this.ensure(simulationId);
    return state.phase === "open" && state.nextProbeAt !== undefined && this.clock() >= state.nextProbeAt;
  }

  /** open -> half_open. The next observed call decides: success closes, failure reopens with doubled backoff. */
  beginProbe(simulationId: string): boolean {
    const state = this.ensure(simulationId);
    if (state.phase !== "open") return false;
    state.phase = "half_open";
    return true;
  }

  /** The hotel reports a pause-cause change (e.g. an admin paused the run while the breaker was open). */
  setPausedRun(simulationId: string, pausedByBreaker: boolean): void {
    this.ensure(simulationId).pausedRun = pausedByBreaker;
  }

  /** Forget a finished run. */
  clear(simulationId: string): void {
    this.states.delete(simulationId);
  }

  /** Feed one operator event directly (the gateway method delegates here). */
  observe(event: OperatorEvent): void {
    const verdict = classifyLlmCall(event);
    if (verdict === "ignore") return;
    const state = this.ensure(event.simulationId);

    if (verdict === "provider_ok") {
      if (state.phase === "half_open") {
        this.close(event);
      } else if (state.phase === "closed") {
        state.consecutiveFailures = 0;
      }
      return; // a stray success from a call that started before opening changes nothing
    }

    // provider_failure
    if (state.phase === "closed") {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= this.threshold) this.open(event, state.backoffMs);
    } else if (state.phase === "half_open") {
      this.open(event, Math.min(state.backoffMs * 2, this.maxBackoffMs));
    }
    // already open: in-flight failures neither extend nor shorten the backoff
  }

  private open(event: OperatorEvent, backoffMs: number): void {
    const state = this.ensure(event.simulationId);
    const now = this.clock();
    const reopen = state.phase === "half_open";
    state.phase = "open";
    state.openedAt = reopen ? (state.openedAt ?? now) : now;
    state.backoffMs = backoffMs;
    state.nextProbeAt = now + backoffMs;
    if (!reopen) state.pausedRun = true;
    if (!reopen) {
      const owned = this.options.onOpen?.(event.simulationId, { ...state });
      if (owned === false) state.pausedRun = false;
    }
    this.options.emit?.({
      type: "llm_circuit_open",
      simulationId: event.simulationId,
      pulseIndex: event.pulseIndex,
      detail: reopen
        ? `The model provider is still failing; next probe in ${Math.round(backoffMs / 1000)}s.`
        : `The model provider failed ${state.consecutiveFailures} times in a row; the run is paused and probes again in ${Math.round(backoffMs / 1000)}s.`,
      data: { consecutiveFailures: state.consecutiveFailures, backoffMs, nextProbeAt: state.nextProbeAt, reopened: reopen },
      createdAt: now,
    });
  }

  private close(event: OperatorEvent): void {
    const state = this.ensure(event.simulationId);
    const snapshot = { ...state };
    const wasPaused = state.pausedRun;
    state.phase = "closed";
    state.consecutiveFailures = 0;
    state.backoffMs = this.initialBackoffMs;
    delete state.openedAt;
    delete state.nextProbeAt;
    state.pausedRun = false;
    this.options.emit?.({
      type: "llm_circuit_closed",
      simulationId: event.simulationId,
      pulseIndex: event.pulseIndex,
      detail: wasPaused
        ? "The model provider answered again; the run resumes."
        : "The model provider answered again.",
      data: { resumed: wasPaused },
      createdAt: this.clock(),
    });
    this.options.onClose?.(event.simulationId, { ...snapshot, phase: "closed", pausedRun: wasPaused });
  }

  private ensure(simulationId: string): BreakerState {
    let state = this.states.get(simulationId);
    if (!state) {
      state = freshState(this.initialBackoffMs);
      this.states.set(simulationId, state);
    }
    return state;
  }

  // ---- IDeliveryGateway: listen only --------------------------------------

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.observe(event);
    return Promise.resolve();
  }
  sendAgentMessage(_channelId: string, _message: DeliveryMessage): Promise<void> {
    return Promise.resolve();
  }
  createChannel(_channelId: string, _type: ChannelType, _memberAgentIds: string[]): Promise<void> {
    return Promise.resolve();
  }
  addMember(_channelId: string, _agentId: string): Promise<void> {
    return Promise.resolve();
  }
  removeMember(_channelId: string, _agentId: string): Promise<void> {
    return Promise.resolve();
  }
  sendSpectatorEvent(_event: SpectatorEvent): Promise<void> {
    return Promise.resolve();
  }
  onSimulationStopped(_simulationId: string, _endReason?: EndReason, _endingOffer?: EndingOffer): Promise<void> {
    return Promise.resolve();
  }
}
