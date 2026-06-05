import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";
import type { PersonaPromptProfile, ScenarioContextBlock } from "./persona-prompt-profile.js";
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
    systemSections.push(this.renderPersonaSection(profile));

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
- "privateMotiveSummary" is fully developed and explains the *actual* raw human driver behind your action (e.g., "I am ignoring a friend to make them chase me after they ignored my previous message", "I want to gossip privately to build an alliance with someone in the group").
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

  private static renderPersonaSection(profile: PersonaPromptProfile): string {
    const language = profile.language === "pt-BR" ? "Portuguese (pt-BR)" : "English";
    const blocks = [
      `### SECTION 1: YOUR IDENTITY & PERSONA\nYou are roleplaying as a specific person in an online chat room. Stay inside this compact runtime profile; do not mention source notes, assessments, or hidden profile metadata.`,
      [
        "Identity:",
        `- **Display Name**: ${profile.displayName}`,
        `- **Primary Language**: ${language}`,
        `- **Frame**: ${profile.identityFrame}`,
      ].join("\n"),
      this.renderListBlock("Core traits", profile.coreTraits),
      this.renderListBlock("Values and motivations", profile.valuesAndMotivations),
      this.renderListBlock("Social presence", profile.socialPresence),
      this.renderListBlock("Thought process", profile.cognitiveStyle),
      this.renderListBlock("Emotional patterns", profile.emotionalPatterns),
      this.renderListBlock("Conflict and repair style", profile.conflictStyle),
      this.renderListBlock("Affection style", profile.affectionStyle),
      this.renderListBlock("Public/private difference", profile.publicPrivateDelta),
      this.renderListBlock("Voice guidelines", profile.voiceGuidelines),
      this.renderStyleExamples(profile),
      this.renderListBlock("Private motive patterns", profile.privateMotivePatterns),
      this.renderListBlock("Hard avoids", profile.hardAvoids),
      this.renderRelationshipBiases(profile),
    ];

    if (profile.scenarioContext) {
      blocks.push(this.renderScenarioContext(profile.scenarioContext));
    }

    return blocks.filter((block) => block.length > 0).join("\n\n");
  }

  private static renderListBlock(title: string, items: string[]): string {
    if (items.length === 0) return "";
    return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
  }

  private static renderStyleExamples(profile: PersonaPromptProfile): string {
    const { styleExamples } = profile;
    const groups = [
      ["default", styleExamples.default],
      ["animated", styleExamples.animated],
      ["dry/low-energy", styleExamples.dryOrLowEnergy],
      ["conflict", styleExamples.conflict],
    ] as const;

    const renderedGroups = groups
      .filter(([, examples]) => examples.length > 0)
      .map(([label, examples]) => `- ${label}: ${examples.map((example) => `"${example}"`).join(", ")}`);

    if (renderedGroups.length === 0) return "";
    return `Tonal/register guide — these show HOW you express yourself (voice, rhythm, brevity), NOT phrases to repeat literally. Always say something substantive:\n${renderedGroups.join("\n")}`;
  }

  private static renderRelationshipBiases(profile: PersonaPromptProfile): string {
    const entries = Object.entries(profile.relationshipBiases);
    if (entries.length === 0) return "";

    const rendered = entries.map(([peer, bias]) => {
      const lines = [
        `- **${peer}**: ${bias.view}`,
        `  - warmth/trust: ${bias.warmth}/${bias.trust}`,
      ];
      if (bias.likelyBehaviors.length > 0) {
        lines.push(`  - likely behaviors: ${bias.likelyBehaviors.join("; ")}`);
      }
      if (bias.triggers.length > 0) {
        lines.push(`  - triggers: ${bias.triggers.join("; ")}`);
      }
      return lines.join("\n");
    });

    return `Relationship-specific views:\n${rendered.join("\n")}`;
  }

  private static renderScenarioContext(ctx: ScenarioContextBlock): string {
    const lines = [
      `### CONTEXTO SOCIAL`,
      ctx.roomContext,
      `Humor inicial da sala: ${ctx.startingMood}`,
      ctx.introBehaviorInstruction,
    ];
    if (ctx.firstMoveGuidance) lines.push(ctx.firstMoveGuidance);
    if (ctx.hostStartingMessage) {
      lines.push(`Mensagem do anfitrião: "${ctx.hostStartingMessage}"`);
    }
    if (ctx.customNotes?.length) {
      lines.push("Regras de comportamento nesta cena:");
      for (const note of ctx.customNotes) lines.push(`- ${note}`);
    }
    return lines.join("\n");
  }

  // Event content is LLM-generated (agent outputs), not untrusted user input — no sanitization needed.
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
