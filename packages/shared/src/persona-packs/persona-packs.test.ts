import { describe, it, expect } from "vitest";
import { ALL_PERSONA_PACKS, getPersonaPackById } from "./index.js";
import { ALL_PERSONAS } from "../constants/personas.js";

const CANONICAL_IDS = ALL_PERSONAS.map((p) => p.id);

const VALID_PRESSURE_TYPES = [
  "urge_to_reply",
  "urge_to_message",
  "urge_to_defend_self",
  "urge_to_mock",
  "urge_to_create_private_channel",
  "urge_to_invite",
  "urge_to_leave",
  "urge_to_react",
  "urge_to_type",
  "urge_to_show_off",
  "urge_to_seek_comfort",
  "urge_to_repair",
  "urge_to_dominate",
  "urge_to_provoke",
  "urge_to_withdraw",
];

const VALID_MEMORY_TYPES = [
  "episodic",
  "relationship",
  "self",
  "social_theory",
  "pending_intention",
  "emotional_residue",
];

describe("PersonaPacks", () => {
  it("has exactly 5 packs, one per canonical persona id", () => {
    expect(ALL_PERSONA_PACKS).toHaveLength(5);
    const ids = ALL_PERSONA_PACKS.map((p) => p.personaId).sort();
    expect(ids).toEqual([...CANONICAL_IDS].sort());
  });

  it("getPersonaPackById resolves each canonical id and returns undefined for unknown", () => {
    for (const id of CANONICAL_IDS) {
      expect(getPersonaPackById(id)).toBeDefined();
    }
    expect(getPersonaPackById("unknown")).toBeUndefined();
  });

  it("has a non-empty displayName and archetype", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.displayName.length, `${pack.personaId}.displayName`).toBeGreaterThan(0);
      expect(pack.archetype.length, `${pack.personaId}.archetype`).toBeGreaterThan(0);
    }
  });

  it("has at least 5 styleExamples each", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.styleExamples.length, `${pack.personaId}.styleExamples`).toBeGreaterThanOrEqual(5);
    }
  });

  it("has at least 3 voiceGuidelines each", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.voiceGuidelines.length, `${pack.personaId}.voiceGuidelines`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has at least 1 relationshipBias per other canonical persona (4 each)", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const others = CANONICAL_IDS.filter((id) => id !== pack.personaId);
      for (const other of others) {
        const bias = pack.relationshipBiases[other];
        expect(bias, `${pack.personaId}.relationshipBiases.${other}`).toBeDefined();
        expect((bias ?? "").length, `${pack.personaId}.relationshipBiases.${other}`).toBeGreaterThan(0);
      }
    }
  });

  it("has at least 4 memorySeeds with a mix of types and at least 2 unresolved", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const seeds = pack.memorySeeds;
      expect(seeds.length, `${pack.personaId}.memorySeeds`).toBeGreaterThanOrEqual(4);
      const types = new Set(seeds.map((s) => s.type));
      expect(types.size, `${pack.personaId}.memorySeedTypes`).toBeGreaterThanOrEqual(2);
      const unresolved = seeds.filter((s) => s.unresolved);
      expect(unresolved.length, `${pack.personaId}.unresolvedSeeds`).toBeGreaterThanOrEqual(2);
      for (const seed of seeds) {
        expect(VALID_MEMORY_TYPES).toContain(seed.type);
        expect(seed.confidence, `${pack.personaId}.seed.confidence`).toBeGreaterThanOrEqual(0);
        expect(seed.confidence, `${pack.personaId}.seed.confidence`).toBeLessThanOrEqual(1);
        expect(seed.summary.length, `${pack.personaId}.seed.summary`).toBeGreaterThan(0);
      }
    }
  });

  it("has at least 2 pendingIntentions each", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.pendingIntentions.length, `${pack.personaId}.pendingIntentions`).toBeGreaterThanOrEqual(2);
      for (const intention of pack.pendingIntentions) {
        expect(["low", "medium", "high"]).toContain(intention.urgency);
      }
    }
  });

  it("has at least 3 socialTheory entries each", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.socialTheory.length, `${pack.personaId}.socialTheory`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has at least 4 edgeProfile.triggers using real pressure type names", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const triggers = pack.edgeProfile.triggers;
      expect(triggers.length, `${pack.personaId}.triggers`).toBeGreaterThanOrEqual(4);
      for (const trigger of triggers) {
        expect(VALID_PRESSURE_TYPES, `${pack.personaId}.trigger.pressure`).toContain(trigger.pressure);
        expect(trigger.sensitivity, `${pack.personaId}.trigger.sensitivity`).toBeGreaterThanOrEqual(0.5);
        expect(trigger.sensitivity, `${pack.personaId}.trigger.sensitivity`).toBeLessThanOrEqual(3.0);
      }
    }
  });

  it("has non-empty maskTells, privateMotiveLexicon and hardLimits", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(pack.edgeProfile.maskTells.length, `${pack.personaId}.maskTells`).toBeGreaterThanOrEqual(3);
      expect(pack.edgeProfile.privateMotiveLexicon.length, `${pack.personaId}.privateMotiveLexicon`).toBeGreaterThanOrEqual(3);
      expect(pack.edgeProfile.hardLimits.length, `${pack.personaId}.hardLimits`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has valid sampling ranges", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const s = pack.sampling;
      expect(s.temperature, `${pack.personaId}.temperature`).toBeGreaterThanOrEqual(0.4);
      expect(s.temperature, `${pack.personaId}.temperature`).toBeLessThanOrEqual(1.2);
      expect(s.repetitionPenalty, `${pack.personaId}.repetitionPenalty`).toBeGreaterThanOrEqual(1.0);
      expect(s.repetitionPenalty, `${pack.personaId}.repetitionPenalty`).toBeLessThanOrEqual(1.5);
      expect(s.topP, `${pack.personaId}.topP`).toBeGreaterThanOrEqual(0.85);
      expect(s.topP, `${pack.personaId}.topP`).toBeLessThanOrEqual(1.0);
      expect(s.maxTokens, `${pack.personaId}.maxTokens`).toBeGreaterThan(0);
    }
  });

  it("has responseDelayMs within [300, 30000] with min <= max", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const [min, max] = pack.presenceProfile.responseDelayMs;
      expect(min, `${pack.personaId}.delayMin`).toBeGreaterThanOrEqual(300);
      expect(max, `${pack.personaId}.delayMax`).toBeLessThanOrEqual(30000);
      expect(min, `${pack.personaId}.delayOrder`).toBeLessThanOrEqual(max);
      expect(pack.presenceProfile.silenceTolerancePulses).toBeGreaterThan(0);
      expect(["short", "medium", "long", "rapid_fire"]).toContain(pack.presenceProfile.messageLength);
    }
  });
});

describe("PersonaPacks style refresh (#29)", () => {
  it("carries enough examples per persona for varied generation", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      expect(
        pack.styleExamples.length,
        `${pack.personaId}.styleExamples count`,
      ).toBeGreaterThanOrEqual(12);
    }
  });

  it("has no duplicate or cross-persona-identical examples", () => {
    const seen = new Map<string, string>();
    for (const pack of ALL_PERSONA_PACKS) {
      const intra = new Set(pack.styleExamples);
      expect(intra.size, `${pack.personaId} duplicates`).toBe(pack.styleExamples.length);
      for (const example of pack.styleExamples) {
        expect(seen.has(example), `"${example}" duplicated across ${seen.get(example)} and ${pack.personaId}`).toBe(false);
        seen.set(example, pack.personaId);
      }
    }
  });

  it("keeps length variance so generation is not capped at one rhythm", () => {
    for (const pack of ALL_PERSONA_PACKS) {
      const lengths = pack.styleExamples.map(s => s.length);
      const spread = Math.max(...lengths) / Math.max(1, Math.min(...lengths));
      expect(spread, `${pack.personaId} short/long spread`).toBeGreaterThanOrEqual(2);
    }
  });
});
