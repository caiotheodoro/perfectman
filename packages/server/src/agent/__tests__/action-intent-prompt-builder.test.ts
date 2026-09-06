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
  it("gives ungated permission to take a creative risk and names the generic replies that count as failure", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.user).toContain("provoke");
    expect(built.user).toContain("Playing it safe every single turn is itself a failure");
    // The old gate let the model decide the stakes weren't real.
    expect(built.user).not.toContain("When there is real pressure");
    expect(built.user).toContain("agreeing and restating");
    expect(built.user).toContain("asking a clarifying question instead of taking a position");
  });

  it("frames silence as a move in the decision and describes no_op in the action list", () => {
    const withNoOp = {
      ...input,
      availableActions: [
        { intentType: "send_message" as const, channelTargets: ["general"], personTargets: [], blocked: false },
        { intentType: "no_op" as const, channelTargets: [], personTargets: [], blocked: false },
      ],
    };
    const built = PromptBuilder.build(withNoOp, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.user).toContain("Withholding is also a move");
    expect(built.user).toContain("**no_op** — stay silent on purpose");
    // Other actions keep their bare rendering.
    expect(built.user).toContain("**send_message** (Channels: general)");
  });

  it("relaxes memoryWrites to belief change instead of suppressing it", () => {
    const built = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(built.system).toContain("whenever what you believe about someone in this room changed");
    expect(built.system).not.toContain("not on every turn");
  });

  it("pins visibleContent and privateMotiveSummary to Portuguese for pt-BR profiles, with Portuguese exemplars", () => {
    const pt = PromptBuilder.build(input, { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" }, "action_intent");
    expect(pt.system).toContain('Write "visibleContent" AND "privateMotiveSummary" in Portuguese (pt-BR)');
    expect(pt.system).toContain("estou ignorando a mensagem dela");
    expect(pt.system).not.toContain("I am ignoring a friend");

    const en = PromptBuilder.build(input, { ...EXAMPLE_PROMPT_PROFILE, language: "en" }, "action_intent");
    expect(en.system).toContain("I am ignoring a friend");
    expect(en.system).not.toContain("in Portuguese (pt-BR) — the motive");
    // The uncomfortable-driver framing is language-independent.
    expect(en.system).toContain("petty, insecure, or manipulative");
    expect(pt.system).toContain("petty, insecure, or manipulative");
  });
});

describe("ActionIntentPromptBuilder — scenario context gating", () => {
  const scenarioContext = {
    roomContext: "Você é Íris, sócia-fundadora da Cerne.",
    startingMood: "Animada e apressada.",
    introBehaviorInstruction: "Anuncie a proposta da Adamantis e empurre pra que todos assinem.",
    firstMoveGuidance: "Comece pelo prazo de sexta.",
  };
  const profile = { ...EXAMPLE_PROMPT_PROFILE, scenarioContext };

  it("renders the intro instruction and first-move guidance only before the agent's first act", () => {
    const before = PromptBuilder.build(makeAgentRuntimeInput({ hasActed: false }), profile, "action_intent");
    expect(before.system).toContain("Anuncie a proposta da Adamantis");
    expect(before.system).toContain("Comece pelo prazo de sexta");

    const after = PromptBuilder.build(makeAgentRuntimeInput({ hasActed: true }), profile, "action_intent");
    expect(after.system).not.toContain("Anuncie a proposta da Adamantis");
    expect(after.system).not.toContain("Comece pelo prazo de sexta");
    expect(after.system).toContain("Você é Íris, sócia-fundadora da Cerne.");
    expect(after.system).toContain("Animada e apressada.");
  });

  it("treats a missing hasActed as not yet acted, so older callers keep the entrance", () => {
    const built = PromptBuilder.build(makeAgentRuntimeInput({}), profile, "action_intent");
    expect(built.system).toContain("Anuncie a proposta da Adamantis");
  });
});
