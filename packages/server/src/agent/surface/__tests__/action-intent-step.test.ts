import { describe, it, expect, vi } from "vitest";
import type {
  AgentRuntimeInput,
  CommittedEvent,
  LLMProviderResult,
  Memory,
} from "@perfectman/shared";
import type { LLMConfig } from "../../llm/llm-config.js";
import { ActionIntentStep } from "../action-intent-step.js";
import { llmSurfaceRegistry } from "../index.js";
import type { StepRunContext } from "../llm-step.js";
import { PromptBuilder } from "../../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../../persona-prompt-profile.js";

function jsonResponse(content: string, promptTokens = 50, completionTokens = 10): LLMProviderResult {
  return {
    content,
    usage: { inputTokens: promptTokens, outputTokens: completionTokens },
    latencyMs: 5,
    model: "mock-model",
    requestedModel: "mock-model",
    routedModel: "mock-model",
    fallbackAttempts: 0,
  };
}

const REPEAT_TEXT = "kkkk sou eu de novo";

function makeInput(overrides: Partial<AgentRuntimeInput> = {}): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "agent-a",
    budgetPriority: "normal",
    availableActions: [
      { intentType: "no_op" as const, channelTargets: [], personTargets: [], blocked: false },
      {
        intentType: "send_message" as const,
        channelTargets: ["general"],
        personTargets: [],
        blocked: false,
      },
    ],
    perceptionPacket: {
      agentId: "agent-a",
      triggeringEvent: null,
      visibleContextEvents: [],
      ownRecentUtterances: [REPEAT_TEXT],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: [],
      translatedEmotionalState: {
        moodDescription: "Feeling neutral.",
        socialContext: "Calm.",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [],
    },
    ...overrides,
  };
}

function sendMessageJson(visibleContent: string): string {
  return JSON.stringify({
    intentType: "send_message",
    channelTarget: "general",
    visibleContent,
    privateMotiveSummary: "A real reason.",
    emotionDrivers: [],
    motivationDrivers: [],
  });
}

const llmConfig = {
  providerType: "mock",
  modelName: "mock-model",
  baseUrl: "http://localhost",
  temperature: 1,
  maxOutputTokens: 256,
  timeoutMs: 5000,
  retryCount: 0,
  responseFormatJson: true,
} as LLMConfig;

const prompt = {
  system: "sys",
  user: "user",
  inputTokensEstimate: 25,
  purpose: "action_intent" as const,
  version: "v-test",
};

function runStep(
  provider: { generateIntent: unknown },
  promptOverride: StepRunContext["prompt"] = prompt,
): Promise<ReturnType<ActionIntentStep["execute"]>> {
  const step = new ActionIntentStep();
  const ctx: StepRunContext = {
    now: 1000,
    pulseIndex: 3,
    provider: provider as StepRunContext["provider"],
    llmConfig,
    profile: {} as StepRunContext["profile"],
    prompt: promptOverride,
  };
  return step.execute(makeInput(), ctx);
}

