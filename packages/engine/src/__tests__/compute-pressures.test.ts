import { describe, it, expect } from "vitest";
import { computePressures } from "../pressure/compute-pressures.js";
import { makeSocial, makeActionEmotions, makeRels, makeAgent } from "./fixtures.js";

describe("computePressures", () => {
  it("surfaces a pressure when an action emotion crosses the threshold", () => {
    const result = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
      makeActionEmotions({ warmth: 1 }),
      [],
    );
    expect(result.map(p => p.type)).toContain("urge_to_message");
    const msg = result.find(p => p.type === "urge_to_message");
    expect(msg?.intensity).toBe("overwhelming");
    expect(msg?.sourceEmotions).toContain("warmth");
    expect(msg?.visibilityPreference).toBe("either");
  });

  it("filters action emotions below the pressure threshold", () => {
    const result = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
      makeActionEmotions({ warmth: 0.1 }),
      [],
    );
    expect(result.map(p => p.type)).not.toContain("urge_to_message");
  });

  it("deduplicates by type keeping the highest intensity", () => {
    const result = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
      makeActionEmotions({ warmth: 1, curiousApproach: 1 }),
      [],
    );
    const urge = result.filter(p => p.type === "urge_to_message");
    expect(urge).toHaveLength(1);
    expect(urge[0]?.intensity).toBe("overwhelming");
  });

  it("keeps only the top 3 salient pressures", () => {
    const result = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
      makeActionEmotions({
        warmth: 1, curiousApproach: 1, pridefulPerformance: 1, anxiousOverreach: 1, defensiveness: 1,
      }),
      [],
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("surfaces an intimacy-sourced private-channel pressure with the closest targets", () => {
    const rels = makeRels(
      { targetAgentId: "b", desireForCloseness: 0.9, curiosity: 0.5, affection: 0.4 },
      { targetAgentId: "c", desireForCloseness: 0.2 },
    );
    const result = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: rels }),
      makeActionEmotions(),
      [],
    );
    const priv = result.find(p => p.type === "urge_to_create_private_channel");
    expect(priv).toBeDefined();
    expect(priv?.sourceMotivations).toContain("desireForIntimacy");
    expect(priv?.visibilityPreference).toBe("private");
  });
});

describe("pressure discharge (ADR-0016)", () => {
  const felt = (pulseIndex: number, dischargedAt?: number) =>
    computePressures(
      makeAgent({
        socialEmotions: makeSocial(),
        relationalStates: new Map(),
        ...(dischargedAt !== undefined ? { pressureDischargedAt: { urge_to_message: dischargedAt } } : {}),
      }),
      makeActionEmotions({ warmth: 0.7 }),
      [],
      pulseIndex,
    ).find(p => p.type === "urge_to_message");

  it("demotes a discharged urge on the next pulse and fully recovers after the refractory window", () => {
    const fresh = felt(10);
    expect(fresh?.intensity).toBe("high");
    const next = felt(11, 10);
    expect(next === undefined || next.intensity === "low" || next.intensity === "medium").toBe(true);
    expect(next?.intensity).not.toBe("high");
    expect(felt(17, 10)?.intensity).toBe("high");
  });

  it("never discharges an overwhelming urge", () => {
    const overwhelming = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map(), pressureDischargedAt: { urge_to_message: 5 } }),
      makeActionEmotions({ warmth: 1 }),
      [],
      6,
    ).find(p => p.type === "urge_to_message");
    expect(overwhelming?.intensity).toBe("overwhelming");
  });

  it("removes an urge that discharges below the threshold instead of clamping it", () => {
    const weak = computePressures(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map(), pressureDischargedAt: { urge_to_message: 3 } }),
      makeActionEmotions({ warmth: 0.35 }),
      [],
      4,
    ).find(p => p.type === "urge_to_message");
    expect(weak).toBeUndefined();
  });

  it("discharges the private-channel drive like any other urge, and ignores the map without a pulse index", () => {
    const rels = makeRels({ targetAgentId: "b", desireForCloseness: 0.9, curiosity: 0.5, affection: 0.4 });
    const agent = makeAgent({ socialEmotions: makeSocial(), relationalStates: rels, pressureDischargedAt: { urge_to_create_private_channel: 8 } });
    const withIndex = computePressures(agent, makeActionEmotions(), [], 9).find(p => p.type === "urge_to_create_private_channel");
    const without = computePressures(agent, makeActionEmotions(), []).find(p => p.type === "urge_to_create_private_channel");
    expect(without).toBeDefined();
    expect(withIndex === undefined || withIndex.intensity !== without?.intensity).toBe(true);
  });
});
