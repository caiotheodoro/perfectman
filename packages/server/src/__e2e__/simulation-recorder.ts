/**
 * SimulationRecorder — captures per-pulse data for the HTML snapshot viewer.
 *
 * After each runPulse():
 *  - Snapshots all agent states (Map<> serialized to plain object)
 *  - Collects new committed events from eventRepo
 *  - Collects operator events from MockDeliveryGateway
 *  - Captures the last ActionIntent per agent (for "thinking" panels)
 */
import type {
  ActionIntent,
  SimulationEvent,
} from "@perfectman/shared";
import { serializeAgentState, type SerializedAgentState } from "../agent/agent-state-serializer.js";
export type { SerializedAgentState };
import type {
  AgentThinking,
  PulseFrame,
  SimulationReplay,
} from "../html/replay-types.js";
export type { AgentThinking, PulseFrame, SimulationReplay };
import type {
  SimulationAppConfig,
  ConfiguredSimulationHandle,
} from "../config/simulation-config.js";
import { buildConfiguredSimulation } from "../config/simulation-config.js";
import { MockDeliveryGateway } from "../delivery/mock-delivery-gateway.js";
import { PersonaAwareRuntime } from "./persona-aware-runtime.js";

// ── Recorder ─────────────────────────────────────────────────────────────────

export class SimulationRecorder {
  private handle!: ConfiguredSimulationHandle;
  private gateway!: MockDeliveryGateway;
  private personaRuntime!: PersonaAwareRuntime;
  private lastEventId: string | undefined = undefined;
  private pulses: PulseFrame[] = [];

  constructor(private readonly config: SimulationAppConfig) {}

  async init(): Promise<void> {
    this.handle = await buildConfiguredSimulation(this.config, {
      agentRuntimeFactory: (registry) => {
        this.personaRuntime = new PersonaAwareRuntime(registry);
        return this.personaRuntime;
      },
    });

    const gw = this.handle.gateways["mock"];
    if (!(gw instanceof MockDeliveryGateway)) {
      throw new Error("SimulationRecorder requires a mock delivery gateway (id: 'mock')");
    }
    this.gateway = gw;
    this.gateway.reset();

    if (this.config.hostStartingMessage) {
      const defaultChannel = this.config.channels.find((c) => c.default) ?? this.config.channels[0];
      if (defaultChannel) {
        await this.injectHostMessage(this.config.hostStartingMessage, defaultChannel.id);
      }
    }
  }

  private async injectHostMessage(message: string, channelId: string): Promise<void> {
    const allAgentIds = this.config.agents.map((a) => a.id);
    const event: SimulationEvent = {
      simulationId: this.handle.simulationId,
      channelId,
      actorId: "host",
      type: "message_sent",
      payload: { content: message },
      sourceIntentId: "host-seed",
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: -1,
      visibility: {
        visibleToAgents: allAgentIds,
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "public",
      },
    };
    const committed = await this.handle.repositories.eventRepo.append(
      this.handle.simulationId,
      [event],
    );
    if (committed.length > 0) {
      this.lastEventId = committed[committed.length - 1]!.id;
    }
  }

  async runPulses(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.runOnePulse();
    }
  }

  private async runOnePulse(): Promise<void> {
    // Snapshot operator event count before this pulse
    const preOpCount = this.gateway.operatorEvents.length;

    // Reset last intents so we can detect which agents were called this pulse
    const agentIdsBefore = new Set(this.personaRuntime.lastIntents.keys());

    const result = await this.handle.runtime.runPulse(this.handle.simulationId);

    // ── Collect new committed events ──────────────────────────────────────────
    const newEvents = await this.handle.repositories.eventRepo.getAfter(
      this.handle.simulationId,
      this.lastEventId,
    );
    if (newEvents.length > 0) {
      this.lastEventId = newEvents[newEvents.length - 1]!.id;
    }

    // ── Snapshot agent states ─────────────────────────────────────────────────
    const agentStates: Record<string, SerializedAgentState> = {};
    for (const agentConfig of this.config.agents) {
      const state = await this.handle.repositories.agentStateRepo.get(
        this.handle.simulationId,
        agentConfig.id,
      );
      if (state) {
        agentStates[agentConfig.id] = serializeAgentState(state);
      }
    }

    // ── Capture thinking (intents that changed this pulse) ────────────────────
    const agentThinking: Record<string, AgentThinking> = {};
    for (const [agentId, intent] of this.personaRuntime.lastIntents.entries()) {
      // Include thinking for all agents that have a recorded intent
      agentThinking[agentId] = intentToThinking(agentId, intent);
    }

    // ── Collect operator events since last pulse ───────────────────────────────
    const operatorEvents = this.gateway.operatorEvents.slice(preOpCount);

    this.pulses.push({
      pulseIndex: result.pulseIndex,
      result,
      committedEvents: newEvents,
      agentStates,
      agentThinking,
      operatorEvents,
    });
  }

  getReplay(): SimulationReplay {
    const agentNames: Record<string, string> = {};
    const agentArchetypes: Record<string, string> = {};
    for (const agent of this.config.agents) {
      agentNames[agent.id] = agent.persona.name;
      agentArchetypes[agent.id] = agent.persona.archetype;
    }

    return {
      simulationId: this.handle.simulationId,
      simulationName: this.config.simulation.name,
      agentIds: this.config.agents.map((a) => a.id),
      agentNames,
      agentArchetypes,
      channels: this.config.channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        memberAgentIds: c.memberAgentIds,
      })),
      pulses: this.pulses,
    };
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function intentToThinking(agentId: string, intent: ActionIntent): AgentThinking {
  return {
    agentId,
    intentType: intent.intentType,
    visibleContent: intent.visibleContent,
    privateMotiveSummary: intent.privateMotiveSummary,
    emotionDrivers: intent.emotionDrivers ?? [],
    motivationDrivers: intent.motivationDrivers ?? [],
  };
}
