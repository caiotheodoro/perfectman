import type {
  AgentContextDigest,
  EmergentGoal,
  GoalProposal,
} from "@perfectman/shared";
import type { BuiltPrompt } from "../../agent/agent-runtime.types.js";
import { promptVersionHash } from "../../agent/prompt-version.js";

export const GOAL_LAYER_TEMPLATE_VERSION = "goal-layer-v1";
const DIGEST_MEMORY_CAP = 10;
const DIGEST_MOTIVE_CAP = 5;

export type GoalLayerPromptInput = {
  agentId: string;
  digest: AgentContextDigest;
  candidates: GoalProposal[];
  activeGoals: EmergentGoal[];
};

/**
 * The goal-layer prompt surface: one combined call carries both the synthesis
 * input (candidates) and the self-verdict input (active goals) over the shared
 * D-13 surface, so the interval review costs at most one call per agent.
 */
export function buildGoalLayerPrompt(input: GoalLayerPromptInput): BuiltPrompt {
  const systemPrompt = renderSystem(input.digest);
  const userPrompt = renderUser(input);
  const totalChars = systemPrompt.length + userPrompt.length;
  return {
    system: systemPrompt,
    user: userPrompt,
    inputTokensEstimate: Math.ceil(totalChars / 4),
    purpose: "goal_synthesis",
    version: promptVersionHash([systemPrompt, userPrompt]),
    templateVersion: GOAL_LAYER_TEMPLATE_VERSION,
  };
}

function renderSystem(digest: AgentContextDigest): string {
  return [
    `You are goal architecture for the agent "${digest.personaId}" in an ongoing online-community simulation.`,
    "You shape the agent's evolving goal structure: you frame candidate goals in the agent's own voice and you report how the agent currently relates to every one of its active goals.",
    "",
    "Framing rules:",
    "- Autonomy (SDT): only endorse a candidate the agent would experience as its own choice — never an imposed task, never a bare transcript of its history.",
    "- Goldilocks critique: the goal must sit in the interesting middle of novelty by learnability; trivial and out-of-reach candidacies get critiqued.",
    "- Voice: narrativeFraming is the agent speaking, not an evaluator describing it.",
    "- Honesty: confidence reflects genuine self-assessment of fit; a selfVerdict claim reflects what the agent believes it has reached, however deluded that belief may be.",
    "",
    "Output contract — respond with ONE valid JSON object with exactly these two keys:",
    '- "proposals": array of endorsed candidates; each object has "proposalId" (the bracketed id of the candidate), "narrativeFraming" (the in-character framing), "confidence" (0..1), and "synthesizer" (always "llm").',
    '- "selfVerdicts": array of self-assessments for active goals; each object has "agentId", "goalId" (the bracketed id of the active goal), "claim" ("reached" | "in_progress" | "abandoned"), "confidence" (0..1), "feltSignal" (0..1), and "narrative".',
    "",
    "Return only the JSON object. No prose, no markdown fences, no thinking blocks.",
  ].join("\n");
}

function renderUser(input: GoalLayerPromptInput): string {
  const { digest, candidates, activeGoals } = input;
  const lines: string[] = [];
  const memories = digest.recentMemories.slice(0, DIGEST_MEMORY_CAP);
  const motives = digest.privateMotiveSummaries.slice(0, DIGEST_MOTIVE_CAP);

  lines.push("Agent state:", "");
  if (memories.length === 0) {
    lines.push("Recent memories: none.");
  } else {
    lines.push("Recent memories:");
    for (const memory of memories) {
      const sources = memory.sourceEventIds.length > 0 ? memory.sourceEventIds.join(", ") : "none";
      lines.push(`- ${memory.summary} (sources: ${sources})`);
    }
  }
  if (motives.length === 0) {
    lines.push("Top private motives: none.");
  } else {
    lines.push("Top private motives:");
    for (const motive of motives) lines.push(`- ${motive}`);
  }

  lines.push("", "Candidate goals crystallized from recent history:");
  if (candidates.length === 0) {
    lines.push("- none");
  } else {
    for (const candidate of candidates) {
      lines.push(
        `- [${candidate.id}] ${candidate.title} | ${candidate.targetState.description}`,
      );
    }
  }

  lines.push("", "Active goals to self-assess:");
  if (activeGoals.length === 0) {
    lines.push("- none");
  } else {
    for (const goal of activeGoals) {
      lines.push(
        `- [${goal.id}] ${goal.title} | ${goal.targetState.description}`,
      );
    }
  }
  return lines.join("\n");
}
