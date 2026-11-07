/**
 * Runtime API the hotel adapter (`packages/hotel`) codes against.
 *
 * Types and frozen constants only, no behaviour. Frozen in Phase 1
 * (docs/plans/hotel-package.md section 18) so the sidecar and the server
 * changes can proceed in parallel. Each section names its ADR. Implementations
 * land with the server work for that ADR; until then nothing in the runtime
 * imports this file, so existing behaviour does not move. Names were
 * "illustrative until frozen" (hotel checklist item 24); this file is the
 * freeze.
 */
import type { ActionIntent, BudgetPriority, CommittedEvent, EventVisibility, UntrustedMessagePayload } from "@perfectman/shared";
import type { PulseResult } from "./pulse-scheduler.js";
import type { ResolvedIntent } from "./intent-resolver.js";
import type { EventLog } from "./event-log.js";

// ---- ADR-0020: split pulse, focused pulse, onConsult -----------------------

export type PulseMode = "sequential" | "split";

export type PulseReason = "base" | "human_chat" | "body_arrived" | "wake";

/**
 * Options for `SimulationRuntime.runPulse(simulationId, opts?)`. Omitted
 * means a base pulse that ages the simulation by `pulseIntervalMs`, i.e.
 * today's behaviour. A focused pulse (`focusAgentIds` set) evaluates only
 * those agents, ages by `elapsedMs`, does not advance `pulseIndex`, and skips
 * the stagnation check and goal-layer review.
 */
export type RunPulseOptions = {
  reason: PulseReason;
  focusAgentIds?: string[];
  /** Wall time since the previous pulse of any kind. Undefined means `pulseIntervalMs`. */
  elapsedMs?: number;
};

export type ConsultInfo = {
  agentId: string;
  reason: PulseReason;
  /** The agent was addressed by a human or another actor this pulse. */
  addressed: boolean;
};

/** Fires when a generate task takes its concurrency slot, immediately before `generateIntent`. */
export type OnConsult = (info: ConsultInfo) => void;

export type SplitPulseConfig = {
  /** Default "sequential": byte-identical to the current loop. */
  pulseMode?: PulseMode;
  /** Default 3 in the hotel, shared across the base and focus lanes (ADR-0020, spike). One slot is reserved for addressed replies. */
  generateConcurrency?: number;
  /** Seed 20 000. Expiry follows the existing `llm_failure` / `no_op` path. */
  generateDeadlineMs?: number;
  onConsult?: OnConsult;
};

/** The slice of `SimulationRuntime` the hotel calls. */
export interface HotelRuntimeApi {
  runPulse(simulationId: string, opts?: RunPulseOptions): Promise<PulseResult>;
  /** Current pulse index, stamped on ingested human events (ADR-0022). */
  getPulseIndex(simulationId: string): number;
  getEventLog(): EventLog;
  /**
   * Re-submits a held intent (a deferred line on arrival) through the normal
   * resolver, so the arbiter and the rate gate still apply (ADR-0019, 0021).
   */
  resolveDeferred(agentId: string, intent: ActionIntent): Promise<ResolvedIntent>;
}

// ---- ADR-0022: guest ingestion ---------------------------------------------

/**
 * One human line, already sanitized and addressed by the adapter, ready to be
 * appended as a `message_sent` event whose payload is `UntrustedMessagePayload`.
 * The adapter owns sanitizing, addressing and hearing; the runtime only appends.
 */
export type GuestLineInput = Omit<UntrustedMessagePayload, "untrusted"> & {
  simulationId: string;
  roomChannelId: string;
  /** `h:<userId>`. Never rendered. */
  actorId: string;
  /** `operator_only` shape when nobody hears the line. */
  visibility: EventVisibility;
  salience: "medium" | "high";
};

export interface GuestIngest {
  /** Appends through `EventLog.append` (not `appendAndProject`: no echo to the hotel). */
  ingest(line: GuestLineInput): Promise<CommittedEvent>;
}

// ---- ADR-0021: room speech arbiter -----------------------------------------

export type ArbiterRule = "human_typing" | "not_addressed_open_line" | "line_budget" | "ambient_too_soon";

