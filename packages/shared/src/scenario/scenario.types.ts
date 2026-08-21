export type ScenarioPreset =
  | "friends_cold_open"
  | "strangers_first_meeting"
  | "mixed_room"
  | "returning_after_silence"
  | "post_event_tension"
  | "introduced_by_host"
  | "private_channel_seed"
  | "custom";

export type RelationshipMode =
  | "established_friends"
  | "total_strangers"
  | "mixed";

export type VisibleIntroPolicy =
  | "none"
  | "system_intro"
  | "agent_intros"
  | "host_message_only"
  | "custom";

export type AgentIntroBehavior =
  | "do_not_introduce_yourself_formally"
  | "introduce_yourself_briefly"
  | "introduce_yourself_only_to_people_you_do_not_know"
  | "wait_for_context";

export type ScenarioContext = {
  scenario: ScenarioPreset;
  relationshipMode: RelationshipMode;
  roomContext: string;
  startingMood: string;
  visibleIntro: VisibleIntroPolicy;
  agentIntroBehavior: AgentIntroBehavior;
  firstMoveGuidance: string;
  customNotes?: string[];
  pairFamiliarity?: Record<string, string>;
  safePriorContext?: string[];
  startingPrompt?: string;
};

export type ScenarioPresetConfig = {
  preset: Exclude<ScenarioPreset, "custom">;
  overrides?: Partial<ScenarioContext>;
};
