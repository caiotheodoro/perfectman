import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HtmlSnapshotGateway } from "../html-snapshot-gateway.js";
import { generateHtml } from "../../html/snapshot-html-generator.js";
import type { GatewayRuntimeMetadata } from "../../config/simulation-config.js";
import type { SerializedAgentState } from "../../agent/agent-state-serializer.js";
import type { OperatorEvent } from "@perfectman/shared";

const META: GatewayRuntimeMetadata = {
  simulationId: "sim_rcv",
  simulationName: "Receiver Test",
  agents: {
    ana: { name: "Ana", archetype: "observer" },
    bruno: { name: "Bruno", archetype: "observer" },
  },
  channels: {
    general: { name: "general" },
    "ana-carla": { name: "ana ↔ carla" },
  },
};

const SOCIAL_ZERO = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0,
  neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0,
  desireForIntimacy: 0,
};

function state(agentId: string): SerializedAgentState {
  return {
    agentId,
    simulationId: "sim_rcv",
    personaId: `persona_${agentId}`,
    presence: "active",
    coreMood: { valence: 0.1, arousal: 0.4, stability: 0.7, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.4, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { ...SOCIAL_ZERO, pride: 0.2 },
    relationalStates: {},
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(agentId: string, pulseIndex: number): OperatorEvent {
  return {
    type: "agent_state_snapshot",
    simulationId: "sim_rcv",
    agentId,
    pulseIndex,
    detail: "Agent state snapshot",
    data: { state: state(agentId) },
    createdAt: 1,
  };
}

function intent(agentId: string, pulseIndex: number): OperatorEvent {
  return {
    type: "action_intent",
    simulationId: "sim_rcv",
    agentId,
    pulseIndex,
    detail: "Action intent",
    data: {
      intentType: "send_message",
      visibleContent: "oi gente",
      privateMotiveSummary: "Preciso marcar presença sem chamar atenção.",
      emotionDrivers: ["curiosity"],
      motivationDrivers: ["connection"],
    },
    createdAt: 1,
  };
}

function visibility(eventId: string, pulseIndex: number, type: string, extra: Record<string, unknown> = {}): OperatorEvent {
  const actorId = typeof extra["actorId"] === "string" ? extra["actorId"] : "ana";
  const channelId = typeof extra["channelId"] === "string" ? extra["channelId"] : "general";
  const visibleToAgents = Array.isArray(extra["visibleToAgents"])
    ? extra["visibleToAgents"].filter((x): x is string => typeof x === "string")
    : [];
  const content = typeof extra["content"] === "string" ? extra["content"] : undefined;
  const channelName = typeof extra["channelName"] === "string" ? extra["channelName"] : undefined;
  return {
    type: "event_visibility",
    simulationId: "sim_rcv",
    agentId: actorId,
    pulseIndex,
    detail: `Event visibility: ${type}`,
    data: {
      eventId,
      eventType: type,
      actorId,
      channelId,
      visibleToAgents,
      content,
      channelName,
    },
    createdAt: 1,
  };
}

describe("HtmlSnapshotGateway (stream-fed receiver)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** Fresh gateway pre-created with the two metadata channels. */
  function buildGateway(): { gw: HtmlSnapshotGateway; outputPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "perfectman-html-gw-"));
    dirs.push(dir);
    const outputPath = join(dir, "out", "snapshot.html");
    const gw = new HtmlSnapshotGateway(META, outputPath);
    void gw.createChannel("general", "public_channel", ["ana", "bruno"]);
    void gw.createChannel("ana-carla", "private_channel", ["ana", "bruno"]);
    return { gw, outputPath };
  }

  it("builds a replay from the delivered stream and flushes the artifact on stop", async () => {
    const { gw, outputPath } = buildGateway();
    // Delivery messages are redundant for this receiver — content rides in event_visibility.
    void gw.sendAgentMessage("general", { kind: "message", agentId: "ana", content: "oi", salience: "low" });

    await gw.sendOperatorEvent(snapshot("ana", 0));
    await gw.sendOperatorEvent(snapshot("bruno", 0));
    await gw.sendOperatorEvent(intent("ana", 0));
    await gw.sendOperatorEvent(visibility("ev_m1", 0, "message_sent", { content: "oi gente" }));
    await gw.sendOperatorEvent(visibility("ev_noop", 0, "no_op_recorded", { actorId: "bruno", visibleToAgents: [] }));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.simulationId).toBe("sim_rcv");
    expect(replay.simulationName).toBe("Receiver Test");
    expect(replay.agentIds).toEqual(["ana", "bruno"]);
    expect(replay.agentNames).toEqual({ ana: "Ana", bruno: "Bruno" });
    expect(replay.agentArchetypes).toEqual({ ana: "observer", bruno: "observer" });

    expect(replay.channels).toEqual([
      { id: "general", name: "general", type: "public_channel", memberAgentIds: ["ana", "bruno"] },
      { id: "ana-carla", name: "ana ↔ carla", type: "private_channel", memberAgentIds: ["ana", "bruno"] },
    ]);
    expect(replay.pulses).toHaveLength(1);

    const frame = replay.pulses[0]!;
    expect(frame.pulseIndex).toBe(0);
    expect(Object.keys(frame.agentStates).sort()).toEqual(["ana", "bruno"]);
    expect(frame.agentStates["ana"]).toEqual(state("ana"));
    expect(frame.committedEvents.map((e) => e.type)).toEqual(["message_sent", "no_op_recorded"]);
    const messageRow = frame.committedEvents[0]!;
    expect(messageRow.id).toBe("ev_m1");
    expect(messageRow.actorId).toBe("ana");
    expect(messageRow.channelId).toBe("general");
    expect(messageRow.payload["content"]).toBe("oi gente");
    expect(messageRow.visibility.visibleToAgents).toEqual([]);
    const noOpRow = frame.committedEvents[1]!;
    expect(noOpRow.actorId).toBe("bruno");
    expect(noOpRow.visibility.visibleToAgents).toEqual([]);

    expect(frame.agentThinking["ana"]).toEqual({
      agentId: "ana",
      intentType: "send_message",
      visibleContent: "oi gente",
      privateMotiveSummary: "Preciso marcar presença sem chamar atenção.",
      emotionDrivers: ["curiosity"],
      motivationDrivers: ["connection"],
    });
    expect(frame.result.eventsCommitted).toBe(2);
    expect(frame.result.agentsCalled).toBe(1);

    // Artifact flushed on stop: file exists, rendered names + thinking present.
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Ana");
    expect(html).toContain("Bruno");
    expect(html).toContain("Preciso marcar presença sem chamar atenção.");
  });

  it("keeps the partial frame when stopped mid-pulse", async () => {
    const { gw } = buildGateway();
    await gw.sendOperatorEvent(snapshot("ana", 0));
    await gw.sendOperatorEvent(snapshot("bruno", 0));
    await gw.sendOperatorEvent(visibility("ev_1", 0, "message_sent", { content: "first" }));
    // Pulse 1 interrupted: only one snapshot and one intent delivered.
    await gw.sendOperatorEvent(snapshot("ana", 1));
    await gw.sendOperatorEvent(intent("ana", 1));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.pulses).toHaveLength(2);
    expect(replay.pulses[0]!.committedEvents).toHaveLength(1);
    expect(replay.pulses[1]!.committedEvents).toHaveLength(0);
    expect(replay.pulses[1]!.agentStates).toEqual({ ana: state("ana") });
    expect(replay.pulses[1]!.agentThinking).toHaveProperty("ana");
  });

  it("creates an empty replay when stopped before any pulse", async () => {
    const { gw } = buildGateway();
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.pulses).toEqual([]);
    expect(replay.channels).toHaveLength(2);
    expect(replay.agentIds).toEqual(["ana", "bruno"]);
  });

  it("keeps a frame with only snapshots empty of committed events", async () => {
    const { gw } = buildGateway();
    await gw.sendOperatorEvent(snapshot("ana", 2));
    await gw.sendOperatorEvent(snapshot("bruno", 2));
    await gw.onSimulationStopped("sim_rcv");

    const frame = gw.toReplay().pulses[0]!;
    expect(frame.pulseIndex).toBe(2);
    expect(frame.committedEvents).toEqual([]);
    expect(frame.result.eventsCommitted).toBe(0);
    expect(frame.result.agentsCalled).toBe(0);
  });

  it("falls back to the channel id when metadata has no name for a dynamic channel", async () => {
    const { gw } = buildGateway();
    await gw.createChannel("dyn-7f3a", "private_channel", ["ana"]);
    const replay = gw.toReplay();
    const dynamic = replay.channels.find((c) => c.id === "dyn-7f3a");
    expect(dynamic?.name).toBe("dyn-7f3a");
    expect(dynamic?.type).toBe("private_channel");
  });

  it("tracks addMember and removeMember on the channel topology", async () => {
    const { gw } = buildGateway();
    await gw.addMember("ana-carla", "bruno");
    await gw.createChannel("dyn-9", "private_channel", ["carla"]);
    await gw.addMember("dyn-9", "ana");
    await gw.removeMember("dyn-9", "carla");
    const replay = gw.toReplay();
    const privateChannel = replay.channels.find((c) => c.id === "ana-carla")!;
    expect(privateChannel.memberAgentIds).toEqual(["ana", "bruno"]);
    const dynamic = replay.channels.find((c) => c.id === "dyn-9")!;
    expect(dynamic.memberAgentIds).toEqual(["ana"]);
  });

  it("renders a standalone artifact via generateHtml with names and thinking", async () => {
    const { gw, outputPath } = buildGateway();
    await gw.sendOperatorEvent(snapshot("ana", 0));
    await gw.sendOperatorEvent(snapshot("bruno", 0));
    await gw.sendOperatorEvent(intent("ana", 0));
    await gw.sendOperatorEvent(visibility("ev_1", 0, "message_sent", { content: "oi" }));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    const html = generateHtml(replay);
    expect(html).toContain("REPLAY_DATA");
    expect(html).toContain("Ana");
    expect(html).toContain("Bruno");
    expect(html).toContain("Preciso marcar presença sem chamar atenção.");
    expect(html).toContain("oi");

    const flushed = readFileSync(outputPath, "utf-8");
    expect(flushed).toBe(html);
  });
});