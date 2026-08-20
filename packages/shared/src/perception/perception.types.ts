import type { CommittedEvent } from "../event/event.types.js";
import type { Memory } from "../memory/memory.types.js";
import type { TranslatedEmotionalState } from "../prompt/prompt.types.js";
import type { AvailableAction } from "../action/action.types.js";

export type PerceptionPacket = {
  agentId: string;
  triggeringEvent: CommittedEvent | null;
  visibleContextEvents: CommittedEvent[]; // 5-10 recent messages in visible channels
  // The agent's own last few sent messages, verbatim, independent of
  // visibleContextEvents' CONTEXT_WINDOW truncation. In a multi-agent room
  // the shared window fills up fast (every agent's turn counts against it),
  // so an agent's own prior utterance from even 1-2 pulses ago can already
  // be pushed out — this is tracked separately so "don't repeat yourself"
  // has something concrete to check against no matter how busy the room is.
  ownRecentUtterances: string[];
  involvedPeople: string[]; // agent IDs relevant to triggering event
  relevantChannels: string[]; // channel IDs visible to agent
  relevantMemories: Memory[];
  translatedEmotionalState: TranslatedEmotionalState;
  availableActions: AvailableAction[];
};