export type ArbiterConfig = {
  /** Seed 6000: ambient lines are held this long while a human types. */
  humanTypingSuppressMs: number;
  /** Seed 10 000, scaled by scenario energy. */
  ambientQuietMs: number;
  /** Seed 3: an addressed human line allows `max(minLineBudget, addressees)` actor lines before the rest yield. */
  minLineBudget: number;
  /** 0..1, scales `ambientQuietMs`. */
  scenarioEnergy: number;
};

export type ArbiterLineKind = "addressed" | "ambient" | "interjection";

/**
 * A denial is `policy_blocked`, never `rateLimited` (lead resolution R10), so
 * the resolver's `fallbackIfBlocked` path commits a `no_op` and the simulation
 * never believes the line was spoken.
 */
export type ArbiterDecision =
  | { outcome: "allowed" }
  | {
      outcome: "blocked";
      violation: { type: "policy_blocked"; detail: `room_speech:${ArbiterRule}` };
      rateLimited: false;
    };

export interface IRoomSpeechArbiter {
  /** The hotel supplies human-line state; the arbiter never sees a socket. */
  noteHumanLine(roomId: string, line: { eventId: string; at: number; addressedIds: string[] }): void;
  noteHumanTyping(roomId: string, typing: boolean, at: number): void;
  /** Decide phase: lets the scheduler skip generation for a blocked, non-addressed agent. */
  preview(agentId: string, roomId: string, now: number): ArbiterDecision;
  /** Resolver phase, authoritative: runs after `allowAction`, before `recordAction`. */
  gate(agentId: string, roomId: string, kind: ArbiterLineKind, now: number): ArbiterDecision;
}

// ---- ADR-0025: budget as a warning, usage getter ----------------------------

export type BudgetMode = "enforce" | "warn";

export type BudgetSoftLimits = {
  callsPerMinute: number;
  tokensPerHour: number;
};

/** `getPriority(sim, agent, opts?)`: an addressed agent is always `high`. */
export type GetPriorityOptions = { addressed?: boolean };

export type RunUsage = {
  simulationId: string;
  mode: BudgetMode;
  calls: number;
  callsThisMinute: number;
  inputTokens: number;
  outputTokens: number;
  tokensThisHour: number;
  /** Fraction of the soft limits consumed, 0..1+. */
  callsFraction: number;
  tokensFraction: number;
  /** Highest priority class an ordinary agent currently gets. Never "blocked" in warn mode. */
  priority: BudgetPriority;
  warned: boolean;
  perAgent: Record<string, { calls: number; tokens: number }>;
};

export interface LlmUsageGetter {
  getUsage(simulationId: string): RunUsage;
}

// ---- ADR-0025 + decision D49: circuit breaker ------------------------------

export type BreakerPhase = "closed" | "open" | "half_open";

export type PauseCause = "admin" | "idle" | "breaker";

export type BreakerState = {
  phase: BreakerPhase;
  /** Provider-level failures only (timeouts, 5xx, 429, network); schema and parse fallbacks do not count. */
  consecutiveFailures: number;
  openedAt?: number;
  /** Wall-clock ms of the next half-open probe. */
  nextProbeAt?: number;
  /** Current backoff: 15 s, 30 s, 60 s, ... capped at 5 min. */
  backoffMs: number;
  /** True while this breaker is the reason the run is paused. */
  pausedRun: boolean;
};

export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_INITIAL_BACKOFF_MS = 15_000;
export const BREAKER_MAX_BACKOFF_MS = 300_000;

/**
 * Who may resume a paused run (D49 amending R2): a breaker pause resumes
 * itself after ONE successful half-open call, and the admin is told on pause
 * and on resume. An admin pause waits for an admin. An idle pause resumes when
 * a human enters a run room (`source: "auto"`). Operator event types for the
 * notices (`llm_budget_warning`, `llm_circuit_open`, `llm_circuit_closed`) are
 * not in `OPERATOR_EVENT_TYPES` yet: its producer guard rejects types with no
 * emission site, so they are added together with the breaker.
 */
export const RESUME_BY: Readonly<Record<PauseCause, "admin" | "half_open_success" | "human_entered">> = {
  admin: "admin",
  breaker: "half_open_success",
  idle: "human_entered",
};

export interface LlmCircuitBreakerApi {
  getState(simulationId: string): BreakerState;
}
