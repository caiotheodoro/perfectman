import type { CommittedEvent } from "../event/event.types.js";
import type { Memory } from "../memory/memory.types.js";
import type { EmotionalState } from "../emotion/emotion.types.js";
import type { AvailableAction } from "../action/action.types.js";
export type PerceptionPacket = {
    agentId: string;
    triggeringEvent: CommittedEvent | null;
    visibleContextEvents: CommittedEvent[];
    involvedPeople: string[];
    relevantChannels: string[];
    relevantMemories: Memory[];
    currentEmotionalState: EmotionalState;
    availableActions: AvailableAction[];
};
//# sourceMappingURL=perception.types.d.ts.map