import type { CommittedEvent } from "../event/event.types.js";
import type { Memory } from "../memory/memory.types.js";
import type { EmotionalState } from "../emotion/emotion.types.js";
import type { AvailableAction } from "../action/action.types.js";

export type PerceptionPacket = {
  agentId: string;
  triggeringEvent: CommittedEvent | null;
  visibleContextEvents: CommittedEvent[]; // 5-10 recent messages in visible channels
  involvedPeople: string[]; // agent IDs relevant to triggering event
  relevantChannels: string[]; // channel IDs visible to agent
  relevantMemories: Memory[];
  currentEmotionalState: EmotionalState;
  availableActions: AvailableAction[];
};
