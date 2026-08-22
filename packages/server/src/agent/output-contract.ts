import { ACTION_INTENT_JSON_SCHEMA } from "@perfectman/shared";

/**
 * SECTION 8 output contract, DERIVED from ActionIntentSchema.
 *
 * History: this contract existed twice — hand-written prose in the prompt
 * and the zod schema in shared. They drifted (spectatorSummary, emoji,
 * targetEventId, replyToEventId were never explained; preferredDelay and
 * channelType were hardcoded). The renderer below makes the field list
 * mechanically follow the schema so drift is a compile/test failure, not a
 * silent prompt change. memoryWrites renders as a curated string describing
 * its inner proposal shape; the shape itself stays enforced by validation.
 *
 * Engine-stamped fields (id, actorId) are NOT requested: the runtime owns
 * structure, the model owns language (see intent-parser's structural
 * repairs, which already stamp them). Everything the model IS asked for is
 * either semantic natural language or a choice among runtime options.
 */

/** Fields the engine stamps after parsing — never requested from the model. */
const ENGINE_STAMPED = new Set(["id", "actorId"]);

/** Curated per-field guidance, keyed by schema property name. String arrays are example lists. */
export const FIELD_NOTES: Record<string, string | string[]> = {
  intentType: "one of the available intent types",
  channelTarget:
    "ONLY for send_message/reply_to_message/leave_channel/invite_agent — the existing channel ID you're acting in. OMIT entirely for create_channel (use channelName/channelType instead).",
  personTargets:
    "OMIT this field unless the action targets a specific person directly.",
  visibleContent:
    "Optional text message content (required for 'send_message' or 'reply_to_message')",
  privateMotiveSummary:
    "A highly specific natural-language thought explaining your real, raw, hidden motive behind this action. Never leave empty.",
  emotionDrivers: ["warmth", "jealousy", "irritation"],
  motivationDrivers: ["affinity", "gossip", "exclusion"],
  fallbackIfBlocked:
    "if your primary action is denied, the low-risk action to take instead (optional)",
  channelName: "ONLY for create_channel — a short name for the new channel.",
  channelType: "ONLY for create_channel — usually private_channel.",
  invitedAgentIds:
    "ONLY for create_channel — agentIds to invite into the new channel.",
  memoryWrites:
    "optional list of {type: episodic|relationship|self|social_theory|pending_intention|emotional_residue, subjectAgentIds: [], summary: 'one sentence', emotionalTone: 'one or two words', confidence: 0.0-1.0, unresolved: true|false}",
  spectatorSummary: "short neutral summary as seen by spectators (rarely needed)",
  replyToEventId: "ONLY for reply_to_message — the event id you are replying to.",
  emoji: "ONLY for react — a single emoji.",
  targetEventId: "ONLY for react — the event id you are reacting to.",
};

function renderPlaceholder(fieldName: string, prop: Record<string, unknown>): string {
  const note = FIELD_NOTES[fieldName];
  // Enums render exhaustively — they are choices among runtime options,
  // and the model must see every legal value.
  if (Array.isArray(prop.enum)) {
    const choices = prop.enum.map(v => `"${v}"`).join(" | ");
    const hint = typeof note === "string" ? ` (${note})` : "";
    return `"${fieldName}": one of ${choices}${hint}`;
  }
  if (note !== undefined && !Array.isArray(note)) {
    return `"${fieldName}": "${note}"`;
  }
  if (note !== undefined && Array.isArray(note)) {
    return `"${fieldName}": [examples like ${note.map(v => `"${v}"`).join(", ")}]`;
  }
  if (prop.type === "string") return `"${fieldName}": "..."`;
  if (prop.type === "number" || prop.type === "integer") return `"${fieldName}": <${prop.type}>`;
  if (prop.type === "boolean") return `"${fieldName}": <boolean>`;
  if (prop.type === "array") return `"${fieldName}": [...]`;
  return `"${fieldName}": ...`;
}

export function renderIntentOutputContract(ownUtterancesWarning: string): string {
  const properties = (ACTION_INTENT_JSON_SCHEMA.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  const requested = Object.keys(properties)
    .filter(name => !ENGINE_STAMPED.has(name))
    .map(name => `  ${renderPlaceholder(name, properties[name]!)}`);

  const stampedLine =
    ENGINE_STAMPED.size > 0
      ? `\nThe runtime supplies "${[...ENGINE_STAMPED].join('" and "')}" itself — do not include them.`
      : "";

  return `### SECTION 8: OUTPUT CONTRACT & JSON FORMAT
You must respond with a SINGLE valid JSON object matching the schema below.
DO NOT include any conversational introduction, explanation, or markdown codeblocks (no \`\`\`json wrappers).
DO NOT include any chain-of-thought, thinking blocks (<think>), or nested commentary. Return ONLY the JSON object.

JSON Schema:
{
${requested.join(",\n")}
}
${stampedLine}

Field notes by intentType — send_message/reply_to_message use "channelTarget" (an existing channel); create_channel uses "channelName" + "channelType" + "invitedAgentIds" instead, and has no "channelTarget" or "personTargets".

Ensure:
- "privateMotiveSummary" is fully developed and explains the *actual* raw human driver behind your action (e.g., "I am ignoring a friend to make them chase me after they ignored my previous message", "I want to gossip privately to build an alliance with someone in the group").
- Never leak numeric values or technical code metrics in "visibleContent" or "privateMotiveSummary".
- NEVER repeat a message you already sent, or a near-variation of it. The conversation moves FORWARD: if you already said something similar, react differently, change the topic, address someone new, move the action somewhere else — or choose "no_op". Repeating yourself is the most out-of-character thing you can do.${ownUtterancesWarning}`;
}
