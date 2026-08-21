import type { AgentRuntimeInput, Memory } from "@perfectman/shared";
import type { PersonaPromptProfile } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";

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
    const packet = input.perceptionPacket;

    const system = [
      this.renderReflectionIdentity(profile),
      this.renderContract(),
    ]
      .filter((block) => block.length > 0)
      .join("\n\n");

    const user = [
      "### CONTEXTO DO MOMENTO",
      this.renderRecentEvents(packet.visibleContextEvents),
      this.renderUnresolvedMemories(packet.relevantMemories),
      `- Estado emocional agora: ${packet.translatedEmotionalState.moodDescription}`,
      "",
      "Consolide o que o momento deixou para trás. Responda ONLY com o JSON object do contrato.",
    ].join("\n");

    const inputTokensEstimate = Math.ceil((system.length + user.length) / 4);

    return {
      system,
      user,
      inputTokensEstimate,
      purpose: "background_reflection",
    };
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

  private static renderContract(): string {
    return `### OUTPUT CONTRACT
Return ONLY a JSON object, no prose, no markdown:
{"consolidations": [
  {
    "type": "episodic|relationship|self|social_theory|pending_intention|emotional_residue",
    "subjectAgentIds": ["agent-id", ...],
    "summary": "one sentence, concrete, first-person",
    "emotionalTone": "one or two words",
    "confidence": 0.0-1.0,
    "unresolved": true|false
  }
]}

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
    const unresolved = memories.filter((m) => m.summary.length > 0);
    if (unresolved.length === 0) return "Unresolved memories: (none carried into this scene)";
    const lines = unresolved.map((m) => `- ${m.summary}${m.unresolved ? " (unresolved)" : ""}`);
    return `Unresolved memories still on your mind:\n${lines.join("\n")}`;
  }
}
