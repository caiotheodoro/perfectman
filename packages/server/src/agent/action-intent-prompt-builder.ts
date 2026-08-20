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
  "channelTarget": "ONLY for send_message/reply_to_message/leave_channel/invite_agent — the existing channel ID you're acting in. OMIT this field entirely for create_channel (use channelName/channelType instead).",
  "personTargets": "OMIT this field for send_message and create_channel — it does not apply to them. Only used for actions that target a specific person directly.",
  "visibleContent": "Optional text message content (required for 'send_message' or 'reply_to_message')",
  "privateMotiveSummary": "A highly specific natural-language thought explaining your real, raw, hidden motive behind this action. Never leave empty.",
  "emotionDrivers": ["Emotion keywords driving this action (e.g. warmth, jealousy, irritation)"],
  "motivationDrivers": ["Motivation keywords driving this action (e.g. affinity, gossip, exclusion)"],
  "preferredDelay": 0,
  "fallbackIfBlocked": "no_op",
  "memoryWrites": [],
  "channelName": "ONLY for create_channel — a short name for the new channel.",
  "channelType": "ONLY for create_channel — usually \\"private_channel\\".",
  "invitedAgentIds": ["ONLY for create_channel — array of agentIds to invite into the new channel."]
}

Field notes by intentType — send_message/reply_to_message use "channelTarget" (an existing channel); create_channel uses "channelName" + "channelType" (usually "private_channel") + "invitedAgentIds" instead, and has no "channelTarget" or "personTargets".

Ensure:
- "privateMotiveSummary" is fully developed and explains the *actual* raw human driver behind your action (e.g., "I am ignoring a friend to make them chase me after they ignored my previous message", "I want to gossip privately to build an alliance with someone in the group").
- Never leak numeric values or technical code metrics in "visibleContent" or "privateMotiveSummary".
- NEVER repeat a message you already sent, or a near-variation of it. The conversation moves FORWARD: if you already said something similar, react differently, change the topic, address someone new, move the action somewhere else — or choose "no_op". Repeating yourself is the most out-of-character thing you can do.${this.renderOwnUtterancesWarning(perceptionPacket.ownRecentUtterances)}`);

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

    // Private-channel awareness: if anything in view lives in a private
    // channel, say so explicitly — the model must know who can see what.
    const privateContext = perceptionPacket.visibleContextEvents.some(e => this.isPrivateEvent(e));
    if (privateContext) {
      userSections.push(
        "IMPORTANT: part of this conversation is happening in a PRIVATE channel (marked 🔒). " +
          "Only the invited people can see those messages. What is said there stays there.",
      );
    }
    // If the agent itself created a private channel, point it out — that is
    // the natural place to take a conversation that shouldn't be public.
    const myPrivateChannel = perceptionPacket.visibleContextEvents.find(
      e => e.type === "channel_created" && e.actorId === input.agentId && e.channelId,
    );
    if (myPrivateChannel) {
      userSections.push(
        `You created a private channel (#${myPrivateChannel.channelId}). If what you want to say ` +
          "should not be public, send it THERE (use it as your channelTarget) instead of the public channel.",
      );
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

    // Section 5b: Motivations — the felt drives behind the urges.
    if (input.activeMotivations.length > 0) {
      userSections.push("\nWhat is driving you right now:");
      input.activeMotivations.forEach((m) => {
        userSections.push(`- Motivation (${m.strength}): ${m.description}`);
      });
    }

    // Section 6: Relevant Memories
    userSections.push("### SECTION 6: WHAT YOU REMEMBER");
    if (perceptionPacket.relevantMemories.length > 0) {
      perceptionPacket.relevantMemories.forEach((m) => {
        userSections.push(`- [Memory (${m.type})] ${m.summary} (Tone: ${m.emotionalTone})`);
      });
      userSections.push(
        "\nAt least one of these memories is relevant right now — let it actually shape what you do: " +
          "bring it up, act warier or warmer because of it, reference it obliquely, or let it explain why " +
          "you're reacting the way you are. Don't just have it sit in the background unused.",
      );
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
      // Private-motive salience: when the engine feels a strong pull to move
      // somewhere private, say so — models default to public replies.
      const privatePressure = input.activePressures.find(
        p => p.type === "urge_to_create_private_channel" &&
          (p.intensity === "high" || p.intensity === "overwhelming"),
      );
      const canCreateChannel = input.availableActions.find(
        a => a.intentType === "create_channel" && !a.blocked,
      );
      if (privatePressure && canCreateChannel) {
        userSections.push(
          "\nNote: you are strongly feeling that part of this should NOT be said in front of everyone. " +
            "If the `create_channel` action fits what you want to do, using it is a natural move right now.",
        );
      }
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

  // Concrete, verbatim list of the agent's own last few messages — backs up
  // the abstract "don't repeat yourself" instruction with something the
  // model can actually check its draft output against, independent of
  // whether those turns are still inside the shared visibleContextEvents
  // window (which fills up fast with 5 agents committing events per pulse).
  private static renderOwnUtterancesWarning(ownRecentUtterances: string[]): string {
    if (ownRecentUtterances.length === 0) return "";
    const quoted = ownRecentUtterances.map((u) => `  - "${u}"`).join("\n");
    return `\n- You already sent these exact messages earlier in this conversation — do NOT repeat any of them or send a near-variation:\n${quoted}`;
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

  private static isPrivateEvent(event: CommittedEvent): boolean {
    const payloadObj = event.payload as Record<string, unknown>;
    return (
      payloadObj.channelType === "private_channel" ||
      event.visibility.visibilityReason.includes("private")
    );
  }

  // Event content is LLM-generated (agent outputs), not untrusted user input — no sanitization needed.
  private static formatEvent(event: CommittedEvent): string {
    const actor = event.actorId;
    const type = event.type;
    const channel = event.channelId ? `#${event.channelId}` : "";
    const priv = this.isPrivateEvent(event) ? " 🔒(private)" : "";
    const channelTag = `${channel}${priv}`;
    
    let content = "";
    if (event.payload && typeof event.payload === "object") {
      const payloadObj = event.payload as Record<string, unknown>;
      if (typeof payloadObj.content === "string") {
        content = `"${payloadObj.content}"`;
      } else if (typeof payloadObj.reaction === "string") {
        content = `reacted with ${payloadObj.reaction}`;
      } else if (typeof payloadObj.emoji === "string") {
        content = `reacted with ${payloadObj.emoji}`;
      } else {
        content = JSON.stringify(event.payload);
      }
    }

    switch (type) {
      case "message_sent":
        return `[${actor} in ${channelTag}]: ${content}`;
      case "reply_sent":
        return `[${actor} in ${channelTag} (reply)]: ${content}`;
      case "reaction_sent":
        return `[${actor} in ${channelTag}]: ${content}`;
      case "channel_created":
        return `[System]: ${actor} created a new private channel ${channelTag}`;
      case "agent_invited":
        return `[System]: ${actor} invited someone to ${channelTag}`;
      case "presence_changed":
        return `[System]: ${actor} changed presence to ${event.payload?.presence || "unknown"}`;
      case "no_op_recorded":
        return `[System]: ${actor} chose to lurk silently.`;
      default:
        return `[${actor} in ${channelTag} (${type})]: ${content}`;
    }
  }
}
