import { PromptSection, modelIntentPacketFieldContract, type AgentRuntimeInput, type CommittedEvent, type Memory } from "@perfectman/shared";
import { GENERIC_PROMPT_PROFILE, type PersonaPromptProfile, type ScenarioContextBlock } from "./persona-prompt-profile.js";
import type { BuiltPrompt, PromptTrim } from "./agent-runtime.types.js";
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
    eventHandles: {},
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
  static build(
    input: AgentRuntimeInput,
    profile: PersonaPromptProfile,
    maxInputTokens?: number,
  ): BuiltPrompt {
    let rendered = this.render(input, profile);
    const rawEstimate = this.estimateTokens(rendered.systemPrompt, rendered.userPrompt);

    let trim: PromptTrim | undefined;
    if (typeof maxInputTokens === "number" && maxInputTokens > 0 && rawEstimate > maxInputTokens) {
      const trimmed = this.trimToFit(input, profile, maxInputTokens);
      rendered = trimmed.rendered;
      const finalEstimate = this.estimateTokens(rendered.systemPrompt, rendered.userPrompt);
      // A trim record is always attached once the raw render was over-cap,
      // even when nothing was droppable (irreducible content) or every
      // droppable item was shed and it still does not fit — `withinCap`
      // distinguishes those from a clean trim so the over-cap send is logged.
      trim = {
        maxInputTokens,
        rawInputTokensEstimate: rawEstimate,
        finalInputTokensEstimate: finalEstimate,
        droppedEvents: trimmed.droppedEvents,
        droppedMemories: trimmed.droppedMemories,
        droppedUtterances: trimmed.droppedUtterances,
        droppedInputTokensEstimate: rawEstimate - finalEstimate,
        withinCap: finalEstimate <= maxInputTokens,
        phase: "assembly",
      };
    }

    const { systemPrompt, userPrompt } = rendered;
    return {
      system: systemPrompt,
      user: userPrompt,
      inputTokensEstimate: this.estimateTokens(systemPrompt, userPrompt),
      purpose: "action_intent",
      version: promptVersionHash([systemPrompt, userPrompt]),
      templateVersion: this.templateVersion(),
      ...(trim ? { trim } : {}),
    };
  }

  /**
   * Single owner of the chars/4 input estimate. `ActionIntentStep.buildRetryPrompt`
   * reuses it for its retry-cap arithmetic so the retry recomputation can never
   * drift from the assembly heuristic.
   */
  static estimateTokens(systemPrompt: string, userPrompt: string): number {
    return Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  }

  /**
   * Bring the assembled prompt within `maxInputTokens` by shedding the
   * lowest-value per-pulse context and re-rendering after every drop. The
   * order is fixed so the same input and cap always yield the same trimmed
   * prompt:
   *   1. relevant memories, lowest salience first — `confidence` ascending,
   *      then `lastReinforcedAt` ascending (staler first), then `id`.
   *   2. recent context events, oldest first — `pulseIndex` ascending, then
   *      `createdAt` ascending, then `id`. The triggering event is the floor
   *      and is never dropped.
   *   3. own recent utterances, oldest first (array order — perception
   *      assembles them chronologically). The step-level repetition guard
   *      checks the full utterance list regardless of what the prompt shows,
   *      so shedding these only weakens the preemptive no-repeat hint, never
   *      the structural enforcement.
   * Memories yield before the live transcript because a stale, low-confidence
   * memory is the most expendable grounding for the next action. Persona, the
   * output contract and the decision question are structural and are never
   * trimmed here.
   */
  private static trimToFit(
    input: AgentRuntimeInput,
    profile: PersonaPromptProfile,
    maxInputTokens: number,
  ): {
    rendered: { systemPrompt: string; userPrompt: string };
    droppedEvents: number;
    droppedMemories: number;
    droppedUtterances: number;
  } {
    const { perceptionPacket } = input;
    const triggeringEventId = perceptionPacket.triggeringEvent?.id;
    const events = [...perceptionPacket.visibleContextEvents];
    const memories = [...perceptionPacket.relevantMemories];
    const utterances = [...perceptionPacket.ownRecentUtterances];
    let droppedEvents = 0;
    let droppedMemories = 0;
    let droppedUtterances = 0;

    const renderCandidate = (): { systemPrompt: string; userPrompt: string } =>
      this.render(
        {
          ...input,
          perceptionPacket: {
            ...perceptionPacket,
            visibleContextEvents: events,
            relevantMemories: memories,
            ownRecentUtterances: utterances,
          },
        },
        profile,
      );
    const fits = (r: { systemPrompt: string; userPrompt: string }): boolean =>
      this.estimateTokens(r.systemPrompt, r.userPrompt) <= maxInputTokens;

    let rendered = renderCandidate();

    while (!fits(rendered) && memories.length > 0) {
      memories.splice(this.lowestSalienceMemoryIndex(memories), 1);
      droppedMemories++;
      rendered = renderCandidate();
    }

    while (!fits(rendered)) {
      const idx = this.oldestDroppableEventIndex(events, triggeringEventId);
      if (idx === -1) break;
      events.splice(idx, 1);
      droppedEvents++;
      rendered = renderCandidate();
    }

    while (!fits(rendered) && utterances.length > 0) {
      utterances.shift();
      droppedUtterances++;
      rendered = renderCandidate();
    }

    return { rendered, droppedEvents, droppedMemories, droppedUtterances };
  }

  private static lowestSalienceMemoryIndex(memories: Memory[]): number {
    let best = 0;
    for (let i = 1; i < memories.length; i++) {
      const m = memories[i]!;
      const b = memories[best]!;
      const lower =
        m.confidence !== b.confidence
          ? m.confidence < b.confidence
          : m.lastReinforcedAt !== b.lastReinforcedAt
            ? m.lastReinforcedAt < b.lastReinforcedAt
            : m.id < b.id;
      if (lower) best = i;
    }
    return best;
  }

  private static oldestDroppableEventIndex(
    events: CommittedEvent[],
    triggeringEventId: string | undefined,
  ): number {
    let best = -1;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (triggeringEventId !== undefined && e.id === triggeringEventId) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const b = events[best]!;
      const older =
        e.pulseIndex !== b.pulseIndex
          ? e.pulseIndex < b.pulseIndex
          : e.createdAt !== b.createdAt
            ? e.createdAt < b.createdAt
            : e.id < b.id;
      if (older) best = i;
    }
    return best;
  }

  private static render(input: AgentRuntimeInput, profile: PersonaPromptProfile): { systemPrompt: string; userPrompt: string } {
    const { perceptionPacket } = input;
    const { translatedEmotionalState } = perceptionPacket;

    const system = new PromptSection()
      .container("persona", (s) => this.renderPersona(s, profile, input.hasActed === true))
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

  private static renderPersona(s: PromptSection, profile: PersonaPromptProfile, hasActed = false): void {
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

    if (profile.scenarioContext) this.renderScenarioContext(s, profile.scenarioContext, hasActed);
    if (profile.hiddenObjective) this.renderHiddenObjective(s, profile.hiddenObjective);
  }

  /**
   * Renders last, deliberately: this is the one piece of context the agent
   * must actually weigh against everything else in the room, not background
   * flavor. Placed after scenario context so it's the most recent thing the
   * model reads before the output contract.
   */
  private static renderHiddenObjective(s: PromptSection, objective: import("@perfectman/shared").AgentObjective): void {
    s.heading("Secret objective");
    s.raw(`Você tem um objetivo pessoal que ninguém na sala sabe: ${objective.description}`);
    s.raw(
      "Você nunca declara esse objetivo em voz alta nem o explica diretamente. Persiga-o através de suas ações e palavras normais nesta cena — e se perceber que outra pessoa está indo atrás da mesma coisa, isso muda como você age.",
    );
    // The three fields below are optional (older/simpler scenarios only set
    // description + scarceResourceId) — when present, they're what actually
    // turns the objective into a constraint instead of flavor text: a
    // sentence the character cannot honestly say, a real cost if it leaks,
    // and a defined moment where the performance is allowed to crack.
    if (objective.constraint) {
      s.raw(`Isso significa que você nunca pode: ${objective.constraint}.`);
    }
    if (objective.costOfExposure) {
      s.raw(`Se isso vazar antes da hora: ${objective.costOfExposure}.`);
    }
    if (objective.breakingPoint) {
      s.raw(
        `Você mantém a máscara até que ${objective.breakingPoint} — a partir daí, pode deixar transparecer, mesmo que só por um instante.`,
      );
    }
  }

  private static renderOutputContract(s: PromptSection, actorId: string): void {
    s.heading("Output contract");
    s.raw("You must respond with a SINGLE valid JSON object matching the enforced intent schema. Do not include any conversational introduction, explanations, markdown code fences, or thinking blocks — return ONLY the JSON object.");
    s.raw(`The fields id, actorId, preferredDelay and fallbackIfBlocked are assigned by the system — never set them (actorId is ${actorId}).`);
    s.raw("The schema is enforced at decoding time where the provider honors it; where it isn't, these are the only fields you may set — set intentType to one value from <actions> below, set targets/content only where they apply, and never omit privateMotiveSummary:");
    s.list("Fields", modelIntentPacketFieldContract());
    s.list("Ensure", [
      `"privateMotiveSummary" is fully developed and names the *actual*, uncomfortable driver behind your action — the specific thought a real person would have but never say out loud, not just a plausible-sounding reason (e.g., "I am ignoring a friend to make them chase me after they ignored my previous message", "I want to gossip privately to build an alliance with someone in the group"). If the honest version feels a little petty, insecure, or manipulative, that's the one to write — not a cleaned-up version of it.`,
      `Never leak numeric values or technical code metrics in "visibleContent" or "privateMotiveSummary".`,
      `"visibleContent" is the final message only — never include your own drafting process in it (no "let me reformulate", "deep breath", "wait, better phrasing:", stray self-corrections, or a first attempt left in before a second one). If you reconsider your wording, do that silently and output only the version you land on.`,
      `For reply_to_message set "replyToEventId", and for react set "targetEventId", to one of the bracketed event handles from <events> (e.g. "e1") — copy the handle text exactly, do not invent an id or describe the message.`,
      `Use "memoryWrites" only when this exchange actually matters to your relationships or intentions — not on every turn. Each proposal must be written in first person ("I…") and grounded in what actually happened in <events> (a promise made, a slight received, a revealed preference, a plan formed), filling every field (type, subjectAgentIds, summary, emotionalTone, confidence, intensity, unresolved) per the field contract above. When nothing qualifies, leave "memoryWrites" empty.`,
    ]);
  }

  private static renderEvents(s: PromptSection, input: AgentRuntimeInput, perceptionPacket: AgentRuntimeInput["perceptionPacket"]): void {
    s.heading("What you noticed");
    const handleByEventId = new Map(
      Object.entries(perceptionPacket.eventHandles).map(([handle, eventId]) => [eventId, handle]),
    );
    if (perceptionPacket.triggeringEvent) {
      s.raw(`Triggering event (what just happened that caught your attention):\n${this.formatEvent(perceptionPacket.triggeringEvent, handleByEventId.get(perceptionPacket.triggeringEvent.id))}`);
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
      s.raw(`Recent context (last messages in visible channels):\n${perceptionPacket.visibleContextEvents.map((e) => this.formatEvent(e, handleByEventId.get(e.id))).join("\n")}`);
    } else {
      s.raw("Recent context: the chat history is currently empty.");
    }
    if (handleByEventId.size > 0) {
      s.raw(
        "Each event above starts with a short handle in square brackets (e.g. [e1]). To reply to or react to a specific message, set replyToEventId / targetEventId to exactly that handle text (e.g. \"e1\") — never a paraphrase, a name, or any other id. If you are not replying to one specific message, use send_message and leave replyToEventId unset.",
      );
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
    // Root-caused via a live capture + a static read of the prompt: nothing
    // anywhere told agents to take a creative risk, so a real transcript
    // read as a "sensible negotiation" — safe, agreeable, never provoking —
    // exactly what the rubric's creativity_unhinged anchor-1 describes. This
    // is the decision moment, so the nudge belongs here, not in the static
    // output contract.
    s.raw(
      "When there is real pressure, tension, or something at stake in the room, don't default to the safest, most " +
        "reasonable-sounding response — take a risk that this specific person, with their actual stakes and mood, " +
        "would take: provoke, push back sharply, escalate, needle someone, let a flash of what you're actually " +
        "feeling slip through, or make a move that surprises the room while still being believable as you. Playing " +
        "it safe every single turn is itself a failure to be this character when the stakes call for more.",
    );
  }

  // Verbatim list of the agent's own last messages, wrapped as literal content
  // the model must not imitate (fence keeps it from reading as instructions).
  /** Newest own utterances rendered verbatim; older ones as one truncated line each. */
  private static readonly VERBATIM_UTTERANCES = 5;
  private static readonly EARLIER_UTTERANCE_CHARS = 80;

  private static renderNoRepeat(s: PromptSection, ownRecentUtterances: string[]): void {
    const verbatim = ownRecentUtterances.slice(-this.VERBATIM_UTTERANCES);
    const earlier = ownRecentUtterances.slice(0, -this.VERBATIM_UTTERANCES);
    s.heading("Do not repeat yourself");
    s.raw("These are your OWN exact prior messages from earlier in this conversation. Cite-check your draft answer against them and do NOT repeat any of them or send a near-variation:");
    s.fence(verbatim.map((u) => `  - "${u}"`).join("\n"));
    if (earlier.length > 0) {
      s.raw("Earlier you already said (do not raise these again unless something changed):");
      s.list(
        undefined,
        earlier.map((u) => (u.length > this.EARLIER_UTTERANCE_CHARS ? `${u.slice(0, this.EARLIER_UTTERANCE_CHARS)}…` : u)),
      );
    }
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

  /**
   * The intro instruction and first-move guidance are an entrance, not a
   * standing order: rendered only until the agent's first outward act.
   * Root-caused via a live capture — "announce the proposal" rendered on all
   * 32 pulses, and the agent re-announced it at p7, p10, p12, p18 and p28.
   */
  private static renderScenarioContext(s: PromptSection, ctx: ScenarioContextBlock, hasActed: boolean): void {
    s.heading("Social context");
    s.raw(ctx.roomContext);
    s.raw(`Humor inicial da sala: ${ctx.startingMood}`);
    if (!hasActed) {
      s.raw(ctx.introBehaviorInstruction);
      if (ctx.firstMoveGuidance) s.raw(ctx.firstMoveGuidance);
    }
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
  private static formatEvent(event: CommittedEvent, handle?: string): string {
    const prefix = handle ? `[${handle}] ` : "";
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
      case "message_sent": return `${prefix}[${actor} in ${channelTag}]: ${content}`;
      case "reply_sent": return `${prefix}[${actor} in ${channelTag} (reply)]: ${content}`;
      case "reaction_sent": return `${prefix}[${actor} in ${channelTag}]: ${content}`;
      case "channel_created": return `${prefix}[System]: ${actor} created a new private channel ${channelTag}`;
      case "agent_invited": return `${prefix}[System]: ${actor} invited someone to ${channelTag}`;
      case "presence_changed": return `${prefix}[System]: ${actor} changed presence to ${event.payload?.presence || "unknown"}`;
      case "no_op_recorded": return `${prefix}[System]: ${actor} chose to lurk silently.`;
      default: return `${prefix}[${actor} in ${channelTag} (${type})]: ${content}`;
    }
  }
}
