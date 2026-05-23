export type InhibitionStrength = "low" | "medium" | "high";

export type InhibitionType =
  | "fear_of_looking_needy"
  | "fear_of_escalating"
  | "fear_of_rejection"
  | "fear_of_exclusion_worsening"
  | "shame_about_desire"
  | "social_anxiety_block"
  | "status_protection"
  | "conflict_avoidance"
  | "vulnerability_guard"
  | "contempt_concealment"
  | "strategic_patience_hold"
  | "intimacy_fear"
  | "performance_anxiety"
  | "repair_doubt";

export type Inhibition = {
  id: string;
  agentId: string;
  type: InhibitionType;
  targetPressureId?: string;
  strength: InhibitionStrength;
  reason: string;
};
