import { PromptSection, modelIntentPacketFieldContract, type AgentRuntimeInput, type CommittedEvent } from "@perfectman/shared";
import { GENERIC_PROMPT_PROFILE, type PersonaPromptProfile, type ScenarioContextBlock } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";
import { promptVersionHash } from "./prompt-version.js";

/**
 * Fixed placeholder input used only to compute each prompt builder's
 * `templateVersion` — never shown to a model. Every per-pulse field takes its
 * simplest branch (no triggering event, empty lists) so the render this
 * produces is stable across process runs and only ever changes when a
 * builder's own render logic does. Shared across builders (see
 * `BackgroundReflectionPromptBuilder`) so every purpose's template version is
 * computed against the same fixed input shape.
 */
export const CANONICAL_TEMPLATE_VERSION_INPUT: AgentRuntimeInput = {
  simulationId: "template-version",
  agentId: "template-version",
  personaConfig: {
    id: "template-version",
    name: "Template Version",
    archetype: "generic",
    writingStyle: "neutral",
    styleExamples: [],
    baselineValence: 0,
    baselineArousal: 0,
    baselineStability: 0.5,
    baselineEnergy: 0.5,
    emotionalReactivity: 1,
    moodInertia: 0.5,
    maxMoodRotation: 0.5,
    energyRegen: 0.05,
    exclusionSensitivity: 1,
    praiseSensitivity: 1,
    conflictSensitivity: 1,
    boredomSensitivity: 1,
    intimacySensitivity: 1,
    socialSensitivities: {},
  },
  perceptionPacket: {
    agentId: "template-version",
    triggeringEvent: null,
    visibleContextEvents: [],
    ownRecentUtterances: [],
    involvedPeople: [],
    relevantChannels: [],
    relevantMemories: [],
    translatedEmotionalState: {
      moodDescription: "",
      socialContext: "",
      relationalFlavors: [],
      pressureDescriptions: [],
      inhibitionDescriptions: [],
    },
    availableActions: [],
  },
  emotionalState: {
    coreMood: {
      valence: 0,
      arousal: 0,
      stability: 0.5,
      energy: 0.5,
      circumplexAngle: 0,
      circumplexRadius: 0,
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
      affection: 0, resentment: 0, suspicion: 0, admiration: 0,
      contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
      desireForStatus: 0, desireForIntimacy: 0,
    },
    relationalStates: new Map(),
  },
  activeMotivations: [],
  activePressures: [],
  activeInhibitions: [],
  relevantMemories: [],
  availableActions: [],
  budgetPriority: "normal",
  triggeringReason: "cold_start",
};

/**
 * Builds the action-intent prompt in the "full hybrid, precision-first"
 * structure. Structural string manipulation (headings, `-` bullets, closable
 * `</tag>` containers, fences) is delegated to PromptSection so the builder
 * never hand-writes markers or tracks closing tags. Decision question LAST.
 */
export class ActionIntentPromptBuilder {
  static build(input: AgentRuntimeInput, profile: PersonaPromptProfile): BuiltPrompt {
    const { systemPrompt, userPrompt } = this.render(input, profile);
    const totalChars = systemPrompt.length + userPrompt.length;
    return {
      system: systemPrompt,
      user: userPrompt,
      inputTokensEstimate: Math.ceil(totalChars / 4),
      purpose: "action_intent",
      version: promptVersionHash([systemPrompt, userPrompt]),
      templateVersion: this.templateVersion(),
    };
  }

  private static render(input: AgentRuntimeInput, profile: PersonaPromptProfile): { systemPrompt: string; userPrompt: string } {
    const { perceptionPacket } = input;
    const { translatedEmotionalState } = perceptionPacket;

    const system = new PromptSection()
      .container("persona", (s) => this.renderPersona(s, profile))
      .container("output_contract", (s) => this.renderOutputContract(s, input.agentId));
    if (perceptionPacket.ownRecentUtterances.length > 0) {
      system.container("no_repeat", (s) => this.renderNoRepeat(s, perceptionPacket.ownRecentUtterances));
    }
    const systemPrompt = system.toString();

    const user = new PromptSection()
      .container("events", (s) => this.renderEvents(s, input, perceptionPacket))
      .container("social", (s) => this.renderSocial(s, translatedEmotionalState.socialContext))
      .container("emotional_state", (s) => this.renderEmotionalState(s, translatedEmotionalState))
      .container("pressures", (s) => this.renderPressures(s, translatedEmotionalState, input.activeMotivations))
      .container("memories", (s) => this.renderMemories(s, perceptionPacket.relevantMemories))
      .container("actions", (s) => this.renderActions(s, input))
      .container("decision", (s) => this.renderDecision(s, input));
    const userPrompt = user.toString();

    return { systemPrompt, userPrompt };
  }

