import { describe, expect, it } from "vitest";
import { ACT_TARGET_MODE, BodyActSchema, BodyIntentSchema, ModelIntentPacketSchema } from "@perfectman/shared";
import { MockActMemory, malformedAct, mockAct } from "../llm/mock-act.js";
import type { MockDrama } from "../llm/mock-act.js";
import { mockBody, withMockBody } from "../llm/mock-body.js";
import { consult } from "../testing/mock-act-input.js";

const WIDE: MockDrama = { maxRung: 6, mayDie: ["person-2"] };
const hot = { resentment: 0.9, envy: 0.1 };

/** The `act` of a consult's body, or undefined. */
const actOf = (b: Record<string, unknown> | undefined): { verb: string; target?: string; intensity?: number } | undefined => (b?.["act"] as { verb: string; target?: string; intensity?: number } | undefined);

/** The verbs one actor proposes toward `person-2` over `consults` consults, with the ladder never vetoed. */
function walk(drama: MockDrama, consults: number, rel: Record<string, number> = hot): string[] {
  const memory = new MockActMemory();
  const verbs: string[] = [];
  for (let n = 1; n <= consults; n++) {
    const act = actOf(mockAct(consult({ others: [{ ref: "person-2", rel }] }), n, drama, memory));
    if (act) verbs.push(act.verb);
  }
  return verbs;
}

