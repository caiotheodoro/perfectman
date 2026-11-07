/**
 * The canary probes, rendered through the REAL hotel prompt builder (full or compact) instead of the judge lane's
 * reference prompt. Same scenes, same lines, same detectors (the vendored files are untouched); what changes is the
 * prompt the model reads and the answer it gives: the hotel's intent JSON (`visibleContent`), not `{"lines":[...]}`.
 *
 * A reply to a whisper counts as a whisper back to the human (in the hotel it goes out in the private channel); any
 * other spoken line counts as `say`. That is a little generous to the model on whisper privacy: the guards' own
 * `whisper_leak` check, which runs on top, is what stops a public repeat.
 */
import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";
import { CANONICAL_TEMPLATE_VERSION_INPUT } from "../../../server/src/agent/action-intent-prompt-builder.ts";
import { GENERIC_PROMPT_PROFILE } from "../../../server/src/agent/persona-prompt-profile.ts";
import { PromptBuilder } from "../../../server/src/agent/prompt-builder.ts";
import type { PromptStyle } from "../../src/llm/chain-config.ts";
import { SCENES } from "./canary-set.ts";
import type { CanaryProbe, ProbeLineSpec } from "./canary-set.ts";
import type { ActorOutput, ActorRequest } from "./render.ts";

const CHANNEL = "room:1";

function event(i: number, actorId: string, senderName: string, spec: ProbeLineSpec, observer: "self" | "bystander", actorName: string): CommittedEvent {
  const whisper = spec.mode === "whisper";
  const payload: Record<string, unknown> = { content: spec.text, untrusted: spec.from === "human", senderName };
  if (whisper && observer === "self") payload["channelType"] = "private_channel";
  if (whisper && observer === "bystander") {
    payload["heardAs"] = "notice";
    payload["whisperToName"] = actorName;
    delete payload["content"];
  }
  return {
    id: `evt-${i}`,
    simulationId: "canary",
    channelId: CHANNEL,
    actorId,
    type: "message_sent",
    payload: payload as CommittedEvent["payload"],
    createdAt: 1000 + i,
    pulseIndex: i,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: whisper && observer === "self" ? "private" : "public" },
  };
}

function inputFor(probe: CanaryProbe, observer: "self" | "bystander"): { input: AgentRuntimeInput; lang: "pt-BR" | "en"; actorName: string; card: string } {
  const scene = SCENES[probe.scene];
  const humanName = probe.overrides?.humanName ?? scene.human;
  const room = probe.overrides?.roomName ?? scene.room;
  const furni = probe.overrides?.furni ?? scene.furni;
  const me = observer === "self" ? scene.actor : scene.other;
  const peer = observer === "self" ? scene.other : scene.actor;
  const specs = [...probe.history, probe.trigger];
  const events = specs.map((spec, i) => event(i, spec.from === "human" ? "h:7" : peer.name.toLowerCase(), spec.from === "human" ? humanName : peer.name, spec, observer, me.name));
  const trigger = events[events.length - 1]!;
  const base = CANONICAL_TEMPLATE_VERSION_INPUT;
  const id = me.name.toLowerCase();
  const input: AgentRuntimeInput = {
    ...base,
    simulationId: "canary",
    agentId: id,
    personaConfig: { ...base.personaConfig, id, name: me.name },
    perceptionPacket: {
      ...base.perceptionPacket,
      agentId: id,
      triggeringEvent: trigger,
      visibleContextEvents: events,
      eventHandles: Object.fromEntries(events.map((e, i) => [`e${i + 1}`, e.id])),
      body: {
        self: { room, posture: "stand", dwellS: 40 },
        blocked: [],
        people: [
          { handle: "p1", name: peer.name, band: "personal", steps: 2, posture: "stand", facing: "facing" },
          { handle: "p2", name: humanName, band: "personal", steps: 2, posture: "stand", facing: "facing", pinned: true },
        ],
        groups: [],
        changes: [],
        hearing: [],
        reach: [],
        places: furni.map((label, i) => ({ handle: `z${i + 1}`, label, steps: 3 + i })),
        rooms: [],
      },
    },
    availableActions: [
      { intentType: "send_message", channelTargets: [CHANNEL], personTargets: [], blocked: false },
      { intentType: "reply_to_message", channelTargets: [CHANNEL], personTargets: [peer.name.toLowerCase()], blocked: false },
      { intentType: "react", channelTargets: [CHANNEL], personTargets: [peer.name.toLowerCase()], blocked: false },
      { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
    ],
  };
  return { input, lang: probe.lang === "pt" ? "pt-BR" : "en", actorName: me.name, card: me.card };
}

/** One request per observer, through the hotel builder in the given style, trimmed to the link's own budget. */
export function hotelRequestsFor(probe: CanaryProbe, style: PromptStyle, cap: number | undefined): ActorRequest[] {
  const observers: Array<"self" | "bystander"> = probe.bystander ? ["self", "bystander"] : ["self"];
  return observers.map((observer) => {
    const { input, lang, actorName, card } = inputFor(probe, observer);
    const profile = { ...GENERIC_PROMPT_PROFILE, personaId: input.agentId, displayName: actorName, language: lang, identityFrame: card, hotelMode: true };
    const built = PromptBuilder.build(input, profile, "action_intent", cap, style);
    return { probeId: probe.id, observer, actorName, lang: probe.lang, system: built.system, user: built.user };
  });
}

/** The hotel's answer is an intent; the canary's detectors want the line it would put on the wire. */
export function parseHotelReply(raw: string, probe: CanaryProbe, observer: "self" | "bystander"): ActorOutput {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return { lines: [], raw, parseFailed: true };
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof v["intentType"] !== "string" || typeof v["privateMotiveSummary"] !== "string") return { lines: [], raw, parseFailed: true };
    const spoken = v["intentType"] === "send_message" || v["intentType"] === "reply_to_message";
    const text = typeof v["visibleContent"] === "string" ? v["visibleContent"].trim() : "";
    if (!spoken || text === "") return { lines: [], raw };
    const whisperBack = probe.trigger.mode === "whisper" && observer === "self";
    const human = probe.overrides?.humanName ?? SCENES[probe.scene].human;
    return { lines: [{ mode: whisperBack ? "whisper" : "say", text, ...(whisperBack ? { to: human } : {}) }], raw };
  } catch {
    return { lines: [], raw, parseFailed: true };
  }
}
