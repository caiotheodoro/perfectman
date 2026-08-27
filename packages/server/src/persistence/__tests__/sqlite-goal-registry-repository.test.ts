/**
 * SqliteGoalRegistryRepository round-trip + AC-1 replay-parity suite
 * (:memory:, no file I/O, per the persistence test convention).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  CommittedEvent,
  EmergentGoal,
  EndingOffer,
  GoalProposal,
  SelfVerdict,
  SimulationEvent,
  WorldVerdict,
} from "@perfectman/shared";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteGoalRegistryRepository } from "../sqlite/goal-registry-repository.js";
import type { GoalSelfVerdictEntry } from "../sqlite/goal-registry-repository.js";
import { SqliteEventRepository } from "../sqlite/event-repository.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeSimulationInput } from "./sqlite-test-helpers.js";
import { GoalRegistry } from "../../simulation/world/goal-registry.js";

const SIM_ID = "sim_goal_registry";
const AGENT = "agent_1";
const CHANNEL = "ch_public";
const GOAL_ID = "crystal-agent_1-resolve-ch_public";

let db: DB;

beforeEach(async () => {
  db = openDatabase(":memory:");
  await new SqliteSimulationRepository(db).create(makeSimulationInput(SIM_ID));
});

afterEach(() => {
  closeDatabase(db);
});

function makeProposal(): GoalProposal {
  return {
    id: GOAL_ID,
    agentId: AGENT,
    title: "Overcome the repeated block in ch_public",
    targetState: {
      id: "predicate-resolve-ch_public",
      description: "no more blocked intents from agent_1 in ch_public",
      observableCriteria: [
        "no more blocked intents from agent_1 in ch_public",
        "a successful follow-up in ch_public after the blocks",
      ],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1", "seed-2", "seed-3"],
    createdAt: 3000,
  };
}

function makeGoal(): EmergentGoal {
  return { ...makeProposal(), status: "active" };
}

function makeVerdict(): WorldVerdict {
  return {
    goalId: GOAL_ID,
    objective: { distanceToTarget: 0.5, progressRate: 0, plateaued: true },
    consensus: "uncontested",
    determination: "contested",
    confidence: 0.75,
  };
}

function makeOffer(): EndingOffer {
  return {
    goalId: GOAL_ID,
    reasons: ["progress plateaued"],
    epilogue: "The story is over.",
    status: "pending",
  };
}

function makeSelfVerdict(): SelfVerdict {
  return {
    agentId: AGENT,
    goalId: GOAL_ID,
    claim: "reached",
    confidence: 1,
    feltSignal: 0.8,
    narrative: "Overcome the repeated block in ch_public: reached",
  };
}

function makeEntry(
  goalId: string,
  claim: SelfVerdict["claim"] = "reached",
  source: GoalSelfVerdictEntry["source"] = "llm",
): GoalSelfVerdictEntry {
  return {
    goalId,
    verdict: {
      agentId: AGENT,
      goalId,
      claim,
      confidence: 1,
      feltSignal: 0.8,
      narrative: `${goalId}: ${claim}`,
    },
    source,
  };
}

/**
 * Goal-event builder for the parity log (goal-registry.test.ts makeCommitted
 * style, replicated here — that suite does not export it). Explicit
 * id/createdAt/pulseIndex keep the appended commit order fully determined.
 */
function goalEvent(
  type: CommittedEvent["type"],
  payload: SimulationEvent["payload"],
  pulseIndex: number,
): SimulationEvent {
  return {
    id: `evt-${type}-${pulseIndex}`,
    simulationId: SIM_ID,
    channelId: CHANNEL,
    actorId: "system",
    type,
    payload,
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex,
    createdAt: pulseIndex * 1000,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "goal_layer",
    },
  };
}

