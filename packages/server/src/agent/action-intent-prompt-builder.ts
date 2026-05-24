import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";
import type { PersonaPromptProfile } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";

export class ActionIntentPromptBuilder {
  /**
   * Builds the V1 action-intent prompt.
   * This is the only active production prompt surface today.
   */
  static build(
    input: AgentRuntimeInput,
    profile: PersonaPromptProfile
  ): BuiltPrompt {
    const { perceptionPacket } = input;
    const { translatedEmotionalState } = perceptionPacket;

    // --- SECTION 1: Persona Identity (System) ---
    const systemSections: string[] = [];
    const identityLines = [
      `- **Display Name**: ${profile.displayName}`,
      `- **Persona Vibe**: ${profile.identityFrame}`,
      `- **Primary Language**: ${profile.language === "pt-BR" ? "Portuguese (pt-BR)" : "English"}`,
    ].join("\n");

    const voiceGuidelinesBlock =
      `\n\nVoice Guidelines:\n${profile.voiceGuidelines.map((g) => `- ${g}`).join("\n")}`;

    const styleExamplesBlock =
      `\n\nStyle Examples (mimic these natural patterns):\n${profile.styleExamples.map((e) => `"${e}"`).join(", ")}`;

    const relationshipBlock = Object.keys(profile.relationshipBiases).length > 0
      ? `\n\nRelationship Biases & Interpersonal Views:\n${Object.entries(profile.relationshipBiases)
        .map(([peer, bias]) => `- **${peer}**: ${bias}`)
        .join("\n")}`
      : "";

    systemSections.push(`### SECTION 1: YOUR IDENTITY & PERSONA
You are roleplaying as a highly specific person in an online chat room. You must completely inhabit this character.
${identityLines}${voiceGuidelinesBlock}${relationshipBlock}${styleExamplesBlock}`);

    // --- SECTION 8: Output Contract (System) ---
    systemSections.push(`### SECTION 8: OUTPUT CONTRACT & JSON FORMAT
You must respond with a SINGLE valid JSON object matching the schema below.
DO NOT include any conversational introduction, explanation, or markdown codeblocks (no \`\`\`json wrappers).
DO NOT include any chain-of-thought, thinking blocks (<think>), or nested commentary. Return ONLY the JSON object.

JSON Schema:
{
  "id": "A unique string representing this intent (copy from the inputs or generate a new unique string)",
  "actorId": "${input.agentId}",
  "intentType": "Must match one of the available intent types",
  "channelTarget": "Target channel ID if applicable (must match available targets)",
  "personTargets": ["Array of target friend agentIds if applicable"],
  "visibleContent": "Optional text message content (required for 'send_message' or 'reply_to_message')",
  "privateMotiveSummary": "A highly specific natural-language thought explaining your real, raw, hidden motive behind this action. Never leave empty.",
  "emotionDrivers": ["Emotion keywords driving this action (e.g. warmth, jealousy, irritation)"],
  "motivationDrivers": ["Motivation keywords driving this action (e.g. affinity, gossip, exclusion)"],
  "preferredDelay": 0,
  "fallbackIfBlocked": "no_op"
}

Ensure:
- "privateMotiveSummary" is fully developed and explains the *actual* raw human driver behind your action (e.g., "I am ignoring Caio to make him chase me after he ignored my previous message", "I want to gossip with Giovanni in private to build an alliance against Bruno").
- Never leak numeric values or technical code metrics in "visibleContent" or "privateMotiveSummary".`);

    const systemPrompt = systemSections.join("\n\n");

    // --- USER PROMPT ---
    const userSections: string[] = [];

    // Section 2: What Agent Noticed
    userSections.push("### SECTION 2: RECENT CHANNEL EVENTS & CHAT LOG");
    if (perceptionPacket.triggeringEvent) {
      userSections.push(`Triggering Event (What just happened that caught your attention):
${this.formatEvent(perceptionPacket.triggeringEvent)}`);
    } else {
      userSections.push("Triggering Event: No specific event triggered this pulse (you have the initiative to speak or act on your own).");
    }

    if (perceptionPacket.visibleContextEvents.length > 0) {
      userSections.push(`Recent Context (Last messages in visible channels):
${perceptionPacket.visibleContextEvents.map((e) => this.formatEvent(e)).join("\n")}`);
    } else {
      userSections.push("Recent Context: The chat history is currently empty.");
    }

    // Section 3: Social Interpretation
    userSections.push("### SECTION 3: SOCIAL INTERPRETATION");
    if (translatedEmotionalState.socialContext) {
      userSections.push(translatedEmotionalState.socialContext);
    } else {
      userSections.push("The social environment is quiet. No unusual signals stand out.");
    }

    // Section 4: Subjective Emotional State
    userSections.push("### SECTION 4: HOW YOU SUBJECTIVELY FEEL");
    userSections.push(translatedEmotionalState.moodDescription);
    if (translatedEmotionalState.relationalFlavors.length > 0) {
      userSections.push("\nYour current feelings towards others:");
      translatedEmotionalState.relationalFlavors.forEach((rf) => {
        userSections.push(`- **${rf.targetAgentId}**: ${rf.description}`);
      });
    }

    // Section 5: Pressures and Inhibitions
    userSections.push("### SECTION 5: FELT URGES & SOCIAL BLOCKS");
    if (translatedEmotionalState.pressureDescriptions.length > 0) {
      userSections.push("Your immediate urges:");
      translatedEmotionalState.pressureDescriptions.forEach((p) => {
        userSections.push(`- Urge: ${p}`);
      });
    } else {
      userSections.push("You feel no strong immediate conversational urges.");
    }

    if (translatedEmotionalState.inhibitionDescriptions.length > 0) {
      userSections.push("\nWhat is holding you back:");
      translatedEmotionalState.inhibitionDescriptions.forEach((inh) => {
        userSections.push(`- Inhibition: ${inh}`);
      });
    }

    // Section 6: Relevant Memories
    userSections.push("### SECTION 6: WHAT YOU REMEMBER");
    if (perceptionPacket.relevantMemories.length > 0) {
      perceptionPacket.relevantMemories.forEach((m) => {
        userSections.push(`- [Memory (${m.type})] ${m.summary} (Tone: ${m.emotionalTone})`);
      });
    } else {
      userSections.push("No specific memories are active in your mind right now.");
    }

    // Section 7: Available Actions
    userSections.push("### SECTION 7: PERMITTED ACTIONS MENU");
    userSections.push("You can ONLY perform one of these actions. Pick a permitted combination:");
    if (input.availableActions.length > 0) {
      input.availableActions.forEach((act) => {
        const targetsDetail = [];
        if (act.channelTargets.length > 0) {
          targetsDetail.push(`Channels: ${act.channelTargets.join(", ")}`);
        }
        if (act.personTargets.length > 0) {
          targetsDetail.push(`People: ${act.personTargets.join(", ")}`);
        }
        userSections.push(`- **${act.intentType}** ${targetsDetail.length > 0 ? `(${targetsDetail.join("; ")})` : ""}${act.blocked ? ` [BLOCKED: ${act.blockReason}]` : ""}`);
      });
    } else {
      userSections.push("- **no_op** (No action available)");
    }

    const userPrompt = userSections.join("\n\n");

    // Estimate input tokens (simple character approximation for safety)
    const totalChars = systemPrompt.length + userPrompt.length;
    const inputTokensEstimate = Math.ceil(totalChars / 4);

    return {
      system: systemPrompt,
      user: userPrompt,
      inputTokensEstimate,
      purpose: "action_intent",
    };
  }

