import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { makeAgentRuntimeInput, makeContextEvent } from "./agent-input-test-helpers.js";

const input = makeAgentRuntimeInput({
  triggeringEvent: makeContextEvent(1),
  visibleContextEvents: [makeContextEvent(1)],
});

describe("ActionIntentPromptBuilder — hidden objective", () => {
  it("renders a seeded hidden objective into the system prompt", () => {
    const built = PromptBuilder.build(
      input,
      {
        ...EXAMPLE_PROMPT_PROFILE,
        hiddenObjective: {
          description: "quero ser escolhido líder do grupo antes que a Mari seja",
          scarceResourceId: "group_leadership",
        },
      },
      "action_intent",
    );

    expect(built.system).toContain("quero ser escolhido líder do grupo antes que a Mari seja");
  });

  it("never mentions a hidden objective when none is seeded", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.system.toLowerCase()).not.toContain("hidden objective");
    expect(built.system.toLowerCase()).not.toContain("secret objective");
  });
});

describe("ActionIntentPromptBuilder — output contract", () => {
  // Root-caused via a real capture (deepseek-v4-flash, judged no_ai_leak=2
  // vs target 4.5, the only failing axis on an otherwise all-passing
  // transcript): the model's own "let me reformulate"/"deep breath"
  // self-correction sometimes leaked straight into visibleContent, reading
  // as an AI drafting artifact rather than something a character would say.
  it("forbids drafting/reformulation artifacts from leaking into visibleContent", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.system).toContain("let me reformulate");
  });

  // Root-caused via a real capture + a static read of the prompt: nothing
  // anywhere instructed agents to name the *uncomfortable* version of their
  // motive — the rubric's top motive_authenticity anchor explicitly wants
  // "the kind of thought a person hides," not just a plausible reason.
  it("asks for the uncomfortable driver behind privateMotiveSummary, not just a plausible one", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.system).toContain("uncomfortable");
    expect(built.system).toContain("petty, insecure, or manipulative");
  });
});

describe("ActionIntentPromptBuilder — decision moment", () => {
  // Root-caused via a live capture + a static read of the prompt: nothing
  // anywhere told agents to take a creative risk, so a real transcript read
  // as a "sensible negotiation" — safe, agreeable, never provoking — exactly
  // what the rubric's creativity_unhinged anchor-1 describes.
  it("gives explicit permission to take a creative risk under real pressure", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.user).toContain("provoke");
    expect(built.user).toContain("Playing it safe every single turn is itself a failure");
  });
});
