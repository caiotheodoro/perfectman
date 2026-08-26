import { describe, it, expect, beforeEach } from "vitest";
import { SimulationLifecycle } from "../simulation-lifecycle.js";
import { InMemorySimulationRepository, InMemoryEventRepository } from "../in-memory-stores.js";
import { EventLog } from "../event-log.js";
import type { Simulation, SimulationSettings } from "@perfectman/shared";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

function makeSim(status: Simulation["status"] = "initializing"): Simulation {
  return {
    id: "sim_1",
    name: "test",
    status,
    agentIds: ["agent_1"],
    channelIds: ["ch_public"],
    settings: SETTINGS,
    seed: 42,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("SimulationLifecycle", () => {
  let simRepo: InMemorySimulationRepository;
  let eventLog: EventLog;
  let lifecycle: SimulationLifecycle;

  beforeEach(async () => {
    simRepo = new InMemorySimulationRepository();
    eventLog = new EventLog(new InMemoryEventRepository());
    lifecycle = new SimulationLifecycle(simRepo, eventLog);

    await simRepo.create({
      id: "sim_1",
      name: "test",
      agentIds: ["agent_1"],
      channelIds: ["ch_public"],
      settings: SETTINGS,
      seed: 42,
    });
  });

  it("start transitions to running and commits simulation_started event", async () => {
    const sim = makeSim("initializing");
    await lifecycle.start(sim, 0);
    const updated = await simRepo.get("sim_1");
    expect(updated?.status).toBe("running");
    const events = await eventLog.getAfter("sim_1");
    expect(events.some(e => e.type === "simulation_started")).toBe(true);
  });

  it("pause transitions to paused and commits simulation_paused event", async () => {
    const sim = makeSim("running");
    await lifecycle.pause(sim, 1);
    const updated = await simRepo.get("sim_1");
    expect(updated?.status).toBe("paused");
    const events = await eventLog.getAfter("sim_1");
    expect(events.some(e => e.type === "simulation_paused")).toBe(true);
  });

  it("resume transitions to running and commits simulation_resumed event", async () => {
    const sim = makeSim("paused");
    await lifecycle.resume(sim, 2);
    const updated = await simRepo.get("sim_1");
    expect(updated?.status).toBe("running");
    const events = await eventLog.getAfter("sim_1");
    expect(events.some(e => e.type === "simulation_resumed")).toBe(true);
  });

  it("stop transitions to stopped and commits simulation_stopped event", async () => {
    const sim = makeSim("running");
    await lifecycle.stop(sim, 3);
    const updated = await simRepo.get("sim_1");
    expect(updated?.status).toBe("stopped");
    const events = await eventLog.getAfter("sim_1");
    expect(events.some(e => e.type === "simulation_stopped")).toBe(true);
  });

  it("stop without reason/offer commits the payload without them", async () => {
    const sim = makeSim("running");
    await lifecycle.stop(sim, 3);
    const events = await eventLog.getAfter("sim_1");
    const stopped = events.find(e => e.type === "simulation_stopped");
    expect(stopped?.payload).toEqual({ simulationId: "sim_1" });
  });

  it("stop with endReason and endingOffer commits them in the payload", async () => {
    const sim = makeSim("running");
    await lifecycle.stop(sim, 3, "goal_end_offered", {
      goalId: "goal_1",
      reasons: ["story complete"],
      epilogue: "Ana found her footing.",
      status: "pending",
    });
    const events = await eventLog.getAfter("sim_1");
    const stopped = events.find(e => e.type === "simulation_stopped");
    expect(stopped?.payload).toMatchObject({
      simulationId: "sim_1",
      endReason: "goal_end_offered",
    });
    expect(stopped?.payload.endingOffer).toEqual({
      goalId: "goal_1",
      reasons: ["story complete"],
      epilogue: "Ana found her footing.",
      status: "pending",
    });
  });

  it("double stop with reason commits a single stopped event (idempotent guard first)", async () => {
    const sim = makeSim("running");
    await lifecycle.stop(sim, 3, "goal_end_offered", {
      goalId: "goal_1",
      reasons: [],
      epilogue: "ep",
      status: "pending",
    });
    // The guard reads the caller-supplied object; SimulationManager re-fetches
    // from the repo before each stop, so present the persisted status.
    const persisted = await simRepo.get("sim_1");
    await lifecycle.stop(persisted!, 4, "operator_command");
    const events = await eventLog.getAfter("sim_1");
    expect(events.filter(e => e.type === "simulation_stopped")).toHaveLength(1);
  });

  it("start throws if simulation is not initializing", async () => {
    const sim = makeSim("running");
    await expect(lifecycle.start(sim, 0)).rejects.toThrow();
  });

  it("pause throws if simulation is not running", async () => {
    const sim = makeSim("initializing");
    await expect(lifecycle.pause(sim, 0)).rejects.toThrow();
  });

  it("lifecycle events have low salience", async () => {
    const sim = makeSim("initializing");
    await lifecycle.start(sim, 0);
    const events = await eventLog.getAfter("sim_1");
    const started = events.find(e => e.type === "simulation_started");
    expect(started?.emotionalSalience).toBe("low");
  });
});
