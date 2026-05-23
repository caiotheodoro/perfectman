import { z } from "zod";
export const PresenceModeSchema = z.enum([
    "active",
    "semi_active",
    "lurking",
    "busy_elsewhere",
    "avoidant",
    "offline",
]);
export const BudgetPrioritySchema = z.enum(["high", "normal", "low", "blocked"]);
export const PersonaConfigSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    archetype: z.string().min(1),
    writingStyle: z.string().min(1),
    styleExamples: z.array(z.string()),
    baselineValence: z.number().min(-1).max(1),
    baselineArousal: z.number().min(0).max(1),
    baselineStability: z.number().min(0.1).max(1),
    baselineEnergy: z.number().min(0).max(1),
    emotionalReactivity: z.number().positive(),
    moodInertia: z.number().min(0).max(1),
    maxMoodRotation: z.number().positive(),
    energyRegen: z.number().positive(),
    exclusionSensitivity: z.number().min(0).max(3),
    praiseSensitivity: z.number().min(0).max(3),
    conflictSensitivity: z.number().min(0).max(3),
    boredomSensitivity: z.number().min(0).max(3),
    intimacySensitivity: z.number().min(0).max(3),
    socialSensitivities: z.record(z.number().min(0).max(3)),
});
//# sourceMappingURL=agent.schema.js.map