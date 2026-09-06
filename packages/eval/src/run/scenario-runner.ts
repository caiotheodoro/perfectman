/**
 * ScenarioRunner — runs a RoleplayScenario against the real pipeline
 * (engine → AgentRuntime → scheduler → resolver → projections) and collects
 * the artifacts the benchmark scores: events, agent states, LLM call counts,
 * fallbacks, probe results, and expected-signal outcomes.
 */

import {
  ALL_PERSONAS,
  type AgentState,
  type CommittedEvent,
  type RoleplayScenario,
  type AgentSeedSpec,
  type EventSeedSpec,
  type Memory,
  getPersonaById,
  getPersonaPackById,
} from "@perfectman/shared";
import {
  buildConfiguredSimulation,
  type AgentConfig,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "@perfectman/server";
import {
  AgentRuntime,
  AgentConfigRegistry,
  MockDeliveryGateway,
  createLLMProvider,
  llmBudget,
  personaPackToProfile,
} from "@perfectman/server";
import type { PersonaPromptProfile } from "@perfectman/server";
import type { LLMProvider } from "@perfectman/server";
import { isEngineAuthoredMotive } from "@perfectman/server";
import type { OperatorEvent } from "@perfectman/shared";
import { eventsToBehavioral, runAllProbes, type ProbeResult } from "../probes/index.js";
import { checkExpectedSignals, type SignalOutcome } from "./signal-checker.js";
import { personaAwareProviderFactory } from "../bench/persona-aware-mock.js";

export type RunnerOpts = {
  providerFactory?: (llmConfig: import("@perfectman/server").LLMConfig, agentId: string) => LLMProvider;
  llmMode?: "mock" | "local";
  pulseLimit?: number;
  repetition?: import("@perfectman/server").RepetitionPolicy;
  /** Sampling seed for local-mode LLM calls; defaults to `benchSeed()` (PERFECTMAN_LLM_SEED or 42). */
  seed?: number;
};

export type ScenarioRunArtifact = {
  scenarioId: string;
  events: CommittedEvent[];
  agentStates: Map<string, AgentState>;
  llmCalls: Map<string, number>;
  fallbackCount: number;
  operatorFailures: number;
  /** Retries that fixed a guard violation on the first attempt — not a
   *  terminal failure, but not free either (see `llm_retry_recovered` in
   *  operator.types.ts). Optional so untyped test fixtures built before this
   *  field existed keep working. */
  recoveredFallbacks?: number;
  /** Committed no-op/guard records whose motive the engine wrote — the parse-failure cross-check for `fallbackCount`. */
  fallbackNoOps?: number;
  /** Operator events by type for the run (mock gateway only). */
  operatorEventCounts?: Partial<Record<OperatorEvent["type"], number>>;
  /** Every `llm_failure` / `llm_retry_recovered` with its detail and data (raw head, models) — the fallback forensics trail. */
  llmFailures?: LlmFailureRecord[];
  /** Memory proposals: committed `memory_written` events vs proposals the parser dropped as malformed. */
  memoryProposals?: { accepted: number; dropped: number };
  /** `liveOnly` signals not evaluated because the run was in mock mode; never in `totalSignals`. */
  skippedSignals?: number;
  probeResults: ProbeResult[];
  signalResults: SignalOutcome[];
  passedSignals: number;
  totalSignals: number;
  latencyMs: number;
  pulseResults: number;
  /** Unique generation prompt versions observed across the run (attribution). */
  promptVersions: string[];
  /** Unique prompt template versions observed across the run (old-vs-new template comparison). */
  templateVersions: string[];
  /** Real provider wire-calls, including repetition-guard retries. */
  providerCalls?: number;
};

class TrackingRuntime {
  private readonly inner: AgentRuntime;
  private readonly calls = new Map<string, number>();
  private readonly versions = new Set<string>();
  private readonly templateVersions = new Set<string>();
  private readonly providers = new Map<string, LLMProvider>();
  private readonly countedProviders = new Map<string, LLMProvider>();
  private providerCallsTotal = 0;

  constructor(
    registry: AgentConfigRegistry,
    factory: ((llmConfig: import("@perfectman/server").LLMConfig, agentId: string) => LLMProvider) | undefined,
    repetition?: import("@perfectman/server").RepetitionPolicy,
  ) {
    this.inner = new AgentRuntime(
      undefined,
      registry,
      (llmConfig, agentId) => {
        // One provider instance per agent per scenario — per-call state
        // (channel caps, memory habits) must persist across pulses.
        let provider = this.providers.get(agentId);
        if (!provider) {
          // Injected factories override the single resolution site; without
          // one, the config's providerType routes through the factory.
          provider = factory ? factory(llmConfig, agentId) : createLLMProvider(llmConfig, agentId);
          this.providers.set(agentId, provider);
        }
        // Per-turn `calls` counts generateIntent invocations, so a
        // repetition-guard retry is invisible there — but retries are the cost
        // side of the repetition policy, so wire calls are counted separately.
        let counted = this.countedProviders.get(agentId);
        if (!counted) {
          const inner = provider;
          counted = {
            generateIntent: (...providerArgs) => {
              this.providerCallsTotal++;
              return inner.generateIntent(...providerArgs);
            },
          };
          this.countedProviders.set(agentId, counted);
        }
        return counted;
      },
      repetition,
    );
  }

  providerCalls(): number {
    return this.providerCallsTotal;
  }

  async generateIntent(
    input: Parameters<AgentRuntime["generateIntent"]>[0],
    context: Parameters<AgentRuntime["generateIntent"]>[1],
  ): ReturnType<AgentRuntime["generateIntent"]> {
    this.calls.set(input.agentId, (this.calls.get(input.agentId) ?? 0) + 1);
    const output = await this.inner.generateIntent(input, context);
    if (output.llmUsage?.promptVersion) this.versions.add(output.llmUsage.promptVersion);
    if (output.llmUsage?.promptTemplateVersion) this.templateVersions.add(output.llmUsage.promptTemplateVersion);
    return output;
  }

  callsFor(agentId: string): number {
    return this.calls.get(agentId) ?? 0;
  }

  totalCalls(): number {
    let t = 0;
    for (const v of this.calls.values()) t += v;
    return t;
  }

  versionsUsed(): string[] {
    return [...this.versions];
  }

  templateVersionsUsed(): string[] {
    return [...this.templateVersions];
  }
}

export class ScenarioRunner {
  static async run(scenario: RoleplayScenario, opts: RunnerOpts = {}): Promise<ScenarioRunArtifact> {
    // The cognition path records usage into the shared llmBudget singleton
    // with wall-clock stamps (#147). Reset this scenario's windows up front
    // so back-to-back runs in one process (e.g. the pinned-seed replay test)
    // start from identical budget state and stay deterministic.
    llmBudget.reset(scenario.id);
    const started = Date.now();
    const packs = new Map<string, import("@perfectman/shared").PersonaPack>();
    for (const p of ALL_PERSONAS) {
      const pack = getPersonaPackById(p.id);
      if (pack) packs.set(p.id, pack);
    }

    let tracking: TrackingRuntime | undefined;
    const providerFactory =
      opts.providerFactory ?? (opts.llmMode === "local" ? undefined : personaAwareProviderFactory(packs, scenario.seed));
    const handle = await buildConfiguredSimulation(
      scenarioToConfig(scenario, opts.llmMode ?? "mock", opts.seed),
      {
        agentRuntimeFactory: (registry) => {
          tracking = new TrackingRuntime(registry, providerFactory, opts.repetition);
          return tracking;
        },
      },
    );

    const gateway = handle.gateways["mock"];
    if (gateway instanceof MockDeliveryGateway) gateway.reset();

    // Seed full agent states (includes memories + relational states).
    for (const spec of scenario.agents) {
      const state = buildAgentState(spec, scenario);
      await handle.repositories.agentStateRepo.upsert(state);
    }
    // Seed prior events (backdated).
    const minPriorPulse = scenario.priorEvents.length > 0
      ? Math.min(...scenario.priorEvents.map(e => e.pulseIndex))
      : 0;
    const prior = scenario.priorEvents.map(e => toCommittedEvent(e, scenario, minPriorPulse));
    if (prior.length > 0) {
      await handle.repositories.eventRepo.append(scenario.id, prior);
    }

    const pulses = Math.min(opts.pulseLimit ?? scenario.pulseCount, scenario.pulseCount);
    let pulseResults = 0;
    for (let i = 0; i < pulses; i++) {
      await handle.runtime.runPulse(scenario.id);
      pulseResults++;
    }

    const events = await handle.repositories.eventRepo.getAfter(scenario.id);
    const states = new Map<string, AgentState>();
    for (const spec of scenario.agents) {
      const state = await handle.repositories.agentStateRepo.get(scenario.id, spec.agentId);
      if (state) states.set(spec.agentId, state);
    }

    const failures = events.filter(e => e.type === "llm_failure").length;
    const operatorEvents = gateway instanceof MockDeliveryGateway ? gateway.operatorEvents : [];
    const { fallbackCount, fallbackNoOps, operatorEventCounts } = countFallbacks(events, operatorEvents);
    const recoveredFallbacks = operatorEvents.filter(e => e.type === "llm_retry_recovered").length;
    const llmFailures = collectLlmFailures(operatorEvents);
    const memoryProposals = {
      accepted: events.filter(e => e.type === "memory_written").length,
      dropped: operatorEvents.reduce((n, e) => n + (e.type === "pulse_metrics" ? Number((e.data as { memoryWritesDropped?: unknown } | undefined)?.memoryWritesDropped ?? 0) : 0), 0),
    };
    const behavioral = eventsToBehavioral(events);
    const probeResults = runAllProbes({
      events: behavioral,
      agentIds: scenario.agents.map(a => a.agentId),
      totalPulses: pulses,
      fallbackCount,
      totalLLMCalls: tracking?.totalCalls() ?? 0,
    });

    const signalResults = checkExpectedSignals(
      scenario,
      events,
      states,
      tracking?.callsFor.bind(tracking) ?? (() => 0),
      { llmMode: opts.llmMode ?? "mock" },
    );
    const evaluated = signalResults.filter(s => !s.skipped);
    const passedSignals = evaluated.filter(s => s.passed).length;

    return {
      scenarioId: scenario.id,
      events,
      agentStates: states,
      llmCalls: new Map(scenario.agents.map(a => [a.agentId, tracking?.callsFor(a.agentId) ?? 0])),
      fallbackCount,
      fallbackNoOps,
      operatorEventCounts,
      llmFailures,
      memoryProposals,
      operatorFailures: failures,
      recoveredFallbacks,
      probeResults,
      signalResults,
      passedSignals,
      totalSignals: evaluated.length,
      skippedSignals: signalResults.length - evaluated.length,
      latencyMs: Date.now() - started,
      pulseResults,
      promptVersions: tracking?.versionsUsed() ?? [],
      templateVersions: tracking?.templateVersionsUsed() ?? [],
      providerCalls: tracking?.providerCalls(),
    };
  }
}

export type LlmFailureRecord = {
  type: "llm_failure" | "llm_retry_recovered";
  agentId: string;
  pulseIndex: number;
  detail: string;
  data?: Record<string, unknown>;
};

/** The forensics trail: what failed, for whom, at which pulse, and what the model returned. */
export function collectLlmFailures(operatorEvents: readonly OperatorEvent[]): LlmFailureRecord[] {
  const out: LlmFailureRecord[] = [];
  for (const e of operatorEvents) {
    if (e.type !== "llm_failure" && e.type !== "llm_retry_recovered") continue;
    out.push({
      type: e.type,
      agentId: e.agentId ?? "",
      pulseIndex: e.pulseIndex,
      detail: e.detail,
      ...(e.data ? { data: e.data as Record<string, unknown> } : {}),
    });
  }
  return out;
}

/**
 * Fallback accounting the runner reports. `fallbackCount` counts every
 * `llm_failure` — the committed one (provider crash path) and the operator
 * one that `ActionIntentStep` emits when a parse failure or exhausted retry
 * substituted a fallback intent; before this both a real run's parse
 * failures and its "0 fallbacks" summary were true at the same time.
 * `fallbackNoOps` is the diagnostic cross-check: committed no-op records
 * whose motive the engine wrote (`isEngineAuthoredMotive`).
 */
export function countFallbacks(
  events: readonly CommittedEvent[],
  operatorEvents: readonly OperatorEvent[],
): { fallbackCount: number; fallbackNoOps: number; operatorEventCounts: Partial<Record<OperatorEvent["type"], number>> } {
  const operatorEventCounts: Partial<Record<OperatorEvent["type"], number>> = {};
  for (const e of operatorEvents) operatorEventCounts[e.type] = (operatorEventCounts[e.type] ?? 0) + 1;
  const committedFailures = events.filter(e => e.type === "llm_failure").length;
  const fallbackNoOps = events.filter(e => {
    if (e.type !== "no_op_recorded" && e.type !== "repetition_blocked") return false;
    const motive = (e.payload as Record<string, unknown>)["privateMotiveSummary"];
    return typeof motive === "string" && isEngineAuthoredMotive(motive);
  }).length;
  return {
    fallbackCount: committedFailures + (operatorEventCounts["llm_failure"] ?? 0),
    fallbackNoOps,
    operatorEventCounts,
  };
}

// ── Config / state builders ──────────────────────────────────────────────────

// Exported for tests: proves an AgentSeedSpec.hiddenObjective (and
// .scenarioContext) actually reach the agent's promptProfile, not just
// scenario metadata.
export function scenarioToConfig(scenario: RoleplayScenario, llmMode: "mock" | "local", seed?: number): SimulationAppConfig {
  const agents: AgentConfig[] = scenario.agents.map(spec => {
    const persona = getPersonaById(spec.personaId) ?? ALL_PERSONAS[0]!;
    const pack = getPersonaPackById(spec.personaId);
    const mood = fullMood(spec, persona);
    const social = fullSocial(spec);
    // Re-skin the pack onto the scene: scene name wins, pack peers survive
    // only through the cast, and a scene that seeds memories replaces the
    // pack's unresolved-memory lines.
    const castDisplayNames = Object.fromEntries(
      scenario.agents.map(a => [
        a.agentId,
        a.scenarioContext?.displayName ?? getPersonaPackById(a.personaId)?.displayName ?? a.agentId,
      ]),
    );
    const basePromptProfile = pack
      ? personaPackToProfile(pack, {
          scenarioContext: spec.scenarioContext,
          castAgentIds: scenario.agents.map(a => a.agentId),
          castDisplayNames,
          replacesMemories: (spec.memories?.length ?? 0) > 0,
        })
      : genericProfile(persona);
    let promptProfile = basePromptProfile;
    if (spec.hiddenObjective) promptProfile = { ...promptProfile, hiddenObjective: spec.hiddenObjective };
    if (spec.scenarioContext) promptProfile = { ...promptProfile, scenarioContext: spec.scenarioContext };
    return {
      id: spec.agentId,
      presence: spec.presence ?? "active",
      persona,
      promptProfile,
      llm: llmMode === "local"
        ? localLLMConfig(pack, seed)
        : {
            providerType: "mock",
            modelName: "persona-aware-mock",
            maxInputTokens: 2048,
            maxOutputTokens: 512,
            temperature: 0.7,
            timeoutMs: 5000,
            retryCount: 1,
          },
      initialCoreMood: mood,
      initialSocialEmotions: social,
      relationalStates: buildRelationalStates(spec),
      arrivalPulse: spec.arrivalPulse ?? null,
    };
  });

  return {
    simulation: {
      id: scenario.id,
      name: scenario.name,
      seed: scenario.seed,
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 200,
        pulseIntervalMs: 3000, // production pacing — the sim clock, not the loop speed
        tokenBudgetPerHour: 1_000_000,
      },
    },
    persistence: { type: "memory" },
    debug: { operatorEvents: true, pulseMetrics: true },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: scenario.channels.map(ch => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      memberAgentIds: ch.memberAgentIds,
      default: ch.type === "public_channel",
      createdBy: ch.createdBy,
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: ch.createdForMotives ?? [],
    })),
    agents,
  };
}