describe("the mock model's acts (drama on)", () => {
  it("[LAD-1] a hostile actor walks the ladder glare, insult, shove, slap, one step per gap, and punch after", () => {
    expect(walk({ ...WIDE, mayDie: [] }, 20)).toEqual(["glare", "insult", "shove", "slap", "punch"]);
  });

  it("[SCN-3] never climbs past the scenario's ceiling", () => {
    expect(walk({ maxRung: 2, mayDie: [] }, 20)).toEqual(["glare", "insult"]);
    expect(walk({ maxRung: 0, mayDie: [] }, 20)).toEqual([]);
  });

  it("[LAD-5] proposes a kill only at someone the scenario lets die, only from a hatred as deep as the blow, and as the last step of the ladder", () => {
    expect(walk(WIDE, 30, { resentment: 0.9 })).toEqual(["glare", "insult", "shove", "slap", "punch", "kill"]);
    expect(walk({ maxRung: 6, mayDie: [] }, 30, { resentment: 0.9 })).not.toContain("kill");
    expect(walk(WIDE, 30, { resentment: 0.6 })).not.toContain("kill");
  });

  it("keeps each step a gap apart, and a smaller gap is a faster ladder", () => {
    const memory = new MockActMemory();
    const at = (n: number): boolean => actOf(mockAct(consult({ others: [{ ref: "person-2", rel: hot }] }), n, { ...WIDE, gap: 5 }, memory)) !== undefined;
    expect([1, 2, 3, 4, 5, 6, 7].filter(at)).toEqual([1, 6]);
  });

  it("[LAD-6] proposes nothing against someone it has no grievance with", () => {
    expect(walk(WIDE, 20, { resentment: 0.2, envy: 0.1, suspicion: 0.2 })).toEqual([]);
  });

  it("gives every proposal a target handle of the render for the verbs that take one, and an intensity in [0, 1]", () => {
    const memory = new MockActMemory();
    for (let n = 1; n <= 20; n++) {
      const act = actOf(mockAct(consult({ others: [{ ref: "person-2", rel: hot }] }), n, WIDE, memory));
      if (!act) continue;
      expect(BodyActSchema.safeParse(act).success).toBe(true);
      expect(act.target).toBe("p1");
      expect(act.intensity).toBeGreaterThanOrEqual(0);
      expect(act.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("[LAD-1] a skip proposes slap straight after glare, once; a veto on it sends the ladder back to where it was", () => {
    const memory = new MockActMemory();
    const drama = { ...WIDE, skip: true };
    const ask = (n: number, blocked: Array<{ code: "ladder"; part: "act" }> = []) => actOf(mockAct(consult({ others: [{ ref: "person-2", rel: hot }], blocked }), n, drama, memory))?.verb;
    expect(ask(1)).toBe("glare");
    expect(ask(4)).toBe("slap");
    expect(ask(5, [{ code: "ladder", part: "act" }])).toBe("insult");
  });

  it.each(["budget", "cooldown", "too_far"] as const)("[GATE-9] a %s veto is only about timing: the same step is asked again, never the next", (code) => {
    const memory = new MockActMemory();
    const ask = (n: number, blocked: Array<{ code: typeof code; part: "act" }> = []) => actOf(mockAct(consult({ others: [{ ref: "person-2", rel: hot }], blocked }), n, WIDE, memory))?.verb;
    expect(ask(1)).toBe("glare");
    expect(ask(4)).toBe("insult");
    // It waits one consult for the clock or the walk, then asks for the same step again, never the next.
    expect(ask(5, [{ code, part: "act" }])).toBeUndefined();
    expect(ask(6)).toBe("insult");
  });

  it("[GATE-5] a veto that says the scene does not allow it stops that pair for good", () => {
    const memory = new MockActMemory();
    const ask = (n: number, blocked: Array<{ code: "no_scenario_gate"; part: "act" }> = []) => actOf(mockAct(consult({ others: [{ ref: "person-2", rel: hot }], blocked }), n, WIDE, memory))?.verb;
    expect(ask(1)).toBe("glare");
    expect(ask(4)).toBe("insult");
    expect(ask(5, [{ code: "no_scenario_gate", part: "act" }])).toBeUndefined();
    for (let n = 6; n < 30; n++) expect(ask(n)).toBeUndefined();
  });

  it("[NEG-6] warmth hugs, and kisses when there is attraction too, and never twice in a row", () => {
    const memory = new MockActMemory();
    const dear = (n: number, rel: Record<string, number>) => actOf(mockAct(consult({ others: [{ ref: "person-2", rel }] }), n, WIDE, memory));
    expect(dear(1, { affection: 0.7 })?.verb).toBe("hug");
    expect(dear(2, { affection: 0.7 })).toBeUndefined();
    expect(dear(7, { affection: 0.9, attraction: 0.9 })?.verb).toBe("kiss");
  });

  it("[bible 4.2] shame cries once, a humiliation as deep as a swoon faints once, and neither has a target", () => {
    const memory = new MockActMemory();
    const ask = (n: number, social: Record<string, number>) => actOf(mockAct(consult({ others: [{ ref: "person-2" }], social }), n, WIDE, memory));
    expect(ask(1, { humiliation: 0.9 })).toMatchObject({ verb: "faint" });
    expect(ask(2, { humiliation: 0.9 })).toBeUndefined();
    expect(ask(3, { shame: 0.7 })).toMatchObject({ verb: "cry" });
    expect(ask(4, { shame: 0.7 })).toBeUndefined();
    expect(ACT_TARGET_MODE.faint).toBe("none");
    expect(actOf(mockAct(consult({ me: "person-3", others: [{ ref: "person-2" }], social: { humiliation: 0.9 } }), 1, WIDE, new MockActMemory()))?.target).toBeUndefined();
  });

  it("[DEATH-4] a body on the floor is tended by someone who loves it, gasped at by someone who does not, and the one who struck holds a picture", () => {
    const tender = actOf(mockAct(consult({ others: [{ ref: "person-2", fallen: true, rel: { affection: 0.5 } }] }), 1, WIDE, new MockActMemory()));
    expect(tender).toMatchObject({ verb: "tend_fallen", target: "p1" });
    const cold = actOf(mockAct(consult({ others: [{ ref: "person-2", fallen: true }] }), 1, WIDE, new MockActMemory()));
    expect(cold).toMatchObject({ verb: "freeze_gasp" });
    expect(cold?.target).toBeUndefined();
    const memory = new MockActMemory();
    for (let n = 1; n <= 16; n++) mockAct(consult({ others: [{ ref: "person-2", rel: { resentment: 0.9 } }] }), n, WIDE, memory);
    expect(memory.killed.has("person-2")).toBe(true);
    expect(actOf(mockAct(consult({ others: [{ ref: "person-2", fallen: true, rel: { resentment: 0.9 } }] }), 17, WIDE, memory))).toMatchObject({ verb: "tableau" });
  });

  it("is deterministic: the same consults give the same proposals", () => {
    expect(walk(WIDE, 40, { resentment: 0.9 })).toEqual(walk(WIDE, 40, { resentment: 0.9 }));
  });
});

describe("malformed acts (dropped, speech kept)", () => {
  const view = consult({ others: [{ ref: "person-2" }] }).perceptionPacket.body!;
  const speech = { intentType: "send_message", visibleContent: "oi", privateMotiveSummary: "quero falar" };

  it("[ACT-4] every sample is either dropped with its block by the schema, or is a shape the planner refuses; none starts an act", () => {
    for (let n = 0; n < 5; n++) {
      const act = malformedAct(n, view)["act"] as { verb: string; target?: string };
      const body = BodyIntentSchema.safeParse({ act });
      if (body.success) {
        const needs = ACT_TARGET_MODE[act.verb as keyof typeof ACT_TARGET_MODE] === "required";
        const person = act.target?.startsWith("p") === true;
        expect(needs ? !person : act.target !== undefined, `${JSON.stringify(act)} is a valid act`).toBe(true);
      } else expect(body.success).toBe(false);
    }
  });

  it("[ACT-4] the packet keeps the speech of every malformed sample, and a schema-invalid act takes its body block with it", () => {
    for (let n = 0; n < 5; n++) {
      const parsed = ModelIntentPacketSchema.parse({ ...speech, body: malformedAct(n, view) });
      expect(parsed.visibleContent).toBe("oi");
      const act = (malformedAct(n, view)["act"] as { verb: string });
      if (!BodyIntentSchema.safeParse({ act }).success) expect(parsed.body).toBeUndefined();
    }
  });

  it("proposes one on every Nth consult when asked, and on no other", () => {
    const memory = new MockActMemory();
    const quiet = consult({ others: [{ ref: "person-2" }] });
    const hits = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => mockAct(quiet, n, { ...WIDE, malformedEvery: 4 }, memory) !== undefined);
    expect(hits).toEqual([4, 8]);
  });
});

describe("withMockBody", () => {
  const inner = { generateIntent: () => Promise.resolve({ content: JSON.stringify({ intentType: "send_message", visibleContent: "oi", privateMotiveSummary: "x" }), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, model: "mock" }) };
  const ctx = { pulseIndex: 1, now: 0 };
  const built = { system: "", user: "", inputTokensEstimate: 0, purpose: "action_intent", version: "v", templateVersion: "t" } as never;

  it("[NEG-2] a view without `drama` gets exactly what it always got, whatever the scenario says", async () => {
    const source = { scenario: () => WIDE, memory: new MockActMemory() };
    const withSource = withMockBody(inner as never, new Map(), source);
    const plain = withMockBody(inner as never, new Map());
    for (let n = 1; n <= 14; n++) {
      const input = consult({ others: [{ ref: "person-2", rel: hot }], drama: false });
      expect((await withSource.generateIntent(input, ctx, built)).content).toBe((await plain.generateIntent(input, ctx, built)).content);
    }
    expect(JSON.stringify(mockBody("person-1", 9))).not.toContain("act");
  });

  it("with `drama` the proposal rides on the speech as a body block", async () => {
    const provider = withMockBody(inner as never, new Map(), { scenario: () => WIDE, memory: new MockActMemory() });
    const out = JSON.parse((await provider.generateIntent(consult({ others: [{ ref: "person-2", rel: hot }] }), ctx, built)).content) as { visibleContent: string; body: { act: { verb: string } } };
    expect(out.visibleContent).toBe("oi");
    expect(out.body.act.verb).toBe("glare");
  });
});
