/**
 * AC-2 restart suite: a mid-run sqlite-backed simulation resumes on a second
 * runtime over the same file. Deliberate file-I/O deviation (D-36): the
 * persistence suite keeps :memory: everywhere else; a closed :memory: DB
 * cannot reopen, so this one file uses mkdtempSync + a real sqlite file.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActionIntent,
  AgentState,
  PersonaConfig,
  SimulationEvent,
  SimulationSettings,
  AgentRuntimeInput,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { SimulationRuntime } from "../../simulation-runtime.js";
import {
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
  InMemorySimulationRepository,
} from "../../in-memory-stores.js";
import { ChannelRegistry } from "../../channel-registry.js";
import { MockDeliveryGateway } from "../../../delivery/mock-delivery-gateway.js";
import { LLMBudgetTracker } from "../../../llm/llm-budget.js";
import { GoalRegistry } from "../goal-registry.js";
import { WorldEvaluator, resolveGoalLayerConfig } from "../world-evaluator.js";
import type { GoalLayerRuntime, GoalRegistryPersister } from "../world-evaluator.js";
import { GoalLayerLLMClient } from "../goal-layer-llm.js";
import type { GoalLayerCallInput, GoalLayerLLMOutcome } from "../goal-layer-llm.js";
import type { GoalLayerClientFactory } from "../goal-synthesizer.js";
import type { AgentRuntime, PulseResult, PulseScheduler } from "../../pulse-scheduler.js";
import type { AgentRuntimeOutput } from "../../../agent/agent-runtime.types.js";
import {
  buildConfiguredSimulation,
  parseSimulationConfig,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "../../../config/simulation-config.js";
import { openDatabase, closeDatabase } from "../../../persistence/sqlite/database.js";
import {
  SqliteAgentStateRepository,
  SqliteChannelRepository,
  SqliteEventRepository,
  SqliteGoalRegistryRepository,
  SqliteSimulationRepository,
} from "../../../persistence/sqlite/index.js";

const SIM_ID = "sim_goal_restart";
const CHANNEL_ID = "general";
const AGENT_ID = "ana";
const BEN_ID = "ben";

// Registry reach through the scheduler/evaluator privates, per the
// goal-end-to-end cast precedent (private `active` on the runtime, `config`
// on the scheduler, `registry` on the evaluator).
type RuntimeWithActiveSims = SimulationRuntime & { active: Map<string, unknown> };
type ActiveSimEntry = {
  scheduler: PulseScheduler & {
    config: { goalLayer?: GoalLayerRuntime };
    inFlight: Promise<PulseResult> | null;
  };
};
type EvaluatorWithRegistry = WorldEvaluator & { registry: GoalRegistry };

function activeSimulations(runtime: SimulationRuntime): Map<string, unknown> {
  return (runtime as RuntimeWithActiveSims).active;
}

function evaluatorRegistry(runtime: SimulationRuntime, simulationId: string): GoalRegistry {
  const entry = activeSimulations(runtime).get(simulationId) as ActiveSimEntry;
  const evaluator = entry.scheduler.config.goalLayer!.evaluator;
  return (evaluator as EvaluatorWithRegistry).registry;
}

const LLM_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 30,
  llmCallBudgetPerMinute: 100,
  pulseIntervalMs: 1000,
  tokenBudgetPerHour: 1_000_000,
};

const MOCK_LLM = {
  providerType: "mock" as const,
  modelName: "mock-model",
  baseUrl: "http://localhost",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

function makeRestartConfig(dbPath: string): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: SIM_ID,
      name: "Goal Layer Restart",
      seed: 42,
      settings: LLM_SETTINGS,
    },
    persistence: { type: "sqlite", path: dbPath },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: [{
      id: CHANNEL_ID,
      type: "public_channel",
      name: "general",
      default: true,
      memberAgentIds: [AGENT_ID],
    }],
    agents: [{
      id: AGENT_ID,
      persona: {
        id: AGENT_ID,
        name: "Ana",
        archetype: "observer",
        writingStyle: "brief and careful",
        styleExamples: ["oi", "entendi"],
      },
      promptProfile: {
        personaId: AGENT_ID,
        displayName: "Ana",
        identityFrame: "You are Ana.",
        voiceGuidelines: ["Keep it short."],
        styleExamples: ["oi"],
        relationshipBiases: {},
        language: "pt-BR",
      },
      llm: MOCK_LLM,
    }],
    goalLayer: { enabled: true, reviewEveryPulses: 1 },
  });
}

function blockedEvent(index: number): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: AGENT_ID,
    type: "intent_blocked",
    payload: {
      intentType: "send_message",
      violations: [{ type: "rate_limited" }],
      intentId: `intent_${index}`,
    },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

async function waitForWorldVerdict(
  handle: ConfiguredSimulationHandle,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = await handle.repositories.eventRepo.getCommittedThrough(
      handle.simulationId,
      Number.MAX_SAFE_INTEGER,
    );
    if (log.some((event) => event.type === "world_verdict")) return;
    if (Date.now() > deadline) {
      throw new Error(
        `goal-layer restart timeout: world_verdict not committed within ${timeoutMs}ms for ${handle.simulationId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("goal-layer write-through (D-31)", () => {
  const goalEventTypes = new Set([
    "goal_proposed",
    "goal_accepted",
    "world_verdict",
    "delusion_gap_sampled",
    "ending_offered",
  ]);

  function makeRuntime(repos: {
    eventRepo: InMemoryEventRepository;
    agentStateRepo: InMemoryAgentStateRepository;
    simRepo: InMemorySimulationRepository;
    channelRepo: InMemoryChannelRepository;
  }, gateway: MockDeliveryGateway): SimulationRuntime {
    return new SimulationRuntime({
      delivery: gateway,
      agentRuntime: noOpAgentRuntime,
      llmBudget: new LLMBudgetTracker(),
      repositories: repos,
    });
  }

  it("persists on reviews that commit zero events (candidate-less interval)", async () => {
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const simRepo = new InMemorySimulationRepository();
    const channelRepo = new InMemoryChannelRepository();
    const runtime = makeRuntime(
      { eventRepo, agentStateRepo, simRepo, channelRepo },
      new MockDeliveryGateway(),
    );
    const registry = new GoalRegistry();
    const evalConfig = resolveGoalLayerConfig({
      enabled: true,
      reviewEveryPulses: 1,
    });
    const persister: GoalRegistryPersister = {
      saveSelfVerdicts: vi.fn(async () => undefined),
      loadSelfVerdicts: vi.fn(async () => []),
    };
    const evaluator = new WorldEvaluator(
      eventRepo,
      agentStateRepo,
      new ChannelRegistry(channelRepo),
      registry,
      evalConfig,
      undefined,
      persister,
    );
    await runtime.createSimulation({
      id: SIM_ID,
      name: "Write-through",
      seed: 42,
      settings: LLM_SETTINGS,
      agentContexts: [
        { id: AGENT_ID, state: makeAgentState(AGENT_ID), persona: makePersona(AGENT_ID, "Ana") },
      ],
      channels: [{
        id: CHANNEL_ID,
        type: "public_channel",
        name: "general",
        default: true,
        memberAgentIds: [AGENT_ID],
      }],
      goalLayer: { config: evalConfig, evaluator },
    });

    // Pulse 0 is review-exempt; pulse 1 runs a review over an event-less
    // log: zero candidates, zero proposals, zero committed goal events — the
    // write-through still fires (D-31 placement: outside the commit-if).
    await runtime.runPulse(SIM_ID);
    await runtime.runPulse(SIM_ID);

    const log = await eventRepo.getCommittedThrough(
      SIM_ID,
      Number.MAX_SAFE_INTEGER,
    );
    expect(log.some((event) => goalEventTypes.has(event.type))).toBe(false);
    expect(persister.saveSelfVerdicts).toHaveBeenCalled();
  });

  it("a failing registry persist is contained: distinct operator event, pulse survives, review events still commit", async () => {
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const simRepo = new InMemorySimulationRepository();
    const channelRepo = new InMemoryChannelRepository();
    const gateway = new MockDeliveryGateway();
    const runtime = makeRuntime(
      { eventRepo, agentStateRepo, simRepo, channelRepo },
      gateway,
    );
    const registry = new GoalRegistry();
    const evalConfig = resolveGoalLayerConfig({
      enabled: true,
      reviewEveryPulses: 1,
    });
    const persister: GoalRegistryPersister = {
      saveSelfVerdicts: vi.fn(async () => {
        throw new Error("disk full");
      }),
      loadSelfVerdicts: vi.fn(async () => []),
    };
    const evaluator = new WorldEvaluator(
      eventRepo,
      agentStateRepo,
      new ChannelRegistry(channelRepo),
      registry,
      evalConfig,
      undefined,
      persister,
    );
    await runtime.createSimulation({
      id: SIM_ID,
      name: "Write-through failure",
      seed: 42,
      settings: LLM_SETTINGS,
      agentContexts: [
        { id: AGENT_ID, state: makeAgentState(AGENT_ID), persona: makePersona(AGENT_ID, "Ana") },
      ],
      channels: [{
        id: CHANNEL_ID,
        type: "public_channel",
        name: "general",
        default: true,
        memberAgentIds: [AGENT_ID],
      }],
      goalLayer: { config: evalConfig, evaluator },
    });
    await runtime.getEventLog().append(SIM_ID, [1, 2, 3].map(blockedEvent));

    // Pulse 1's review commits goal_proposed; the persist write fails right
    // after. The pulse must survive, the failure must surface under its own
    // operator event, and the review log must be untouched.
    await runtime.runPulse(SIM_ID);
    await runtime.runPulse(SIM_ID);

    const log = await eventRepo.getCommittedThrough(
      SIM_ID,
      Number.MAX_SAFE_INTEGER,
    );
    expect(log.some((event) => event.type === "goal_proposed")).toBe(true);
    expect(gateway.operatorEvents.some((e) => e.detail === "Registry persist failed")).toBe(true);
    expect(gateway.operatorEvents.some((e) => e.detail === "World review failed")).toBe(false);

    // The run keeps pulsing past the failure (cache semantics, D-31).
    await runtime.runPulse(SIM_ID);
  });
});

describe("goal layer restart (AC-2)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "deterministic mid-run: a second buildConfiguredSimulation on the same file resumes goals/verdicts/gap history",
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), "goal-restart-"));
      const dbPath = join(tmpDir, "sim.sqlite");

      // Phase 1: factory run until the first world verdict commits — the
      // mid-run state the restart must resume.
      const config = makeRestartConfig(dbPath);
      const phase1 = await buildConfiguredSimulation(config);
      let phase1Registry: GoalRegistry;
      try {
        await phase1.runtime.getEventLog().append(phase1.simulationId, [1, 2, 3].map(blockedEvent));
        await phase1.runtime.start(phase1.simulationId);
        phase1Registry = evaluatorRegistry(phase1.runtime, phase1.simulationId);
        await waitForWorldVerdict(phase1, 20_000);
      } finally {
        // A poll can return while a pulse is still in flight (its review
        // already committed the verdict); drain it so nothing records into
        // the registry after close() below, then stop and close.
        const phase1Entry = activeSimulations(phase1.runtime).get(
          phase1.simulationId,
        ) as ActiveSimEntry | undefined;
        if (phase1Entry) {
          while (phase1Entry.scheduler.inFlight !== null) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        if (activeSimulations(phase1.runtime).has(phase1.simulationId)) {
          await phase1.runtime.stop(phase1.simulationId);
        }
        await phase1.close();
      }

      // Phase 2: a second build on the same file must reach the surviving
      // simulations row through the factory's attach-existing branch (T412)
      // instead of crashing on the simulations.id PK.
      const phase2 = await buildConfiguredSimulation(config, { attachExisting: true });
      try {
        const resumed = evaluatorRegistry(phase2.runtime, phase2.simulationId);
        expect(resumed.getGoals()).toEqual(phase1Registry.getGoals());
        for (const goal of phase1Registry.getGoals()) {
          expect(resumed.getLatestVerdict(goal.id)).toEqual(
            phase1Registry.getLatestVerdict(goal.id),
          );
          expect(resumed.getGapHistory(goal.id)).toEqual(
            phase1Registry.getGapHistory(goal.id),
          );
        }
        expect(resumed.getProposals()).toEqual(phase1Registry.getProposals());
        expect(resumed.getPendingOffer()).toEqual(phase1Registry.getPendingOffer());
      } finally {
        if (activeSimulations(phase2.runtime).has(phase2.simulationId)) {
          await phase2.runtime.stop(phase2.simulationId);
        }
        await phase2.close();
      }
    },
    30_000,
  );

  it(
    "LLM mid-run: the self-verdict junction written by the deluded achiever survives the restart",
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), "goal-restart-"));
      const dbPath = join(tmpDir, "sim.sqlite");
      const resolveGoalId = `crystal-${AGENT_ID}-resolve-${CHANNEL_ID}`;

      // Phase 1: hand-wired runtime over the four sqlite repos (BEN pattern).
      // The deluded achiever never self-terminates, so only this test stops
      // the run — the junction is populated mid-run with the story open.
      const db1 = openDatabase(dbPath);
      const eventRepo1 = new SqliteEventRepository(db1);
      const agentStateRepo1 = new SqliteAgentStateRepository(db1);
      const simRepo1 = new SqliteSimulationRepository(db1);
      const channelRepo1 = new SqliteChannelRepository(db1);
      const runtime1 = new SimulationRuntime({
        delivery: new MockDeliveryGateway(),
        agentRuntime: noOpAgentRuntime,
        llmBudget: new LLMBudgetTracker(),
        repositories: {
          eventRepo: eventRepo1,
          agentStateRepo: agentStateRepo1,
          simRepo: simRepo1,
          channelRepo: channelRepo1,
        },
      });
      const registry1 = new GoalRegistry();
      const evalConfig = resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        synthesizer: {
          mode: "llm",
          intervalPulses: 1,
          maxCandidatesPerReview: 10,
          maxSelfVerdictsPerReview: 3,
        },
      });
      const evaluator1 = new WorldEvaluator(
        eventRepo1,
        agentStateRepo1,
        new ChannelRegistry(channelRepo1),
        registry1,
        evalConfig,
        {
          simulationId: SIM_ID,
          llmConfigs: new Map([
            [AGENT_ID, MOCK_LLM],
            [BEN_ID, MOCK_LLM],
          ]),
          budget: new LLMBudgetTracker(),
          clientFactory,
        },
        new SqliteGoalRegistryRepository(db1),
      );
      await runtime1.createSimulation({
        id: SIM_ID,
        name: "Deluded Restart E2E",
        seed: 7,
        settings: LLM_SETTINGS,
        agentContexts: [
          { id: AGENT_ID, state: makeAgentState(AGENT_ID), persona: makePersona(AGENT_ID, "Ana") },
          { id: BEN_ID, state: makeAgentState(BEN_ID), persona: makePersona(BEN_ID, "Ben") },
        ],
        channels: [{
          id: CHANNEL_ID,
          type: "public_channel",
          name: "general",
          default: true,
          memberAgentIds: [AGENT_ID, BEN_ID],
        }],
        goalLayer: { config: evalConfig, evaluator: evaluator1 },
      });
      await runtime1.getEventLog().append(SIM_ID, [1, 2, 3].map(blockedEvent));
      await runtime1.getEventLog().append(SIM_ID, [makeRidiculeEvent()]);

      let junctionReached = false;
      try {
        // Pulse 0 is review-exempt; drive it first so reviews run on the
        // pulses below. A fresh witnessed event per review keeps a next goal
        // pending, so the deluded arc stays on the re_goal branch.
        await runtime1.runPulse(SIM_ID);
        for (let pulse = 1; pulse <= 8; pulse += 1) {
          await runtime1.getEventLog().append(SIM_ID, [makeWitnessedEvent(pulse)]);
          await runtime1.runPulse(SIM_ID);
          if (registry1.getSelfVerdict(resolveGoalId)?.verdict.claim === "reached") {
            junctionReached = true;
            break;
          }
        }

        // The deluded mid-run state the restart must preserve: LLM belief
        // reached, world machine disagrees, run still open.
        expect(junctionReached).toBe(true);
        expect(registry1.getSelfVerdict(resolveGoalId)?.verdict.claim).toBe("reached");
        expect(registry1.getLatestVerdict(resolveGoalId)?.determination).toBe("not_reached");
        expect(activeSimulations(runtime1).has(SIM_ID)).toBe(true);
      } finally {
        if (activeSimulations(runtime1).has(SIM_ID)) {
          await runtime1.stop(SIM_ID);
        }
        closeDatabase(db1);
      }

      // Phase 2: reopen the file and attach (T412) — a plain second create
      // hits the simulations.id PK; attachExisting routes around it.
      const db2 = openDatabase(dbPath);
      const eventRepo2 = new SqliteEventRepository(db2);
      const agentStateRepo2 = new SqliteAgentStateRepository(db2);
      const simRepo2 = new SqliteSimulationRepository(db2);
      const channelRepo2 = new SqliteChannelRepository(db2);
      const runtime2 = new SimulationRuntime({
        delivery: new MockDeliveryGateway(),
        agentRuntime: noOpAgentRuntime,
        llmBudget: new LLMBudgetTracker(),
        repositories: {
          eventRepo: eventRepo2,
          agentStateRepo: agentStateRepo2,
          simRepo: simRepo2,
          channelRepo: channelRepo2,
        },
      });
      try {
        const createParams = {
          id: SIM_ID,
          name: "Deluded Restart E2E",
          seed: 7,
          settings: LLM_SETTINGS,
          agentContexts: [
            { id: AGENT_ID, state: makeAgentState(AGENT_ID), persona: makePersona(AGENT_ID, "Ana") },
            { id: BEN_ID, state: makeAgentState(BEN_ID), persona: makePersona(BEN_ID, "Ben") },
          ],
          channels: [{
            id: CHANNEL_ID,
            type: "public_channel",
            name: "general",
            default: true,
            memberAgentIds: [AGENT_ID, BEN_ID],
          }],
          attachExisting: true,
        };
        await runtime2.createSimulation(createParams);

        // Rebuilt registry = replay + the persisted junction overlay (the
        // factory's buildGoalLayerRuntime does the same restore internally).
        const logAfter = await eventRepo2.getCommittedThrough(
          SIM_ID,
          Number.MAX_SAFE_INTEGER,
        );
        const registry2 = new GoalRegistry(logAfter);
        const goalRepo2 = new SqliteGoalRegistryRepository(db2);
        for (const entry of await goalRepo2.loadSelfVerdicts(SIM_ID)) {
          if (!registry2.getGoal(entry.goalId)) continue;
          registry2.recordSelfVerdict(entry.goalId, entry.verdict, entry.source);
        }
        expect(registry2.getGoals()).toEqual(registry1.getGoals());
        expect(registry2.getLatestVerdict(resolveGoalId)).toEqual(
          registry1.getLatestVerdict(resolveGoalId),
        );
        expect(registry2.getGapHistory(resolveGoalId)).toEqual(
          registry1.getGapHistory(resolveGoalId),
        );
        expect(registry2.getSelfVerdict(resolveGoalId)).toEqual(
          registry1.getSelfVerdict(resolveGoalId),
        );
        expect(registry2.getPendingOffer()).toEqual(registry1.getPendingOffer());
      } finally {
        closeDatabase(db2);
      }
    },
    30_000,
  );
});

function makeAgentState(agentId: string): AgentState {
  return {
    agentId,
    simulationId: SIM_ID,
    personaId: agentId,
    presence: "active",
    coreMood: {
      valence: 0,
      arousal: 0.5,
      stability: 0.8,
      energy: 0.6,
      circumplexAngle: 0,
      circumplexRadius: 0.5,
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
      resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0,
      socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
    },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makePersona(id: string, name: string): PersonaConfig {
  return {
    id,
    name,
    archetype: "observer",
    writingStyle: "brief and careful",
    styleExamples: [],
    baselineValence: 0,
    baselineArousal: 0.5,
    baselineStability: 0.8,
    baselineEnergy: 0.6,
    emotionalReactivity: 0.5,
    moodInertia: 0.5,
    maxMoodRotation: 0.5,
    energyRegen: 0.05,
    exclusionSensitivity: 0.5,
    praiseSensitivity: 0.5,
    conflictSensitivity: 0.5,
    boredomSensitivity: 0.5,
    intimacySensitivity: 0.5,
    socialSensitivities: {},
  };
}

function makeNoOpIntent(actorId: string): ActionIntent {
  return {
    id: createId(),
    actorId,
    intentType: "no_op",
    personTargets: [],
    privateMotiveSummary: "nothing to do",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

/** Canned agent runtime: every LLM decision resolves to a no-op, so the goal
 *  call class is the only budget consumer in these drives. */
