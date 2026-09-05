import { z } from "zod";
import type { VideoStory } from "./types.js";
import { MISSING_EMOTION_NOTICE } from "./source-utils.js";

const text = z.string().refine(value => value.trim().length > 0, "Must not be blank");
const emotion = z.object({
  source: z.literal("authored").optional(),
  label: text.optional(),
  drivers: z.array(text).optional(),
  values: z.record(z.number().finite()).optional(),
}).strict().refine(value => value.label || value.drivers?.length || Object.keys(value.values ?? {}).length, {
  message: "An authored emotion needs a label, drivers, or numeric values",
});
const scriptSchema = z.object({
  version: z.literal("perfectman-video-v1"),
  title: text,
  agents: z.array(z.object({ id: text, name: text }).strict()).min(1),
  steps: z.array(z.object({
    phase: text,
    kind: z.enum(["message", "private", "event", "state", "narration"]),
    text: z.string().min(1),
    actorId: text.optional(),
    channel: text.optional(),
    visibility: z.enum(["public", "private", "operator"]).optional(),
    emotion: emotion.optional(),
    duration: z.number().finite().positive().optional(),
  }).strict()).min(1),
}).strict();

export function normalizeScript(value: unknown): VideoStory {
  const source = scriptSchema.parse(value);
  const ids = new Set(source.agents.map(agent => agent.id));
  if (ids.size !== source.agents.length) throw new Error("Script agent IDs must be unique");
  for (const step of source.steps) {
    if (step.actorId && !ids.has(step.actorId)) throw new Error(`Unknown script actorId: ${step.actorId}`);
  }
  const original = value as { steps: unknown[] };
  return {
    title: source.title,
    sourceKind: "script",
    agents: source.agents,
    steps: source.steps.map((step, index) => ({
      ...step,
      id: `step-${index + 1}`,
      action: step.kind,
      visibility: step.visibility ?? (step.kind === "private" ? "private" : "public"),
      emotion: step.emotion ? { ...step.emotion, source: "authored" } : undefined,
      sourceRefs: [`/steps/${index}`],
      raw: original.steps[index],
    })),
    notices: ["Script dialogue, phases, and emotion cues are authored.", MISSING_EMOTION_NOTICE],
  };
}
