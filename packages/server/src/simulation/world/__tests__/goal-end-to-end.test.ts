import { describe, expect, it } from "vitest";
import type { CommittedEvent, SimulationEvent } from "@perfectman/shared";
import type { SimulationRuntime } from "../../simulation-runtime.js";
import {
  buildConfiguredSimulation,
  parseSimulationConfig,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "../../../config/simulation-config.js";

type RuntimeWithActiveSims = SimulationRuntime & { active: Map<string, unknown> };
function activeSimulationIds(runtime: SimulationRuntime): Map<string, unknown> {
  return (runtime as RuntimeWithActiveSims).active;
}

const SIM_ID = "sim_goal_e2e";
const CHANNEL_ID = "general";
const AGENT_ID = "ana";

const SEQUENCE = [
  "goal_proposed",
  "goal_accepted",
  "world_verdict",
  "delusion_gap_sampled",
  "ending_offered",
  "simulation_stopped",
] as const;

function makeConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: SIM_ID,
      name: "Goal Layer E2E",
      seed: 42,
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 100,
        pulseIntervalMs: 1000,
        tokenBudgetPerHour: 1_000_000,
      },
    },
    persistence: { type: "memory" },
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
      llm: {
        providerType: "mock",
        modelName: "mock-model",
        maxInputTokens: 2048,
        maxOutputTokens: 512,
        temperature: 0.7,
        timeoutMs: 5000,
        retryCount: 1,
      },
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

async function waitForEnd(
  handle: ConfiguredSimulationHandle,
  timeoutMs: number,
): Promise<CommittedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = await handle.repositories.eventRepo.getCommittedThrough(
      handle.simulationId,
      Number.MAX_SAFE_INTEGER,
    );
    const stopped = log.find((event) => event.type === "simulation_stopped");
    const active = activeSimulationIds(handle.runtime);
    if (stopped && !active.has(handle.simulationId)) return stopped;
    if (Date.now() > deadline) {
      throw new Error(
        `goal-layer e2e timeout: simulation_stopped not committed within ${timeoutMs}ms for ${handle.simulationId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("goal layer end-to-end", () => {
  it(
    "crystallizes a resolve goal from seeded blocked intents, reviews it, and stops with endReason + epilogue",
    async () => {
      const handle = await buildConfiguredSimulation(makeConfig());
      try {
        const seeds: SimulationEvent[] = [1, 2, 3].map(blockedEvent);
        await handle.runtime.getEventLog().append(handle.simulationId, seeds);
        await handle.runtime.start(handle.simulationId);

        const stopped = await waitForEnd(handle, 15_000);
        const log = await handle.repositories.eventRepo.getCommittedThrough(
          handle.simulationId,
          Number.MAX_SAFE_INTEGER,
        );

        const indexOf = (type: string): number =>
          log.findIndex((event) => event.type === type);

        for (let i = 1; i < SEQUENCE.length; i++) {
          expect(indexOf(SEQUENCE[i]!)).toBeGreaterThan(indexOf(SEQUENCE[i - 1]!));
        }

        const goalProposed = log.find((event) => event.type === "goal_proposed")!;
        expect(goalProposed.payload["synthesizer"]).toBe("deterministic");
        expect(typeof goalProposed.payload["narrativeFraming"]).toBe("string");
        expect((goalProposed.payload["narrativeFraming"] as string).length).toBeGreaterThan(0);
        expect(goalProposed.payload["confidence"]).toBe(1);
        const proposal = goalProposed.payload["proposal"] as { id?: string };
        expect(proposal?.id).toMatch(/^crystal-ana-resolve-general/);
        expect(goalProposed.visibility.visibleToAgents).toContain(AGENT_ID);
        expect(goalProposed.visibility.visibleToSpectators).toBe(true);

        for (const type of ["world_verdict", "delusion_gap_sampled"]) {
          const events = log.filter((event) => event.type === type);
          expect(events.length).toBeGreaterThan(0);
          for (const event of events) {
            expect(event.pulseIndex).toBeGreaterThanOrEqual(1);
            expect(event.createdAt).toBeGreaterThan(0);
          }
        }

        expect(stopped.payload["endReason"]).toBe("goal_end_offered");
        const offer = stopped.payload["endingOffer"] as {
          epilogue?: string;
          reasons?: string[];
          status?: string;
          goalId?: string;
        };
        expect(typeof offer?.goalId).toBe("string");
        expect((offer?.epilogue ?? "").length).toBeGreaterThan(0);
        expect(offer?.status).toBe("pending");
        // Pinned branch: the story-holds ending (world verdict reached + beat
        // + meaning) — the plateau epilogue would flag a regression to the
        // degraded ending path.
        expect(offer?.epilogue).toContain("the story holds");
        expect(offer?.reasons).toContain("world verdict: reached");

        const active = activeSimulationIds(handle.runtime);
        expect(active.has(handle.simulationId)).toBe(false);
      } finally {
        const active = activeSimulationIds(handle.runtime);
        if (active.has(handle.simulationId)) {
          await handle.runtime.stop(handle.simulationId);
        }
        await handle.close();
      }
    },
    20_000,
  );
});