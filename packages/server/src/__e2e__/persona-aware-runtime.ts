/**
 * PersonaAwareRuntime — wraps AgentRuntime with per-archetype message content
 * and richer privateMotiveSummary for the HTML snapshot viewer.
 *
 * Keeps all budget checking, fallback handling, and LLM infrastructure from
 * AgentRuntime intact; only post-processes the surface-level output.
 */
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, AgentRuntimeOutput } from "../agent/agent-runtime.types.js";
import type { ActionIntent } from "@perfectman/shared";
import { AgentRuntime } from "../agent/agent-runtime.js";
import type { AgentConfigRegistry } from "../agent/agent-config-registry.js";

// ── Per-archetype content scripts ────────────────────────────────────────────

type Script = {
  sendMsgs: string[];
  boredMsg: string;
  replyMsgs: string[];
  motives: Record<string, string>;
};

const SCRIPTS: Record<string, Script> = {
  observer: {
    sendMsgs: ["entendi", "hm", "interessante isso", "oi gente"],
    boredMsg: "tô aqui",
    replyMsgs: ["oi, que que rolou?", "pode elaborar?", "entendi sim", "faz sentido"],
    motives: {
      boredom: "Breaking the silence feels necessary, but I don't want to say too much.",
      send_message: "Watching the room, feeling a quiet need to acknowledge the presence here.",
      reply_to_message: "This feels worth engaging with carefully.",
      no_op: "Better to stay quiet and observe for now. Not enough has happened.",
    },
  },
  provocateur: {
    sendMsgs: ["sério isso?", "kk", "que bagunça", "e aí?"],
    boredMsg: "alguém tá vivo aqui?",
    replyMsgs: ["nossa, que drama", "tá bom né", "vixi", "ahnn"],
    motives: {
      boredom: "Can't stand the silence — need to stir something up, see who reacts.",
      send_message: "The silence is boring me. Poking to see who moves first.",
      reply_to_message: "Too easy not to respond to this one.",
      no_op: "Holding back this time — but barely. Something about this doesn't feel worth it yet.",
    },
  },
  strategist: {
    sendMsgs: ["interessante", "pode ser", "depende", "tem lógica"],
    boredMsg: "alguém tem algo relevante pra dizer?",
    replyMsgs: ["concordo, parcialmente", "tem alguma lógica", "faz sentido", "é uma perspectiva"],
    motives: {
      boredom: "Need to remind people I'm here. Say something measured and useful.",
      send_message: "Positioning carefully — say something non-committal but visible.",
      reply_to_message: "Worth engaging here, but staying neutral to see how others react first.",
      no_op: "Not enough information yet. Watch and wait — acting now would be premature.",
    },
  },
};

const FALLBACK_SCRIPT: Script = {
  sendMsgs: ["olá", "oi"],
  boredMsg: "pois é",
  replyMsgs: ["oi tudo bem"],
  motives: {
    boredom: "Bored, sending a casual opener to break the silence.",
    send_message: "Reacting to activity in the channel.",
    reply_to_message: "Responding to direct mention.",
    no_op: "No active urges detected, choosing silence.",
  },
};

function getScript(archetype: string): Script {
  return SCRIPTS[archetype.toLowerCase()] ?? FALLBACK_SCRIPT;
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]!;
}

// ── Runtime wrapper ──────────────────────────────────────────────────────────

export class PersonaAwareRuntime {
  private readonly inner: AgentRuntime;
  private callIndex = 0;

  /** Last resolved intent per agentId — used by SimulationRecorder for thinking panels. */
  readonly lastIntents = new Map<string, ActionIntent>();

  constructor(registry: AgentConfigRegistry) {
    this.inner = new AgentRuntime(undefined, registry);
  }

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
  ): Promise<AgentRuntimeOutput> {
    const result = await this.inner.generateIntent(input, context);

    if (result.fallbackApplied) {
      this.lastIntents.set(input.agentId, result.intent);
      return result;
    }

    const script = getScript(input.personaConfig.archetype);
    const seed = this.callIndex++;
    const intentType = result.intent.intentType;
    const isBored = result.intent.motivationDrivers.includes("boredom");

    let visibleContent = result.intent.visibleContent;
    let privateMotiveSummary = result.intent.privateMotiveSummary;

    if (intentType === "send_message") {
      visibleContent = isBored ? script.boredMsg : pick(script.sendMsgs, seed);
      privateMotiveSummary = isBored
        ? script.motives["boredom"]!
        : script.motives["send_message"]!;
    } else if (intentType === "reply_to_message") {
      visibleContent = pick(script.replyMsgs, seed);
      privateMotiveSummary = script.motives["reply_to_message"]!;
    } else if (intentType === "no_op") {
      privateMotiveSummary = script.motives["no_op"]!;
    }

    const intent: ActionIntent = {
      ...result.intent,
      visibleContent,
      privateMotiveSummary,
    };

    this.lastIntents.set(input.agentId, intent);
    return { ...result, intent };
  }
}