/** Builds the LLM config for local/frontier runs (DeepSeek or any
 *  OpenAI-compatible endpoint). Secrets come from env vars only. */
function genericProfile(persona: import("@perfectman/shared").PersonaConfig): PersonaPromptProfile {
  return {
    personaId: persona.id,
    displayName: persona.name,
    language: "pt-BR",
    identityFrame: `You are ${persona.name}, a ${persona.archetype}. ${persona.writingStyle}`,
    coreTraits: [persona.archetype],
    valuesAndMotivations: [],
    socialPresence: [],
    cognitiveStyle: [],
    emotionalPatterns: [],
    conflictStyle: [],
    affectionStyle: [],
    publicPrivateDelta: [],
    voiceGuidelines: [persona.writingStyle],
    styleExamples: { default: persona.styleExamples, animated: [], dryOrLowEnergy: [], conflict: [] },
    privateMotivePatterns: [],
    hardAvoids: [],
    relationshipBiases: {},
    sourceRefs: { assessmentIds: [], lastCompiledAt: new Date().toISOString() },
  };
}

// Exported for tests: benchmarks must pin LLM sampling so runs are
// comparable (see issue #45). Overridable without code changes via env.
export function benchSeed(): number {
  const raw = process.env.PERFECTMAN_LLM_SEED?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 42;
}

