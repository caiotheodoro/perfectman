import type { IntentType } from "../intent/intent.types.js";

export type AvailableAction = {
  intentType: IntentType;
  channelTargets: string[]; // channel IDs agent can target
  personTargets: string[]; // agent IDs agent can target
  blocked: boolean; // true if rate-limited or policy-blocked
  blockReason?: string;
};
