import { z } from "zod";

export const GoalKindSchema = z.enum([
  "task_claim",
  "affiliation",
  "status_dominance",
  "resolve",
  "master_skill",
  "legacy",
]);

export const GoalOriginSchema = z.enum(["crystallized_from", "social_convention"]);

export const GoalStatusSchema = z.enum([
  "proposed",
  "active",
  "believed_reached",
  "abandoned",
  "world_verified_reached",
]);

export const WorldStatePredicateSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  observableCriteria: z.array(z.string().min(1)),
});

export const ProgressScoreSchema = z.object({
  distanceToTarget: z.number().min(0).max(1),
  progressRate: z.number().min(0).max(1),
  plateaued: z.boolean(),
});

export const EmergentGoalSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  targetState: WorldStatePredicateSchema,
  kind: GoalKindSchema,
  status: GoalStatusSchema,
  origin: GoalOriginSchema,
  sourceEventIds: z.array(z.string().min(1)),
  createdAt: z.number().int().positive(),
});

export const SelfClaimSchema = z.enum(["reached", "in_progress", "abandoned"]);

export const SelfVerdictSchema = z.object({
  agentId: z.string().min(1),
  goalId: z.string().min(1),
  claim: SelfClaimSchema,
  confidence: z.number().min(0).max(1),
  feltSignal: z.number().min(0).max(1),
  narrative: z.string().min(1),
});

export const RatificationStateSchema = z.enum([
  "uncontested",
  "contested",
  "ratified",
  "rejected",
]);

export const WorldDeterminationSchema = z.enum(["reached", "not_reached", "contested"]);

export const WorldVerdictSchema = z.object({
  goalId: z.string().min(1),
  objective: ProgressScoreSchema,
  consensus: RatificationStateSchema,
  determination: WorldDeterminationSchema,
  confidence: z.number().min(0).max(1),
});

export const DelusionWeightsSchema = z.object({
  wSignal: z.number().min(0).max(1),
  wSocial: z.number().min(0).max(1),
  wIdentity: z.number().min(0).max(1),
  revisionThreshold: z.number().min(0).max(1),
});

export const DelusionGapSampleSchema = z.object({
  at: z.number().int().positive(),
  magnitude: z.number().min(0).max(1),
  divergenceFromLog: z.number().min(0).max(1),
  divergenceFromWorld: z.number().min(0).max(1),
});

export const DelusionGapSchema = z.object({
  goalId: z.string().min(1),
  agentId: z.string().min(1),
  magnitude: z.number().min(0).max(1),
  divergenceFromLog: z.number().min(0).max(1),
  divergenceFromWorld: z.number().min(0).max(1),
  history: z.array(DelusionGapSampleSchema),
});

export const EndingOfferStatusSchema = z.enum(["pending", "accepted", "declined"]);

export const EndingOfferSchema = z.object({
  goalId: z.string().min(1),
  reasons: z.array(z.string().min(1)),
  epilogue: z.string().min(1),
  status: EndingOfferStatusSchema,
});

export const GoalProposalSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  targetState: WorldStatePredicateSchema,
  kind: GoalKindSchema,
  origin: GoalOriginSchema,
  sourceEventIds: z.array(z.string().min(1)),
  createdAt: z.number().int().positive(),
});

export const GoalRatingSchema = z.object({
  proposalId: z.string().min(1),
  recommendAccept: z.boolean(),
  score: z.number().min(0).max(1),
  empowermentGain: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)),
});

export const EndConditionResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("end_offered"),
    offer: EndingOfferSchema,
  }),
  z.object({
    kind: z.literal("re_goal"),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("continue"),
    reason: z.string().min(1),
  }),
]);

export const SynthesizerModeSchema = z.enum(["deterministic", "llm"]);

export const SynthesizerConfigSchema = z.object({
  mode: SynthesizerModeSchema,
  intervalPulses: z.number().int().positive(),
  maxCandidatesPerReview: z.number().int().positive(),
});

export const AgentContextDigestSchema = z.object({
  personaId: z.string().min(1),
  recentMemories: z.array(
    z.object({
      summary: z.string().min(1),
      sourceEventIds: z.array(z.string()),
    }),
  ),
  privateMotiveSummaries: z.array(z.string()),
});

export const GoalSynthesizerInputSchema = z.object({
  agentId: z.string().min(1),
  candidates: z.array(GoalProposalSchema),
  context: AgentContextDigestSchema,
});

export const GoalSynthesisResultSchema = z.object({
  proposal: GoalProposalSchema,
  narrativeFraming: z.string().min(1),
  confidence: z.number().min(0).max(1),
  synthesizer: SynthesizerModeSchema,
});

export const AcceptanceModeSchema = z.enum(["auto", "agent"]);

export const GoalAcceptanceDecisionSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  reason: z.string().optional(),
});