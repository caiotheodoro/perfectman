export type InitiativeSource =
  | "boredom_accumulator"
  | "curiosity_accumulator"
  | "reply_pressure"
  | "social_anxiety_relief"
  | "status_assertion"
  | "repair_urgency"
  | "gossip_impulse"
  | "attraction_reach"
  | "comfort_seeking"
  | "alliance_signal"
  | "avoidance_exit"
  | "conflict_provocation"
  | "exclusion_response"
  | "testing_probe"
  | "vulnerability_opening"
  | "secrecy_motive"
  | "cold_start_bootstrap";

export type InitiativeAccumulator = {
  source: InitiativeSource;
  value: number; // [0, 1]
  threshold: number; // agent fires when value > threshold
  growthRate: number; // per pulse
  decayRate: number; // per pulse
  lastFiredAt: number | null; // pulseIndex
};

export type InitiativeCandidate = {
  source: InitiativeSource;
  score: number;
  proceed: boolean;
  cooldownRemaining: number; // pulses
};
