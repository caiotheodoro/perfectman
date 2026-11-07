import { describe, it, expect, vi } from "vitest";
import { PulseScheduler } from "../pulse-scheduler.js";
import type { AgentRuntime, LLMBudget, PulseSchedulerConfig } from "../pulse-scheduler.js";
import { InMemoryEventRepository, InMemoryAgentStateRepository, InMemoryChannelRepository } from "../in-memory-stores.js";
import { ChannelRegistry } from "../channel-registry.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { IntentResolver } from "../intent-resolver.js";
import { EngineSnapshotProjection } from "../projections/engine-snapshot-projection.js";
import { DeliveryProjection } from "../projections/delivery-projection.js";
import { SpectatorProjection } from "../projections/spectator-projection.js";
import { OperatorProjection } from "../projections/operator-projection.js";
import { EngineEventBuilder } from "../engine-event-builder.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import { cannedNoOpStep, makeAgentState, makePersona, SETTINGS } from "./fixtures.js";
import type { ActionIntent, AttentionReason, EngineSnapshot, Simulation } from "@perfectman/shared";

const SIM: Simulation = {
  id: "sim_defer",
  name: "defer",
  status: "running",
  agentIds: ["a1", "a2", "a3", "a4"],
  channelIds: ["ch_public"],
  settings: SETTINGS,
  seed: 11,
  createdAt: 0,
  updatedAt: 0,
};

type Pending = { agentId: string; resolve: (intent?: Partial<ActionIntent>) => void; reject: (err: Error) => void };

/** An agent runtime whose model calls stay open until the test settles them. */
function controlledRuntime() {
  const calls: Pending[] = [];
  const runtime: AgentRuntime = {
    generateIntent: vi.fn((input) => {
      return new Promise((resolve, reject) => {
        calls.push({
          agentId: input.agentId,
          reject,
          resolve: (over = {}) =>
            resolve({
              intent: {
                id: `intent_${calls.length}`,
                actorId: input.agentId,
                intentType: "send_message",
                visibleContent: `line from ${input.agentId}`,
                personTargets: [],
                privateMotiveSummary: "because",
                emotionDrivers: [],
                motivationDrivers: [],
                memoryWrites: [],
                fallbackIfBlocked: "no_op",
                ...over,
              } satisfies ActionIntent,
              llmUsage: null,
              latencyMs: 1,
              fallbackApplied: false,
              operatorEvents: [],
            }),
        });
      });
    }),
  };
  return { runtime, calls };
}

async function harness(
  options: Partial<PulseSchedulerConfig> & { addressed?: string[]; channelId?: string } = {},
) {
  const { addressed = [], channelId = "ch_public", ...overrides } = options;
  const eventRepo = new InMemoryEventRepository();
  const agentStateRepo = new InMemoryAgentStateRepository();
  const channelRepo = new InMemoryChannelRepository();
  const channelRegistry = new ChannelRegistry(channelRepo);
  const gateway = new MockDeliveryGateway();
  const ids = ["a1", "a2", "a3", "a4"];
  await channelRepo.create({
    id: channelId,
    simulationId: SIM.id,
    type: "public_channel",
    name: "general",
    createdBy: "system",
    memberAgentIds: ids,
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  });
  for (const id of ids) await channelRepo.addMembership({ channelId, agentId: id, joinedAt: 0 });
  const agents = ids.map((id) => ({
    id,
    state: makeAgentState({ agentId: id, simulationId: SIM.id }),
    persona: makePersona(id),
  }));
  const { runtime, calls } = controlledRuntime();
  const rateLimitGate = new RateLimitGate({ ...SETTINGS, maxMessagesPerMinutePerAgent: 1000 });
  const llmBudget: LLMBudget = { getPriority: vi.fn().mockReturnValue("high") };
  const consults: Array<{ agentId: string; addressed: boolean; reason: string }> = [];
  const scheduler = new PulseScheduler({
    simulation: SIM,
    agents,
    defaultPublicChannelId: channelId,
    eventRepo,
    agentStateRepo,
    channelRegistry,
    rateLimitGate,
    intentResolver: new IntentResolver(rateLimitGate, channelRegistry),
    engineSnapshotProjection: new EngineSnapshotProjection(),
    deliveryProjection: new DeliveryProjection(gateway),
    spectatorProjection: new SpectatorProjection(gateway),
    operatorProjection: new OperatorProjection(gateway),
    engineEventBuilder: new EngineEventBuilder(),
    agentRuntime: runtime,
    llmBudget,
    pulseIntervalMs: 6000,
    pulseMode: "split",
    generateConcurrency: 3,
    onConsult: (info) => consults.push(info),
    stepResolver: (snap: EngineSnapshot) => {
      const base = cannedNoOpStep(snap);
      const agentId = snap.agentState.agentId;
      const reasons: AttentionReason[] = addressed.includes(agentId) ? ["direct_mention"] : ["initiative_cadence"];
      return {
        ...base,
        attentionResults: { ...base.attentionResults, reasons, needsLLM: true },
        decision: { ...base.decision, needsLLM: true, outcome: "respond" },
        availableActions: [
          { intentType: "send_message", channelTargets: [], personTargets: [], blocked: false },
          { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
        ],
        updatedAgentState: { ...base.updatedAgentState, simulationId: SIM.id },
      };
    },
    ...overrides,
  });
  const messageActors = async () =>
    (await eventRepo.getAfter(SIM.id)).filter((e) => e.type === "message_sent").map((e) => e.actorId);
  return { scheduler, calls, consults, eventRepo, llmBudget, messageActors, channelRepo };
}

const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

async function settleAll(h: Awaited<ReturnType<typeof harness>>, pulse: Promise<unknown>): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const open = h.calls.splice(0, h.calls.length);
    for (const call of open) call.resolve();
    await tick();
  }
  await pulse;
}

