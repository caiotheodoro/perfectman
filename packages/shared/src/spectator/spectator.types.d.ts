import type { EventType } from "../event/event.types.js";
export type SpectatorEventType = EventType | "spectator_hint" | "motive_reveal" | "relationship_shift" | "recap";
export type SpectatorEvent = {
    type: SpectatorEventType;
    simulationId: string;
    actorId?: string;
    channelId?: string;
    visibleContent?: string;
    narrativeHint?: string | null;
    summary?: string;
    createdAt: number;
    pulseIndex: number;
};
//# sourceMappingURL=spectator.types.d.ts.map