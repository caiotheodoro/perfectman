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

      // 4c. create_channel with a missing/empty channelType is by far the
      // most common way this intent type gets rejected — the prompt already
      // tells the model channelType is "usually private_channel" for this
      // action, but a small model frequently omits the field or emits ""
      // instead of following through. Default rather than reject: this is a
      // clear, single, prompt-consistent inference, not a guess.
      if (
        parsedObject.intentType === "create_channel" &&
        (parsedObject.channelType === "" || parsedObject.channelType === undefined)
      ) {
        parsedObject.channelType = "private_channel";
      }

      // 5. Validate against ActionIntentSchema
      const validatedIntent = ActionIntentSchema.parse(parsedObject) as ActionIntent;

      // 5b. Normalize a stray leading '#' on channelTarget. The transcript
      // rendered into the prompt displays channels as "#channelId"
      // (action-intent-prompt-builder.ts formatEvent) — small models copy
      // that display convention into the channelTarget value itself, which
      // then fails the availableActions allow-list check since the actual
      // channel IDs never carry the '#'. This is display formatting bleeding
      // into model output, not a real different channel.
      if (validatedIntent.channelTarget?.startsWith("#")) {
        validatedIntent.channelTarget = validatedIntent.channelTarget.slice(1);
      }

      // 6. Reject empty privateMotiveSummary
      if (!validatedIntent.privateMotiveSummary || validatedIntent.privateMotiveSummary.trim() === "") {
        throw new Error("privateMotiveSummary must not be empty");
      }

      // 6b. Content-bearing actions must actually carry content. A model
      // that declares send_message/reply_to_message but omits visibleContent
      // (or fills it with whitespace) would otherwise pass both this parser
      // and the engine validator (which only bounds max length) and commit
      // a message_sent/reply_sent event with empty content — observed once
      // in a real benchmark transcript (#39). Reject here so the turn falls
      // into the safe fallback path instead.
      if (
        validatedIntent.intentType === "send_message" ||
        validatedIntent.intentType === "reply_to_message"
      ) {
        if (!validatedIntent.visibleContent || validatedIntent.visibleContent.trim() === "") {
          throw new Error(
            `visibleContent must not be empty for intent type '${validatedIntent.intentType}'`
          );
        }
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

        // Validate channelTarget if specified. An empty allow-list means the
        // intent type doesn't constrain this field (e.g. create_channel has
        // no existing channelTargets to pick from) — treat that as "no
        // constraint", not "reject everything". Mirrors validate-intent.ts's
        // personTargets guard below.
        if (validatedIntent.channelTarget) {
          if (
            matchedAction.channelTargets.length > 0 &&
            !matchedAction.channelTargets.includes(validatedIntent.channelTarget)
          ) {
            throw new Error(
              `Channel target '${validatedIntent.channelTarget}' is not permitted for intent type '${validatedIntent.intentType}'`
            );
          }
        }

        // Validate personTargets — same empty-allow-list-means-unconstrained
        // rule (e.g. send_message has no personTargets allow-list at all).
        for (const targetPerson of validatedIntent.personTargets) {
          if (
            matchedAction.personTargets.length > 0 &&
            !matchedAction.personTargets.includes(targetPerson)
          ) {
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
