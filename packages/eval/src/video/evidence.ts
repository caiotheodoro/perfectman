import { z } from "zod";
import { isEngineAuthoredMotive } from "@perfectman/shared";
import type { VideoChannel, VideoStep, VideoStory } from "./types.js";
import { mergeChannels } from "./social-metadata.js";
import { agentsFromSteps, MISSING_EMOTION_NOTICE, OPERATOR_EVENT_TYPES, pointerKey, readablePayload } from "./source-utils.js";

const rowSchema = z.object({
  pulse: z.number().int(),
  agent: z.string().min(1),
  type: z.string().min(1),
  channelId: z.string().optional(),
  private: z.boolean().optional(),
  content: z.string().optional(),
  privateMotive: z.string().optional(),
  engineAuthored: z.boolean().optional(),
  phase: z.string().min(1).optional(),
}).passthrough();
const rowsSchema = z.array(rowSchema).min(1);
const evidenceSchema = z.object({
  name: z.string().optional(),
  scenarioId: z.string().optional(),
  transcript: rowsSchema,
  finalStates: z.record(z.record(z.number().finite())).optional(),
}).passthrough();

export function normalizeEvidence(value: unknown, fallbackTitle = "Perfectman run"): VideoStory {
  const bare = Array.isArray(value);
  const source = bare ? { transcript: rowsSchema.parse(value) } : evidenceSchema.parse(value);
  const original = bare ? value : (value as { transcript: unknown[] }).transcript;
  const steps: VideoStep[] = [];
  const channelRows: VideoChannel[] = [];
  source.transcript.forEach((row, index) => {
    const ref = `${bare ? "" : "/transcript"}/${index}`;
    const isMotive = row.type === "private_motive_summary";
    const fallback = row.engineAuthored === true || isEngineAuthoredMotive(row.privateMotive ?? (isMotive ? row.content : undefined) ?? "");
    const spokenAct = ["message_sent", "reply_sent", "reaction_sent"].includes(row.type);
    const operator = (fallback && !spokenAct) || OPERATOR_EVENT_TYPES.has(row.type);
    if (row.channelId && !isMotive && !operator) {
      channelRows.push({ id: row.channelId, name: row.channelId, kind: row.private ? "private" : "public" });
    }
    const base = {
      phase: row.phase ?? "Simulation", actorId: row.agent, channel: row.channelId,
      pulse: row.pulse, sourceRefs: [ref], raw: original[index],
    };
    const extra = Object.fromEntries(Object.entries(row).filter(([key]) =>
      !["pulse", "agent", "type", "channelId", "private", "content", "privateMotive", "engineAuthored", "phase"].includes(key),
    ));
    steps.push({
      ...base, id: `row-${index + 1}`,
      kind: isMotive && !fallback ? "private" : spokenAct ? "message" : "event", action: row.type.replace(/_/g, " "),
      text: row.content ?? [row.type.replace(/_/g, " "), readablePayload(extra)].filter(Boolean).join("\n"),
      visibility: operator ? "operator" : isMotive || row.private ? "private" : "public",
      ...(row.type === "agent_left" && row.channelId ? { stageAction: { kind: "leave" as const, agentIds: [row.agent] } } : {}),
    });
    if (row.privateMotive) steps.push({
      ...base, id: `row-${index + 1}-motive`, kind: fallback ? "event" : "private", action: "private motive",
      text: row.privateMotive, visibility: fallback ? "operator" : "private",
    });
  });
  if ("finalStates" in source && source.finalStates) {
    for (const [actorId, values] of Object.entries(source.finalStates)) steps.push({
      id: `final-${actorId}`, phase: "Final state", kind: "state", action: "final state", actorId,
      text: Object.entries(values).map(([key, value]) => `${key}: ${value}`).join("\n") || "No final values recorded.",
      visibility: "operator", emotion: { source: "snapshot", values },
      sourceRefs: [`/finalStates/${pointerKey(actorId)}`], raw: values,
    });
  }
  return {
    title: ("name" in source && source.name) || ("scenarioId" in source && source.scenarioId) || fallbackTitle,
    sourceKind: bare ? "transcript" : "evidence", agents: agentsFromSteps(steps), channels: mergeChannels(channelRows), steps,
    notices: [MISSING_EMOTION_NOTICE,
      "Legacy transcripts retain final emotional states only. Final values appear only at the end.",
      "Simulation is a display phase when the source has no phase label; source array order is retained."],
  };
}
