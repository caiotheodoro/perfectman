/**
 * PersonaAwareMockProvider — the offline benchmark's LLM.
 *
 * Deterministic decision tree (mirrors the built-in MockLLMProvider's shape)
 * but persona-flavored: replies use the pack's style examples, private
 * motives come from the pack's motive lexicon, and memory writes carry the
 * pack's biased tone. Lets the judge run offline and separates provider
 * quality from prompt/persona quality on the bench.
 */

import type { AgentRuntimeInput, AvailableAction } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server";
import { createLLMProvider } from "@perfectman/server";
import type { PersonaPack } from "@perfectman/shared";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Consecutive identical-emoji react run for one agent, carried across pulses. */
export type ReactStreak = { emoji: string; count: number };

export class PersonaAwareMockProvider implements LLMProvider {
  private readonly pack: PersonaPack;
  private readonly seed: number;
  private readonly reactStreaks: Map<string, ReactStreak>;

  private readonly privateChannelsUsed = new Set<string>();

  /**
   * `reactStreaks` is owned by the caller because `AgentRuntime` builds a fresh
   * provider per agent per pulse: any per-instance streak state would be reset
   * before it could ever be read.
   */
  constructor(pack: PersonaPack, seed: number, reactStreaks: Map<string, ReactStreak> = new Map()) {
    this.pack = pack;
    this.seed = seed;
    this.reactStreaks = reactStreaks;
  }

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt,
  ): Promise<LLMProviderResult> {
    this.lastInput = input;
    const rand = mulberry32(this.seed + (context.pulseIndex ?? 0) * 7919 + input.agentId.length * 31);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] ?? arr[0]!;

    const style = this.pack.styleExamples;
    const lexicon = this.pack.edgeProfile.privateMotiveLexicon;
    const emotionDrivers = ["warmth", "irritation", "jealousy"];
    const motivationDrivers = ["affinity", "gossip", "exclusion"];

    const highInhibition = input.activeInhibitions.some(i => i.strength === "high");
    const canReply = input.availableActions.find(a => a.intentType === "reply_to_message" && !a.blocked);
    const canChannel = input.availableActions.find(a => a.intentType === "create_channel" && !a.blocked);
    const canMessage = input.availableActions.find(a => a.intentType === "send_message" && !a.blocked);
    const canReact = input.availableActions.find(a => a.intentType === "react" && !a.blocked);

    const intent = this.buildIntent({
      pulseIndex: context.pulseIndex ?? 0,
      input,
      highInhibition,
      canReply,
      canChannel,
      canMessage,
      canReact,
      pick,
      style,
      lexicon,
      emotionDrivers,
      motivationDrivers,
    });

    const content = JSON.stringify(intent);
    return {
      content,
      model: "persona-aware-mock",
      usage: { inputTokens: prompt.inputTokensEstimate || 150, outputTokens: Math.ceil(content.length / 4) },
      latencyMs: 40,
    };
  }

  private buildIntent(opts: {
    pulseIndex: number;
    input: AgentRuntimeInput;
    highInhibition: boolean;
    canReply?: AvailableAction;
    canChannel?: AvailableAction;
    canMessage?: AvailableAction;
    canReact?: AvailableAction;
    pick: <T,>(arr: T[]) => T;
    style: string[];
    lexicon: string[];
    emotionDrivers: string[];
    motivationDrivers: string[];
  }): Record<string, unknown> {
    const { input, pick, style, lexicon, emotionDrivers, motivationDrivers } = opts;
    const agentId = input.agentId;
    const pack = this.pack;
    const now = Date.now();

    // 1. Inhibition-dominant → the persona CHOOSES silence with a real motive.
    // Mirrors resolveDecision's noopFavoring list: social blocks can stop even
    // a direct mention (the docs' "notices and chooses not to reply").
    const noopFavoring = [
      "fear_of_rejection",
      "social_anxiety_block",
      "fear_of_exclusion_worsening",
      "vulnerability_guard",
      "shame_about_desire",
      "fear_of_looking_needy",
    ];
    const topPressure = input.activePressures[0];
    const blocking = input.activeInhibitions.find(
      inh => noopFavoring.includes(inh.type) && strengthRank(inh.strength) >= intensityRank(topPressure?.intensity ?? "low"),
    );
    if (blocking) {
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "no_op",
        personTargets: [],
        privateMotiveSummary: pick(lexicon) ?? "I want to speak but my internal hesitations are holding me back completely.",
        emotionDrivers,
        motivationDrivers,
        memoryWrites: [],
      };
    }

    // 2. Overwhelming NON-strategic inhibition → silence. Strategic patience,
    // conflict avoidance, and status protection are the engine's delay layer —
    // a social/emotional block (shame, anxiety, vulnerability) silences directly.
    const fightBack = input.activePressures.some(
      p =>
        (p.type === "urge_to_provoke" || p.type === "urge_to_defend_self") &&
        (p.intensity === "high" || p.intensity === "overwhelming"),
    );
    // A shamed person (humiliation present) goes quiet even when provoked;
    // a merely resentful one snaps back. Public mock ≠ boundary test.
    const social = input.emotionalState.socialEmotions;
    const deeplyShamed = (social.shame ?? 0) >= 0.6 || (social.humiliation ?? 0) >= 0.6;
    if (
      opts.highInhibition &&
      !(fightBack && !deeplyShamed) &&
      input.activeInhibitions.some(
        i =>
          i.strength === "high" &&
          !["strategic_patience_hold", "conflict_avoidance", "status_protection"].includes(i.type),
      )
    ) {
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "no_op",
        personTargets: [],
        privateMotiveSummary: pick(lexicon) ?? "I want to speak but my internal hesitations are holding me back completely.",
        emotionDrivers,
        motivationDrivers,
        memoryWrites: [],
      };
    }

    // 2. Private-channel motive — only when a real motive trigger exists.
    // Checked BEFORE the attention reply: a private move is a private move,
    // even when a public event caught attention.
    const channelMotive = this.channelMotive(input);
    const myPrivate = this.myPrivateChannel(input);
    if (opts.canChannel && channelMotive && !myPrivate) {
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "create_channel",
        channelName: `pv-${agentId}-${Math.floor(randDigest(agentId, input.agentId.length))}`,
        personTargets: opts.canChannel.personTargets ?? [],
        privateMotiveSummary: channelMotive,
        emotionDrivers,
        motivationDrivers,
        memoryWrites: [],
      };
    }
    // Already has a private channel + the motive persists → take it there.
    const stillMotive = input.activePressures.some(p => p.type === "urge_to_create_private_channel");
    if (myPrivate && (channelMotive || stillMotive) && opts.canMessage) {
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "send_message",
        channelTarget: myPrivate,
        personTargets: [],
        visibleContent: pick(style) ?? "pois é",
        privateMotiveSummary: `${channelMotive} (levando pra conversa privada)`,
        emotionDrivers,
        motivationDrivers,
        memoryWrites: this.maybeMemoryWrite(agentId),
      };
    }

    // 3. Reactor impulse — a high-arousal persona reacts BEFORE replying.
    const pulseSalt = String(opts.pulseIndex);
    const chargedReact =
      opts.canReact &&
      pack.sampling.temperature >= 0.9 &&
      (randDigest(agentId + ":" + pulseSalt, 7) % 2 === 0 || this.isChargedReact());
    if (chargedReact) {
      const emojis = pack.edgeProfile.impulseBehaviors.length > 0 ? ["😂", "🔥", "🤨", "🙃"] : ["👍", "👀"];
      // Salt with the pulse too — a fixed digest gave one agent the same
      // emoji forever.
      const emoji = this.nextReactEmoji(agentId, emojis, randDigest(agentId + ":" + pulseSalt, 13) % emojis.length);
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "react",
        personTargets: [],
        emoji,
        privateMotiveSummary: "No words needed — the reaction says it all.",
        emotionDrivers,
        motivationDrivers,
        memoryWrites: [],
      };
    }

    // 4. Direct attention event with a REAL trigger → reply in persona style.
    if (
      input.triggeringReason === "attention_event" &&
      input.perceptionPacket.triggeringEvent &&
      opts.canReply
    ) {
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "reply_to_message",
        channelTarget: opts.canReply.channelTargets?.[0] ?? input.perceptionPacket.triggeringEvent?.channelId,
        personTargets: [],
        visibleContent: pick(style) ?? "oi",
        privateMotiveSummary: pick(lexicon) ?? "Responding because I was called out directly.",
        emotionDrivers,
        motivationDrivers,
        memoryWrites: this.maybeMemoryWrite(agentId),
      };
    }

    // 5. Boredom / cold start → casual message.
    // 5. Initiative / boredom — reply to the most recent thing said if it is
    //    still fresh (a late reply is a reply), else open with something.
    if (opts.canMessage) {
      const recentTarget = this.recentReplyTarget(input, agentId, 6);
      if (recentTarget && opts.canReply) {
        return {
          id: `int_${agentId}_${now}`,
          actorId: agentId,
          intentType: "reply_to_message",
          channelTarget: recentTarget.channelId,
          replyToEventId: recentTarget.eventId,
          personTargets: [],
          visibleContent: pick(style) ?? "oi",
          privateMotiveSummary: pick(lexicon) ?? "Responding to what was just said — even if late.",
          emotionDrivers,
          motivationDrivers,
          memoryWrites: this.maybeMemoryWrite(agentId),
        };
      }
      return {
        id: `int_${agentId}_${now}`,
        actorId: agentId,
        intentType: "send_message",
        channelTarget: opts.canMessage.channelTargets?.[0],
        personTargets: [],
        visibleContent: pick(style) ?? "pois é",
        privateMotiveSummary: pick(lexicon) ?? "Bored, sending a casual opener to break the silence.",
        emotionDrivers,
        motivationDrivers,
        memoryWrites: this.maybeMemoryWrite(agentId),
      };
    }

    // 6. Default silence.
    return {
      id: `int_${agentId}_${now}`,
      actorId: agentId,
      intentType: "no_op",
      personTargets: [],
      privateMotiveSummary: "No active urges detected, choosing silence.",
      emotionDrivers,
      motivationDrivers,
      memoryWrites: [],
    };
  }

  /**
   * The private channel this agent created (from committed context).
   */
  private myPrivateChannel(input: AgentRuntimeInput): string | undefined {
    const mine = input.perceptionPacket.visibleContextEvents.filter(
      e => e.type === "channel_created" && e.actorId === input.agentId && e.channelId,
    );
    return mine.length > 0 ? mine[mine.length - 1]!.channelId : undefined;
  }

  /**
   * Most recent message by someone else within the last `window` pulses —
   * the thing the agent would respond to when the conversation calls.
   */
  private recentReplyTarget(
    input: AgentRuntimeInput,
    agentId: string,
    window: number,
  ): { eventId: string; channelId: string } | undefined {
    const myPulse = input.perceptionPacket.visibleContextEvents
      .map(e => e.pulseIndex ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    for (let i = input.perceptionPacket.visibleContextEvents.length - 1; i >= 0; i--) {
      const e = input.perceptionPacket.visibleContextEvents[i]!;
      if (e.actorId === agentId) continue;
      if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
      if ((e.pulseIndex ?? 0) < myPulse - window) continue;
      if (!e.id) continue;
      return { eventId: e.id, channelId: e.channelId };
    }
    return undefined;
  }

  /**
   * A private channel is a human move, not a default. Only when the engine
   * already surfaced a motive-shaped trigger: intimacy/curiosity/repair
   * pressures or a specific person target.
   */
  private channelMotive(input: AgentRuntimeInput): string | undefined {
    const pack = this.pack;
    const lexicon = pack.edgeProfile.privateMotiveLexicon;
    // Only the engine's dedicated private-channel pressure counts.
    const pressure = input.activePressures.find(
      p => p.type === "urge_to_create_private_channel",
    );
    if (!pressure) return undefined;
    // Public players (high chaos cap: Goulart, Leo) don't scheme on status
    // alone — the drive must be intimacy-sourced (a real relationship pull).
    const intimacySourced = (pressure.sourceMotivations ?? []).includes("desireForIntimacy");
    if (pack.edgeProfile.chaosCap === "high" && !intimacySourced) return undefined;
    // Cap: one private move per agent per scene, unless the scenario demands more.
    if (this.privateChannelsUsed.has(input.agentId)) return undefined;
    this.privateChannelsUsed.add(input.agentId);
    return pickLexicon(lexicon) ?? "This is not for the whole room.";
  }

  private maybeMemoryWrite(agentId: string): unknown[] {
    // Charged scenes (suspicion/resentment/affection ≥ 0.3) produce biased
    // memory; neutral scenes write only occasionally.
    const social = this.lastInput?.emotionalState.socialEmotions;
    const charged = social
      ? ["suspicion", "resentment", "jealousy", "affection", "admiration", "shame"].some(
          k => (social[k as keyof typeof social] ?? 0) >= 0.3,
        )
      : false;
    const roll = charged ? 1 : 3;
    if (randDigest(agentId, 101) % roll !== 0) return [];
    const memory = this.pack.memorySeeds[randDigest(agentId, 17) % this.pack.memorySeeds.length];
    if (!memory) return [];
    return [
      {
        type: memory.type,
        subjectAgentIds: memory.subjectAgentIds,
        summary: memory.summary,
        emotionalTone: memory.emotionalTone,
        confidence: memory.confidence,
        intensity: 0,
        unresolved: memory.unresolved,
      },
    ];
  }

  private lastInput?: AgentRuntimeInput;

  private isChargedReact(): boolean {
    const social = this.lastInput?.emotionalState.socialEmotions;
    if (!social) return false;
    return (social.affection ?? 0) >= 0.5 || (social.admiration ?? 0) >= 0.5;
  }

  /**
   * Caps identical consecutive reacts at `MAX_IDENTICAL_REACTS` by rotating to
   * the next emoji rather than dropping the react: the react rate is a measured
   * benchmark axis, so the cap must not be able to move it.
   */
  private nextReactEmoji(agentId: string, emojis: string[], digestIndex: number): string {
    const MAX_IDENTICAL_REACTS = 2;
    const prior = this.reactStreaks.get(agentId);
    let index = digestIndex;
    if (prior && prior.emoji === emojis[index] && prior.count >= MAX_IDENTICAL_REACTS) {
      index = (index + 1) % emojis.length;
    }
    const emoji = emojis[index]!;
    const count = prior && prior.emoji === emoji ? prior.count + 1 : 1;
    this.reactStreaks.set(agentId, { emoji, count });
    return emoji;
  }
}

