import { describe, expect, it } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import {
  projectTrajectory,
  type RecordedEndCondition,
} from "../goal-scenario-runner.js";

const SIM_ID = "sim_proj";

function baseEvent(overrides: Partial<CommittedEvent>): CommittedEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    simulationId: SIM_ID,
    channelId: "general",
    actorId: "system",
    type: "goal_proposed",
    payload: {},
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
    createdAt: 1000,
    ...overrides,
  };
}

const PROPOSAL = {
  id: "crystal-ana-resolve-general",
  agentId: "ana",
  title: "Overcome the repeated block in general",
  targetState: {
    id: "predicate-resolve-general",
    description: "no more blocked intents from ana in general",
    observableCriteria: ["no more blocked intents from ana in general"],
  },
  kind: "resolve",
  origin: "crystallized_from",
  sourceEventIds: ["seed-1"],
  createdAt: 1000,
};

const GOAL = { ...PROPOSAL, status: "active" };

function gapEvent(goalId: string, at: number, pulseIndex: number): CommittedEvent {
  return baseEvent({
    type: "delusion_gap_sampled",
    payload: {
      goalId,
      agentId: "ana",
      at,
      magnitude: 0.5,
      divergenceFromLog: 0.4,
      divergenceFromWorld: 1,
    },
    pulseIndex,
  });
}

function record(
  goalId: string,
  kind: RecordedEndCondition["kind"],
  reason?: string,
): RecordedEndCondition {
  return { goalId, agentId: "ana", pulseIndex: 3, kind, reason };
}

