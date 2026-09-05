import { z } from "zod";
import { isEngineAuthoredMotive } from "@perfectman/server";
import type { RecordedEmotion, VideoStep } from "./types.js";

const Numbers = z.record(z.number().finite());
export const ReplayState = z.object({
  agentId: z.string().optional(),
  presence: z.string().optional(),
  coreMood: Numbers.optional(),
  socialEmotions: Numbers.optional(),
  relationalStates: z.record(z.record(z.unknown())).optional(),
}).passthrough();
export const ReplayOperator = z.object({
  type: z.string().min(1),
  agentId: z.string().optional(),
  pulseIndex: z.number().int().optional(),
  detail: z.string().optional(),
  data: z.record(z.unknown()).optional(),
}).passthrough();
type State = z.infer<typeof ReplayState>;
type Operator = z.infer<typeof ReplayOperator>;

function numbersText(values: Record<string, number>): string {
  return Object.entries(values).map(([name, value]) => `${name}: ${value}`).join(" · ");
}

export function stateStep(state: State, actorId: string, pulse: number, ref: string): VideoStep {
  const values: Record<string, number> = { ...state.coreMood, ...state.socialEmotions };
  const lines: string[] = [];
  if (state.presence) lines.push(`Presence: ${state.presence}.`);
  if (state.coreMood) lines.push(`Mood — ${numbersText(state.coreMood)}`);
  if (state.socialEmotions) lines.push(`Social emotions — ${numbersText(state.socialEmotions)}`);
  for (const [target, relation] of Object.entries(state.relationalStates ?? {})) {
    const numbers = Object.fromEntries(Object.entries(relation).filter(
      (pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]),
    ));
    if (Object.keys(numbers).length) lines.push(`Toward ${target} — ${numbersText(numbers)}`);
    for (const [key, value] of Object.entries(numbers)) values[`relational.${target}.${key}`] = value;
  }
  const strongest = Object.entries(state.socialEmotions ?? {}).sort((a, b) => b[1] - a[1])[0];
  return {
    id: ref, phase: "Recorded pulse state", kind: "state", actorId, pulse,
    visibility: "operator", sourceRefs: [ref], raw: state,
    text: lines.join("\n") || "State recorded; no emotional measurements were saved.",
    ...(Object.keys(values).length ? { emotion: {
      source: "snapshot", values, ...(strongest && strongest[1] > 0 ? { label: strongest[0] } : {}),
    } satisfies RecordedEmotion } : {}),
  };
}

export function operatorStep(op: Operator, pulse: number, ref: string): VideoStep {
  const base: VideoStep = {
    id: ref, phase: `Recorded operator event: ${op.type}`, kind: "event", actorId: op.agentId,
    pulse: op.pulseIndex ?? pulse, visibility: "operator", sourceRefs: [ref], raw: op,
    text: [op.detail || op.type, op.data ? JSON.stringify(op.data, null, 2) : ""].filter(Boolean).join("\n"),
  };
  if (op.type !== "action_intent") return base;
  const data = z.object({
    intentType: z.string().optional(), privateMotiveSummary: z.string().optional(),
    emotionDrivers: z.array(z.string()).optional(), motivationDrivers: z.array(z.string()).optional(),
  }).passthrough().parse(op.data ?? {});
  const motive = data.privateMotiveSummary;
  if (!motive) return base;
  if (isEngineAuthoredMotive(motive) || data.engineAuthored === true) {
    return { ...base, phase: "Recorded engine interruption", text: motive };
  }
  return {
    ...base, kind: "private", phase: "Recorded private intent",
    text: [data.intentType ? `Intent: ${data.intentType}` : "", motive,
      data.emotionDrivers?.length ? `Emotion: ${data.emotionDrivers.join(", ")}` : "",
      data.motivationDrivers?.length ? `Motivation: ${data.motivationDrivers.join(", ")}` : ""].filter(Boolean).join("\n"),
    ...(data.emotionDrivers?.length ? { emotion: { source: "driver", drivers: data.emotionDrivers } as RecordedEmotion } : {}),
  };
}
