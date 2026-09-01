import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import type { CommittedEvent } from "@perfectman/shared";
import {
  makeAgentRuntimeInput,
  makeContextEvent,
  makeContextMemory,
} from "./agent-input-test-helpers.js";

const TRIGGER_ID = "evt-trigger";
const TRIGGER_CONTENT = "TRIGGER_CONTENT_UNIQUE_MARKER";

const triggeringEvent: CommittedEvent = {
  ...makeContextEvent(999),
  id: TRIGGER_ID,
  pulseIndex: 999,
  createdAt: 999999,
  payload: { content: TRIGGER_CONTENT },
};

const EVENT_COUNT = 24;
const MEMORY_COUNT = 8;

const allEvents = [triggeringEvent, ...Array.from({ length: EVENT_COUNT }, (_, i) => makeContextEvent(i))];
const allMemories = Array.from({ length: MEMORY_COUNT }, (_, i) => makeContextMemory(i));

const fullInput = makeAgentRuntimeInput({
  triggeringEvent,
  visibleContextEvents: allEvents,
  relevantMemories: allMemories,
});
const rawBuild = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent");
// Floor render: only the triggering event, no memories — the trimmer can never
// go below this, since it never drops the triggering event.
const floorBuild = PromptBuilder.build(
  makeAgentRuntimeInput({ triggeringEvent, visibleContextEvents: [triggeringEvent] }),
  EXAMPLE_PROMPT_PROFILE,
  "action_intent",
);

