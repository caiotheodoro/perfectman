/**
 * HTML Receiver Parity E2E (SC-002 / D-8)
 *
 * One seeded mock run (PersonaAwareRuntime wrapper, both sides) driving a
 * recorder-style capture AND the production HtmlSnapshotGateway receiver in
 * the same composite delivery: the receiver must derive the same replay the
 * recorder-style capture does, normalized per D-8:
 *   (a) per-pulse event-type→actor summaries (event_visibility vs committedEvents)
 *   (b) serialized agent states byte-equal (shared serializer, D-4)
 *   (c) thinking derived from `action_intent` events only — never compared
 *       against the recorder's stale last-known `agentThinking` wholesale
 *   (d) channels restricted to the static scenario ids
 *
 * The capture loop mirrors SimulationRecorder.runOnePulse exactly (the
 * recorder's handle is private, so the parity harness replicates its
 * formulas; the recorder itself stays the reference of html-snapshot.e2e).
 * The comparison is deterministic: seeded mock, no real LLM.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConfiguredSimulation,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "../config/simulation-config.js";
import { MockDeliveryGateway } from "../delivery/mock-delivery-gateway.js";
import { HtmlSnapshotGateway } from "../delivery/html-snapshot-gateway.js";
import { PersonaAwareRuntime } from "./persona-aware-runtime.js";
import { FOUR_PERSONA_CONFIG } from "./4-persona-scenario.js";
import { serializeAgentState, type SerializedAgentState } from "../agent/agent-state-serializer.js";
import { generateHtml } from "../html/snapshot-html-generator.js";
import type { AgentThinking, PulseFrame, SimulationReplay } from "../html/replay-types.js";
import type { ActionIntent, OperatorEvent } from "@perfectman/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../../../../tmp/perfectman-receiver-parity.html");
const PULSE_COUNT = parseInt(process.env["PULSE_COUNT"] ?? "15", 10);

const PARITY_CONFIG: SimulationAppConfig = {
  ...FOUR_PERSONA_CONFIG,
  deliveryGateways: [
    { id: "mock", type: "mock" },
    { id: "html", type: "html-snapshot", outputPath: OUTPUT_PATH },
  ],
};

const STATIC_CHANNEL_IDS = new Set(FOUR_PERSONA_CONFIG.channels.map((c) => c.id));

// ── Recorder-style helpers (mirror SimulationRecorder's formulas) ─────────────

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

function thinkingFromIntentEvent(event: OperatorEvent): AgentThinking | null {
  if (!event.agentId) return null;
  const data = event.data ?? {};
  const visibleContent = data["visibleContent"];
  return {
    agentId: event.agentId,
    intentType: typeof data["intentType"] === "string" ? data["intentType"] : "",
    visibleContent: typeof visibleContent === "string" ? visibleContent : undefined,
    privateMotiveSummary:
      typeof data["privateMotiveSummary"] === "string" ? data["privateMotiveSummary"] : "",
    emotionDrivers: Array.isArray(data["emotionDrivers"])
      ? data["emotionDrivers"].filter((d): d is string => typeof d === "string")
      : [],
    motivationDrivers: Array.isArray(data["motivationDrivers"])
      ? data["motivationDrivers"].filter((d): d is string => typeof d === "string")
      : [],
  };
}

function eventSummary(frame: PulseFrame): Record<string, string[]> {
  const byActor: Record<string, string[]> = {};
  for (const e of frame.committedEvents) {
    (byActor[e.actorId] ??= []).push(e.type);
  }
  for (const types of Object.values(byActor)) types.sort();
  return byActor;
}

function recorderStyleReplay(
  config: SimulationAppConfig,
  simulationId: string,
  pulses: PulseFrame[],
): SimulationReplay {
  const agentNames: Record<string, string> = {};
  const agentArchetypes: Record<string, string> = {};
  for (const agent of config.agents) {
    agentNames[agent.id] = agent.persona.name;
    agentArchetypes[agent.id] = agent.persona.archetype;
  }
  return {
    simulationId,
    simulationName: config.simulation.name,
    agentIds: config.agents.map((a) => a.id),
    agentNames,
    agentArchetypes,
    channels: config.channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      memberAgentIds: c.memberAgentIds,
    })),
    pulses,
  };
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("html receiver parity (SC-002)", () => {
  let handle: ConfiguredSimulationHandle;
  let gateway: MockDeliveryGateway;
  let receiver: HtmlSnapshotGateway;
  let recorderReplay: SimulationReplay;
  let receiverReplay: SimulationReplay;

  beforeAll(async () => {
    let personaRuntime: PersonaAwareRuntime | undefined;
    handle = await buildConfiguredSimulation(PARITY_CONFIG, {
      agentRuntimeFactory: (registry) => {
        personaRuntime = new PersonaAwareRuntime(registry);
        return personaRuntime;
      },
    });
    const gw = handle.gateways["mock"];
    if (!(gw instanceof MockDeliveryGateway)) throw new Error("parity config must create a mock gateway");
    gateway = gw;
    const html = handle.gateways["html"];
    if (!(html instanceof HtmlSnapshotGateway)) throw new Error("parity config must create an html-snapshot gateway");
    receiver = html;
    gateway.reset();

    const pulses: PulseFrame[] = [];
    let lastEventId: string | undefined = undefined;
    for (let i = 0; i < PULSE_COUNT; i++) {
      const preOpCount = gateway.operatorEvents.length;
      const result = await handle.runtime.runPulse(handle.simulationId);

      const newEvents = await handle.repositories.eventRepo.getAfter(handle.simulationId, lastEventId);
      if (newEvents.length > 0) lastEventId = newEvents[newEvents.length - 1]!.id;

      const agentStates: Record<string, SerializedAgentState> = {};
      for (const agent of PARITY_CONFIG.agents) {
        const state = await handle.repositories.agentStateRepo.get(handle.simulationId, agent.id);
        if (state) agentStates[agent.id] = serializeAgentState(state);
      }

      const agentThinking: Record<string, AgentThinking> = {};
      for (const [agentId, intent] of personaRuntime!.lastIntents.entries()) {
        agentThinking[agentId] = intentToThinking(agentId, intent);
      }

      pulses.push({
        pulseIndex: result.pulseIndex,
        result,
        committedEvents: newEvents,
        agentStates,
        agentThinking,
        operatorEvents: gateway.operatorEvents.slice(preOpCount),
      });
    }

    recorderReplay = recorderStyleReplay(PARITY_CONFIG, handle.simulationId, pulses);
    await handle.runtime.stop(handle.simulationId); // flushes the receiver artifact
    receiverReplay = receiver.toReplay();
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("runs the same scenario for the recorder-style capture and the receiver", () => {
    expect(receiverReplay.pulses).toHaveLength(PULSE_COUNT);
    expect(recorderReplay.pulses).toHaveLength(PULSE_COUNT);
    expect(receiverReplay.simulationName).toBe(recorderReplay.simulationName);
    expect(receiverReplay.agentIds).toEqual(recorderReplay.agentIds);
    expect(receiverReplay.agentNames).toEqual(recorderReplay.agentNames);
    expect(receiverReplay.agentArchetypes).toEqual(recorderReplay.agentArchetypes);
    // The receiver sees the full stream: same operator events, same order.
    for (let i = 0; i < PULSE_COUNT; i++) {
      expect(receiverReplay.pulses[i]!.operatorEvents).toEqual(recorderReplay.pulses[i]!.operatorEvents);
    }
  });

  it("matches per-pulse event-type→actor summaries (event_visibility vs committedEvents)", () => {
    for (let i = 0; i < PULSE_COUNT; i++) {
      expect(eventSummary(receiverReplay.pulses[i]!)).toEqual(eventSummary(recorderReplay.pulses[i]!));
    }
  });

  it("produces byte-equal serialized agent states per pulse", () => {
    for (let i = 0; i < PULSE_COUNT; i++) {
      expect(receiverReplay.pulses[i]!.agentStates).toEqual(recorderReplay.pulses[i]!.agentStates);
    }
  });

  it("derives thinking from the action_intent events, never from stale recorder thinking", () => {
    for (let i = 0; i < PULSE_COUNT; i++) {
      const recorderFrame = recorderReplay.pulses[i]!;
      const receiverFrame = receiverReplay.pulses[i]!;

      const intentMap: Record<string, AgentThinking> = {};
      for (const opEv of recorderFrame.operatorEvents) {
        if (opEv.type !== "action_intent") continue;
        const thinking = thinkingFromIntentEvent(opEv);
        if (thinking) intentMap[thinking.agentId] = thinking;
      }

      // Receiver thinking == intent-event derivation for this pulse only.
      // (No fixture-adequacy counter for divergent frames: with participant
      // identifiers on committed events, every agent in this canned room
      // stays attentive every pulse, so the recorder's last-known map never
      // diverges from any pulse's intent map.)
      expect(receiverFrame.agentThinking).toEqual(intentMap);
    }
  });

  it("restricts receiver channels to the static scenario ids (dynamic normalized)", () => {
    const receiverStatic = receiverReplay.channels
      .filter((c) => STATIC_CHANNEL_IDS.has(c.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const recorderChannels = [...recorderReplay.channels].sort((a, b) => a.id.localeCompare(b.id));
    expect(receiverStatic.map((c) => ({ id: c.id, name: c.name, type: c.type }))).toEqual(
      recorderChannels.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    );
    // Any extra channels are dynamic ones created mid-run: their ids are not
    // in the static set and their names fall back to the id (no metadata).
    const dynamicChannels = receiverReplay.channels.filter((c) => !STATIC_CHANNEL_IDS.has(c.id));
    for (const channel of dynamicChannels) {
      expect(channel.name).toBe(channel.id);
    }
  });

  it("approximates PulseFrame.result from the stream (D-9)", () => {
    for (let i = 0; i < PULSE_COUNT; i++) {
      const receiverFrame = receiverReplay.pulses[i]!;
      const recorderFrame = recorderReplay.pulses[i]!;
      // eventsCommitted: one event_visibility per committed event — equals the scheduler counter.
      expect(receiverFrame.result.eventsCommitted).toBe(recorderFrame.result.eventsCommitted);
      expect(receiverFrame.result.eventsCommitted).toBe(receiverFrame.committedEvents.length);
      // agentsCalled: distinct action_intent agents — healthy run resolves every call.
      expect(receiverFrame.result.agentsCalled).toBe(recorderFrame.result.agentsCalled);
      expect(receiverFrame.result.pulseIndex).toBe(recorderFrame.result.pulseIndex);
    }
  });

  it("writes the artifact and renders the four persona names on both paths", async () => {
    expect(existsSync(OUTPUT_PATH)).toBe(true);
    const receiverHtml = generateHtml(receiverReplay);
    for (const name of ["Ana", "Bruno", "Carla", "Diego"]) {
      expect(receiverHtml).toContain(name);
      expect(generateHtml(recorderReplay)).toContain(name);
    }
  });
});