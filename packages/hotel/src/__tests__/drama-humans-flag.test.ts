/**
 * `may_target_humans` on the wire to the hotel. Verb table rev 4 gave the hotel's `DramaBlock` the flag (off when absent), so the compile writes it out
 * explicitly: on unless the scene (`drama.may_target_humans: false`) or the process (`PERFECTMAN_HUMAN_TARGETS=0`) turns it off. The sidecar's own
 * read (`drama_ext`, `resolveRunDrama`) must agree with what the hotel was told.
 */
import { describe, expect, it } from "vitest";
import { AuthoringService } from "../authoring/authoring-service.js";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import { hotelReadsBlock } from "../testing/hotel-block-read.js";

const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const source = (drama?: unknown): string =>
  JSON.stringify({
    title: "Noite no bar", situation: "Tres amigos no bar depois do trabalho.", language: "pt-BR",
    cast: [{ name: "Ana Clara", role: "connector", goal: "Fechar a conta." }, { name: "Duda", role: "skeptic", goal: "Cobrar o que deve." }],
    ...(drama === undefined ? {} : { drama }),
  });
const svc = (env: Record<string, string> = {}): AuthoringService => new AuthoringService({ llm, apiKey: undefined, env: (n) => env[n], sheet: { mode: "off" } });
const wireOf = (s: string, env?: Record<string, string>): object => JSON.parse(JSON.stringify(svc(env).compile({ source: s }).body)) as object;

describe("the compiled body tells the hotel whether a human can be the target without a chip", () => {
  it("writes may_target_humans: true into the default block, and the hotel's strict read takes it", () => {
    const wire = wireOf(source());
    expect(hotelReadsBlock(wire)).toMatchObject({ kind: "valid", may_target_humans: true });
  });

  it("writes it into an authored block too, and into free play plus skips ({})", () => {
    for (const drama of [{}, { max_rung: "slap", may_target: [["Ana Clara", "Duda"]] }]) expect(hotelReadsBlock(wireOf(source(drama))), JSON.stringify(drama)).toMatchObject({ kind: "valid", may_target_humans: true });
  });

  it("the scene's drama.may_target_humans: false is written as false, and the sidecar reads the same", () => {
    const wire = wireOf(source({ max_rung: "slap", may_target_humans: false }));
    expect(hotelReadsBlock(wire)).toMatchObject({ kind: "valid", may_target_humans: false });
    const parsed = parseScenarioBody(wire);
    expect(parsed.ok && resolveRunDrama(parsed.body, {}).humansTargetable).toBe(false);
  });

  it("PERFECTMAN_HUMAN_TARGETS=0 writes false for the hotel too, so the two never disagree", () => {
    const wire = wireOf(source(), { PERFECTMAN_HUMAN_TARGETS: "0" });
    expect(hotelReadsBlock(wire)).toMatchObject({ kind: "valid", may_target_humans: false });
  });

  it("drama: off carries no flag (the hotel's default, off, stands) and targets nobody", () => {
    const wire = wireOf(source("off"));
    expect(hotelReadsBlock(wire)).toMatchObject({ kind: "valid", max_rung: 0, may_target_humans: false });
  });

  it("the sidecar's strict read keeps the block as the four keys, and a block that says false is never read looser by the ext", () => {
    const on = parseScenarioBody(wireOf(source()));
    expect(on.ok && on.body.drama).not.toHaveProperty("may_target_humans");
    expect(on.ok && resolveRunDrama(on.body, {}).humansTargetable).toBe(true);
    const wire = { ...(wireOf(source()) as { drama: object }) };
    const looser = parseScenarioBody({ ...wire, drama: { ...wire.drama, may_target_humans: false }, drama_ext: { may_target_humans: true } });
    expect(looser.ok && resolveRunDrama(looser.body, {}).humansTargetable).toBe(false);
  });

  it("a block with a may_target_humans that is not a boolean is not a block (free play), as the hotel reads it", () => {
    const wire = { ...(wireOf(source()) as { drama: object }) };
    const bad = { ...wire, drama: { ...wire.drama, may_target_humans: "yes" } };
    expect(hotelReadsBlock(bad)).toMatchObject({ kind: "invalid" });
    const parsed = parseScenarioBody(bad);
    expect(parsed.ok && resolveRunDrama(parsed.body, {}).mode).toBe("free_play");
  });
});
