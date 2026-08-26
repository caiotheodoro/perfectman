// Goal lifecycle unions — the emergent goal layer sits above the agent level:
// goals are never seeded, they crystallize from the canonical event log mid-run.

export type GoalKind =
  | "task_claim"
  | "affiliation"
  | "status_dominance"
  | "resolve"
  | "master_skill"
  | "legacy";

export type GoalOrigin = "crystallized_from" | "social_convention";

export type GoalStatus =
  | "proposed"
  | "active"
  | "believed_reached"
  | "abandoned"
  | "world_verified_reached";

export type WorldStatePredicate = {
  id: string;
  description: string;
  // Event-log-verifiable conditions that ground the target state
  observableCriteria: string[];
};

export type ProgressScore = {
  distanceToTarget: number; // 0..1 state-space distance remaining; 0 = target reached
  progressRate: number; // fraction of the original gap closed, 0..1
  plateaued: boolean; // no meaningful distance change across recent reviews
};

export type EmergentGoal = {
  id: string;
  agentId: string;
  title: string;
  targetState: WorldStatePredicate;
  kind: GoalKind;
  status: GoalStatus;
  origin: GoalOrigin;
  sourceEventIds: string[]; // crystallizing events from the agent's own history
  createdAt: number;
};

export type SelfClaim = "reached" | "in_progress" | "abandoned";

export type SelfVerdict = {
  agentId: string;
  goalId: string;
  claim: SelfClaim;
  confidence: number; // 0..1
  feltSignal: number; // 0..1 subjective success signal (Coltheart Factor 1)
  narrative: string;
};

export type RatificationState = "uncontested" | "contested" | "ratified" | "rejected";

export type WorldDetermination = "reached" | "not_reached" | "contested";

export type WorldVerdict = {
  goalId: string;
  objective: ProgressScore;
  consensus: RatificationState;
  determination: WorldDetermination;
  confidence: number; // 0..1
};

export type DelusionWeights = {
  wSignal: number; // weight of the felt success signal (Coltheart Factor 1)
  wSocial: number; // weight of social feedback (Leary sociometer)
  wIdentity: number; // identity-threat sensitivity (Cohen & Sherman)
  revisionThreshold: number; // disconfirmation needed before the belief revises
};

export type DelusionGapSample = {
  at: number;
  magnitude: number;
  divergenceFromLog: number;
  divergenceFromWorld: number;
};

export type DelusionGap = {
  goalId: string;
  agentId: string;
  magnitude: number; // 0..1, derived over time — never stored as a flag
  divergenceFromLog: number; // 0..1 self-narrative vs canonical event log
  divergenceFromWorld: number; // 0..1 self-claim vs world determination
  history: DelusionGapSample[];
};

export type EndingOfferStatus = "pending" | "accepted" | "declined";

export type EndingOffer = {
  goalId: string;
  reasons: string[];
  epilogue: string;
  status: EndingOfferStatus;
};

export type GoalProposal = {
  id: string;
  agentId: string;
  title: string;
  targetState: WorldStatePredicate;
  kind: GoalKind;
  origin: GoalOrigin;
  sourceEventIds: string[];
  createdAt: number;
};

export type GoalRating = {
  proposalId: string;
  recommendAccept: boolean;
  score: number; // 0..1 Goldilocks interest (novelty × learnability)
  empowermentGain: number; // 0..1 tie-breaker: expansion of the future action space
  reasons: string[];
};

export type EndConditionResult =
  | { kind: "end_offered"; offer: EndingOffer }
  | { kind: "re_goal"; reason: string }
  | { kind: "continue"; reason: string };

// Goal-synthesis seam — the D-13 LLM slice extends these contracts, never
// reshapes them: provenance discriminates deterministic vs LLM synthesis so
// the divergence/verdict math stays honest regardless of the producing mode.

export type SynthesizerMode = "deterministic" | "llm";

export type SynthesizerConfig = {
  mode: SynthesizerMode;
  intervalPulses: number; // LLM-mode cost gate — synthesis cadence
  maxCandidatesPerReview: number;
};

export type AgentContextDigest = {
  personaId: string;
  recentMemories: Array<{ summary: string; sourceEventIds: string[] }>; // capped 10
  privateMotiveSummaries: string[]; // capped 5
};

export type GoalSynthesizerInput = {
  agentId: string;
  candidates: GoalProposal[];
  context: AgentContextDigest;
};

export type GoalSynthesisResult = {
  proposal: GoalProposal; // enriched
  narrativeFraming: string;
  confidence: number; // 0..1
  synthesizer: SynthesizerMode;
};

export type AcceptanceMode = "auto" | "agent";

export type GoalAcceptanceDecision = {
  decision: "accept" | "decline";
  reason?: string;
};