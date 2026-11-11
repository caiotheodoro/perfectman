/**
 * LAD-11, the sheet owns the high rungs. In a scene with a beat sheet the model's proposals and the director's own beats do not go above rung 2 (shove and up) until the
 * climax window opens, 20 s before the sheet's climax; an answer to an authored act is the exception; the sheet's own acts, the pressure floor and the climax forcing are not
 * touched. The offline reproduction (run 63's shape: a shove at 0:34 and a slap at 0:59 from the improvised arc, under a sheet whose reversal is at 2:16) is in
 * `packages/eval/src/test/drama-sheet-sim.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { AuthoringService } from "../authoring/authoring-service.js";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import { A, B, C, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";

const CLIMAX = 170_000;
const hot = emotion({ dominanceAssertion: 0.9, impulsiveProvocation: 0.9, defensiveness: 0.9, contemptuousDismissal: 0.9 }, { toward: [B, A, C] });
const sheetRig = (): Rig => makeRig({ block: WIDE_BLOCK, sheet: { climaxAtMs: CLIMAX } });

/** The rungs below a shove, one beat apiece, so the shove is the next step of the ladder. */
async function climbToTheShove(rig: Rig): Promise<void> {
  rig.act({ actId: "g", verb: "glare", actor: A, with: B, origin: "model", outcome: "landed" });
  await rig.clock.advance(30_000);
  rig.act({ actId: "i", verb: "insult", actor: A, with: B, origin: "model", outcome: "landed" });
  await rig.clock.advance(30_000);
}

describe("LAD-11: the sheet holds shove and up until the climax window opens", () => {
  it("refuses the model's shove while the window is shut, on the sheet's own clock", () => {
    const rig = sheetRig();
    return climbToTheShove(rig).then(() => {
      expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "veto", reason: "ladder", rule: "LAD-11", detail: "sheet_hold" });
    });
  });

  it("is what made the difference: the same shove with no sheet is approved", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    await climbToTheShove(rig);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "approve", verb: "shove" });
  });

  it("opens 20 s before the climax: the shove goes at 150 s and not at 149 s", async () => {
    const rig = sheetRig();
    await climbToTheShove(rig);
    await rig.clock.advance(CLIMAX - DEFAULT_DRAMA_TUNING.sheetHold.beforeClimaxMs - 60_000 - 1000);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "veto", rule: "LAD-11" });
    await rig.clock.advance(1000);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "approve", verb: "shove" });
  });

  it("holds the director's own shove too, and a held actor stays quiet instead of filling the wait with a lesser act", async () => {
    const rig = sheetRig();
    await climbToTheShove(rig);
    const decision = rig.dir.decide({ actor: A, emotion: hot });
    expect(decision.kind).toBe("pass");
    expect(rig.dir.trace()?.reason).toBe("sheet_hold");
  });

  it("never holds the rungs below the shove: a glare is the improvised arc's, whatever else gates it", () => {
    const rig = sheetRig();
    expect(rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "model" }, emotion: hot })).not.toMatchObject({ rule: "LAD-11" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "insult", with: B, origin: "model" }, emotion: hot })).not.toMatchObject({ rule: "LAD-11" });
  });

  it("never holds an authored act: the sheet's own shove at 1:00 goes through its gates as ever", async () => {
    const rig = sheetRig();
    await climbToTheShove(rig);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "scenario" } })).toMatchObject({ kind: "approve", verb: "shove" });
  });

  it("lets the target of an authored act answer it: the improvised blow back is not held", async () => {
    const rig = sheetRig();
    // The sheet's own glare and insult by A at B, then A's authored shove; B answers.
    rig.act({ actId: "g", verb: "glare", actor: B, with: A, origin: "model", outcome: "landed" });
    await rig.clock.advance(30_000);
    rig.act({ actId: "i", verb: "insult", actor: B, with: A, origin: "model", outcome: "landed" });
    await rig.clock.advance(30_000);
    rig.act({ actId: "s", verb: "shove", actor: A, with: B, origin: "scenario", authoredSkip: true, outcome: "landed" });
    await rig.clock.advance(21_000);
    expect(rig.dir.decide({ actor: B, proposal: { verb: "shove", with: A, origin: "model" }, emotion: emotion({ dominanceAssertion: 0.9, impulsiveProvocation: 0.9, defensiveness: 0.9 }, { toward: [A] }) })).toMatchObject({ kind: "approve", verb: "shove" });
    // A third person has no such answer to give.
    expect(rig.dir.decide({ actor: C, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "veto" });
  });

  it("the answer is for 30 s: a blow back after that is the improvised arc's again, and held", async () => {
    const rig = sheetRig();
    rig.act({ actId: "g", verb: "glare", actor: B, with: A, origin: "model", outcome: "landed" });
    await rig.clock.advance(30_000);
    rig.act({ actId: "i", verb: "insult", actor: B, with: A, origin: "model", outcome: "landed" });
    await rig.clock.advance(5_000);
    rig.act({ actId: "s", verb: "shove", actor: A, with: B, origin: "scenario", authoredSkip: true, outcome: "landed" });
    await rig.clock.advance(60_000);
    expect(rig.dir.decide({ actor: B, proposal: { verb: "shove", with: A, origin: "model" }, emotion: hot })).toMatchObject({ kind: "veto", rule: "LAD-11" });
  });

  it("ends with the window: the sheet's climax comes inside it, so the aftermath is the improvised arc's again", async () => {
    const rig = sheetRig();
    await climbToTheShove(rig);
    await rig.clock.advance(CLIMAX - 60_000 + 5_000);
    rig.act({ actId: "sl", verb: "slap", actor: A, with: B, origin: "scenario", authoredSkip: true, outcome: "landed" });
    await rig.clock.advance(25_000);
    expect(rig.dir.decide({ actor: C, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).not.toMatchObject({ rule: "LAD-11" });
  });

  it("is off with no sheet, and off with the run's release when the sheet could not start", async () => {
    const plain = makeRig({ block: WIDE_BLOCK });
    await climbToTheShove(plain);
    expect(plain.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "approve" });
    const rig = sheetRig();
    await climbToTheShove(rig);
    rig.dir.releaseSheetHold();
    expect(rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "approve" });
  });

  it("a sheet gives the scene a climax deadline of its own: the pressure floor rises toward it unless the author wrote another", () => {
    const rig = sheetRig();
    expect(rig.dir.pressure()).toBe(0);
    const late = sheetRig();
    return late.clock.advance(CLIMAX).then(() => expect(late.dir.pressure()).toBeGreaterThan(0.5));
  });
});

