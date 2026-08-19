import { describe, it, expect, beforeEach } from "vitest";
import { EventLog } from "../event-log.js";
import { InMemoryEventRepository } from "../in-memory-stores.js";
import type { SimulationEvent } from "@perfectman/shared";

const SIM_ID = "sim_test";

function makeEvent(overrides: Partial<SimulationEvent> = {}): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: "ch_public",
    actorId: "agent_1",
    type: "message_sent",
    payload: { content: "hello" },
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    ...overrides,
  };
}

describe("EventLog", () => {
  let log: EventLog;

  beforeEach(() => {
    log = new EventLog(new InMemoryEventRepository());
  });

  it("appends events and returns committed events with id + createdAt + pulseIndex", async () => {
    const committed = await log.append(SIM_ID, [makeEvent()]);
    expect(committed).toHaveLength(1);
    expect(committed[0].createdAt).toBeTypeOf("number");
    expect(committed[0].pulseIndex).toBeTypeOf("number");
  });

  it("getAfter with no afterEventId returns all events", async () => {
    await log.append(SIM_ID, [makeEvent(), makeEvent()]);
    const all = await log.getAfter(SIM_ID);
    expect(all).toHaveLength(2);
  });

  it("getAfter returns only events after the given id", async () => {
    const [e1, e2] = await log.append(SIM_ID, [makeEvent(), makeEvent()]);
    const after = await log.getAfter(SIM_ID, e1!.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(e2!.id);
  });

  it("getAfter rejects when afterEventId is stale", async () => {
    await log.append(SIM_ID, [makeEvent()]);
    await expect(log.getAfter(SIM_ID, "evt_missing")).rejects.toThrow("Event not found");
  });

  it("getCommittedThrough filters by pulseIndex", async () => {
    await log.append(SIM_ID, [{ ...makeEvent(), pulseIndex: 1 }]);
    await log.append(SIM_ID, [{ ...makeEvent(), pulseIndex: 5 }]);
    const result = await log.getCommittedThrough(SIM_ID, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.pulseIndex).toBe(1);
  });

  it("getById returns the correct event", async () => {
    const [committed] = await log.append(SIM_ID, [makeEvent()]);
    const found = await log.getById(SIM_ID, committed!.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(committed!.id);
  });

  it("event log is append-only — committed events are not mutated", async () => {
    const [c1] = await log.append(SIM_ID, [makeEvent()]);
    await log.append(SIM_ID, [makeEvent()]);
    const all = await log.getAfter(SIM_ID);
    expect(all[0]!.id).toBe(c1!.id);
  });
});
