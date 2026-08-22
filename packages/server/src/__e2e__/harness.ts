/**
 * SimulationHarness — flagship e2e test harness.
 *
 * Converts a named fixture scenario into a fully-wired simulation:
 * real engine (Dev3) → real AgentRuntime with mock LLM (Dev1) →
 * real PulseScheduler + IntentResolver + all projections (Dev2) →
 * MockDeliveryGateway for inspection.
 *
 * Every test using this harness exercises the full cross-boundary
 * pipeline in a single call to runPulse().
 */

import type {
  AgentState,
  Channel,
  ChannelMembership,
  CommittedEvent,
  EventType,
  PersonaConfig,
  Simulation,
  SimulationSettings,
} from "@perfectman/shared";
import type { AgentConfigRegistry } from "../agent/agent-config-registry.js";
import { AgentRuntime } from "../agent/agent-runtime.js";
import { DEFAULT_MOCK_CONFIG } from "../agent/persona-loader.js";
import { GENERIC_PROMPT_PROFILE } from "../agent/persona-prompt-profile.js";
import {
  buildConfiguredSimulation,
  type AgentConfig,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "../config/simulation-config.js";
import { MockDeliveryGateway } from "../delivery/mock-delivery-gateway.js";
import type {
  IAgentStateRepository,
  IEventRepository,
} from "../persistence/repositories.js";
import {
  type AgentContext,
  type PulseResult,
} from "../simulation/pulse-scheduler.js";

export const DEFAULT_E2E_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 30,
  llmCallBudgetPerMinute: 100,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

export type ScenarioSeed = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  agentContexts: AgentContext[];
  /** Events already in the log before the first pulse (scenario setup state). */
  priorEvents: CommittedEvent[];
};

/** Wraps AgentRuntime and counts how many times each agent's LLM path was invoked. */
class TrackingAgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly calls = new Map<string, number>();

  constructor(registry: AgentConfigRegistry) {
    this.inner = new AgentRuntime(undefined, registry);
  }

  async generateIntent(
    input: Parameters<AgentRuntime["generateIntent"]>[0],
    context: Parameters<AgentRuntime["generateIntent"]>[1],
  ): ReturnType<AgentRuntime["generateIntent"]> {
    this.calls.set(input.agentId, (this.calls.get(input.agentId) ?? 0) + 1);
    return this.inner.generateIntent(input, context);
  }

  callsFor(agentId: string): number {
    return this.calls.get(agentId) ?? 0;
  }

  totalCalls(): number {
    let total = 0;
    for (const v of this.calls.values()) total += v;
    return total;
  }
}

export class SimulationHarness {
  private readonly handle: ConfiguredSimulationHandle;
  private readonly eventRepo: IEventRepository;
  private readonly agentStateRepo: IAgentStateRepository;
  private readonly tracking: TrackingAgentRuntime;
  readonly gateway: MockDeliveryGateway;
  readonly simulationId: string;

  private constructor(params: {
    handle: ConfiguredSimulationHandle;
    eventRepo: IEventRepository;
    agentStateRepo: IAgentStateRepository;
    tracking: TrackingAgentRuntime;
    gateway: MockDeliveryGateway;
    simulationId: string;
  }) {
    this.handle = params.handle;
    this.eventRepo = params.eventRepo;
    this.agentStateRepo = params.agentStateRepo;
    this.tracking = params.tracking;
    this.gateway = params.gateway;
    this.simulationId = params.simulationId;
  }

