import type { VideoAgent, VideoStep } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pointerKey(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function readablePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload).map(([key, value]) =>
    `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
  ).join("\n");
}

export function agentsFromSteps(steps: VideoStep[], knownIds: string[] = []): VideoAgent[] {
  return [...new Set([...steps.flatMap(step => [
    ...(step.actorId ? [step.actorId] : []), ...(step.recipientIds ?? []),
    ...(step.audienceIds ?? []), ...(step.stageAction?.agentIds ?? []),
  ]), ...knownIds])]
    .map(id => ({ id, name: id }));
}

export const MISSING_EMOTION_NOTICE =
  "Steps keep the last recorded emotional state. Expressions are neutral until an emotional state is recorded. No missing emotion trajectory is invented.";

/** Authoritative emitters make these internal even when old exports lost visibility. */
export const OPERATOR_EVENT_TYPES = new Set([
  "no_op_recorded", "repetition_blocked", "memory_written", "intent_blocked",
  "llm_failure", "stagnation_detected", "operator_warning",
]);
