import { memoryWriteProposalFieldContract, type AgentRuntimeInput, type Memory } from "@perfectman/shared";
import { CANONICAL_TEMPLATE_VERSION_INPUT } from "./action-intent-prompt-builder.js";
import { GENERIC_PROMPT_PROFILE, type PersonaPromptProfile } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";
import { promptVersionHash } from "./prompt-version.js";

/**
 * Background-reflection prompt: relationship memory, emotional residue, and
 * pending-intention consolidation (docs/architecture/application.md,
 * "Memory And Continuity"). A reasoning-only surface — no visible chat text
 * is produced here.
 *
 * Field gating follows docs/architecture/prompt-system.md's field-purpose
 * matrix for this purpose: identityFrame and relationshipBiases are in;
 * voiceGuidelines and styleExamples are OUT (writing guidance is noise when
 * the model is consolidating memory, not composing speech).
 */
export class BackgroundReflectionPromptBuilder {
  static build(input: AgentRuntimeInput, profile: PersonaPromptProfile): BuiltPrompt {
    const { system, user } = this.render(input, profile);
    const inputTokensEstimate = Math.ceil((system.length + user.length) / 4);

    return {
      system,
      user,
      inputTokensEstimate,
      purpose: "background_reflection",
      version: promptVersionHash([system, user]),
      templateVersion: this.templateVersion(),
    };
  }

  private static render(input: AgentRuntimeInput, profile: PersonaPromptProfile): { system: string; user: string } {
    const packet = input.perceptionPacket;

    const system = [
      this.renderReflectionIdentity(profile),
      this.renderContract(),
    ]
      .filter((block) => block.length > 0)
      .join("\n\n");

    const user = [
      "### CURRENT MOMENT",
      this.renderRecentEvents(packet.visibleContextEvents),
      this.renderUnresolvedMemories(packet.relevantMemories),
      `- Current emotional state: ${packet.translatedEmotionalState.moodDescription}`,
      "",
      "Consolidate what this moment left behind. Respond ONLY with the JSON object from the contract.",
    ].join("\n");

    return { system, user };
  }

  private static cachedTemplateVersion: string | undefined;

  /**
   * Content hash of a render against the shared fixed canonical input,
   * computed once and cached. See `CANONICAL_TEMPLATE_VERSION_INPUT` for why
   * this differs from `version` (which hashes the real per-pulse render).
   */
  private static templateVersion(): string {
    if (this.cachedTemplateVersion === undefined) {
      const { system, user } = this.render(CANONICAL_TEMPLATE_VERSION_INPUT, GENERIC_PROMPT_PROFILE);
      this.cachedTemplateVersion = promptVersionHash([system, user]);
    }
    return this.cachedTemplateVersion;
  }

  private static renderReflectionIdentity(profile: PersonaPromptProfile): string {
    const biases = Object.entries(profile.relationshipBiases);
    const renderedBiases =
      biases.length > 0
        ? biases
            .map(([agentId, bias]) => `- ${agentId}: ${bias.view} (warmth: ${bias.warmth}, trust: ${bias.trust})`)
            .join("\n")
        : "- (no strong prior feelings)";

    return `### REFLECTION IDENTITY
You are reflecting privately on a chat-room conversation. This is inner reasoning about relationships and feelings — nothing you produce here is sent to the room.

Identity: ${profile.displayName} — ${profile.identityFrame}

How you tend to feel about the others:
${renderedBiases}`;
  }

  /**
   * The `consolidations` output contract, derived from
   * `MemoryWriteProposalSchema` (`@perfectman/shared`) via
   * `memoryWriteProposalFieldContract()` instead of hand-written prose, so it
   * can never drift from what the parser downstream actually accepts.
   */
  private static renderContract(): string {
    const fields = memoryWriteProposalFieldContract()
      .map((field) => `  - ${field}`)
      .join("\n");

    return `### OUTPUT CONTRACT
Return ONLY a JSON object, no prose, no markdown:
{"consolidations": [item, ...]}

Each item is a memory-write proposal with these fields:
${fields}

Rules:
- 0 to 3 items. An empty list is a valid answer — only consolidate what actually left residue.
- Use "relationship" for how you now see a specific person; "pending_intention" for something you still want to do later; "emotional_residue" for leftover feeling without a target action; "social_theory" for a guess about group dynamics.
- Never invent agent ids that are not in the transcript.`;
  }

  private static renderRecentEvents(events: AgentRuntimeInput["perceptionPacket"]["visibleContextEvents"]): string {
    if (events.length === 0) return "(nothing happened recently)";
    const lines = events.slice(-12).map((e) => {
      const p = e.payload as Record<string, unknown>;
      const text = typeof p.content === "string" ? `: ${p.content}` : "";
      return `[p${e.pulseIndex}] ${e.actorId} (${e.type})${text}`;
    });
    return `Recent moments:\n${lines.join("\n")}`;
  }

  private static renderUnresolvedMemories(memories: readonly Memory[]): string {
    const unresolved = memories.filter((m) => m.unresolved && m.summary.length > 0);
    if (unresolved.length === 0) return "Unresolved memories: (none carried into this scene)";
    const lines = unresolved.map((m) => `- ${m.summary}`);
    return `Unresolved memories still on your mind:\n${lines.join("\n")}`;
  }
}
