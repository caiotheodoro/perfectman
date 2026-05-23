import { z } from "zod";
export declare const IntentTypeSchema: z.ZodEnum<["send_message", "reply_to_message", "react", "create_channel", "invite_agent", "leave_channel", "typing_start", "typing_cancel", "write_memory", "delay_response", "no_op"]>;
export declare const MemoryWriteProposalSchema: z.ZodObject<{
    type: z.ZodEnum<["episodic", "relationship", "self", "social_theory", "pending_intention", "emotional_residue"]>;
    subjectAgentIds: z.ZodArray<z.ZodString, "many">;
    summary: z.ZodString;
    emotionalTone: z.ZodString;
    confidence: z.ZodNumber;
    unresolved: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
    subjectAgentIds: string[];
    summary: string;
    emotionalTone: string;
    confidence: number;
    unresolved: boolean;
}, {
    type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
    subjectAgentIds: string[];
    summary: string;
    emotionalTone: string;
    confidence: number;
    unresolved: boolean;
}>;
export declare const ActionIntentSchema: z.ZodObject<{
    id: z.ZodString;
    actorId: z.ZodString;
    intentType: z.ZodEnum<["send_message", "reply_to_message", "react", "create_channel", "invite_agent", "leave_channel", "typing_start", "typing_cancel", "write_memory", "delay_response", "no_op"]>;
    channelTarget: z.ZodOptional<z.ZodString>;
    personTargets: z.ZodArray<z.ZodString, "many">;
    visibleContent: z.ZodOptional<z.ZodString>;
    privateMotiveSummary: z.ZodString;
    emotionDrivers: z.ZodArray<z.ZodString, "many">;
    motivationDrivers: z.ZodArray<z.ZodString, "many">;
    preferredDelay: z.ZodOptional<z.ZodNumber>;
    fallbackIfBlocked: z.ZodOptional<z.ZodEnum<["send_message", "reply_to_message", "react", "create_channel", "invite_agent", "leave_channel", "typing_start", "typing_cancel", "write_memory", "delay_response", "no_op"]>>;
    memoryWrites: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["episodic", "relationship", "self", "social_theory", "pending_intention", "emotional_residue"]>;
        subjectAgentIds: z.ZodArray<z.ZodString, "many">;
        summary: z.ZodString;
        emotionalTone: z.ZodString;
        confidence: z.ZodNumber;
        unresolved: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
        subjectAgentIds: string[];
        summary: string;
        emotionalTone: string;
        confidence: number;
        unresolved: boolean;
    }, {
        type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
        subjectAgentIds: string[];
        summary: string;
        emotionalTone: string;
        confidence: number;
        unresolved: boolean;
    }>, "many">;
    spectatorSummary: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    actorId: string;
    intentType: "send_message" | "reply_to_message" | "react" | "create_channel" | "invite_agent" | "leave_channel" | "typing_start" | "typing_cancel" | "write_memory" | "delay_response" | "no_op";
    personTargets: string[];
    privateMotiveSummary: string;
    emotionDrivers: string[];
    motivationDrivers: string[];
    memoryWrites: {
        type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
        subjectAgentIds: string[];
        summary: string;
        emotionalTone: string;
        confidence: number;
        unresolved: boolean;
    }[];
    channelTarget?: string | undefined;
    visibleContent?: string | undefined;
    preferredDelay?: number | undefined;
    fallbackIfBlocked?: "send_message" | "reply_to_message" | "react" | "create_channel" | "invite_agent" | "leave_channel" | "typing_start" | "typing_cancel" | "write_memory" | "delay_response" | "no_op" | undefined;
    spectatorSummary?: string | undefined;
}, {
    id: string;
    actorId: string;
    intentType: "send_message" | "reply_to_message" | "react" | "create_channel" | "invite_agent" | "leave_channel" | "typing_start" | "typing_cancel" | "write_memory" | "delay_response" | "no_op";
    personTargets: string[];
    privateMotiveSummary: string;
    emotionDrivers: string[];
    motivationDrivers: string[];
    memoryWrites: {
        type: "episodic" | "relationship" | "self" | "social_theory" | "pending_intention" | "emotional_residue";
        subjectAgentIds: string[];
        summary: string;
        emotionalTone: string;
        confidence: number;
        unresolved: boolean;
    }[];
    channelTarget?: string | undefined;
    visibleContent?: string | undefined;
    preferredDelay?: number | undefined;
    fallbackIfBlocked?: "send_message" | "reply_to_message" | "react" | "create_channel" | "invite_agent" | "leave_channel" | "typing_start" | "typing_cancel" | "write_memory" | "delay_response" | "no_op" | undefined;
    spectatorSummary?: string | undefined;
}>;
//# sourceMappingURL=intent.schema.d.ts.map