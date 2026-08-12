import { ActionIntentSchema, createId } from "@perfectman/shared";
import type { ActionIntent, AvailableAction } from "@perfectman/shared";

export type IntentParserResult = {
  intent: ActionIntent;
  fallbackApplied: boolean;
  errorDetail?: string;
};

export class IntentParser {
  /**
   * Attempts to clean, repair, parse, and validate the raw LLM output into an ActionIntent.
   * If parsing or validation fails, it applies a safe fallback intent.
   */
  static parse(
    rawText: string,
    actorId: string,
    availableActions: AvailableAction[],
    preferredFallbackType: "no_op" | "delay_response" = "no_op"
  ): IntentParserResult {
    let cleanedText = rawText;

    try {
      // 1. Narrow repair: Strip markdown code fences (e.g. ```json or ```)
      cleanedText = cleanedText.replace(/```[a-zA-Z]*\s*/g, "");
      cleanedText = cleanedText.replace(/```\s*$/g, "");

      // 2. Trim content before/after first JSON object
      const firstBrace = cleanedText.indexOf("{");
      const lastBrace = cleanedText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error("No JSON object found in response");
      }
      let jsonText = cleanedText.substring(firstBrace, lastBrace + 1);

      // 3. Remove trailing commas
      jsonText = jsonText.replace(/,\s*([}\]])/g, "$1");

      // 4. Parse JSON
      const parsedObject = JSON.parse(jsonText) as Record<string, unknown>;

      // 4b. Narrow structural repair — default fields that are structural
      // (not semantic) so a model that follows the compact schema example
      // still passes: id, arrays, motive. Also: models return `null` for
      // optional fields — zod rejects null where it expects undefined.
      if (typeof parsedObject.id !== "string" || parsedObject.id.trim() === "") {
        parsedObject.id = createId();
      }
      if (parsedObject.actorId === undefined) parsedObject.actorId = actorId;
      if (!Array.isArray(parsedObject.personTargets)) parsedObject.personTargets = [];
      if (!Array.isArray(parsedObject.emotionDrivers)) parsedObject.emotionDrivers = [];
      if (!Array.isArray(parsedObject.motivationDrivers)) parsedObject.motivationDrivers = [];
      if (!Array.isArray(parsedObject.memoryWrites)) parsedObject.memoryWrites = [];
      for (const optional of [
        "channelTarget", "visibleContent", "preferredDelay", "fallbackIfBlocked",
        "spectatorSummary", "replyToEventId", "emoji", "targetEventId",
        "channelName", "channelType", "invitedAgentIds",
      ]) {
        if (parsedObject[optional] === null) {
          delete parsedObject[optional];
        }
      }

      // 5. Validate against ActionIntentSchema
      const validatedIntent = ActionIntentSchema.parse(parsedObject) as ActionIntent;

      // 6. Reject empty privateMotiveSummary
      if (!validatedIntent.privateMotiveSummary || validatedIntent.privateMotiveSummary.trim() === "") {
        throw new Error("privateMotiveSummary must not be empty");
      }

      // 7. Validate that intent targets exist in availableActions
      // Note: 'no_op' and 'delay_response' are always permitted system-level fallbacks.
      if (validatedIntent.intentType !== "no_op" && validatedIntent.intentType !== "delay_response") {
        const matchedAction = availableActions.find(
          (action) => action.intentType === validatedIntent.intentType
        );
        if (!matchedAction) {
          throw new Error(`Intent type '${validatedIntent.intentType}' is not currently available for this agent`);
        }
        if (matchedAction.blocked) {
          throw new Error(
            `Intent type '${validatedIntent.intentType}' is currently blocked: ${matchedAction.blockReason || "unknown reason"}`
          );
        }

        // Validate channelTarget if specified
        if (validatedIntent.channelTarget) {
          if (!matchedAction.channelTargets.includes(validatedIntent.channelTarget)) {
            throw new Error(
              `Channel target '${validatedIntent.channelTarget}' is not permitted for intent type '${validatedIntent.intentType}'`
            );
          }
        }

        // Validate personTargets
        for (const targetPerson of validatedIntent.personTargets) {
          if (!matchedAction.personTargets.includes(targetPerson)) {
            throw new Error(
              `Person target '${targetPerson}' is not permitted for intent type '${validatedIntent.intentType}'`
            );
          }
        }
      }

      return {
        intent: validatedIntent,
        fallbackApplied: false,
      };

    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const fallbackReason = `Fallback applied: ${errorMsg}`;

      // Pick actual fallback type from the validated fallback option if parse partially succeeded and had it
      let fallbackType = preferredFallbackType;

      // Attempt to inspect if the parsed JSON has a valid fallbackIfBlocked property
      try {
        const firstBrace = cleanedText.indexOf("{");
        const lastBrace = cleanedText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const partialJson = JSON.parse(cleanedText.substring(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1"));
          if (partialJson.fallbackIfBlocked === "no_op" || partialJson.fallbackIfBlocked === "delay_response") {
            fallbackType = partialJson.fallbackIfBlocked;
          }
        }
      } catch {
        // Ignore partial JSON extraction failures on fallback inspection
      }

      const fallbackIntent = this.createFallback(actorId, fallbackType, fallbackReason);

      return {
        intent: fallbackIntent,
        fallbackApplied: true,
        errorDetail: errorMsg,
      };
    }
  }

  /**
   * Helper to build a safe, fully validated fallback ActionIntent
   */
  static createFallback(
    actorId: string,
    fallbackType: "no_op" | "delay_response",
    reason: string
  ): ActionIntent {
    return {
      id: createId(),
      actorId,
      intentType: fallbackType,
      personTargets: [],
      privateMotiveSummary: reason,
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    };
  }
}