describe("ActionIntentStep", () => {
  it("is registered for the action_intent purpose with a stable label", () => {
    const step = new ActionIntentStep();
    expect(step.purpose).toBe("action_intent");
    expect(step.label).toBe("action_intent");
  });

  it("registry exposes only implemented surfaces and each entry conforms to LLMStep", () => {
    // Fail-closed: adding a new prompt purpose must be an explicit registry entry.
    expect(Object.keys(llmSurfaceRegistry).sort()).toEqual(["action_intent"]);
    for (const step of Object.values(llmSurfaceRegistry)) {
      expect(typeof step.purpose).toBe("string");
      expect(typeof step.label).toBe("string");
      expect(typeof step.render).toBe("function");
      expect(typeof step.gate).toBe("function");
      expect(typeof step.execute).toBe("function");
    }
  });

  it("returns ok with a composed intent and no fallback on a valid model answer", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockResolvedValue(
        jsonResponse(
          JSON.stringify({ intentType: "no_op", privateMotiveSummary: "Staying quiet.", emotionDrivers: [], motivationDrivers: [] }),
        ),
      ),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(false);
    expect(outcome.value.intent.intentType).toBe("no_op");
    expect(outcome.value.llmUsage?.inputTokens).toBe(50);
  });

  it("records a prompt_trimmed operator event when the built prompt carries a trim", async () => {
    const trimmedPrompt = {
      ...prompt,
      trim: {
        maxInputTokens: 2048,
        rawInputTokensEstimate: 3041,
        finalInputTokensEstimate: 2040,
        droppedEvents: 5,
        droppedMemories: 2,
        droppedInputTokensEstimate: 1001,
        withinCap: true,
        phase: "assembly" as const,
      },
    };
    const outcome = await runStep(
      {
        generateIntent: vi.fn().mockResolvedValue(
          jsonResponse(
            JSON.stringify({ intentType: "no_op", privateMotiveSummary: "Quiet.", emotionDrivers: [], motivationDrivers: [] }),
          ),
        ),
      },
      trimmedPrompt,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const trimEvent = outcome.value.operatorEvents.find((e) => e.type === "prompt_trimmed");
    expect(trimEvent).toBeDefined();
    expect(trimEvent!.pulseIndex).toBe(3);
    expect(trimEvent!.data).toMatchObject({ droppedEvents: 5, droppedMemories: 2, maxInputTokens: 2048 });
    expect(trimEvent!.detail).toContain("exceeded maxInputTokens");
  });

  it("emits no prompt_trimmed operator event when the prompt was not trimmed", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockResolvedValue(
        jsonResponse(
          JSON.stringify({ intentType: "no_op", privateMotiveSummary: "Quiet.", emotionDrivers: [], motivationDrivers: [] }),
        ),
      ),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.operatorEvents.some((e) => e.type === "prompt_trimmed")).toBe(false);
  });

  it("returns a typed failure outcome with a fallback intent when the provider throws", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockRejectedValue(new Error("connection reset")),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.fallback.fallbackApplied).toBe(true);
    expect(outcome.fallback.intent.intentType).toBe("no_op");
    const failure = outcome.fallback.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failure?.detail).toContain("connection reset");
  });

  it("carries an in-band parse fallback (controlled disposition, not a thrown error)", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockResolvedValue(jsonResponse("not json at all")),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.intent.intentType).toBe("no_op");
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
  });

  it("recovers from a repeated first answer via a single retry that returns new content", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT), 50, 10))
        .mockResolvedValueOnce(jsonResponse(sendMessageJson("falando de outra coisa agora"), 60, 15)),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(false);
    expect(outcome.value.intent.visibleContent).toBe("falando de outra coisa agora");
    // Both calls' tokens are summed in budget + telemetry alike.
    expect(outcome.value.llmUsage?.inputTokens).toBe(110);
    expect(outcome.value.llmUsage?.outputTokens).toBe(25);
    // latency is also aggregated across main+retry
    expect(outcome.value.llmUsage?.latencyMs).toBe(10);
    const telemetry = outcome.value.operatorEvents.find((e) => e.type === "pulse_metrics");
    expect(telemetry?.data?.inputTokens).toBe(110);
    expect(telemetry?.data?.outputTokens).toBe(25);
    expect(provider.generateIntent).toHaveBeenCalledTimes(2);
  });

  it("blocks with intent_blocked (no llm_failure) when the retry still repeats", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT))),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
  });

  it("reports llm_failure (not intent_blocked) when the retry returns unparseable content", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockResolvedValueOnce(jsonResponse("not json at all")),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(false);
  });

  it("reports llm_failure (not intent_blocked) when the retry provider call throws", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockRejectedValueOnce(new Error("retry blew up")),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    const failure = outcome.value.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failure).toBeDefined();
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(false);
  });
});

const CTX_EVENT_CONTENT = "x".repeat(140);
const CTX_MEMORY_SUMMARY = "m".repeat(180);

function heavyEvent(i: number): CommittedEvent {
  return {
    id: `evt-${String(i).padStart(3, "0")}`,
    simulationId: "sim-cap",
    channelId: "general",
    actorId: `agent-${i % 3}`,
    type: "message_sent",
    payload: { content: `event-${i} ${CTX_EVENT_CONTENT}` },
    createdAt: 1000 + i,
    pulseIndex: i,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public message",
    },
  };
}

function heavyMemory(i: number): Memory {
  return {
    id: `mem-${String(i).padStart(3, "0")}`,
    agentId: "example-friend",
    simulationId: "sim-cap",
    type: "episodic",
    subjectAgentIds: ["agent-1"],
    sourceEventIds: [],
    summary: `memory-${i} ${CTX_MEMORY_SUMMARY}`,
    emotionalTone: "neutral",
    confidence: (i + 1) / 100,
    unresolved: false,
    createdAt: 5000 + i,
    lastReinforcedAt: 5000 + i,
  };
}

