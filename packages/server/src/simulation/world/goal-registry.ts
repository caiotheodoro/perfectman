import type {
  CommittedEvent,
  DelusionGapSample,
  EmergentGoal,
  EndingOffer,
  GoalProposal,
  WorldVerdict,
} from "@perfectman/shared";

const GAP_HISTORY_CAP = 32;

export type GoalRegistryState = {
  proposals: Map<string, GoalProposal>;
  goals: Map<string, EmergentGoal>;
  verdicts: Map<string, WorldVerdict>;
  gapHistory: Map<string, DelusionGapSample[]>;
  pendingOffer: { offer: EndingOffer; offeredAtPulse: number } | null;
};

/**
 * Per-simulation goal state (RateLimitGate pattern): in-memory, rebuilt from
 * the committed log on construction. Goals are never seeded — the registry
 * only holds proposals the world layer accepted mid-run.
 */
export class GoalRegistry {
  private state: GoalRegistryState;

  constructor(log: CommittedEvent[] = []) {
    this.state = GoalRegistry.rebuildFromLog(log);
  }

  /** Pure replay of the six goal event types back into registry state. */
  static rebuildFromLog(log: CommittedEvent[]): GoalRegistryState {
    const state: GoalRegistryState = {
      proposals: new Map(),
      goals: new Map(),
      verdicts: new Map(),
      gapHistory: new Map(),
      pendingOffer: null,
    };
    for (const event of log) {
      switch (event.type) {
        case "goal_proposed": {
          const proposal = event.payload["proposal"] as GoalProposal | undefined;
          if (proposal) state.proposals.set(proposal.id, proposal);
          break;
        }
        case "goal_accepted": {
          const goal = event.payload["goal"] as EmergentGoal | undefined;
          if (goal) {
            state.proposals.delete(goal.id);
            state.goals.set(goal.id, goal);
          }
          break;
        }
        case "goal_declined": {
          const proposal = event.payload["proposal"] as GoalProposal | undefined;
          if (proposal) state.proposals.delete(proposal.id);
          break;
        }
        case "world_verdict": {
          const verdict = event.payload["verdict"] as WorldVerdict | undefined;
          if (verdict) state.verdicts.set(verdict.goalId, verdict);
          break;
        }
        case "delusion_gap_sampled": {
          const goalId = event.payload["goalId"];
          const sample = gapSampleFromPayload(event.payload);
          if (typeof goalId === "string" && sample) {
            appendGapSample(state.gapHistory, goalId, sample);
          }
          break;
        }
        case "ending_offered": {
          const offer = event.payload["offer"] as EndingOffer | undefined;
          if (offer && state.pendingOffer === null) {
            state.pendingOffer = { offer, offeredAtPulse: event.pulseIndex };
          }
          break;
        }
        default:
          break;
      }
    }
    return state;
  }

  recordProposal(proposal: GoalProposal): void {
    this.state.proposals.set(proposal.id, proposal);
  }

  hasProposal(proposalId: string): boolean {
    return this.state.proposals.has(proposalId);
  }

  getProposals(): GoalProposal[] {
    return [...this.state.proposals.values()];
  }

  promoteProposal(proposalId: string): EmergentGoal | null {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return null;
    const goal: EmergentGoal = {
      id: proposal.id,
      agentId: proposal.agentId,
      title: proposal.title,
      targetState: proposal.targetState,
      kind: proposal.kind,
      status: "active",
      origin: proposal.origin,
      sourceEventIds: [...proposal.sourceEventIds],
      createdAt: proposal.createdAt,
    };
    this.state.proposals.delete(proposalId);
    this.state.goals.set(goal.id, goal);
    return goal;
  }

  declineProposal(proposalId: string): void {
    this.state.proposals.delete(proposalId);
  }

  getGoals(): EmergentGoal[] {
    return [...this.state.goals.values()];
  }

  getGoal(goalId: string): EmergentGoal | undefined {
    return this.state.goals.get(goalId);
  }

  recordVerdict(verdict: WorldVerdict): void {
    this.state.verdicts.set(verdict.goalId, verdict);
  }

  getLatestVerdict(goalId: string): WorldVerdict | undefined {
    return this.state.verdicts.get(goalId);
  }

  recordGapSample(goalId: string, sample: DelusionGapSample): void {
    appendGapSample(this.state.gapHistory, goalId, sample);
  }

  getGapHistory(goalId: string): DelusionGapSample[] {
    return this.state.gapHistory.get(goalId) ?? [];
  }

  /** Single-offer invariant: a second offer is refused. */
  setPendingOffer(offer: EndingOffer, offeredAtPulse: number): boolean {
    if (this.state.pendingOffer !== null) return false;
    this.state.pendingOffer = { offer, offeredAtPulse };
    return true;
  }

  getPendingOffer(): { offer: EndingOffer; offeredAtPulse: number } | null {
    return this.state.pendingOffer;
  }
}

function appendGapSample(
  history: Map<string, DelusionGapSample[]>,
  goalId: string,
  sample: DelusionGapSample,
): void {
  const list = history.get(goalId) ?? [];
  const prev = list[list.length - 1];
  const next =
    prev !== undefined && prev.at === sample.at
      ? [...list.slice(0, -1), sample]
      : [...list, sample];
  history.set(goalId, next.slice(-GAP_HISTORY_CAP));
}

function gapSampleFromPayload(
  payload: Record<string, unknown>,
): DelusionGapSample | null {
  const at = payload["at"];
  const magnitude = payload["magnitude"];
  const divergenceFromLog = payload["divergenceFromLog"];
  const divergenceFromWorld = payload["divergenceFromWorld"];
  if (
    typeof at !== "number" ||
    typeof magnitude !== "number" ||
    typeof divergenceFromLog !== "number" ||
    typeof divergenceFromWorld !== "number"
  ) {
    return null;
  }
  return { at, magnitude, divergenceFromLog, divergenceFromWorld };
}