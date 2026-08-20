import type {
  ActionIntent,
  AvailableAction,
  AgentState,
  SimulationSettings,
  IntentValidationResult,
  IntentViolation,
} from "@perfectman/shared";

const VALID_INTENT_TYPES = new Set([
  "send_message", "reply_to_message", "react",
  "create_channel", "invite_agent", "leave_channel",
  "typing_start", "typing_cancel",
  "write_memory", "delay_response", "no_op",
]);

const MAX_VISIBLE_CONTENT_LENGTH = 2000;
const MAX_PERSON_TARGETS = 10;

/**
 * Pure intent validation. Called by dev2 IntentResolver as first step.
 *
 * Checks:
 *   1. intentType is supported
 *   2. privateMotiveSummary is non-empty
 *   3. channelTarget (if provided) is in availableActions for this intentType
 *   4. personTargets are all in availableActions for this intentType (no hidden targets)
 *   5. preferredDelay is non-negative if provided
 *   6. visibleContent within length limits
 *   7. Fallback intent type is valid
 *   8. Person targets don't exceed max
 */
export function validateIntentPure(
  intent: ActionIntent,
  availableActions: AvailableAction[],
  agentState: AgentState,
  settings: SimulationSettings,
): IntentValidationResult {
  const violations: IntentViolation[] = [];

  // 1. Intent type must be supported
  if (!VALID_INTENT_TYPES.has(intent.intentType)) {
    violations.push({
      type:   "unsupported_intent_type",
      detail: `"${intent.intentType}" is not a valid intent type`,
    });
    return { valid: false, violations };
  }

  // 2. privateMotiveSummary required
  if (!intent.privateMotiveSummary || intent.privateMotiveSummary.trim().length === 0) {
    violations.push({
      type:   "missing_motive_summary",
      detail: "privateMotiveSummary must be non-empty",
    });
  }

  // 3-4. Find the AvailableAction for this intentType
  const availableAction = availableActions.find(a => a.intentType === intent.intentType);

  if (!availableAction) {
    // No available action for this type → blocked by policy
    violations.push({
      type:   "policy_blocked",
      detail: `intentType "${intent.intentType}" has no available action slot`,
    });
  } else {
    // 3. Channel target validation. An empty allow-list means this intent
    // type doesn't constrain channelTarget (e.g. create_channel has no
    // existing channels to target) — treat as unconstrained, matching the
    // personTargets guard just below.
    if (intent.channelTarget) {
      if (
        availableAction.channelTargets.length > 0 &&
        !availableAction.channelTargets.includes(intent.channelTarget)
      ) {
        violations.push({
          type:   "hidden_channel_target",
          detail: `channelTarget "${intent.channelTarget}" is not in available channels for ${intent.intentType}`,
        });
      }
    }

    // 4. Person targets — all must be reachable
    for (const personId of intent.personTargets) {
      if (
        availableAction.personTargets.length > 0 &&
        !availableAction.personTargets.includes(personId)
      ) {
        violations.push({
          type:   "hidden_person_target",
          detail: `personTarget "${personId}" is not reachable`,
        });
      }
    }

    // Blocked action
    if (availableAction.blocked) {
      violations.push({
        type:   "rate_limited",
        detail: availableAction.blockReason ?? "action is blocked",
      });
    }
  }

  // 5. Preferred delay non-negative
  if (intent.preferredDelay !== undefined && intent.preferredDelay < 0) {
    violations.push({
      type:   "invalid_delay",
      detail: "preferredDelay must be >= 0",
    });
  }

  // 6. Visible content length
  if (intent.visibleContent && intent.visibleContent.length > MAX_VISIBLE_CONTENT_LENGTH) {
    violations.push({
      type:   "schema_invalid",
      detail: `visibleContent exceeds max length of ${MAX_VISIBLE_CONTENT_LENGTH}`,
    });
  }

  // 7. Fallback intent type valid
  if (intent.fallbackIfBlocked && !VALID_INTENT_TYPES.has(intent.fallbackIfBlocked)) {
    violations.push({
      type:   "unsupported_intent_type",
      detail: `fallbackIfBlocked "${intent.fallbackIfBlocked}" is not a valid intent type`,
    });
  }

  // 8. Person targets count
  if (intent.personTargets.length > MAX_PERSON_TARGETS) {
    violations.push({
      type:   "schema_invalid",
      detail: `personTargets exceeds max of ${MAX_PERSON_TARGETS}`,
    });
  }

  return {
    valid:      violations.length === 0,
    violations,
  };
}
