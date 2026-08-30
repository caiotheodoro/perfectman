import { ModelIntentPacketSchema, composeIntentPacket } from "@perfectman/shared";
import type { ActionIntent, AvailableAction, CommittedEvent, IntentType } from "@perfectman/shared";

type TargetField = "replyToEventId" | "targetEventId";

/**
 * Everything `parse` needs to turn a model-supplied event handle ("e1") into
 * the real `evt_*` id it stands for. Only the `action_intent` step passes
 * this; without it the parser leaves reply/react target strings untouched
 * (legacy passthrough).
 */
export type TargetResolutionContext = {
  eventHandles: Record<string, string>; // "e1" -> real event id, as shown to the model this render
  events: CommittedEvent[]; // triggering event followed by visible-context events (for actor + floor lookup)
  triggeringEventId?: string; // retry-exhausted floor: infer this as the target
};

export type IntentParserResult = {
  intent: ActionIntent;
  fallbackApplied: boolean;
  errorDetail?: string;
  // Set when the intent is a reply/react whose target handle could not be
  // resolved against `TargetResolutionContext.eventHandles`. The caller
  // re-prompts once with a targeted note, then applies `floorTargets`.
  unresolvedTarget?: { field: TargetField; badHandle: string; validHandles: string[] };
};

type TargetResolution =
  | { kind: "not_applicable" }
  | { kind: "resolved" }
  | { kind: "unresolved"; field: TargetField; badHandle: string; validHandles: string[] }
  | { kind: "floored"; detail: string }
  | { kind: "downgraded"; detail: string }
  | { kind: "dropped"; detail: string };

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
    targetContext?: TargetResolutionContext,
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

      // 7. Resolve a reply/react target handle ("e1") to the real event id.
      // Runs only when the step supplies the render's handle map. An
      // unresolvable handle is a retriable failure, not a fallback: the
      // original intent is returned so the caller can re-prompt then floor.
      if (targetContext) {
        const resolution = this.resolveTargets(intent, targetContext, { floor: false });
        if (resolution.kind === "unresolved") {
          return {
            intent,
            fallbackApplied: false,
            errorDetail: `Unresolvable ${resolution.field}: '${resolution.badHandle || "(empty)"}'`,
            unresolvedTarget: {
              field: resolution.field,
              badHandle: resolution.badHandle,
              validHandles: resolution.validHandles,
            },
          };
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

  /**
   * Retry-exhausted floor for an unresolved reply/react target. Infers the
   * triggering event (or, failing that, the most recent visible message) as
   * the target. With neither available, a reply downgrades to send_message
   * and a reaction is dropped. Never leaves the target empty or unresolved.
   * Mutates a copy — the input intent is left untouched.
   */
  static floorTargets(
    intent: ActionIntent,
    targetContext: TargetResolutionContext,
  ): { intent: ActionIntent; detail?: string; droppedReaction?: boolean } {
    const working: ActionIntent = { ...intent };
    const resolution = this.resolveTargets(working, targetContext, { floor: true });
    if (resolution.kind === "dropped") {
      return { intent: working, detail: resolution.detail, droppedReaction: true };
    }
    if (resolution.kind === "floored" || resolution.kind === "downgraded") {
      return { intent: working, detail: resolution.detail };
    }
    return { intent: working };
  }

  /**
   * Resolves `replyToEventId` / `targetEventId` from a per-render handle
   * ("e1") to the real event id, mutating `intent` in place. `floor: false`
   * reports an unresolvable handle for the caller to retry; `floor: true`
   * applies the triggering-event / visible-message / downgrade floor.
   */
  private static resolveTargets(
    intent: ActionIntent,
    ctx: TargetResolutionContext,
    opts: { floor: boolean },
  ): TargetResolution {
    const isReply = intent.intentType === "reply_to_message";
    const isReact = intent.intentType === "react";
    if (!isReply && !isReact) return { kind: "not_applicable" };

    const field: TargetField = isReply ? "replyToEventId" : "targetEventId";
    const raw = (intent[field] ?? "").trim();
    const handles = ctx.eventHandles ?? {};
    const validHandles = Object.keys(handles);
    const realIds = new Set(Object.values(handles));
    const normalized = raw.replace(/^\[+/, "").replace(/\]+$/, "").trim();

    let realId: string | undefined;
    if (normalized && handles[normalized]) realId = handles[normalized];
    else if (normalized && realIds.has(normalized)) realId = normalized;

    if (realId) {
      this.assignTarget(intent, field, realId, ctx);
      return { kind: "resolved" };
    }

    if (!opts.floor) {
      return { kind: "unresolved", field, badHandle: raw, validHandles };
    }

    const lastVisibleMessageId = [...ctx.events]
      .reverse()
      .find((e) => e.type === "message_sent" || e.type === "reply_sent")?.id;
    const floorId = ctx.triggeringEventId ?? lastVisibleMessageId;

    if (floorId) {
      this.assignTarget(intent, field, floorId, ctx);
      return {
        kind: "floored",
        detail: `unresolvable ${field} '${raw || "(empty)"}'; inferred triggering/visible event ${floorId} as the target`,
      };
    }

    if (isReply) {
      intent.intentType = "send_message";
      delete intent.replyToEventId;
      delete intent.replyToActorId;
      return {
        kind: "downgraded",
        detail: `unresolvable replyToEventId '${raw || "(empty)"}' with no event to target; downgraded to send_message`,
      };
    }
    return {
      kind: "dropped",
      detail: `unresolvable targetEventId '${raw || "(empty)"}' with no event to target; reaction dropped`,
    };
  }

  private static assignTarget(
    intent: ActionIntent,
    field: TargetField,
    realEventId: string,
    ctx: TargetResolutionContext,
  ): void {
    intent[field] = realEventId;
    if (field === "replyToEventId") {
      const actor = ctx.events.find((e) => e.id === realEventId)?.actorId;
      if (actor) intent.replyToActorId = actor;
    }
  }
}