describe("the compile hands the sheet's climax to the pressure floor", () => {
  const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
  const source = (drama?: unknown): string =>
    JSON.stringify({
      title: "Noite no bar", situation: "Tres amigos no bar depois do trabalho.", language: "pt-BR",
      cast: [{ name: "Ana Clara", role: "connector", goal: "Fechar a conta." }, { name: "Duda", role: "skeptic", goal: "Cobrar o que deve." }],
      ...(drama === undefined ? {} : { drama }),
    });
  const compile = async (src: string): Promise<{ drama_ext?: { pressure_floor?: { climax_at_ms: number } }; beat_sheet?: { arc: { climax_at_ms: number } } }> => {
    const service = new AuthoringService({ llm, apiKey: undefined, sheet: { mode: "mock", kb: null } });
    return (await service.compileWithSheet({ source: src })).body as never;
  };

  it("writes drama_ext.pressure_floor = the sheet's climax second, and the run's read agrees", async () => {
    const body = await compile(source());
    expect(body.beat_sheet?.arc.climax_at_ms).toBeGreaterThan(0);
    expect(body.drama_ext?.pressure_floor).toEqual({ climax_at_ms: body.beat_sheet!.arc.climax_at_ms });
    const parsed = parseScenarioBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok && resolveRunDrama(parsed.body, {})).toMatchObject({ pressure: { climax_at_ms: body.beat_sheet!.arc.climax_at_ms }, sheet: { climax_at_ms: body.beat_sheet!.arc.climax_at_ms } });
  });

  it("a deadline the author wrote is the author's, and the sheet's hold still follows the sheet", async () => {
    const body = await compile(source({ pressure_floor: { climax_at_ms: 200_000 } }));
    expect(body.drama_ext?.pressure_floor).toEqual({ climax_at_ms: 200_000 });
    const parsed = parseScenarioBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok && resolveRunDrama(parsed.body, {})).toMatchObject({ pressure: { climax_at_ms: 200_000 }, sheet: { climax_at_ms: body.beat_sheet!.arc.climax_at_ms } });
  });
});
