import { z } from "zod";
export declare const EventTypeSchema: z.ZodEnum<["message_sent", "reply_sent", "reaction_sent", "typing_started", "typing_cancelled", "channel_created", "agent_invited", "agent_left", "presence_changed", "intent_delayed", "intent_blocked", "memory_written", "no_op_recorded", "private_motive_summary", "operator_warning", "llm_failure", "simulation_started", "simulation_paused", "simulation_resumed", "simulation_stopped", "recap_generated", "reflection_completed", "stagnation_detected"]>;
export declare const EmotionalSalienceSchema: z.ZodEnum<["low", "medium", "high", "critical"]>;
export declare const EventVisibilitySchema: z.ZodObject<{
    visibleToAgents: z.ZodArray<z.ZodString, "many">;
    visibleToSpectators: z.ZodBoolean;
    visibleToOperators: z.ZodBoolean;
    visibilityReason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    visibleToAgents: string[];
    visibleToSpectators: boolean;
    visibleToOperators: boolean;
    visibilityReason: string;
}, {
    visibleToAgents: string[];
    visibleToSpectators: boolean;
    visibleToOperators: boolean;
    visibilityReason: string;
}>;
export declare const SimulationEventSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    simulationId: z.ZodString;
    channelId: z.ZodString;
    actorId: z.ZodString;
    type: z.ZodEnum<["message_sent", "reply_sent", "reaction_sent", "typing_started", "typing_cancelled", "channel_created", "agent_invited", "agent_left", "presence_changed", "intent_delayed", "intent_blocked", "memory_written", "no_op_recorded", "private_motive_summary", "operator_warning", "llm_failure", "simulation_started", "simulation_paused", "simulation_resumed", "simulation_stopped", "recap_generated", "reflection_completed", "stagnation_detected"]>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    createdAt: z.ZodOptional<z.ZodNumber>;
    pulseIndex: z.ZodOptional<z.ZodNumber>;
    sourceIntentId: z.ZodOptional<z.ZodString>;
    sourceEventIds: z.ZodArray<z.ZodString, "many">;
    emotionalSalience: z.ZodEnum<["low", "medium", "high", "critical"]>;
    visibility: z.ZodObject<{
        visibleToAgents: z.ZodArray<z.ZodString, "many">;
        visibleToSpectators: z.ZodBoolean;
        visibleToOperators: z.ZodBoolean;
        visibilityReason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    }, {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "message_sent" | "reply_sent" | "reaction_sent" | "typing_started" | "typing_cancelled" | "channel_created" | "agent_invited" | "agent_left" | "presence_changed" | "intent_delayed" | "intent_blocked" | "memory_written" | "no_op_recorded" | "private_motive_summary" | "operator_warning" | "llm_failure" | "simulation_started" | "simulation_paused" | "simulation_resumed" | "simulation_stopped" | "recap_generated" | "reflection_completed" | "stagnation_detected";
    simulationId: string;
    channelId: string;
    actorId: string;
    payload: Record<string, unknown>;
    sourceEventIds: string[];
    emotionalSalience: "low" | "medium" | "high" | "critical";
    visibility: {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    };
    id?: string | undefined;
    createdAt?: number | undefined;
    pulseIndex?: number | undefined;
    sourceIntentId?: string | undefined;
}, {
    type: "message_sent" | "reply_sent" | "reaction_sent" | "typing_started" | "typing_cancelled" | "channel_created" | "agent_invited" | "agent_left" | "presence_changed" | "intent_delayed" | "intent_blocked" | "memory_written" | "no_op_recorded" | "private_motive_summary" | "operator_warning" | "llm_failure" | "simulation_started" | "simulation_paused" | "simulation_resumed" | "simulation_stopped" | "recap_generated" | "reflection_completed" | "stagnation_detected";
    simulationId: string;
    channelId: string;
    actorId: string;
    payload: Record<string, unknown>;
    sourceEventIds: string[];
    emotionalSalience: "low" | "medium" | "high" | "critical";
    visibility: {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    };
    id?: string | undefined;
    createdAt?: number | undefined;
    pulseIndex?: number | undefined;
    sourceIntentId?: string | undefined;
}>;
export declare const CommittedEventSchema: z.ZodObject<{
    simulationId: z.ZodString;
    channelId: z.ZodString;
    actorId: z.ZodString;
    type: z.ZodEnum<["message_sent", "reply_sent", "reaction_sent", "typing_started", "typing_cancelled", "channel_created", "agent_invited", "agent_left", "presence_changed", "intent_delayed", "intent_blocked", "memory_written", "no_op_recorded", "private_motive_summary", "operator_warning", "llm_failure", "simulation_started", "simulation_paused", "simulation_resumed", "simulation_stopped", "recap_generated", "reflection_completed", "stagnation_detected"]>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    sourceIntentId: z.ZodOptional<z.ZodString>;
    sourceEventIds: z.ZodArray<z.ZodString, "many">;
    emotionalSalience: z.ZodEnum<["low", "medium", "high", "critical"]>;
    visibility: z.ZodObject<{
        visibleToAgents: z.ZodArray<z.ZodString, "many">;
        visibleToSpectators: z.ZodBoolean;
        visibleToOperators: z.ZodBoolean;
        visibilityReason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    }, {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    }>;
} & {
    id: z.ZodString;
    createdAt: z.ZodNumber;
    pulseIndex: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: number;
    type: "message_sent" | "reply_sent" | "reaction_sent" | "typing_started" | "typing_cancelled" | "channel_created" | "agent_invited" | "agent_left" | "presence_changed" | "intent_delayed" | "intent_blocked" | "memory_written" | "no_op_recorded" | "private_motive_summary" | "operator_warning" | "llm_failure" | "simulation_started" | "simulation_paused" | "simulation_resumed" | "simulation_stopped" | "recap_generated" | "reflection_completed" | "stagnation_detected";
    simulationId: string;
    channelId: string;
    actorId: string;
    payload: Record<string, unknown>;
    pulseIndex: number;
    sourceEventIds: string[];
    emotionalSalience: "low" | "medium" | "high" | "critical";
    visibility: {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    };
    sourceIntentId?: string | undefined;
}, {
    id: string;
    createdAt: number;
    type: "message_sent" | "reply_sent" | "reaction_sent" | "typing_started" | "typing_cancelled" | "channel_created" | "agent_invited" | "agent_left" | "presence_changed" | "intent_delayed" | "intent_blocked" | "memory_written" | "no_op_recorded" | "private_motive_summary" | "operator_warning" | "llm_failure" | "simulation_started" | "simulation_paused" | "simulation_resumed" | "simulation_stopped" | "recap_generated" | "reflection_completed" | "stagnation_detected";
    simulationId: string;
    channelId: string;
    actorId: string;
    payload: Record<string, unknown>;
    pulseIndex: number;
    sourceEventIds: string[];
    emotionalSalience: "low" | "medium" | "high" | "critical";
    visibility: {
        visibleToAgents: string[];
        visibleToSpectators: boolean;
        visibleToOperators: boolean;
        visibilityReason: string;
    };
    sourceIntentId?: string | undefined;
}>;
//# sourceMappingURL=event.schema.d.ts.map