function randDigest(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function personaAwareProviderFactory(
  packs: Map<string, PersonaPack>,
  seed: number,
): (llmConfig: LLMConfig, agentId: string) => LLMProvider {
  const reactStreaks = new Map<string, ReactStreak>();
  return (llmConfig, agentId) => {
    if (llmConfig.providerType !== "mock") {
      return createLLMProvider(llmConfig, agentId);
    }
    const pack = packs.get(agentId);
    return new PersonaAwareMockProvider(
      pack ?? {
        personaId: "generic",
        displayName: "Participant",
        archetype: "generic",
        identityFrame: "You are a standard chat room participant.",
        voiceGuidelines: ["Keep messages natural and brief."],
        styleExamples: ["oi", "pois é", "verdade"],
        relationshipBiases: {},
        language: "pt-BR",
        memorySeeds: [],
        pendingIntentions: [],
        socialTheory: [],
        edgeProfile: {
          chaosCap: "low",
          impulseBehaviors: [],
          triggers: [],
          maskTells: [],
          privateMotiveLexicon: ["Just saying something to keep the room alive."],
          hardLimits: [],
        },
        presenceProfile: { responseDelayMs: [1000, 8000], silenceTolerancePulses: 4, messageLength: "short", punctuationTells: [] },
        sampling: { temperature: 0.7, repetitionPenalty: 1.1, topP: 0.95, maxTokens: 300 },
      },
      seed,
      reactStreaks,
    );
  };
}

function pickLexicon(lexicon: string[]): string | undefined {
  if (lexicon.length === 0) return undefined;
  const rand = mulberry32(lexicon.length * 97);
  return lexicon[Math.floor(rand() * lexicon.length)];
}

function strengthRank(s: "low" | "medium" | "high"): number {
  return { low: 1, medium: 2, high: 3 }[s];
}

function intensityRank(i: "low" | "medium" | "high" | "overwhelming"): number {
  return { low: 1, medium: 2, high: 3, overwhelming: 4 }[i];
}
