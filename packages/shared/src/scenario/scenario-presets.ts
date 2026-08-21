import type { ScenarioContext, ScenarioPreset } from "./scenario.types.js";

export const SCENARIO_PRESETS: Record<Exclude<ScenarioPreset, "custom">, ScenarioContext> = {
  friends_cold_open: {
    scenario: "friends_cold_open",
    relationshipMode: "established_friends",
    roomContext: "This is a private friend-group chat. Everyone already knows each other.",
    startingMood: "quiet, casual, slightly empty",
    visibleIntro: "none",
    agentIntroBehavior: "do_not_introduce_yourself_formally",
    firstMoveGuidance: "If you speak first, act like someone reviving a familiar group chat.",
    customNotes: [
      "Silence is normal here.",
      "No one should explain who they are unless the scenario says they are strangers.",
    ],
  },
  strangers_first_meeting: {
    scenario: "strangers_first_meeting",
    relationshipMode: "total_strangers",
    roomContext: "Agents are entering a new shared room and have no prior relationship.",
    startingMood: "polite, new, lightly uncertain",
    visibleIntro: "agent_intros",
    agentIntroBehavior: "introduce_yourself_briefly",
    firstMoveGuidance: "If you speak first, a short natural introduction is appropriate.",
    customNotes: [
      "Do not invent prior friendships, inside jokes, or shared history.",
    ],
  },
  mixed_room: {
    scenario: "mixed_room",
    relationshipMode: "mixed",
    roomContext: "Some agents already know each other; one or more people are new to the group.",
    startingMood: "polite but uncertain",
    visibleIntro: "agent_intros",
    agentIntroBehavior: "introduce_yourself_only_to_people_you_do_not_know",
    firstMoveGuidance: "Act familiar with known people and briefly introduce yourself only to unknown people.",
    customNotes: [
      "Use pair familiarity when provided; otherwise fall back to the mixed-room assumption.",
    ],
  },
  returning_after_silence: {
    scenario: "returning_after_silence",
    relationshipMode: "established_friends",
    roomContext: "The group exists and already knows each other, but nobody has talked for a while.",
    startingMood: "quiet, stale, slightly awkward",
    visibleIntro: "none",
    agentIntroBehavior: "do_not_introduce_yourself_formally",
    firstMoveGuidance: "If you speak first, treat it like reviving an existing chat after silence.",
  },
  post_event_tension: {
    scenario: "post_event_tension",
    relationshipMode: "established_friends",
    roomContext: "Something minor happened before the simulation starts. Nobody has addressed it yet.",
    startingMood: "tense, indirect, quiet",
    visibleIntro: "none",
    agentIntroBehavior: "do_not_introduce_yourself_formally",
    firstMoveGuidance: "Let subtext, avoidance, repair, or silence feel natural; do not explain the whole backstory.",
  },
  introduced_by_host: {
    scenario: "introduced_by_host",
    relationshipMode: "mixed",
    roomContext: "A host or system message frames the room before agents respond.",
    startingMood: "structured but casual",
    visibleIntro: "host_message_only",
    agentIntroBehavior: "wait_for_context",
    firstMoveGuidance: "Respond naturally to the host framing without over-explaining yourself.",
  },
  private_channel_seed: {
    scenario: "private_channel_seed",
    relationshipMode: "mixed",
    roomContext: "Some agents may have access to private side channels, creating public/private asymmetry.",
    startingMood: "casual on the surface, socially asymmetric underneath",
    visibleIntro: "none",
    agentIntroBehavior: "do_not_introduce_yourself_formally",
    firstMoveGuidance: "Act from the public room context while allowing suspicion, exclusion, or alliance behavior to emerge naturally.",
    customNotes: [
      "Do not reveal private-channel facts in public unless the visible context supports it.",
    ],
  },
};

export function resolveScenarioPreset(
  preset: Exclude<ScenarioPreset, "custom">,
  overrides: Partial<ScenarioContext> = {},
): ScenarioContext {
  return {
    ...SCENARIO_PRESETS[preset],
    ...overrides,
    scenario: overrides.scenario ?? preset,
  };
}
