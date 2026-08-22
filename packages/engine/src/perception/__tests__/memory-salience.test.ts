import { describe, it, expect } from "vitest";
import { scoreMemorySalience, selectRelevantMemories } from "../memory-salience.js";
import type { Memory } from "@perfectman/shared";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m",
    agentId: "goulart",
    simulationId: "sim",
    type: "episodic",
    subjectAgentIds: [],
    sourceEventIds: [],
    summary: "something happened",
    emotionalTone: "neutral",
    confidence: 0.5,
    unresolved: false,
    createdAt: 100,
    lastReinforcedAt: null,
    ...overrides,
  };
}

describe("scoreMemorySalience", () => {
  it("weights subject relevance above recency (old relevant beats new irrelevant)", () => {
    const involved = new Set(["bruno"]);
    const oldRelevant = memory({ createdAt: 10, subjectAgentIds: ["bruno"] });
    const newIrrelevant = memory({ createdAt: 200 });
    expect(scoreMemorySalience(oldRelevant, involved, 200)).toBeGreaterThan(
      scoreMemorySalience(newIrrelevant, involved, 200),
    );
  });

  it("prefers open loops over settled ones at equal age and confidence", () => {
    const involved = new Set<string>();
    const open = memory({ unresolved: true, createdAt: 50 });
    const settled = memory({ unresolved: false, createdAt: 50 });
    expect(scoreMemorySalience(open, involved, 100)).toBeGreaterThan(
      scoreMemorySalience(settled, involved, 100),
    );
  });

  it("orders type tiers: pending_intention > relationship > episodic", () => {
    const involved = new Set<string>();
    const pending = scoreMemorySalience(memory({ type: "pending_intention" }), involved, 100);
    const relationship = scoreMemorySalience(memory({ type: "relationship" }), involved, 100);
    const episodic = scoreMemorySalience(memory({ type: "episodic" }), involved, 100);
    expect(pending).toBeGreaterThan(relationship);
    expect(relationship).toBeGreaterThan(episodic);
  });

  it("rewards authored confidence", () => {
    const involved = new Set<string>();
    const high = scoreMemorySalience(memory({ confidence: 0.9 }), involved, 100);
    const low = scoreMemorySalience(memory({ confidence: 0.1 }), involved, 100);
    expect(high).toBeGreaterThan(low);
  });

  it("keeps recency as a bounded term, not a dominating one", () => {
    const involved = new Set<string>();
    // Newest possible vs oldest possible differs by RECENCY_WEIGHT only.
    const newest = scoreMemorySalience(memory({ createdAt: 100 }), involved, 100);
    const oldest = scoreMemorySalience(memory({ createdAt: 0 }), involved, 100);
    expect(newest - oldest).toBeCloseTo(0.5);
  });

  it("is finite for unknown memory types via the fallback weight", () => {
    const rogue = memory({ type: "alien" as Memory["type"] });
    expect(Number.isFinite(scoreMemorySalience(rogue, new Set(), 100))).toBe(true);
  });
});

describe("selectRelevantMemories", () => {
  it("returns an empty list for an empty store", () => {
    expect(selectRelevantMemories([], new Set(), 8)).toEqual([]);
  });

  it("caps selection at maxMemories", () => {
    const store = Array.from({ length: 20 }, (_, i) =>
      memory({ id: `m${i}`, createdAt: i + 1 }),
    );
    expect(selectRelevantMemories(store, new Set(), 8)).toHaveLength(8);
  });

  it("ranks a salient old memory ahead of fresh noise", () => {
    const store = [
      memory({ id: "noise-1", createdAt: 101 }),
      memory({ id: "noise-2", createdAt: 102 }),
      memory({
        id: "open-intent",
        type: "pending_intention",
        subjectAgentIds: ["bruno"],
        confidence: 0.95,
        unresolved: true,
        createdAt: 40,
      }),
      memory({ id: "noise-3", createdAt: 103 }),
    ];
    const selected = selectRelevantMemories(store, new Set(["bruno"]), 2);
    expect(selected[0]!.id).toBe("open-intent");
  });

  it("breaks exact ties by recency deterministically", () => {
    const store = [
      memory({ id: "older", createdAt: 10 }),
      memory({ id: "newer", createdAt: 20 }),
    ];
    expect(selectRelevantMemories(store, new Set(), 1)[0]!.id).toBe("newer");
  });
});