describe("ActionIntentPromptBuilder maxInputTokens trim", () => {
  it("leaves the prompt untouched when it already fits (no trim record)", () => {
    const built = PromptBuilder.build(
      fullInput,
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      rawBuild.inputTokensEstimate + 100,
    );
    expect(built.trim).toBeUndefined();
    expect(built.system).toBe(rawBuild.system);
    expect(built.user).toBe(rawBuild.user);
  });

  it("trims an over-cap assembly down to the cap and records the trim", () => {
    const cap = Math.floor((floorBuild.inputTokensEstimate + rawBuild.inputTokensEstimate) / 2);
    expect(cap).toBeLessThan(rawBuild.inputTokensEstimate);

    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim).toBeDefined();
    expect(built.trim!.maxInputTokens).toBe(cap);
    expect(built.trim!.rawInputTokensEstimate).toBe(rawBuild.inputTokensEstimate);
    expect(built.trim!.finalInputTokensEstimate).toBe(built.inputTokensEstimate);
    expect(built.trim!.droppedInputTokensEstimate).toBe(
      rawBuild.inputTokensEstimate - built.inputTokensEstimate,
    );
    expect(built.trim!.droppedEvents + built.trim!.droppedMemories).toBeGreaterThan(0);
  });

  it("is deterministic: identical input and cap produce byte-identical output", () => {
    const cap = Math.floor((floorBuild.inputTokensEstimate + rawBuild.inputTokensEstimate) / 2);
    const a = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);
    const b = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
    expect(a.version).toBe(b.version);
    expect(a.trim).toEqual(b.trim);
  });

  it("drops lowest-salience memories before any recent event", () => {
    // A cap just below the raw estimate: the small overflow is absorbed by
    // dropping memories alone, so no event is touched.
    const cap = rawBuild.inputTokensEstimate - 20;
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.trim).toBeDefined();
    expect(built.trim!.droppedMemories).toBeGreaterThan(0);
    expect(built.trim!.droppedEvents).toBe(0);
    // The lowest-confidence memory (mem-000) goes first; the highest stays.
    expect(built.user).not.toContain("memory-0-marker");
    expect(built.user).toContain(`memory-${MEMORY_COUNT - 1}-marker`);
  });

  it("drops oldest recent events first and always keeps the triggering event", () => {
    // Force every memory out plus a partial slice of the oldest events.
    const perEvent =
      PromptBuilder.build(
        makeAgentRuntimeInput({ triggeringEvent, visibleContextEvents: [triggeringEvent, makeContextEvent(0)] }),
        EXAMPLE_PROMPT_PROFILE,
        "action_intent",
      ).inputTokensEstimate - floorBuild.inputTokensEstimate;
    const keepEvents = 6;
    const cap = floorBuild.inputTokensEstimate + perEvent * keepEvents;

    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim).toBeDefined();
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBeGreaterThan(0);
    expect(built.trim!.droppedEvents).toBeLessThan(EVENT_COUNT);
    // Oldest (event-0) dropped; newest (event-23) and the trigger retained.
    expect(built.user).not.toContain("event-0-marker");
    expect(built.user).toContain(`event-${EVENT_COUNT - 1}-marker`);
    expect(built.user).toContain(TRIGGER_CONTENT);
  });

  it("honors the cap even when it forces every droppable context out", () => {
    const cap = floorBuild.inputTokensEstimate;
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim).toBeDefined();
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBe(EVENT_COUNT);
    expect(built.user).toContain(TRIGGER_CONTENT);
    expect(built.trim!.withinCap).toBe(true);
    expect(built.trim!.phase).toBe("assembly");
  });

  it("sheds oldest own utterances when memories and events are already exhausted", () => {
    const firstUtterance = `utterance-0-marker ${"u".repeat(120)}`;
    const utterances = [
      firstUtterance,
      `utterance-1-marker ${"u".repeat(120)}`,
      `utterance-2-marker ${"u".repeat(120)}`,
      `utterance-3-marker ${"u".repeat(120)}`,
    ];
    const floorBuild = PromptBuilder.build(
      makeAgentRuntimeInput({ triggeringEvent, visibleContextEvents: [triggeringEvent] }),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
    );
    const perUtterance =
      PromptBuilder.build(
        makeAgentRuntimeInput({
          triggeringEvent,
          visibleContextEvents: [triggeringEvent],
          ownRecentUtterances: [firstUtterance],
        }),
        EXAMPLE_PROMPT_PROFILE,
        "action_intent",
      ).inputTokensEstimate - floorBuild.inputTokensEstimate;
    // Cap fits the fence with exactly one utterance left: three must be shed.
    const cap = floorBuild.inputTokensEstimate + perUtterance;

    const built = PromptBuilder.build(
      makeAgentRuntimeInput({
        triggeringEvent,
        visibleContextEvents: [triggeringEvent],
        ownRecentUtterances: utterances,
      }),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      cap,
    );

    expect(built.trim).toBeDefined();
    expect(built.trim!.droppedMemories).toBe(0);
    expect(built.trim!.droppedEvents).toBe(0);
    expect(built.trim!.droppedUtterances).toBe(utterances.length - 1);
    expect(built.trim!.withinCap).toBe(true);
    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    // Oldest utterances shed; the newest stays in the no-repeat fence (system).
    expect(built.system).not.toContain("utterance-0-marker");
    expect(built.system).not.toContain("utterance-1-marker");
    expect(built.system).toContain(`utterance-${utterances.length - 1}-marker`);
  });

  it("sheds own utterances only after memories and events", () => {
    const utterance = `utterance-0-marker ${"u".repeat(120)}`;
    const baseInput = {
      triggeringEvent,
      visibleContextEvents: [triggeringEvent, makeContextEvent(0)],
      relevantMemories: [makeContextMemory(0)],
      ownRecentUtterances: [utterance],
    };
    const floorBuild = PromptBuilder.build(
      makeAgentRuntimeInput({ triggeringEvent, visibleContextEvents: [triggeringEvent] }),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
    );
    const withUtteranceOnly = PromptBuilder.build(
      makeAgentRuntimeInput({
        triggeringEvent,
        visibleContextEvents: [triggeringEvent],
        ownRecentUtterances: [utterance],
      }),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
    );
    // Cap sits just above the one-utterance render, so fitting requires
    // shedding both the memory and the event first — utterances yield last.
    const cap = withUtteranceOnly.inputTokensEstimate + 5;
    expect(cap).toBeLessThan(
      PromptBuilder.build(makeAgentRuntimeInput(baseInput), EXAMPLE_PROMPT_PROFILE, "action_intent")
        .inputTokensEstimate,
    );

    const built = PromptBuilder.build(
      makeAgentRuntimeInput(baseInput),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      cap,
    );

    expect(built.trim).toBeDefined();
    expect(built.trim!.droppedMemories).toBe(1);
    expect(built.trim!.droppedEvents).toBe(1);
    expect(built.trim!.droppedUtterances).toBe(0);
    expect(built.trim!.withinCap).toBe(true);
    expect(built.user).not.toContain("memory-0-marker");
    expect(built.user).not.toContain("event-0-marker");
    expect(built.system).toContain("utterance-0-marker");
  });

  it("flags an irreducible over-cap prompt with withinCap:false after shedding everything droppable", () => {
    // Cap below the floor render: the drop loop exhausts every memory and
    // event and the persona + contract + decision + triggering event alone
    // still blow the cap.
    const cap = Math.floor(floorBuild.inputTokensEstimate / 2);
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.trim).toBeDefined();
    expect(built.trim!.withinCap).toBe(false);
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBe(EVENT_COUNT);
    expect(built.trim!.finalInputTokensEstimate).toBeGreaterThan(cap);
    expect(built.inputTokensEstimate).toBe(built.trim!.finalInputTokensEstimate);
    expect(built.user).toContain(TRIGGER_CONTENT);
  });

  it("records a trim even when the raw render is over-cap with nothing droppable", () => {
    // No context events and no memories to begin with — the trimmer has
    // nothing to shed, but the render is still over-cap and the send must be
    // logged rather than shipped silently.
    const cap = 10;
    const built = PromptBuilder.build(
      makeAgentRuntimeInput({ triggeringEvent, visibleContextEvents: [triggeringEvent] }),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      cap,
    );

    expect(built.trim).toBeDefined();
    expect(built.trim!.withinCap).toBe(false);
    expect(built.trim!.droppedEvents).toBe(0);
    expect(built.trim!.droppedMemories).toBe(0);
    expect(built.trim!.rawInputTokensEstimate).toBe(built.trim!.finalInputTokensEstimate);
    expect(built.trim!.finalInputTokensEstimate).toBeGreaterThan(cap);
  });
});