// Exported for tests and local debug tooling.
/**
 * Known-working real-model route (as of this writing): OrcaRouter's
 * `deepseek/deepseek-v4-flash` (paid tier — the free variant shares a
 * capacity pool that gets rate-limited fast under any sustained run).
 *   PERFECTMAN_LLM_PROVIDER=deepseek
 *   PERFECTMAN_LLM_MODEL=deepseek/deepseek-v4-flash
 *   PERFECTMAN_LLM_BASE_URL=https://api.orcarouter.ai/v1
 *   PERFECTMAN_LLM_API_KEY=<your key — never commit it>
 * Ruled out, with reasons, after real captures: OpenCode Zen/Zen Go
 * (works in isolation, stalls unpredictably on full multi-pulse runs —
 * cloud-side queueing, not this codebase); Groq (strict per-account
 * tokens-per-minute cap that a single real call can exhaust); GLM-5.3-flash
 * (no way to disable its hidden reasoning phase at all — correct output,
 * impractically slow); most "*-free" models on any router (share a
 * capacity pool independent of account balance, rate-limit fast).
 */
export function localLLMConfig(
  pack: import("@perfectman/shared").PersonaPack | undefined,
  seed: number = benchSeed(),
): import("@perfectman/server").LLMConfig {
  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  const baseUrl =
    process.env.PERFECTMAN_LLM_BASE_URL ??
    (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1");
  const modelName =
    process.env.PERFECTMAN_LLM_MODEL ?? (isDeepseek ? "deepseek-chat" : "qwen3:8b");
  const apiKeyEnv = process.env.PERFECTMAN_LLM_API_KEY ? "PERFECTMAN_LLM_API_KEY" : undefined;
  const sampling = pack?.sampling ?? { temperature: 0.7, repetitionPenalty: 1.1, topP: 0.95, maxTokens: 512 };
  // `includes` (not `startsWith`) because routers namespace model ids by
  // provider (e.g. OrcaRouter's "deepseek/deepseek-v4-flash-free") — see the
  // matching `thinking`-disable gate below, same reasoning. This is
  // deliberately narrow: `thinking: {type: "disabled"}` is a DeepSeek-format
  // field specific to the deepseek-v4 API surface, not a generic
  // "reasoning model" toggle — sending it to an unrelated model risks the
  // same HTTP 400 this gate was built to avoid in the first place.
  const isDeepseekV4 = isDeepseek && modelName.includes("deepseek-v4");
  // Groq-specific: its free `on_demand` tier's token-per-minute accounting
  // is keyed off *requested* max_tokens, not actual usage (see maxOutputTokens
  // below) — this is an account/endpoint limit, not a model property, so it
  // must not be inferred from the model name.
  const isGroq = baseUrl.includes("groq.com");
  return {
    // providerType only splits the native Ollama /api/chat path from the
    // generic OpenAI-compatible one; DeepSeek is a plain OpenAI-compatible
    // config (its baseUrl/model/extraBody mapping above).
    providerType: isDeepseek ? "openai-compatible" : "ollama",
    modelName,
    baseUrl,
    apiKeyEnv,
    maxInputTokens: 4096,
    // Intent JSON + motive prose needs headroom; persona packs are tuned
    // for small local models. Reasoning-capable cloud models are a
    // different animal: they spend thousands of output tokens on a hidden
    // reasoning phase before ever emitting the visible JSON — confirmed on
    // deepseek-v4-flash, glm-5.3-flash (no way to turn it off at all), AND
    // qwen3.8-27b (real capture: mostly "Empty or missing content", an
    // isolated diagnostic needing 929 output tokens for one call to
    // complete). This is NOT unique to models named "deepseek-v4" — the
    // local-tuned budget silently produces EMPTY content (hit
    // maxOutputTokens mid-reasoning, zero JSON ever reached) on any of them.
    //
    // Groq is the one confirmed exception, and for an unrelated reason: its
    // free `on_demand` tier caps at 8000 tokens-PER-MINUTE and counts the
    // *requested* max_tokens against that budget, not actual usage (root-
    // caused via a live capture: a real gpt-oss-120b call needed only ~500
    // output tokens, but requesting the flat 8000 ceiling burned almost the
    // whole per-minute budget on ONE call and 429-ed every other agent's
    // turn for the rest of the run). That is an account/endpoint limit,
    // not a property of "non-deepseek-v4 models" — keying the small budget
    // off the model name (an earlier version of this fix) starved every
    // other reasoning-capable cloud model instead. Every cloud endpoint
    // gets the large reasoning-headroom ceiling except Groq specifically.
    // deepseek-v4 with thinking disabled (below) emits the intent JSON and
    // nothing else, so the reasoning headroom is pure runaway room: every
    // "No JSON object found" on the first forensic reads was a 25–27k-char
    // response that opened as valid JSON and never closed — the model
    // looped inside a string until the 8000-token cap. 2500 tokens is 3–5×
    // a real intent and cuts the loop at a third of the cost.
    maxOutputTokens: isDeepseek
      ? (isGroq ? 2000 : isDeepseekV4 ? 2500 : 8000)
      : Math.max(600, sampling.maxTokens * 2),
    temperature: sampling.temperature,
    timeoutMs: isDeepseek ? 180000 : 120000,
    retryCount: 2,
    responseFormatJson: true,
    extraBody: isDeepseek
      ? {
          seed,
          top_p: sampling.topP,
          // DeepSeek has no repetition_penalty — map to frequency_penalty
          // (stronger for hot personas) plus presence_penalty to kill loops.
          // deepseek-v4 loops inside long string fields at the pack default
          // (0.25); a floor of 0.6 is the second half of the runaway fix.
          frequency_penalty: isDeepseekV4
            ? Math.max(0.6, Math.min(2, (sampling.repetitionPenalty - 1) * 2.5))
            : Math.min(2, (sampling.repetitionPenalty - 1) * 2.5),
          presence_penalty: 0.4,
          // deepseek-v4-* models reason by default at effort `high`, spending
          // the output-token budget on a thinking block before the intent
          // JSON — every intent call then fails to parse. This is DeepSeek's
          // OpenAI-format key to disable that phase; `reasoning_effort: "none"`
          // returns HTTP 400 on DeepSeek. `isDeepseek` here really means
          // "speak the openai-compatible protocol" (any OpenAI-compatible
          // endpoint can be substituted via PERFECTMAN_LLM_BASE_URL/MODEL,
          // e.g. Groq/OpenRouter) — this field is specific to the deepseek-v4
          // model family itself, not the protocol, and other providers
          // reject the unrecognized key with HTTP 400. `includes` (not
          // `startsWith`) because routers namespace model ids by provider
          // (e.g. OrcaRouter's "deepseek/deepseek-v4-flash-free") — a prefix
          // check silently never matches those, and the model burns its
          // whole token budget on hidden reasoning instead.
          ...(isDeepseekV4 ? { thinking: { type: "disabled" } } : {}),
        }
      : {
          seed,
          top_p: sampling.topP,
          repetition_penalty: sampling.repetitionPenalty,
          // Qwen3 emits a <think>...</think> reasoning block by default,
          // which breaks JSON-object parsing of the intent response
          // (OllamaProvider only sends `think` through when explicitly
          // set — see its native /api/chat mapping). Without this, local
          // Qwen3 runs fail to parse on ~every turn and fall back to
          // no-ops, producing no real signal. The product's own example
          // config (examples/simulations/qwen3-local.example.json) sets
          // this per-agent already; the eval harness's local-mode default
          // needs the same.
          think: false,
        },
  };
}

function fullMood(spec: AgentSeedSpec, persona: import("@perfectman/shared").PersonaConfig): import("@perfectman/shared").CoreMood {  return {
    valence: spec.mood?.valence ?? persona.baselineValence,
    arousal: spec.mood?.arousal ?? persona.baselineArousal,
    stability: spec.mood?.stability ?? persona.baselineStability,
    energy: spec.mood?.energy ?? persona.baselineEnergy,
    circumplexAngle: 0,
    circumplexRadius: 0.3,
    momentumValence: 0,
    momentumArousal: 0,
  };
}

function fullSocial(spec: AgentSeedSpec): import("@perfectman/shared").SocialEmotions {
  return {
    jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
    resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0,
    socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
    ...spec.social,
  };
}

function buildRelationalStates(
  spec: AgentSeedSpec,
): Record<string, import("@perfectman/shared").RelationalState> {
  const out: Record<string, import("@perfectman/shared").RelationalState> = {};
  if (spec.relational) {
    for (const [target, rel] of Object.entries(spec.relational)) {
      out[target] = {
        targetAgentId: target,
        trust: 0.5,
        affection: 0.3,
        resentment: 0,
        attraction: 0.2,
        suspicion: 0.1,
        admiration: 0.2,
        envy: 0,
        comfort: 0.5,
        threat: 0,
        curiosity: 0.3,
        desireForCloseness: 0.3,
        desireForDistance: 0.1,
        interactionCount: 0,
        lastInteractionAt: null,
        lastPositiveAt: null,
        lastNegativeAt: null,
        ...rel,
      };
    }
  }
  return out;
}

function buildAgentState(spec: AgentSeedSpec, scenario: RoleplayScenario): AgentState {
  const persona = getPersonaById(spec.personaId) ?? ALL_PERSONAS[0]!;
  const now = Date.now();
  const relationalStates = new Map(Object.entries(buildRelationalStates(spec)));
  const memories: Memory[] = (spec.memories ?? []).map((m, i) => ({
    id: `mem_${scenario.id}_${spec.agentId}_${i}`,
    agentId: spec.agentId,
    simulationId: scenario.id,
    type: m.type,
    subjectAgentIds: m.subjectAgentIds,
    sourceEventIds: [],
    summary: m.summary,
    emotionalTone: m.emotionalTone,
    confidence: m.confidence ?? 0.8,
    intensity: m.intensity ?? 0,
    unresolved: m.unresolved ?? false,
    // Simulated-clock epoch, not wall-clock: memory age is measured in pulses
    // off PulseScheduler.simTime, which starts at 0. See applyMemoryProjection.
    createdAt: 0,
    lastReinforcedAt: 0,
  }));

  return {
    agentId: spec.agentId,
    simulationId: scenario.id,
    personaId: spec.personaId,
    presence: spec.presence ?? "active",
    coreMood: fullMood(spec, persona),
    socialEmotions: fullSocial(spec),
    relationalStates,
    memories,
    initiativeAccumulators: (spec.initiativeAccumulators ?? []).map((acc, i) => ({
        id: `acc_${spec.agentId}_${i}`,
        source: acc.source as import("@perfectman/shared").InitiativeSource,
        value: acc.value,
        threshold: acc.threshold,
        growthRate: 0.06,
        decayRate: 0.02,
        lastFiredAt: null,
      })),
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: spec.arrivalPulse ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

let _eventId = 0;

function toCommittedEvent(spec: EventSeedSpec, scenario: RoleplayScenario, minPriorPulse = 0): CommittedEvent {
  _eventId++;
  const now = Date.now();
  return {
    id: `evt_seed_${scenario.id}_${_eventId}`,
    simulationId: scenario.id,
    channelId: spec.channelId,
    actorId: spec.actorId,
    type: spec.type as CommittedEvent["type"],
    payload: (spec.payload ?? {}) as import("@perfectman/shared").EventPayload,
    createdAt: now - (spec.minutesAgo ?? 0) * 60_000,
    pulseIndex: spec.pulseIndex - minPriorPulse,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "scenario_seed",
    },
  };
}