  /**
   * Helper to format a CommittedEvent into a highly readable line in the prompt log.
   */
  private static formatEvent(event: CommittedEvent): string {
    const actor = event.actorId;
    const type = event.type;
    const channel = event.channelId ? `#${event.channelId}` : "";
    
    let content = "";
    if (event.payload && typeof event.payload === "object") {
      const payloadObj = event.payload as Record<string, unknown>;
      if (typeof payloadObj.content === "string") {
        content = `"${payloadObj.content}"`;
      } else if (typeof payloadObj.reaction === "string") {
        content = `reacted with ${payloadObj.reaction}`;
      } else {
        content = JSON.stringify(event.payload);
      }
    }

    switch (type) {
      case "message_sent":
        return `[${actor} in ${channel}]: ${content}`;
      case "reply_sent":
        return `[${actor} in ${channel} (reply)]: ${content}`;
      case "reaction_sent":
        return `[${actor} in ${channel}]: ${content}`;
      case "channel_created":
        return `[System]: ${actor} created a new private channel ${channel}`;
      case "agent_invited":
        return `[System]: ${actor} invited someone to ${channel}`;
      case "presence_changed":
        return `[System]: ${actor} changed presence to ${event.payload?.presence || "unknown"}`;
      case "no_op_recorded":
        return `[System]: ${actor} chose to lurk silently.`;
      default:
        return `[${actor} in ${channel} (${type})]: ${content}`;
    }
  }
}
