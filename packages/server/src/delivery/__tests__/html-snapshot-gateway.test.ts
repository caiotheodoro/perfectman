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

function goalProposed(goalId: string, pulseIndex: number, title = "Resolver o impasse"): OperatorEvent {
  return {
    type: "goal_proposed",
    simulationId: "sim_rcv",
    agentId: "ana",
    pulseIndex,
    detail: `Goal proposed: ${goalId}`,
    data: {
      goalId,
      proposal: {
        id: goalId,
        agentId: "ana",
        title,
        targetState: {
          id: "pred-1",
          description: "sem mais bloqueios",
          observableCriteria: ["sem mais bloqueios"],
        },
        kind: "resolve",
        origin: "crystallized_from",
        sourceEventIds: ["seed-1"],
        createdAt: 1,
      },
      narrativeFraming: "Ana percebe que precisa resolver o impasse.",
      confidence: 0.85,
      synthesizer: "deterministic",
    },
    createdAt: 1,
  };
}

function goalAccepted(goalId: string, pulseIndex: number): OperatorEvent {
  return {
    type: "goal_accepted",
    simulationId: "sim_rcv",
    agentId: "ana",
    pulseIndex,
    detail: `Goal accepted: ${goalId}`,
    data: {
      goalId,
      goal: {
        id: goalId,
        agentId: "ana",
        title: "Resolver o impasse",
        targetState: {
          id: "pred-1",
          description: "sem mais bloqueios",
          observableCriteria: ["sem mais bloqueios"],
        },
        kind: "resolve",
        status: "active",
        origin: "crystallized_from",
        sourceEventIds: ["seed-1"],
        createdAt: 1,
      },
    },
    createdAt: 1,
  };
}

function goalDeclined(goalId: string, pulseIndex: number, title: string): OperatorEvent {
  return {
    type: "goal_declined",
    simulationId: "sim_rcv",
    agentId: "ana",
    pulseIndex,
    detail: `Goal declined: ${goalId}`,
    data: {
      goalId,
      proposal: {
        id: goalId,
        agentId: "ana",
        title,
        targetState: {
          id: "pred-2",
          description: "sem mais bloqueios",
          observableCriteria: [],
        },
        kind: "resolve",
        origin: "crystallized_from",
        sourceEventIds: [],
        createdAt: 1,
      },
    },
    createdAt: 1,
  };
}

function worldVerdict(goalId: string, pulseIndex: number, determination: string, confidence: number): OperatorEvent {
  return {
    type: "world_verdict",
    simulationId: "sim_rcv",
    pulseIndex,
    detail: `World verdict: ${determination}`,
    data: {
      goalId,
      verdict: {
        goalId,
        objective: { distanceToTarget: 0.2, progressRate: 0.8, plateaued: false },
        consensus: "ratified",
        determination,
        confidence,
      },
    },
    createdAt: 1,
  };
}

function gapSampled(
  goalId: string,
  pulseIndex: number,
  sample: { magnitude: number; divergenceFromLog: number; divergenceFromWorld: number },
): OperatorEvent {
  return {
    type: "delusion_gap_sampled",
    simulationId: "sim_rcv",
    pulseIndex,
    detail: `Delusion gap sampled: ${goalId}`,
    data: {
      goalId,
      agentId: "ana",
      at: 2,
      magnitude: sample.magnitude,
      divergenceFromLog: sample.divergenceFromLog,
      divergenceFromWorld: sample.divergenceFromWorld,
    },
    createdAt: 1,
  };
}

