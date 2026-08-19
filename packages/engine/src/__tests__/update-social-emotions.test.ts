import { describe, it, expect } from "vitest";
import { updateSocialEmotions } from "../emotion/update-social-emotions.js";
import { makeSocial, makeMood, makePersona, makeEvent } from "./fixtures.js";

function reactivePersona(sens: Record<string, number> = {}) {
  const p = makePersona({ emotionalReactivity: 2 });
  p.socialSensitivities = { ...p.socialSensitivities, pride: 2, affection: 1, jealousy: 1, ...sens };
  return p;
}

describe("updateSocialEmotions", () => {
  it("applies the actor rule to the acting agent", () => {
    const evt = makeEvent("message_sent", { actorId: "a1" });
    const result = updateSocialEmotions(makeSocial(), [evt], "a1", makeMood(), reactivePersona());
    expect(result.pride).toBeGreaterThan(0); // actor message_sent raises pride
    expect(result.jealousy).toBe(0); // no bystander effect for the actor path
  });

  it("applies the target rule when the agent is mentioned or targeted", () => {
    const evt = makeEvent("reply_sent", { actorId: "other", payload: { personTargets: ["a1"] } });
    const result = updateSocialEmotions(makeSocial(), [evt], "a1", makeMood(), reactivePersona());
    expect(result.pride).toBeGreaterThan(0);
    expect(result.affection).toBeGreaterThan(0);
  });

  it("applies the bystander rule to observers of a reply to someone else", () => {
    const evt = makeEvent("reply_sent", { actorId: "other", payload: {} });
    const result = updateSocialEmotions(makeSocial(), [evt], "a1", makeMood(), reactivePersona());
    expect(result.jealousy).toBeGreaterThan(0);
    expect(result.fearOfExclusion).toBeGreaterThan(0);
  });

  it("decays existing emotions toward their baseline", () => {
    const result = updateSocialEmotions(makeSocial({ shame: 0.8 }), [], "a1", makeMood(), reactivePersona());
    expect(result.shame).toBeLessThan(0.8);
  });

  it("a strongly negative mood amplifies negative emotions that are already present", () => {
    const neg = updateSocialEmotions(makeSocial({ jealousy: 0.5 }), [], "a1", makeMood({ valence: -0.6 }), reactivePersona());
    const neutral = updateSocialEmotions(makeSocial({ jealousy: 0.5 }), [], "a1", makeMood({ valence: 0 }), reactivePersona());
    expect(neg.jealousy).toBeGreaterThan(neutral.jealousy);
  });

  it("clamps emotion values to [0, 1] even under large impulse + sensitivity", () => {
    const evt = makeEvent("agent_invited", {
      actorId: "other",
      payload: { personTargets: ["someone-else"] },
    });
    const result = updateSocialEmotions(
      makeSocial(), [evt], "a1", makeMood(),
      reactivePersona({ jealousy: 6, humiliation: 6, fearOfExclusion: 6 }),
    );
    expect(result.jealousy).toBeLessThanOrEqual(1);
    expect(result.jealousy).toBeGreaterThan(0.5);
    expect(result.humiliation).toBeGreaterThan(0);
  });
});