describe("projectTrajectory", () => {
  it("parses proposed/accepted goals and maps a reached termination from ending_offered + goal_end_offered stop", () => {
    const events: CommittedEvent[] = [
      baseEvent({
        type: "goal_proposed",
        payload: { goalId: PROPOSAL.id, proposal: PROPOSAL, narrativeFraming: "x", confidence: 1, synthesizer: "deterministic" },
      }),
      baseEvent({
        type: "goal_accepted",
        payload: { goalId: GOAL.id, goal: GOAL },
        pulseIndex: 1,
      }),
      gapEvent(GOAL.id, 2000, 1),
      gapEvent(GOAL.id, 3000, 2),
      baseEvent({
        type: "ending_offered",
        payload: {
          goalId: GOAL.id,
          offer: {
            goalId: GOAL.id,
            reasons: ["world verdict: reached", "completion beat present", "meaning made"],
            epilogue: "the story holds",
            status: "pending",
          },
        },
        pulseIndex: 3,
      }),
      baseEvent({
        type: "simulation_stopped",
        payload: {
          simulationId: SIM_ID,
          endReason: "goal_end_offered",
          endingOffer: { goalId: GOAL.id, reasons: ["world verdict: reached"], epilogue: "the story holds", status: "pending" },
        },
        pulseIndex: 3,
      }),
    ];
    const rows = projectTrajectory(events, [record(GOAL.id, "end_offered")], { pulseCap: 120, pulsesRun: 4 });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.goalId).toBe(GOAL.id);
    expect(row.agentId).toBe("ana");
    expect(row.proposed).toBe(true);
    expect(row.accepted).toBe(true);
    expect(row.declined).toBe(false);
    expect(row.gapSamples.map((s) => s.at)).toEqual([2000, 3000]);
    expect(row.termination).toBe("reached");
  });

  it("maps a plateau-based offer to story-is-over", () => {
    const events: CommittedEvent[] = [
      baseEvent({ type: "goal_accepted", payload: { goalId: GOAL.id, goal: GOAL } }),
      baseEvent({
        type: "ending_offered",
        payload: {
          goalId: GOAL.id,
          offer: {
            goalId: GOAL.id,
            reasons: ["progress plateaued", "no next goal survived the critic"],
            epilogue: "The story is over",
            status: "pending",
          },
        },
      }),
      baseEvent({
        type: "simulation_stopped",
        payload: {
          simulationId: SIM_ID,
          endReason: "goal_end_offered",
          endingOffer: { goalId: GOAL.id, reasons: ["progress plateaued"], epilogue: "The story is over", status: "pending" },
        },
      }),
    ];
    const rows = projectTrajectory(events, [record(GOAL.id, "end_offered")], { pulseCap: 120, pulsesRun: 4 });
    expect(rows[0]!.termination).toBe("story-is-over");
  });

  it("maps a cap stop to pulse-cap-stop for every goal, distinct from a goal_end_offered stop", () => {
    const events: CommittedEvent[] = [
      baseEvent({ type: "goal_accepted", payload: { goalId: GOAL.id, goal: GOAL }, pulseIndex: 2 }),
      gapEvent(GOAL.id, 2000, 5),
    ];
    const rows = projectTrajectory(events, [record(GOAL.id, "re_goal", "deluded achiever arc")], {
      pulseCap: 120,
      pulsesRun: 120,
    });
    expect(rows[0]!.termination).toBe("pulse-cap-stop");
  });

  it("derives re_goal and continue terminations from the recorder log when the run did not stop", () => {
    const second = { ...GOAL, id: "crystal-carla-legacy-ch_w2" };
    const events: CommittedEvent[] = [
      baseEvent({ type: "goal_accepted", payload: { goalId: GOAL.id, goal: GOAL }, pulseIndex: 1 }),
      baseEvent({ type: "goal_accepted", payload: { goalId: second.id, goal: second }, pulseIndex: 2 }),
      gapEvent(GOAL.id, 2000, 1),
    ];
    const rows = projectTrajectory(
      events,
      [
        record(GOAL.id, "re_goal", "agent claims reached but the world verdict is not_reached"),
        record(second.id, "continue", "arc still open"),
        record(GOAL.id, "re_goal", "agent claims reached but the world verdict is not_reached"),
      ],
      { pulseCap: 120, pulsesRun: 30 },
    );
    const byGoal = new Map(rows.map((row) => [row.goalId, row]));
    expect(byGoal.get(GOAL.id)!.termination).toBe("re_goal");
    expect(byGoal.get(second.id)!.termination).toBe("continue");
  });

  it("excludes a simulation_stopped on a non-goal path from termination mapping", () => {
    const events: CommittedEvent[] = [
      baseEvent({ type: "goal_accepted", payload: { goalId: GOAL.id, goal: GOAL }, pulseIndex: 1 }),
      baseEvent({ type: "simulation_stopped", payload: { simulationId: SIM_ID, endReason: "operator_requested" }, pulseIndex: 9 }),
    ];
    const rows = projectTrajectory(events, [record(GOAL.id, "continue", "arc still open")], { pulseCap: 120, pulsesRun: 10 });
    // The stop is not a goal_end_offered and the cap was not hit: the last
    // recorder entry owns the termination.
    expect(rows[0]!.termination).toBe("continue");
  });

  it("returns [] for an empty event log", () => {
    expect(projectTrajectory([], [], { pulseCap: 120, pulsesRun: 0 })).toEqual([]);
  });

  it("emits a declined proposal row with no gap samples", () => {
    const events: CommittedEvent[] = [
      baseEvent({
        type: "goal_proposed",
        payload: { goalId: PROPOSAL.id, proposal: PROPOSAL, narrativeFraming: "x", confidence: 1, synthesizer: "deterministic" },
      }),
      baseEvent({ type: "goal_declined", payload: { goalId: PROPOSAL.id, proposal: PROPOSAL } }),
    ];
    const rows = projectTrajectory(events, [], { pulseCap: 120, pulsesRun: 30 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposed).toBe(true);
    expect(rows[0]!.declined).toBe(true);
    expect(rows[0]!.accepted).toBe(false);
    expect(rows[0]!.gapSamples).toEqual([]);
    expect(rows[0]!.termination).toBe("continue");
  });

  it("orders gap samples by at regardless of commit order", () => {
    const events: CommittedEvent[] = [
      gapEvent(GOAL.id, 3000, 3),
      gapEvent(GOAL.id, 1000, 1),
      gapEvent(GOAL.id, 2000, 2),
      baseEvent({ type: "goal_accepted", payload: { goalId: GOAL.id, goal: GOAL } }),
    ];
    const rows = projectTrajectory(events, [], { pulseCap: 120, pulsesRun: 4 });
    expect(rows[0]!.gapSamples.map((s) => s.at)).toEqual([1000, 2000, 3000]);
  });
});