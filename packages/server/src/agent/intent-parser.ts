import { ModelIntentPacketSchema, composeIntentPacket } from "@perfectman/shared";
import type { ActionIntent, AvailableAction, IntentType } from "@perfectman/shared";

export type IntentParserResult = {
  intent: ActionIntent;
  fallbackApplied: boolean;
  errorDetail?: string;
};

export class IntentParser {
  /**
   * Cleans the raw LLM output into the model-decision packet, stamps the
   * engine-owned structural fields via composeIntentPacket, then enforces the
   * available-action allow-list. Structural repairs (array defaults, channelType
   * default, null-deletion, `#`-strip) remain as a safety net for providers that
   * are not shape-constrained; shape itself is zoned by ModelIntentPacketSchema.
   * If validation fails, a controlled fallback intent is returned (never a throw
   * for expected model-output problems).
   */
  static parse(
    rawText: string,
    actorId: string,
    availableActions: AvailableAction[],
    preferredFallbackType: "no_op" | "delay_response" = "no_op",
  ): IntentParserResult {
    let cleanedText = rawText;

    try {
      // 1. Narrow repair: strip markdown code fences, find the JSON object.
      cleanedText = cleanedText.replace(/```[a-zA-Z]*\s*/g, "").replace(/```\s*$/g, "");
      const firstBrace = cleanedText.indexOf("{");
      const lastBrace = cleanedText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error("No JSON object found in response");
      }
      let jsonText = cleanedText.substring(firstBrace, lastBrace + 1);
      // 2. Remove trailing commas (stray token emission).
      jsonText = jsonText.replace(/,\s*([}\]])/g, "$1");

      const parsedObject = JSON.parse(jsonText) as Record<string, unknown>;

      // 3. Narrow structural repair on the packet fields. Engine fields
      // (id/actorId) no longer belong to the packet — extra keys are stripped
      // by zod. But the two most common small-model shape failures are still
      // coaxed: null where arrays expected, and create_channel omitting
      // channelType.
      if (!Array.isArray(parsedObject.personTargets)) parsedObject.personTargets = [];
      if (!Array.isArray(parsedObject.emotionDrivers)) parsedObject.emotionDrivers = [];
      if (!Array.isArray(parsedObject.motivationDrivers)) parsedObject.motivationDrivers = [];
      if (!Array.isArray(parsedObject.memoryWrites)) parsedObject.memoryWrites = [];
      for (const optional of [
        "channelTarget", "visibleContent", "replyToEventId", "emoji", "targetEventId",
        "channelName", "channelType", "invitedAgentIds", "spectatorSummary",
      ]) {
        if (parsedObject[optional] === null) delete parsedObject[optional];
      }
      if (
        parsedObject.intentType === "create_channel" &&
        (parsedObject.channelType === "" || parsedObject.channelType === undefined)
      ) {
        parsedObject.channelType = "private_channel";
      }

      // 4. Validate the packet (shape + required intentType/privateMotiveSummary).
      const packet = ModelIntentPacketSchema.parse(parsedObject);

      // 5. Stamp engine fields + compose into a full ActionIntent.
      let intent = composeIntentPacket({ kind: "model", packet, agentId: actorId });

      // 5a. Reject whitespace-only motives (zod min(1) accepts "  ").
      if (intent.privateMotiveSummary.trim().length === 0) {
        throw new Error("privateMotiveSummary must not be empty");
      }

      // 5b. Normalize a stray leading '#' on channelTarget — the transcript
      // renders channels as "#channelId" and small models copy that display
      // convention into the value, which then fails the allow-list below.
      if (intent.channelTarget?.startsWith("#")) {
        intent = { ...intent, channelTarget: intent.channelTarget.slice(1) };
      }

      // 5c. Content-bearing actions must actually carry content. A model
      // that declares send_message/reply_to_message but omits visibleContent
      // (or fills it with whitespace) would otherwise pass both this parser
      // and the engine validator (which only bounds max length) and commit
      // a message_sent/reply_sent event with empty content — observed once
      // in a real benchmark transcript (#39). Reject here so the turn falls
      // into the safe fallback path instead.
      if (intent.intentType === "send_message" || intent.intentType === "reply_to_message") {
        if (!intent.visibleContent || intent.visibleContent.trim() === "") {
          throw new Error(
            `visibleContent must not be empty for intent type '${intent.intentType}'`,
          );
        }
      }

      // 6. Validate intent targets exist in availableActions.
      // no_op and delay_response are always permitted system-level fallbacks.
      if (intent.intentType !== "no_op" && intent.intentType !== "delay_response") {
        const matchedAction = availableActions.find(
          (action) => action.intentType === intent.intentType,
        );
        if (!matchedAction) {
          throw new Error(`Intent type '${intent.intentType}' is not currently available for this agent`);
        }
        if (matchedAction.blocked) {
          throw new Error(
            `Intent type '${intent.intentType}' is currently blocked: ${matchedAction.blockReason || "unknown reason"}`,
          );
        }
        if (intent.channelTarget) {
          if (
            matchedAction.channelTargets.length > 0 &&
            !matchedAction.channelTargets.includes(intent.channelTarget)
          ) {
            throw new Error(
              `Channel target '${intent.channelTarget}' is not permitted for intent type '${intent.intentType}'`,
            );
          }
        }
        for (const targetPerson of intent.personTargets) {
          if (
            matchedAction.personTargets.length > 0 &&
            !matchedAction.personTargets.includes(targetPerson)
          ) {
            throw new Error(
              `Person target '${targetPerson}' is not permitted for intent type '${intent.intentType}'`,
            );
          }
        }
      }

      return { intent, fallbackApplied: false };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const fallbackReason = `Fallback applied: ${errorMsg}`;

      let fallbackType: IntentType = preferredFallbackType;
      try {
        const firstBrace = cleanedText.indexOf("{");
        const lastBrace = cleanedText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const partialJson = JSON.parse(
            cleanedText.substring(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1"),
          ) as { fallbackIfBlocked?: string };
          if (partialJson.fallbackIfBlocked === "no_op" || partialJson.fallbackIfBlocked === "delay_response") {
            fallbackType = partialJson.fallbackIfBlocked;
          }
        }
      } catch {
        // Ignore partial JSON extraction failures on fallback inspection.
      }

      return {
        intent: composeIntentPacket({
          kind: "fallback",
          agentId: actorId,
          intentType: fallbackType,
          reason: fallbackReason,
        }),
        fallbackApplied: true,
        errorDetail: errorMsg,
      };
    }
  }

  /**
   * Helper to build a safe fallback intent directly (budget gate, etc.) without
   * passing through the model boundary.
   */
  static createFallback(
    actorId: string,
    fallbackType: "no_op" | "delay_response",
    reason: string,
  ): ActionIntent {
    return composeIntentPacket({
      kind: "fallback",
      agentId: actorId,
      intentType: fallbackType,
      reason,
    });
  }
}