describe("PulseScheduler deferred agents (staggered arrival)", () => {
  it("never consults a deferred agent, then consults it from the pulse after it is admitted", async () => {
    const h = await harness({ generateConcurrency: 5 });
    expect(h.scheduler.deferAgent("a3")).toBe(true);
    expect(h.scheduler.deferAgent("a3")).toBe(false);
    expect(h.scheduler.deferAgent("ghost")).toBe(false);
    expect(h.scheduler.agentCount).toBe(3);
    expect(h.scheduler.hasAgent("a3")).toBe(true);

    const first = h.scheduler.runPulse({ reason: "base" });
    await tick();
    expect(h.calls.map((c) => c.agentId).sort()).toEqual(["a1", "a2", "a4"]);
    await settleAll(h, first);
    expect(h.consults.map((c) => c.agentId)).not.toContain("a3");

    expect(h.scheduler.admitAgent("a3")).toBe(true);
    expect(h.scheduler.admitAgent("a3")).toBe(false);
    expect(h.scheduler.agentCount).toBe(4);
    const second = h.scheduler.runPulse({ reason: "base" });
    await tick();
    expect(h.calls.map((c) => c.agentId).sort()).toEqual(["a1", "a2", "a3", "a4"]);
    await settleAll(h, second);
  });

  it("retiring a deferred agent removes it for good", async () => {
    const h = await harness({ generateConcurrency: 5 });
    h.scheduler.deferAgent("a2");
    expect(h.scheduler.retireAgent("a2")).toBe(true);
    expect(h.scheduler.hasAgent("a2")).toBe(false);
    expect(h.scheduler.admitAgent("a2")).toBe(false);
    expect(h.scheduler.agentCount).toBe(3);
  });
});

describe("PulseScheduler channel anchor (hotel doors)", () => {
  /** Two room channels the actor is a member of, as the hotel run registers them. */
  const rooms = async (h: Awaited<ReturnType<typeof harness>>) => {
    for (const id of ["room:16", "room:17"]) {
      await h.channelRepo.create({ id, simulationId: SIM.id, type: "public_channel", name: id, createdBy: "system", memberAgentIds: ["a1"], spectatorVisible: true, operatorVisible: true, createdForMotives: [], status: "active", createdAt: 0, updatedAt: 0 });
      await h.channelRepo.addMembership({ channelId: id, agentId: "a1", joinedAt: 0 });
    }
  };
  const sentBy = async (h: Awaited<ReturnType<typeof harness>>) => (await h.eventRepo.getAfter(SIM.id)).filter((e) => e.type === "message_sent" && e.actorId === "a1");
  /** Where a1's next line goes: one more pulse, answered with no channel of its own. */
  const nextLineChannel = async (h: Awaited<ReturnType<typeof harness>>): Promise<string | undefined> => {
    const before = (await sentBy(h)).length;
    const pulse = h.scheduler.runPulse({ reason: "base" });
    await tick();
    await settleAll(h, pulse);
    return (await sentBy(h)).slice(before).at(0)?.channelId;
  };

  it("a line committed on a room the actor already left does not pull its default channel back", async () => {
    const h = await harness({ generateConcurrency: 5 });
    await rooms(h);
    h.scheduler.followToChannel("a1", "room:16");
    // the decision starts in room 16 ...
    const pulse = h.scheduler.runPulse({ reason: "base" });
    await tick();
    // ... the actor takes the door while the model is thinking ...
    h.scheduler.followToChannel("a1", "room:17");
    // ... and the answer commits on the old room
    for (const c of h.calls.splice(0, h.calls.length)) c.resolve(c.agentId === "a1" ? { channelTarget: "room:16" } : {});
    await tick();
    await settleAll(h, pulse);
    expect((await sentBy(h)).map((e) => e.channelId)).toEqual(["room:16"]);
    expect(await nextLineChannel(h)).toBe("room:17");
  });

  it("a line with a blank channel does not become the actor's default channel", async () => {
    const h = await harness({ generateConcurrency: 5 });
    await rooms(h);
    h.scheduler.followToChannel("a1", "room:17");
    const pulse = h.scheduler.runPulse({ reason: "base" });
    await tick();
    for (const c of h.calls.splice(0, h.calls.length)) c.resolve(c.agentId === "a1" ? { channelTarget: "" } : {});
    await tick();
    await settleAll(h, pulse);
    expect((await sentBy(h)).map((e) => e.channelId)).toEqual(["room:17"]);
    expect(await nextLineChannel(h)).toBe("room:17");
  });
});
