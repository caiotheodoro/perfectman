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
import { AgentRuntime, AgentConfigRegistry, MockDeliveryGateway, MockLLMProvider, OllamaProvider, OpenAiCompatibleProvider, personaPackToProfile } from "@perfectman/server";
import type { PersonaPromptProfile } from "@perfectman/server";
import type { LLMProvider } from "@perfectman/server";
import { eventsToBehavioral, runAllProbes, type ProbeResult } from "../probes/index.js";
import { checkExpectedSignals, type SignalOutcome } from "./signal-checker.js";
import { personaAwareProviderFactory } from "../bench/persona-aware-mock.js";

export type RunnerOpts = {
  providerFactory?: (llmConfig: import("@perfectman/server").LLMConfig, agentId: string) => LLMProvider;
  llmMode?: "mock" | "local";
  pulseLimit?: number;
};

export type ScenarioRunArtifact = {
  scenarioId: string;
  events: CommittedEvent[];
  agentStates: Map<string, AgentState>;
  llmCalls: Map<string, number>;
  fallbackCount: number;
  operatorFailures: number;
  probeResults: ProbeResult[];
  signalResults: SignalOutcome[];
  passedSignals: number;
  totalSignals: number;
  latencyMs: number;
  pulseResults: number;
  /** Unique generation prompt versions observed across the run (attribution). */
  promptVersions: string[];
};

class TrackingRuntime {
  private readonly inner: AgentRuntime;
  private readonly calls = new Map<string, number>();
  private readonly versions = new Set<string>();
  private readonly providers = new Map<string, LLMProvider>();

  constructor(
    registry: AgentConfigRegistry,
    factory: ((llmConfig: import("@perfectman/server").LLMConfig, agentId: string) => LLMProvider) | undefined,
  ) {
    this.inner = new AgentRuntime(undefined, registry, (llmConfig, agentId) => {
      // One provider instance per agent per scenario — per-call state
      // (channel caps, memory habits) must persist across pulses.
      let provider = this.providers.get(agentId);
      if (!provider) {
        provider = factory ? factory(llmConfig, agentId) : undefined;
        if (!provider) {
          // No injected factory → follow the config's provider type
          // (mock → canned; ollama → native API for Qwen3; else OpenAI-compatible).
          provider =
            llmConfig.providerType === "mock"
              ? new MockLLMProvider()
              : llmConfig.providerType === "ollama"
                ? new OllamaProvider(llmConfig)
                : new OpenAiCompatibleProvider(llmConfig);
        }
        this.providers.set(agentId, provider);
      }
      return provider;
    });
  }

  async generateIntent(
    input: Parameters<AgentRuntime["generateIntent"]>[0],
    context: Parameters<AgentRuntime["generateIntent"]>[1],
  ): ReturnType<AgentRuntime["generateIntent"]> {
    this.calls.set(input.agentId, (this.calls.get(input.agentId) ?? 0) + 1);
    const output = await this.inner.generateIntent(input, context);
    if (output.llmUsage?.promptVersion) this.versions.add(output.llmUsage.promptVersion);
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
}

export class ScenarioRunner {
  static async run(scenario: RoleplayScenario, opts: RunnerOpts = {}): Promise<ScenarioRunArtifact> {
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
      scenarioToConfig(scenario, opts.llmMode ?? "mock"),
      {
        agentRuntimeFactory: (registry) => {
          tracking = new TrackingRuntime(registry, providerFactory);
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
    const fallbackCount = failures;
    const behavioral = eventsToBehavioral(events);
    const probeResults = runAllProbes({
      events: behavioral,
      agentIds: scenario.agents.map(a => a.agentId),
      totalPulses: pulses,
      fallbackCount,
      totalLLMCalls: tracking?.totalCalls() ?? 0,
    });

    const signalResults = checkExpectedSignals(scenario, events, states, tracking?.callsFor.bind(tracking) ?? (() => 0));
    const passedSignals = signalResults.filter(s => s.passed).length;

    return {
      scenarioId: scenario.id,
      events,
      agentStates: states,
      llmCalls: new Map(scenario.agents.map(a => [a.agentId, tracking?.callsFor(a.agentId) ?? 0])),
      fallbackCount,
      operatorFailures: failures,
      probeResults,
      signalResults,
      passedSignals,
      totalSignals: signalResults.length,
      latencyMs: Date.now() - started,
      pulseResults,
      promptVersions: tracking?.versionsUsed() ?? [],
    };
  }
}

// ── Config / state builders ──────────────────────────────────────────────────

function scenarioToConfig(scenario: RoleplayScenario, llmMode: "mock" | "local"): SimulationAppConfig {
  const agents: AgentConfig[] = scenario.agents.map(spec => {
    const persona = getPersonaById(spec.personaId) ?? ALL_PERSONAS[0]!;
    const pack = getPersonaPackById(spec.personaId);
    const mood = fullMood(spec, persona);
    const social = fullSocial(spec);
    return {
      id: spec.agentId,
      presence: spec.presence ?? "active",
      persona,
      promptProfile: pack
        ? personaPackToProfile(pack)
        : genericProfile(persona),
      llm: llmMode === "local"
        ? localLLMConfig(pack)
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

function localLLMConfig(pack: import("@perfectman/shared").PersonaPack | undefined): import("@perfectman/server").LLMConfig {
  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  const baseUrl =
    process.env.PERFECTMAN_LLM_BASE_URL ??
    (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1");
  const modelName =
    process.env.PERFECTMAN_LLM_MODEL ?? (isDeepseek ? "deepseek-chat" : "qwen3:8b");
  const apiKeyEnv = process.env.PERFECTMAN_LLM_API_KEY ? "PERFECTMAN_LLM_API_KEY" : undefined;
  const sampling = pack?.sampling ?? { temperature: 0.7, repetitionPenalty: 1.1, topP: 0.95, maxTokens: 512 };
  return {
    // qwen3_8b/ollama/freellmapi all land on an OpenAI-compatible provider
    // (or the native Ollama path); DeepSeek uses the OpenAI-compatible one.
    providerType: isDeepseek ? "qwen3_8b" : "ollama",
    modelName,
    baseUrl,
    apiKeyEnv,
    maxInputTokens: 4096,
    // Intent JSON + motive prose needs headroom; persona packs are tuned
    // for small local models.
    maxOutputTokens: Math.max(600, sampling.maxTokens * 2),
    temperature: sampling.temperature,
    timeoutMs: 120000,
    retryCount: 2,
    responseFormatJson: true,
    extraBody: isDeepseek
      ? {
          top_p: sampling.topP,
          // DeepSeek has no repetition_penalty — map to frequency_penalty
          // (stronger for hot personas) plus presence_penalty to kill loops.
          frequency_penalty: Math.min(2, (sampling.repetitionPenalty - 1) * 2.5),
          presence_penalty: 0.4,
        }
      : {
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
    unresolved: m.unresolved ?? false,
    createdAt: now,
    lastReinforcedAt: now,
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