const noOpAgentRuntime: AgentRuntime = {
  async generateIntent(input: AgentRuntimeInput): Promise<AgentRuntimeOutput> {
    return {
      intent: makeNoOpIntent(input.agentId),
      llmUsage: null,
      latencyMs: 5,
      fallbackApplied: false,
      operatorEvents: [],
    };
  },
};

function makeWitnessedEvent(index: number): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: `ch_w${index}`,
    actorId: BEN_ID,
    type: "message_sent",
    payload: { content: "the storm passed quickly" },
    sourceEventIds: [],
    emotionalSalience: "high",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function makeRidiculeEvent(): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: BEN_ID,
    type: "reaction_sent",
    payload: { emoji: "👎", targetEventId: "seed-1" },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

/** Deluded canned outcome: a genuine LLM "reached" claim for every active goal (D-19/D-23). */
function deludedLlmOutcome(input: GoalLayerCallInput): GoalLayerLLMOutcome {
  return {
    result: {
      proposals: input.candidates.map((candidate) => ({
        proposal: candidate,
        narrativeFraming: `${candidate.title} — ${candidate.targetState.description}`,
        confidence: 0.8,
        synthesizer: "llm" as const,
      })),
      selfVerdicts: input.activeGoals.map((goal) => ({
        agentId: goal.agentId,
        goalId: goal.id,
        claim: "reached" as const,
        confidence: 1,
        feltSignal: 0.8,
        narrative: `${goal.title}: reached`,
      })),
    },
    operatorEvents: [],
  };
}

const clientFactory: GoalLayerClientFactory = (params) => {
  const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
  caller.call = async (input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> =>
    deludedLlmOutcome(input);
  return caller;
};