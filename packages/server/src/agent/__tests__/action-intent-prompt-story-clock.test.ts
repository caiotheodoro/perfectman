import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { makeAgentRuntimeInput, makeContextEvent } from "./agent-input-test-helpers.js";

const base = makeAgentRuntimeInput({
  triggeringEvent: makeContextEvent(1),
  visibleContextEvents: [makeContextEvent(1)],
});

describe("ActionIntentPromptBuilder — story clock", () => {
  it("tells the agent what time it is when the scene has a clock", () => {
    const built = PromptBuilder.build({ ...base, storyClock: "11:52pm" }, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.user).toContain("It is 11:52pm where you are.");
  });

  it("says nothing about the time when the scene has none", () => {
    const built = PromptBuilder.build(base, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.user).not.toContain("where you are");
  });
});