  private static cachedTemplateVersion: string | undefined;

  /**
   * Content hash of a render against a fixed canonical input, computed once
   * and cached. `version` above hashes the real per-pulse render, so it changes
   * on every call and can't say whether the *template* (as opposed to the
   * event transcript, mood, memories, etc.) changed between two runs — this
   * does, by holding the input fixed and only ever changing when `render`
   * itself does. The canonical input always takes the same branches (e.g. no
   * `<no_repeat>` container, since `ownRecentUtterances` is empty), so those
   * per-pulse-conditional branches aren't reflected here even when real
   * renders use them — this identifies the template, not full branch coverage.
   */
  private static templateVersion(): string {
    if (this.cachedTemplateVersion === undefined) {
      const { systemPrompt, userPrompt } = this.render(CANONICAL_TEMPLATE_VERSION_INPUT, GENERIC_PROMPT_PROFILE);
      this.cachedTemplateVersion = promptVersionHash([systemPrompt, userPrompt]);
    }
    return this.cachedTemplateVersion;
  }

  private static renderPersona(s: PromptSection, profile: PersonaPromptProfile): void {
    const language = profile.language === "pt-BR" ? "Portuguese (pt-BR)" : "English";
    s.heading("Identity");
    s.raw("You are roleplaying as a specific person in an online chat room. Stay inside this compact runtime profile; do not mention source notes, assessments, or hidden profile metadata.");
    s.list("Identity", [
      `**Display Name**: ${profile.displayName}`,
      `**Primary Language**: ${language}`,
      `**Frame**: ${profile.identityFrame}`,
    ]);

    this.addList(s, "Core traits", profile.coreTraits);
    this.addList(s, "Values and motivations", profile.valuesAndMotivations);
    this.addList(s, "Social presence", profile.socialPresence);
    this.addList(s, "Thought process", profile.cognitiveStyle);
    this.addList(s, "Emotional patterns", profile.emotionalPatterns);
    this.addList(s, "Conflict and repair style", profile.conflictStyle);
    this.addList(s, "Affection style", profile.affectionStyle);
    this.addList(s, "Public/private difference", profile.publicPrivateDelta);
    this.addList(s, "Voice guidelines", profile.voiceGuidelines);
    this.renderStyleExamples(s, profile);
    this.addList(s, "Private motive patterns", profile.privateMotivePatterns);
    this.addList(s, "Hard avoids", profile.hardAvoids);
    this.renderRelationshipBiases(s, profile);

    if (profile.scenarioContext) this.renderScenarioContext(s, profile.scenarioContext);
  }

  private static renderOutputContract(s: PromptSection, actorId: string): void {
    s.heading("Output contract");
    s.raw("You must respond with a SINGLE valid JSON object matching the enforced intent schema. Do not include any conversational introduction, explanations, markdown code fences, or thinking blocks — return ONLY the JSON object.");
    s.raw(`The fields id, actorId, preferredDelay and fallbackIfBlocked are assigned by the system — never set them (actorId is ${actorId}).`);
    s.raw("The schema is enforced at decoding time where the provider honors it; where it isn't, these are the only fields you may set — set intentType to one value from <actions> below, set targets/content only where they apply, and never omit privateMotiveSummary:");
    s.list("Fields", modelIntentPacketFieldContract());
    s.list("Ensure", [
      `"privateMotiveSummary" is fully developed and explains the *actual* raw human driver behind your action (e.g., "I am ignoring a friend to make them chase me after they ignored my previous message", "I want to gossip privately to build an alliance with someone in the group").`,
      `Never leak numeric values or technical code metrics in "visibleContent" or "privateMotiveSummary".`,
    ]);
  }