function endingOffered(goalId: string, pulseIndex: number): OperatorEvent {
  return {
    type: "ending_offered",
    simulationId: "sim_rcv",
    pulseIndex,
    detail: `Ending offered: ${goalId}`,
    data: {
      goalId,
      offer: {
        goalId,
        reasons: ["world verdict: reached", "beat present"],
        epilogue: "A história se sustenta.",
        status: "pending",
      },
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

  it("carries the reaction emoji from event_visibility into the replay and artifact", async () => {
    const { gw, outputPath } = buildGateway();
    await gw.sendOperatorEvent(snapshot("ana", 0));
    await gw.sendOperatorEvent({
      type: "event_visibility",
      simulationId: "sim_rcv",
      agentId: "ana",
      pulseIndex: 0,
      detail: "Event visibility: reaction_sent",
      data: {
        eventId: "ev_react",
        eventType: "reaction_sent",
        actorId: "ana",
        channelId: "general",
        visibleToAgents: [],
        emoji: "🎉",
        targetEventId: "ev_m1",
      },
      createdAt: 1,
    });
    await gw.onSimulationStopped("sim_rcv");

    const row = gw.toReplay().pulses[0]!.committedEvents[0]!;
    expect(row.type).toBe("reaction_sent");
    expect(row.payload["emoji"]).toBe("🎉");
    expect(row.payload["targetEventId"]).toBe("ev_m1");

    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("🎉");
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

  it("derives the goal panel from delivered goal-layer events and flushes it with the stop payload", async () => {
    const { gw, outputPath } = buildGateway();
    await gw.sendOperatorEvent(goalProposed("g1", 1));
    await gw.sendOperatorEvent(goalAccepted("g1", 2));
    // Two verdicts and gaps: only the latest verdict is kept, samples keep arrival order.
    await gw.sendOperatorEvent(worldVerdict("g1", 3, "not_reached", 0.6));
    await gw.sendOperatorEvent(gapSampled("g1", 3, { magnitude: 0.4, divergenceFromLog: 0.3, divergenceFromWorld: 0.5 }));
    await gw.sendOperatorEvent(worldVerdict("g1", 4, "reached", 0.9));
    await gw.sendOperatorEvent(gapSampled("g1", 4, { magnitude: 0.1, divergenceFromLog: 0.05, divergenceFromWorld: 0.15 }));
    await gw.sendOperatorEvent(endingOffered("g1", 5));
    await gw.onSimulationStopped("sim_rcv", "goal_end_offered", {
      goalId: "g1",
      reasons: ["world verdict: reached"],
      epilogue: "A história se sustenta.",
      status: "pending",
    });

    const replay = gw.toReplay();
    expect(replay.goals).toEqual([
      {
        goalId: "g1",
        agentId: "ana",
        title: "Resolver o impasse",
        kind: "resolve",
        targetStateDescription: "sem mais bloqueios",
        narrativeFraming: "Ana percebe que precisa resolver o impasse.",
        synthesizer: "deterministic",
        confidence: 0.85,
        status: "ended",
        proposalPulse: 1,
        acceptedPulse: 2,
        latestVerdict: {
          distanceToTarget: 0.2,
          progressRate: 0.8,
          plateaued: false,
          consensus: "ratified",
          determination: "reached",
          confidence: 0.9,
        },
        gapSamples: [
          { pulseIndex: 3, magnitude: 0.4, divergenceFromLog: 0.3, divergenceFromWorld: 0.5 },
          { pulseIndex: 4, magnitude: 0.1, divergenceFromLog: 0.05, divergenceFromWorld: 0.15 },
        ],
        ending: {
          goalId: "g1",
          reasons: ["world verdict: reached", "beat present"],
          epilogue: "A história se sustenta.",
          status: "pending",
        },
      },
    ]);
    expect(replay.endReason).toBe("goal_end_offered");
    expect(replay.endingOffer?.epilogue).toBe("A história se sustenta.");

    // Flushed artifact carries the panel section, the panel data, and the end line.
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("goal-panel");
    expect(html).toContain("Resolver o impasse");
    expect(html).toContain("goal_end_offered");
    expect(html).toContain("A história se sustenta.");
  });

  it("ends a declined goal as declined with no verdict, samples, or ending", async () => {
    const { gw } = buildGateway();
    await gw.sendOperatorEvent(goalProposed("g2", 1, "Abandonar o fórum"));
    await gw.sendOperatorEvent(goalDeclined("g2", 2, "Abandonar o fórum"));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.goals).toHaveLength(1);
    const panel = replay.goals![0]!;
    expect(panel.status).toBe("declined");
    expect(panel.acceptedPulse).toBeUndefined();
    expect(panel.latestVerdict).toBeUndefined();
    expect(panel.gapSamples).toEqual([]);
    expect(panel.ending).toBeUndefined();
    expect(replay.endReason).toBeUndefined();
  });

  it("keeps separate run-level panels per goalId across frames, interleaved streams intact", async () => {
    const { gw } = buildGateway();
    // Events on distant pulses: the run-level map must merge them, and each
    // frame must still carry its own pulse's operator events (no per-frame
    // drops). Goal gx ends; goal gy is accepted with a single gap sample.
    await gw.sendOperatorEvent(goalProposed("gx", 1));
    await gw.sendOperatorEvent(worldVerdict("gx", 3, "reached", 0.9));
    await gw.sendOperatorEvent(gapSampled("gx", 3, { magnitude: 0.4, divergenceFromLog: 0.3, divergenceFromWorld: 0.5 }));
    await gw.sendOperatorEvent(goalProposed("gy", 7, "Seguir em frente"));
    await gw.sendOperatorEvent(worldVerdict("gy", 8, "not_reached", 0.6));
    await gw.sendOperatorEvent(gapSampled("gy", 8, { magnitude: 0.7, divergenceFromLog: 0.6, divergenceFromWorld: 0.8 }));
    await gw.sendOperatorEvent(goalAccepted("gy", 9));
    await gw.sendOperatorEvent(endingOffered("gx", 10));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.goals).toHaveLength(2);

    const gx = replay.goals!.find((g) => g.goalId === "gx")!;
    expect(gx.status).toBe("ended");
    expect(gx.proposalPulse).toBe(1);
    expect(gx.acceptedPulse).toBeUndefined();
    expect(gx.latestVerdict?.determination).toBe("reached");
    // Single-sample trajectory: one sample, on the verdict's pulse.
    expect(gx.gapSamples).toEqual([
      { pulseIndex: 3, magnitude: 0.4, divergenceFromLog: 0.3, divergenceFromWorld: 0.5 },
    ]);
    expect(gx.ending?.reasons).toEqual(["world verdict: reached", "beat present"]);

    const gy = replay.goals!.find((g) => g.goalId === "gy")!;
    expect(gy.status).toBe("accepted");
    expect(gy.proposalPulse).toBe(7);
    expect(gy.acceptedPulse).toBe(9);
    expect(gy.latestVerdict?.determination).toBe("not_reached");
    expect(gy.gapSamples).toHaveLength(1);
    expect(gy.ending).toBeUndefined();

    // Frames keep the per-pulse stream: one frame per event pulse, each
    // holding only its own events; the verdict for gx must not land on gy's
    // frame or panel.
    expect(replay.pulses.map((p) => p.pulseIndex)).toEqual([1, 3, 7, 8, 9, 10]);
    const frame7 = replay.pulses.find((p) => p.pulseIndex === 7)!;
    expect(frame7.operatorEvents.map((e) => e.type)).toEqual(["goal_proposed"]);
    expect(frame7.operatorEvents[0]!.data?.["goalId"]).toBe("gy");
    const frame3 = replay.pulses.find((p) => p.pulseIndex === 3)!;
    expect(frame3.operatorEvents.map((e) => e.type)).toEqual(["world_verdict", "delusion_gap_sampled"]);
  });

  it("ignores malformed goal payloads and falls back for missing optional fields", async () => {
    const { gw } = buildGateway();
    // No goalId: proposal is dropped entirely (no entry, no throw).
    await gw.sendOperatorEvent({
      type: "goal_proposed",
      simulationId: "sim_rcv",
      agentId: "ana",
      pulseIndex: 1,
      detail: "Goal proposed: unknown",
      data: { proposal: { title: "sem id" } },
      createdAt: 1,
    });
    // Events for a goal the receiver never saw a proposal for: ignored.
    await gw.sendOperatorEvent(worldVerdict("ghost", 2, "reached", 0.9));
    await gw.sendOperatorEvent(goalAccepted("ghost", 3));
    await gw.sendOperatorEvent(gapSampled("ghost", 3, { magnitude: 1, divergenceFromLog: 1, divergenceFromWorld: 1 }));
    // Minimal proposal: every optional field falls back, no throw.
    await gw.sendOperatorEvent({
      type: "goal_proposed",
      simulationId: "sim_rcv",
      agentId: "bruno",
      pulseIndex: 4,
      detail: "Goal proposed: g3",
      data: { goalId: "g3", proposal: { agentId: "bruno" } },
      createdAt: 1,
    });
    // Unknown endReason-adjacent fields on the stop: keys stay absent.
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect(replay.goals).toHaveLength(1);
    const g3 = replay.goals![0]!;
    expect(g3).toEqual({
      goalId: "g3",
      agentId: "bruno",
      title: "",
      kind: "",
      targetStateDescription: "",
      narrativeFraming: "",
      synthesizer: "",
      confidence: 0,
      status: "proposed",
      proposalPulse: 4,
      gapSamples: [],
    });
    expect("acceptedPulse" in g3).toBe(false);
    expect("latestVerdict" in g3).toBe(false);
    expect("endReason" in replay).toBe(false);
    expect("endingOffer" in replay).toBe(false);
  });

  it("stays byte-identical for no-goal runs: no goal keys in the replay, no goal markers in the artifact", async () => {
    const { gw, outputPath } = buildGateway();
    await gw.sendOperatorEvent(snapshot("ana", 0));
    await gw.sendOperatorEvent(snapshot("bruno", 0));
    await gw.sendOperatorEvent(intent("ana", 0));
    await gw.sendOperatorEvent(visibility("ev_m1", 0, "message_sent", { content: "oi gente" }));
    await gw.sendOperatorEvent(visibility("ev_noop", 0, "no_op_recorded", { actorId: "bruno", visibleToAgents: [] }));
    await gw.onSimulationStopped("sim_rcv");

    const replay = gw.toReplay();
    expect("goals" in replay).toBe(false);
    expect("endReason" in replay).toBe(false);
    expect("endingOffer" in replay).toBe(false);

    // The no-goal artifact carries no goal-panel shell, CSS, or JS — the
    // byte-identity invariant behind the `!goals || goals.length === 0` guard.
    const html = readFileSync(outputPath, "utf-8");
    expect(html).not.toContain("goal-panel");
    expect(html).not.toContain("camada de objetivos");
    expect(html).not.toContain("GOAL_CSS");
    expect(html).not.toContain("GOAL_JS");
    // Pre-existing sections stay untouched when no goals are present.
    expect(html).toContain("REPLAY_DATA");
    expect(html).toContain("PULSES");
    expect(html).toContain("oi gente");
  });
});