describe("SqliteGoalRegistryRepository", () => {
  it("saveSelfVerdicts + loadSelfVerdicts round-trip", async () => {
    const repo = new SqliteGoalRegistryRepository(db);
    const entry = makeEntry(GOAL_ID);

    await repo.saveSelfVerdicts(SIM_ID, [entry]);

    const loaded = await repo.loadSelfVerdicts(SIM_ID);
    expect(loaded).toEqual([entry]);
  });

  it("upsert overwrites the same-goal row", async () => {
    const repo = new SqliteGoalRegistryRepository(db);
    await repo.saveSelfVerdicts(SIM_ID, [makeEntry(GOAL_ID, "in_progress")]);

    await repo.saveSelfVerdicts(SIM_ID, [makeEntry(GOAL_ID, "reached")]);

    const loaded = await repo.loadSelfVerdicts(SIM_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.verdict.claim).toBe("reached");
    expect(loaded[0]?.source).toBe("llm");
  });

  it("saveSelfVerdicts replaces the whole junction: dropped goals are deleted, not resurrected", async () => {
    const repo = new SqliteGoalRegistryRepository(db);
    await repo.saveSelfVerdicts(SIM_ID, [
      makeEntry("goal-a", "in_progress"),
      makeEntry("goal-b", "reached"),
    ]);

    // Next write-through drops goal-a from the junction.
    await repo.saveSelfVerdicts(SIM_ID, [makeEntry("goal-b", "reached")]);

    const loaded = await repo.loadSelfVerdicts(SIM_ID);
    expect(loaded.map((entry) => entry.goalId)).toEqual(["goal-b"]);

    // Empty write-through clears the simulation's whole junction.
    await repo.saveSelfVerdicts(SIM_ID, []);
    expect(await repo.loadSelfVerdicts(SIM_ID)).toEqual([]);
  });

  it("keeps one row per goal and orders by goal_id", async () => {
    const repo = new SqliteGoalRegistryRepository(db);
    await repo.saveSelfVerdicts(SIM_ID, [
      makeEntry("goal-z", "in_progress"),
      makeEntry("goal-a", "reached", "deterministic"),
      makeEntry("goal-m", "abandoned"),
    ]);

    const loaded = await repo.loadSelfVerdicts(SIM_ID);
    expect(loaded.map((entry) => entry.goalId)).toEqual(["goal-a", "goal-m", "goal-z"]);
    expect(loaded[0]?.source).toBe("deterministic");
  });

  it("loadSelfVerdicts returns an empty list for an unknown simulation", async () => {
    const repo = new SqliteGoalRegistryRepository(db);
    await repo.saveSelfVerdicts(SIM_ID, [makeEntry(GOAL_ID)]);

    expect(await repo.loadSelfVerdicts("ghost-sim")).toEqual([]);
  });
});

describe("GoalRegistry sqlite parity (AC-1)", () => {
  it("replay-only and sqlite-restored registries agree on one committed log; the junction is the exactly-one divergence", async () => {
    const eventRepo = new SqliteEventRepository(db);
    const proposal = makeProposal();
    const log: CommittedEvent[] = await eventRepo.append(SIM_ID, [
      goalEvent("goal_proposed", { goalId: proposal.id, proposal }, 1),
      goalEvent("goal_accepted", { goalId: proposal.id, goal: makeGoal() }, 2),
      goalEvent("world_verdict", { goalId: proposal.id, verdict: makeVerdict() }, 3),
      goalEvent(
        "delusion_gap_sampled",
        {
          goalId: proposal.id,
          agentId: AGENT,
          at: 3000,
          magnitude: 0,
          divergenceFromLog: 0,
          divergenceFromWorld: 0,
        },
        4,
      ),
      goalEvent("ending_offered", { goalId: proposal.id, offer: makeOffer() }, 5),
    ]);

    // Pre-restart registry: replay + the D-23 junction entry the evaluator
    // would have written during the run.
    const preRestart = new GoalRegistry(log);
    preRestart.recordSelfVerdict(GOAL_ID, makeSelfVerdict(), "llm");
    const entries: GoalSelfVerdictEntry[] = preRestart
      .getGoals()
      .flatMap((goal) => {
        const stored = preRestart.getSelfVerdict(goal.id);
        return stored
          ? [{ goalId: goal.id, verdict: stored.verdict, source: stored.source }]
          : [];
      });
    const repo = new SqliteGoalRegistryRepository(db);
    await repo.saveSelfVerdicts(SIM_ID, entries);

    // Replay-only side: a registry built from the log alone never sees the
    // junction (D-23).
    const replay = new GoalRegistry(log);
    expect(replay.getSelfVerdict(GOAL_ID)).toBeUndefined();

    // Sqlite-restored side: replay + stored-junction overlay (T408 shape).
    const restored = new GoalRegistry(log);
    for (const entry of await repo.loadSelfVerdicts(SIM_ID)) {
      restored.recordSelfVerdict(entry.goalId, entry.verdict, entry.source);
    }

    // The five replayable shapes agree cell-by-cell between the builders.
    expect(restored.getProposals()).toEqual(replay.getProposals());
    expect(restored.getGoals()).toEqual(replay.getGoals());
    expect(restored.getLatestVerdict(GOAL_ID)).toEqual(replay.getLatestVerdict(GOAL_ID));
    expect(restored.getGapHistory(GOAL_ID)).toEqual(replay.getGapHistory(GOAL_ID));
    expect(restored.getPendingOffer()).toEqual(replay.getPendingOffer());

    // The exactly-one divergence: the junction persists only on the
    // sqlite-backed side, and equals what the run wrote.
    expect(restored.getSelfVerdict(GOAL_ID)).toEqual(preRestart.getSelfVerdict(GOAL_ID));

    // The restored registry equals the pre-restart registry on all six shapes.
    expect(restored.getProposals()).toEqual(preRestart.getProposals());
    expect(restored.getGoals()).toEqual(preRestart.getGoals());
    expect(restored.getLatestVerdict(GOAL_ID)).toEqual(preRestart.getLatestVerdict(GOAL_ID));
    expect(restored.getGapHistory(GOAL_ID)).toEqual(preRestart.getGapHistory(GOAL_ID));
    expect(restored.getSelfVerdict(GOAL_ID)).toEqual(preRestart.getSelfVerdict(GOAL_ID));
    expect(restored.getPendingOffer()).toEqual(preRestart.getPendingOffer());
  });
});