  static async create(seed: ScenarioSeed): Promise<SimulationHarness> {
    let tracking: TrackingAgentRuntime | undefined;
    const handle = await buildConfiguredSimulation(scenarioSeedToConfig(seed), {
      agentRuntimeFactory: (registry) => {
        tracking = new TrackingAgentRuntime(registry);
        return tracking;
      },
    });
    const gateway = handle.gateways["mock"];
    if (!(gateway instanceof MockDeliveryGateway)) {
      throw new Error("E2E config must create a mock gateway");
    }
    gateway.reset();

    for (const agent of seed.agentContexts) {
      await handle.repositories.agentStateRepo.upsert(agent.state);
    }

    if (seed.priorEvents.length > 0) {
      await handle.repositories.eventRepo.append(seed.simulation.id, seed.priorEvents);
    }

    return new SimulationHarness({
      handle,
      eventRepo: handle.repositories.eventRepo,
      agentStateRepo: handle.repositories.agentStateRepo,
      tracking: tracking!,
      gateway,
      simulationId: seed.simulation.id,
    });
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async runPulse(): Promise<PulseResult> {
    return this.handle.runtime.runPulse(this.simulationId);
  }

  async runPulses(n: number): Promise<PulseResult[]> {
    const results: PulseResult[] = [];
    for (let i = 0; i < n; i++) {
      results.push(await this.runPulse());
    }
    return results;
  }

  // ── Inspection ─────────────────────────────────────────────────────────────

  async getAgentState(agentId: string): Promise<AgentState> {
    const state = await this.agentStateRepo.get(this.simulationId, agentId);
    if (!state) throw new Error(`Agent state not found: ${agentId}`);
    return state;
  }

  async getAllEvents(): Promise<CommittedEvent[]> {
    return this.eventRepo.getAfter(this.simulationId);
  }

  async getEventsByType(type: EventType): Promise<CommittedEvent[]> {
    const all = await this.getAllEvents();
    return all.filter(e => e.type === type);
  }

  async getEventsForAgent(agentId: string): Promise<CommittedEvent[]> {
    const all = await this.getAllEvents();
    return all.filter(e => e.actorId === agentId);
  }

  /** How many times the LLM path was invoked for a given agent. */
  llmCallsFor(agentId: string): number {
    return this.tracking.callsFor(agentId);
  }

  totalLLMCalls(): number {
    return this.tracking.totalCalls();
  }

  // ── Shared assertion helpers ───────────────────────────────────────────────

  /** Asserts no llm_failure events were committed and no operator failure events emitted. */
  async assertNoLLMFailures(): Promise<void> {
    const failures = await this.getEventsByType("llm_failure");
    if (failures.length > 0) {
      throw new Error(
        `Expected no LLM failures, found ${failures.length}: ` +
          failures.map(e => JSON.stringify(e.payload)).join(", "),
      );
    }
    const opFailures = this.gateway.operatorEvents.filter(e => e.type === "llm_failure");
    if (opFailures.length > 0) {
      throw new Error(
        `Expected no operator llm_failure events, found ${opFailures.length}: ` +
          opFailures.map(e => e.detail).join(", "),
      );
    }
  }

  /** Asserts every committed event has mandatory committed fields. */
  async assertCommittedEventShape(): Promise<void> {
    const all = await this.getAllEvents();
    for (const evt of all) {
      if (!evt.id) throw new Error(`Event missing id: ${JSON.stringify(evt)}`);
      if (typeof evt.createdAt !== "number") throw new Error(`Event missing createdAt: ${evt.id}`);
      if (typeof evt.pulseIndex !== "number") throw new Error(`Event missing pulseIndex: ${evt.id}`);
      if (!evt.simulationId) throw new Error(`Event missing simulationId: ${evt.id}`);
      if (!evt.visibility) throw new Error(`Event missing visibility: ${evt.id}`);
    }
  }

  /** Asserts all emotion values in the state are within their legal bounds. */
  assertEmotionBounds(state: AgentState): void {
    const { coreMood, socialEmotions } = state;
    const inRange = (v: number, min: number, max: number) => v >= min && v <= max;

    if (!inRange(coreMood.valence, -1, 1)) throw new Error(`valence out of bounds: ${coreMood.valence}`);
    if (!inRange(coreMood.arousal, 0, 1)) throw new Error(`arousal out of bounds: ${coreMood.arousal}`);
    if (!inRange(coreMood.stability, 0.1, 1)) throw new Error(`stability out of bounds: ${coreMood.stability}`);
    if (!inRange(coreMood.energy, 0, 1)) throw new Error(`energy out of bounds: ${coreMood.energy}`);

    for (const [key, val] of Object.entries(socialEmotions)) {
      if (!inRange(val, 0, 1)) throw new Error(`socialEmotions.${key} out of bounds: ${val}`);
    }
  }
}

// ── Scenario conversion helpers ──────────────────────────────────────────────

function scenarioSeedToConfig(seed: ScenarioSeed): SimulationAppConfig {
  return {
    simulation: {
      id: seed.simulation.id,
      name: seed.simulation.name,
      seed: seed.simulation.seed,
      settings: seed.simulation.settings,
    },
    persistence: { type: "memory" },
    debug: {
      operatorEvents: true,
      pulseMetrics: true,
    },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: seed.channels.map(channel => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      memberAgentIds: channel.memberAgentIds,
      default: channel.type === "public_channel",
      createdBy: channel.createdBy,
      spectatorVisible: channel.spectatorVisible,
      operatorVisible: channel.operatorVisible,
      createdForMotives: channel.createdForMotives,
    })),
    agents: seed.agentContexts.map(agentContextToConfig),
  };
}

function agentContextToConfig(agent: AgentContext): AgentConfig {
  return {
    id: agent.id,
    presence: agent.state.presence,
    persona: agent.persona,
    promptProfile: {
      ...GENERIC_PROMPT_PROFILE,
      personaId: agent.persona.id,
      displayName: agent.persona.name,
      language: "pt-BR",
      identityFrame: `You are ${agent.persona.name}, a ${agent.persona.archetype}. ${agent.persona.writingStyle}`,
      voiceGuidelines: [
        agent.persona.writingStyle,
      ],
      styleExamples: {
        ...GENERIC_PROMPT_PROFILE.styleExamples,
        default: agent.persona.styleExamples,
      },
      relationshipBiases: {},
    },
    llm: DEFAULT_MOCK_CONFIG,
    initialCoreMood: agent.state.coreMood,
    initialSocialEmotions: agent.state.socialEmotions,
    relationalStates: Object.fromEntries(agent.state.relationalStates.entries()),
    arrivalPulse: agent.state.arrivalPulse,
  };
}

export function makeSimulation(
  id: string,
  name: string,
  agentIds: string[],
  channelIds: string[],
  settings: SimulationSettings = DEFAULT_E2E_SETTINGS,
): Simulation {
  const now = Date.now();
  return {
    id,
    name,
    status: "running",
    agentIds,
    channelIds,
    settings,
    seed: 42,
    createdAt: now,
    updatedAt: now,
  };
}

export function agentContextsFrom(
  agentStates: Record<string, AgentState>,
  personas: Record<string, PersonaConfig>,
): AgentContext[] {
  return Object.entries(agentStates).map(([id, state]) => ({
    id,
    state,
    persona: personas[id]!,
  }));
}