  private static renderEvents(s: PromptSection, input: AgentRuntimeInput, perceptionPacket: AgentRuntimeInput["perceptionPacket"]): void {
    s.heading("What you noticed");
    if (perceptionPacket.triggeringEvent) {
      s.raw(`Triggering event (what just happened that caught your attention):\n${this.formatEvent(perceptionPacket.triggeringEvent)}`);
    } else {
      s.raw("Triggering event: no specific event triggered this pulse (you have the initiative to speak or act on your own).");
    }

    // Private-channel awareness: if anything in view lives in a private
    // channel, say so explicitly — the model must know who can see what.
    if (perceptionPacket.visibleContextEvents.some((e) => this.isPrivateEvent(e))) {
      s.raw(
        "IMPORTANT: part of this conversation is happening in a PRIVATE channel (marked 🔒). " +
          "Only the invited people can see those messages. What is said there stays there.",
      );
    }
    // If the agent itself created a private channel, point it out — that is
    // the natural place to take a conversation that shouldn't be public.
    const myPrivateChannel = perceptionPacket.visibleContextEvents.find(
      (e) => e.type === "channel_created" && e.actorId === input.agentId && e.channelId,
    );
    if (myPrivateChannel) {
      s.raw(
        `You created a private channel (#${myPrivateChannel.channelId}). If what you want to say ` +
          "should not be public, send it THERE (use it as your channelTarget) instead of the public channel.",
      );
    }

    if (perceptionPacket.visibleContextEvents.length > 0) {
      s.raw(`Recent context (last messages in visible channels):\n${perceptionPacket.visibleContextEvents.map((e) => this.formatEvent(e)).join("\n")}`);
    } else {
      s.raw("Recent context: the chat history is currently empty.");
    }
  }

  private static renderSocial(s: PromptSection, socialContext: string): void {
    s.heading("Social interpretation");
    s.raw(socialContext || "The social environment is quiet. No unusual signals stand out.");
  }

  private static renderEmotionalState(s: PromptSection, te: AgentRuntimeInput["perceptionPacket"]["translatedEmotionalState"]): void {
    s.heading("How you subjectively feel");
    s.raw(te.moodDescription);
    if (te.relationalFlavors.length > 0) {
      s.list("Your current feelings towards others", te.relationalFlavors.map((rf) => `**${rf.targetAgentId}**: ${rf.description}`));
    }
  }

  private static renderPressures(s: PromptSection, te: AgentRuntimeInput["perceptionPacket"]["translatedEmotionalState"], activeMotivations: AgentRuntimeInput["activeMotivations"]): void {
    s.heading("Felt urges & social blocks");
    if (te.pressureDescriptions.length > 0) {
      s.list("Your immediate urges", te.pressureDescriptions.map((p) => `Urge: ${p}`));
    } else {
      s.raw("You feel no strong immediate conversational urges.");
    }
    if (te.inhibitionDescriptions.length > 0) {
      s.list("What is holding you back", te.inhibitionDescriptions.map((inh) => `Inhibition: ${inh}`));
    }
    if (activeMotivations.length > 0) {
      s.list("What is driving you right now", activeMotivations.map((m) => `Motivation (${m.strength}): ${m.description}`));
    }
  }

  private static renderMemories(s: PromptSection, relevantMemories: AgentRuntimeInput["perceptionPacket"]["relevantMemories"]): void {
    s.heading("What you remember");
    if (relevantMemories.length > 0) {
      s.list(undefined, relevantMemories.map((m) => `[Memory (${m.type})] ${m.summary} (Tone: ${m.emotionalTone})`));
      s.raw(
        "At least one of these memories is relevant right now — let it actually shape what you do: " +
          "bring it up, act warier or warmer because of it, reference it obliquely, or let it explain why " +
          "you're reacting the way you are. Don't just have it sit in the background unused.",
      );
    } else {
      s.raw("No specific memories are active in your mind right now.");
    }
  }

  private static renderActions(s: PromptSection, input: AgentRuntimeInput): void {
    s.heading("Permitted actions");
    if (input.availableActions.length > 0) {
      s.list(undefined, input.availableActions.map((act) => {
        const targetsDetail: string[] = [];
        if (act.channelTargets.length > 0) targetsDetail.push(`Channels: ${act.channelTargets.join(", ")}`);
        if (act.personTargets.length > 0) targetsDetail.push(`People: ${act.personTargets.join(", ")}`);
        return `**${act.intentType}** ${targetsDetail.length > 0 ? `(${targetsDetail.join("; ")})` : ""}${act.blocked ? ` [BLOCKED: ${act.blockReason}]` : ""}`;
      }));

      // Private-motive salience: when the engine feels a strong pull to move
      // somewhere private, say so — models default to public replies.
      const privatePressure = input.activePressures.find(
        (p) => p.type === "urge_to_create_private_channel" && (p.intensity === "high" || p.intensity === "overwhelming"),
      );
      const canCreateChannel = input.availableActions.find((a) => a.intentType === "create_channel" && !a.blocked);
      if (privatePressure && canCreateChannel) {
        s.raw(
          "Note: you are strongly feeling that part of this should NOT be said in front of everyone. " +
            "If the `create_channel` action fits what you want to do, using it is a natural move right now.",
        );
      }
    } else {
      s.list(undefined, ["**no_op** (No action available)"]);
    }
  }