function heavyInput(): AgentRuntimeInput {
  return {
    simulationId: "sim-cap",
    agentId: "example-friend",
    personaConfig: {
      id: "example-friend",
      name: "Example Friend",
      archetype: "careful-observer",
      writingStyle: "lowercase blunt",
      styleExamples: [],
      baselineValence: 0,
      baselineArousal: 0,
      baselineStability: 0.5,
      baselineEnergy: 0.5,
      emotionalReactivity: 1,
      moodInertia: 0.5,
      maxMoodRotation: 0.5,
      energyRegen: 0.05,
      exclusionSensitivity: 1,
      praiseSensitivity: 1,
      conflictSensitivity: 1,
      boredomSensitivity: 1,
      intimacySensitivity: 1,
      socialSensitivities: {},
    },
    perceptionPacket: {
      agentId: "example-friend",
      triggeringEvent: null,
      visibleContextEvents: Array.from({ length: 6 }, (_, i) => heavyEvent(i)),
      ownRecentUtterances: [REPEAT_TEXT],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: Array.from({ length: 4 }, (_, i) => heavyMemory(i)),
      translatedEmotionalState: {
        moodDescription: "You feel steady.",
        socialContext: "The room is active.",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [
        { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
      ],
    },
    emotionalState: {
      coreMood: {
        valence: 0, arousal: 0, stability: 0.5, energy: 0.5,
        circumplexAngle: 0, circumplexRadius: 0, momentumValence: 0, momentumArousal: 0,
      },
      socialEmotions: {
        jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
        affection: 0, resentment: 0, suspicion: 0, admiration: 0,
        contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
        desireForStatus: 0, desireForIntimacy: 0,
      },
      relationalStates: new Map(),
    },
    activeMotivations: [],
    activePressures: [],
    activeInhibitions: [],
    relevantMemories: [],
    availableActions: [
      { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
    ],
    budgetPriority: "normal",
    triggeringReason: "attention_event",
  };
}

function cappedCtx(
  provider: { generateIntent: unknown },
  cap: number,
  prompt: StepRunContext["prompt"],
  pulseIndex: number,
): StepRunContext {
  return {
    now: 1000,
    pulseIndex,
    provider: provider as StepRunContext["provider"],
    llmConfig: { ...llmConfig, maxInputTokens: cap } as LLMConfig,
    profile: EXAMPLE_PROMPT_PROFILE,
    prompt,
  };
}

describe("ActionIntentStep maxInputTokens cap on reachable over-cap paths", () => {
  it("re-trims the repetition-retry prompt back under the cap and logs it as a retry-phase trim", async () => {
    const input = heavyInput();
    const raw = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");
    // Cap the base render fits, but the appended correction note would not.
    const cap = raw.inputTokensEstimate + 40;
    const basePrompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);
    expect(basePrompt.trim).toBeUndefined();

    const generateIntent = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT), 50, 10))
      .mockResolvedValueOnce(jsonResponse(sendMessageJson("a genuinely different line now"), 55, 12));
    const outcome = await new ActionIntentStep().execute(
      input,
      cappedCtx({ generateIntent }, cap, basePrompt, 7),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(generateIntent).toHaveBeenCalledTimes(2);

    const retryArg = generateIntent.mock.calls[1]![2] as {
      system: string;
      user: string;
      inputTokensEstimate: number;
    };
    expect(retryArg.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(Math.ceil((retryArg.system.length + retryArg.user.length) / 4)).toBeLessThanOrEqual(cap);

    const trimEvents = outcome.value.operatorEvents.filter((e) => e.type === "prompt_trimmed");
    expect(trimEvents).toHaveLength(1);
    expect(trimEvents[0]!.data).toMatchObject({ phase: "repetition_retry", withinCap: true });
    expect(trimEvents[0]!.data!.finalInputTokensEstimate as number).toBeLessThanOrEqual(cap);
  });

  it("logs the trim that happened when the budget gate blocks the call before execute()", () => {
    const input = { ...heavyInput(), budgetPriority: "blocked" as const };
    const tightCap = Math.floor(
      PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent").inputTokensEstimate * 0.7,
    );
    const trimmedPrompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent", tightCap);
    expect(trimmedPrompt.trim).toBeDefined();

    const outcome = new ActionIntentStep().gate(
      input,
      cappedCtx({ generateIntent: vi.fn() }, tightCap, trimmedPrompt, 9),
    );

    expect(outcome).toBeDefined();
    expect(outcome!.ok).toBe(false);
    if (outcome!.ok) return;
    const types = outcome!.fallback.operatorEvents.map((e) => e.type);
    expect(types).toContain("prompt_trimmed");
    expect(types).toContain("llm_budget_exceeded");
  });
});
