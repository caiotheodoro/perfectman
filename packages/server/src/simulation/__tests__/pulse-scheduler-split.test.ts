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
  id: "sim_split",
  name: "split",
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
  return { scheduler, calls, consults, eventRepo, llmBudget, messageActors };
}

const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe("PulseScheduler split pulse (ADR-0020)", () => {
  it("runs a focused pulse beside the base pulse: waits only for the addressee's own call, never for the others, and leaves pulseIndex alone", async () => {
    const h = await harness({ generateConcurrency: 5 });
    const base = h.scheduler.runPulse({ reason: "base" });
    await tick();
    expect(h.calls.map((c) => c.agentId).sort()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(h.scheduler.getPulseIndex()).toBe(1); // the next base index applies once decide is done

    // A human line for a2 arrives while a2 is mid-call for an ambient reason.
    const focused = h.scheduler.runPulse({ reason: "human_chat", focusAgentIds: ["a2"], elapsedMs: 1500 });
    await tick();
    expect(h.calls).toHaveLength(4); // a2 waits for its own call, it does not start a second one

    // a2's ambient call settles; the focused pulse then runs its own call for a2 while a1/a3/a4 are still open.
    h.calls.find((c) => c.agentId === "a2")!.resolve();
    await tick();
    expect(h.calls.filter((c) => c.agentId === "a2")).toHaveLength(2);
    expect(h.consults.filter((c) => c.agentId === "a2").map((c) => [c.reason, c.addressed])).toEqual([
      ["base", false],
      ["human_chat", true],
    ]);
    h.calls.filter((c) => c.agentId === "a2")[1]!.resolve();
    await focused; // finished while the base pulse still has three calls open
    expect(h.scheduler.getPulseIndex()).toBe(1);
    for (const call of h.calls.filter((c) => c.agentId !== "a2")) call.resolve();
    await base;
    expect((await h.messageActors()).filter((id) => id === "a2")).toHaveLength(2);
    expect(h.scheduler.getPulseIndex()).toBe(1);
  });

  it("keeps one slot for addressed replies and orders waiting tasks addressed first", async () => {
    const h = await harness({ addressed: ["a4"], generateConcurrency: 2 });
    const base = h.scheduler.runPulse({ reason: "base" });
    await tick();
    // 4 consults wanted, 2 slots, 1 reserved: only one non-addressed call may be in flight.
    const nonAddressedInFlight = h.consults.filter((c) => !c.addressed).length;
    expect(nonAddressedInFlight).toBe(1);
    // The addressed agent takes the reserved slot at once, ahead of the queued ambient ones.
    expect(h.consults.some((c) => c.agentId === "a4" && c.addressed)).toBe(true);
    for (let i = 0; i < 20 && h.calls.length > 0; i++) {
      const open = h.calls.splice(0, h.calls.length);
      for (const call of open) call.resolve();
      await tick();
    }
    await base;
    expect(h.consults).toHaveLength(4);
  });

  it("commits each task as its call settles; commitOrder turn commits in turn order instead", async () => {
    for (const commitOrder of ["settle", "turn"] as const) {
      const h = await harness({ generateConcurrency: 5, commitOrder });
      const base = h.scheduler.runPulse({ reason: "base" });
      await tick();
      const started = h.calls.map((c) => c.agentId);
      expect(started).toHaveLength(4);
      // Settle in reverse start order.
      for (const call of [...h.calls].reverse()) {
        call.resolve();
        await tick();
      }
      await base;
      const committedOrder = await h.messageActors();
      if (commitOrder === "settle") expect(committedOrder).toEqual([...started].reverse());
      else expect(committedOrder).toEqual(started);
    }
  });

  it("skips generation for a non-addressed agent the arbiter would block, and never for the addressed one", async () => {
    const blocked = { outcome: "blocked", violation: { type: "policy_blocked", detail: "room_speech:human_typing" }, rateLimited: false } as const;
    const preview = vi.fn(() => blocked);
    const arbiter = { noteHumanLine: vi.fn(), noteHumanTyping: vi.fn(), preview, gate: vi.fn(() => ({ outcome: "allowed" }) as const) };
    const h = await harness({ arbiter, generateConcurrency: 5, addressed: ["a2"], channelId: "room:lounge" });
    const run = h.scheduler.runPulse({ reason: "base" });
    await tick();
    // Everyone but the addressed agent is blocked in the decide phase: one model call, no wasted ones.
    expect(h.calls.map((c) => c.agentId)).toEqual(["a2"]);
    h.calls[0]!.resolve();
    await run;
    expect(preview).toHaveBeenCalledTimes(3);
  });

  it("does not arbitrate outside room channels", async () => {
    const preview = vi.fn();
    const arbiter = { noteHumanLine: vi.fn(), noteHumanTyping: vi.fn(), preview, gate: vi.fn() };
    const h = await harness({ arbiter, generateConcurrency: 5 });
    const run = h.scheduler.runPulse({ reason: "base" });
    await tick();
    expect(h.calls).toHaveLength(4);
    for (const call of h.calls.splice(0)) call.resolve();
    await run;
    expect(preview).not.toHaveBeenCalled();
  });

  it("falls back to a recorded silence when a generate call outlives its deadline", async () => {
    vi.useFakeTimers();
    try {
      const h = await harness({ generateConcurrency: 5, generateDeadlineMs: 1000 });
      const base = h.scheduler.runPulse({ reason: "base" });
      await vi.advanceTimersByTimeAsync(1500);
      await base;
      const events = await h.eventRepo.getAfter(SIM.id);
      expect(events.filter((e) => e.type === "llm_failure").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
  describe("ambient gate", () => {
    /** Runs a base pulse and settles every call it opens. */
    async function basePulse(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
      const run = h.scheduler.runPulse({ reason: "base" });
      for (let i = 0; i < 5; i++) {
        await tick();
        for (const call of h.calls.splice(0)) call.resolve();
      }
      await run;
    }

    it("does not consult an actor again while nothing new happened in its view, and consults it once quietMs has passed", async () => {
      let now = 1_000_000;
      const h = await harness({ generateConcurrency: 5, clock: () => now, ambientGate: { quietMs: 30_000 } });
      await basePulse(h);
      expect(h.consults).toHaveLength(4);
      now += 6000;
      await basePulse(h);
      expect(h.consults).toHaveLength(4); // held: the room is as it was
      now += 25_000;
      await basePulse(h);
      expect(h.consults).toHaveLength(8); // 31 s after the first
    });

    it("never holds an addressed actor, and holds nothing when the gate is off", async () => {
      let now = 1_000_000;
      const gated = await harness({ generateConcurrency: 5, clock: () => now, addressed: ["a2"], ambientGate: { quietMs: 30_000 } });
      await basePulse(gated);
      now += 6000;
      await basePulse(gated);
      expect(gated.consults.filter((c) => c.agentId === "a2")).toHaveLength(2);
      expect(gated.consults.filter((c) => c.agentId !== "a2")).toHaveLength(3);
      const open = await harness({ generateConcurrency: 5, clock: () => now });
      await basePulse(open);
      await basePulse(open);
      expect(open.consults).toHaveLength(8);
    });
  });
});