  // The actionable decision question goes LAST (context first, decision last).
  private static renderDecision(s: PromptSection, input: AgentRuntimeInput): void {
    s.heading("Decide now");
    s.raw(
      'You can ONLY perform ONE action. Pick exactly one permitted combination from <actions>, fill every relevant field per <output_contract>, and emit the JSON object. The conversation moves FORWARD: if you already said something similar, react differently, change the topic, address someone new, move elsewhere — or choose "no_op".',
    );
  }

  // Verbatim list of the agent's own last messages, wrapped as literal content
  // the model must not imitate (fence keeps it from reading as instructions).
  private static renderNoRepeat(s: PromptSection, ownRecentUtterances: string[]): void {
    s.heading("Do not repeat yourself");
    s.raw("These are your OWN exact prior messages from earlier in this conversation. Cite-check your draft answer against them and do NOT repeat any of them or send a near-variation:");
    s.fence(ownRecentUtterances.map((u) => `  - "${u}"`).join("\n"));
  }

  private static addList(s: PromptSection, title: string, items: string[]): void {
    if (items.length > 0) s.list(title, items);
  }

  private static renderStyleExamples(s: PromptSection, profile: PersonaPromptProfile): void {
    const { styleExamples } = profile;
    const groups = [
      ["default", styleExamples.default],
      ["animated", styleExamples.animated],
      ["dry/low-energy", styleExamples.dryOrLowEnergy],
      ["conflict", styleExamples.conflict],
    ] as const;
    const rendered = groups
      .filter(([, examples]) => examples.length > 0)
      .map(([label, examples]) => `${label}: ${examples.map((example) => `"${example}"`).join(", ")}`);
    if (rendered.length === 0) return;
    s.raw("Tonal/register guide — these show HOW you express yourself (voice, rhythm, brevity), NOT phrases to repeat literally. Always say something substantive:");
    s.list(undefined, rendered);
  }

  private static renderRelationshipBiases(s: PromptSection, profile: PersonaPromptProfile): void {
    const entries = Object.entries(profile.relationshipBiases);
    if (entries.length === 0) return;
    const rendered = entries.map(([peer, bias]) => {
      const lines = [`**${peer}**: ${bias.view}`, `  - warmth/trust: ${bias.warmth}/${bias.trust}`];
      if (bias.likelyBehaviors.length > 0) lines.push(`  - likely behaviors: ${bias.likelyBehaviors.join("; ")}`);
      if (bias.triggers.length > 0) lines.push(`  - triggers: ${bias.triggers.join("; ")}`);
      return lines.join("\n");
    });
    s.raw("Relationship-specific views:");
    s.list(undefined, rendered);
  }

  private static renderScenarioContext(s: PromptSection, ctx: ScenarioContextBlock): void {
    s.heading("Social context");
    s.raw(ctx.roomContext);
    s.raw(`Humor inicial da sala: ${ctx.startingMood}`);
    s.raw(ctx.introBehaviorInstruction);
    if (ctx.firstMoveGuidance) s.raw(ctx.firstMoveGuidance);
    if (ctx.hostStartingMessage) s.raw(`Mensagem do anfitrião: "${ctx.hostStartingMessage}"`);
    if (ctx.customNotes?.length) {
      s.list("Regras de comportamento nesta cena", ctx.customNotes);
    }
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
      case "message_sent": return `[${actor} in ${channelTag}]: ${content}`;
      case "reply_sent": return `[${actor} in ${channelTag} (reply)]: ${content}`;
      case "reaction_sent": return `[${actor} in ${channelTag}]: ${content}`;
      case "channel_created": return `[System]: ${actor} created a new private channel ${channelTag}`;
      case "agent_invited": return `[System]: ${actor} invited someone to ${channelTag}`;
      case "presence_changed": return `[System]: ${actor} changed presence to ${event.payload?.presence || "unknown"}`;
      case "no_op_recorded": return `[System]: ${actor} chose to lurk silently.`;
      default: return `[${actor} in ${channelTag} (${type})]: ${content}`;
    }
  }
}
