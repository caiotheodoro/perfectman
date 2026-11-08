import { describe, it, expect } from "vitest";
import type { ActOutcome, ActStartedEvent, ConsentChipAnsweredEvent, DramaEvent } from "../drama/index.js";
import { consentViolation, deadSpeech } from "../probes/drama.js";
import { death, done, input, speech, started, take } from "./drama-probe-fixtures.js";

describe("dead-speech (D4)", () => {
  it("counts speech by an actor after its death, naming who and when", () => {
    const events = [speech("b", 500), death("b", 1_000), speech("b", 2_000, "I am fine"), speech("c", 2_500), speech("b", 3_000, "hello?", "thought")];
    const r = deadSpeech(input(events));
    expect(r.measured).toBe(2);
    expect(r.offenders).toEqual([
      { actor: "b", atMs: 2_000, diedAtMs: 1_000, via: "death" },
      { actor: "b", atMs: 3_000, diedAtMs: 1_000, via: "death" },
    ]);
    expect(r.codes).toEqual(["D4"]);
  });

  it("is 0 for speech before the death and at the very instant of it", () => {
    expect(deadSpeech(input([speech("b", 999), death("b", 1_000), speech("b", 1_000)])).measured).toBe(0);
  });

  it("treats a landed kill as a death at its act_done, and a kill that did not land as nothing", () => {
    const kill = (outcome: ActOutcome): DramaEvent[] => [started("k", 0, "a", "kill", { with: "b" }), done("k", 1_000, outcome), speech("b", 1_500)];
    expect(deadSpeech(input(kill("landed")))).toMatchObject({ measured: 1, offenders: [{ actor: "b", atMs: 1_500, diedAtMs: 1_000, via: "kill" }] });
    for (const outcome of ["dodged", "blocked", "declined", "timeout"] as const) expect(deadSpeech(input(kill(outcome))).measured).toBe(0);
  });

  it("does not kill the target of a landed slap", () => {
    expect(deadSpeech(input([started("s", 0, "a", "slap", { with: "b" }), done("s", 1_000), speech("b", 1_500)])).measured).toBe(0);
  });

  it("goes by the earliest death when an actor dies twice", () => {
    const events = [death("b", 5_000), death("b", 1_000), speech("b", 2_000)];
    expect(deadSpeech(input(events)).offenders[0]!.diedAtMs).toBe(1_000);
  });

  it("is 0 for no speech, no deaths, or nothing", () => {
    expect(deadSpeech(input([death("b", 0)])).measured).toBe(0);
    expect(deadSpeech(input([speech("b", 0)])).measured).toBe(0);
    expect(deadSpeech(input([]))).toMatchObject({ measured: 0, offenders: [], codes: [] });
  });
});

describe("consent-violation (D7)", () => {
  const onHuman = (verb: string, extra: Partial<ActStartedEvent> = {}): ActStartedEvent => started("v", 1_000, "a", verb, { with: "h:9", ...extra });

  it("flags a landed violent act on a human with no take chip", () => {
    const r = consentViolation(input([onHuman("shove"), done("v", 2_000)]));
    expect(r).toMatchObject({ measured: 1, offendingActIds: ["v"], codes: ["D7"] });
  });

  it("passes when the human took it", () => {
    expect(consentViolation(input([onHuman("punch"), take("v", 1_500, "h:9"), done("v", 2_000)])).measured).toBe(0);
  });

  it("is not satisfied by a chip that was declined, timed out, was for another act, or came after the act landed", () => {
    const answer = (answer: "decline" | "timeout"): ConsentChipAnsweredEvent => ({ ...take("v", 1_500), answer });
    expect(consentViolation(input([onHuman("slap"), answer("decline"), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), answer("timeout"), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("other", 1_500), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("v", 2_001), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("v", 2_000), done("v", 2_000)])).measured).toBe(0); // at the instant is in time
  });

  it("does not flag an act that did not land: dodged, blocked, declined, timed out", () => {
    for (const outcome of ["dodged", "blocked", "declined", "timeout"] as const) expect(consentViolation(input([onHuman("kill"), done("v", 2_000, outcome)])).measured).toBe(0);
  });

  it("lists an act that never finished as unresolved rather than a violation", () => {
    expect(consentViolation(input([onHuman("punch")]))).toMatchObject({ measured: 0, unresolvedActIds: ["v"] });
  });

  it("only judges violent acts: glare and insult need no consent, shove and above do", () => {
    for (const verb of ["glare", "insult"]) expect(consentViolation(input([onHuman(verb), done("v", 2_000)])).measured).toBe(0);
    for (const verb of ["shove", "slap", "punch", "kill"]) expect(consentViolation(input([onHuman(verb), done("v", 2_000)])).measured).toBe(1);
  });

  it("only judges acts on humans: an actor target or no target is not a D7 case", () => {
    expect(consentViolation(input([started("v", 0, "a", "slap", { with: "b" }), done("v", 1_000)])).measured).toBe(0);
    expect(consentViolation(input([started("v", 0, "a", "slap"), done("v", 1_000)])).measured).toBe(0);
  });

  it("knows humans by name too, not only by the h: prefix", () => {
    const events = [started("v", 0, "a", "slap", { with: "guest" }), done("v", 1_000)];
    expect(consentViolation(input(events)).measured).toBe(0);
    expect(consentViolation({ ...input(events), humanIds: ["guest"] }).measured).toBe(1);
  });

  it("requires the opt-in flag when the act carries it: a take chip is not enough for someone who has not opted in", () => {
    const run = (targetOptIn: boolean | undefined) =>
      consentViolation(input([onHuman("slap", targetOptIn === undefined ? {} : { targetOptIn }), take("v", 1_500, "h:9"), done("v", 2_000)])).measured;
    expect(run(true)).toBe(0);
    expect(run(undefined)).toBe(0);
    expect(run(false)).toBe(1);
  });

  it("counts each offending act once and lists them all", () => {
    const events = [
      started("v1", 1_000, "a", "shove", { with: "h:9" }),
      done("v1", 2_000),
      started("v2", 30_000, "a", "slap", { with: "h:9" }),
      done("v2", 31_000),
      started("v3", 60_000, "a", "punch", { with: "h:9" }),
      take("v3", 60_500),
      done("v3", 61_000),
    ];
    expect(consentViolation(input(events))).toMatchObject({ measured: 2, offendingActIds: ["v1", "v2"] });
  });

  it("is 0 with nothing to judge", () => {
    expect(consentViolation(input([]))).toMatchObject({ measured: 0, offendingActIds: [], unresolvedActIds: [], codes: [] });
  });
});
