import { describe, it, expect } from "vitest";
import {
  CIRCUMPLEX_POSITIONS,
  getCircumplexByLabel,
} from "../constants/circumplex.js";
import {
  ALL_PERSONAS,
  getPersonaById,
  GOULART,
  BRUNO,
  CAIO,
  MARIANA,
  LEO,
} from "../constants/personas.js";
import {
  EVENT_IMPULSE_TABLE,
  SOCIAL_EMOTION_DECAY,
  RELATIONAL_UPDATE_RULES,
} from "../constants/emotion-rules.js";
import {
  ACTION_PRESSURE_MAP,
  getActionPressureEntry,
} from "../constants/action-pressure-map.js";
import {
  STAGNATION_THRESHOLDS,
  STAGNATION_WEIGHTS,
} from "../constants/stagnation.js";
import { PersonaConfigSchema } from "../agent/agent.schema.js";

// --- Circumplex ---
describe("CIRCUMPLEX_POSITIONS", () => {
  it("has exactly 12 positions", () => {
    expect(CIRCUMPLEX_POSITIONS).toHaveLength(12);
  });

  it("all angles in [0, 2π)", () => {
    const TAU = 2 * Math.PI;
    for (const p of CIRCUMPLEX_POSITIONS) {
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(TAU);
    }
  });

  it("all valence in [-1, 1]", () => {
    for (const p of CIRCUMPLEX_POSITIONS) {
      expect(p.valence).toBeGreaterThanOrEqual(-1);
      expect(p.valence).toBeLessThanOrEqual(1);
    }
  });

  it("all arousal in [0, 1]", () => {
    for (const p of CIRCUMPLEX_POSITIONS) {
      expect(p.arousal).toBeGreaterThanOrEqual(0);
      expect(p.arousal).toBeLessThanOrEqual(1);
    }
  });

  it("getCircumplexByLabel finds known position", () => {
    const happy = getCircumplexByLabel("happy");
    expect(happy).toBeDefined();
    expect(happy!.angle).toBe(0);
  });

  it("getCircumplexByLabel returns undefined for unknown", () => {
    expect(getCircumplexByLabel("nonexistent")).toBeUndefined();
  });
});

// --- Personas ---
describe("Personas", () => {
  it("has exactly 5 personas", () => {
    expect(ALL_PERSONAS).toHaveLength(5);
  });

  it("all personas validate against PersonaConfigSchema", () => {
    for (const persona of ALL_PERSONAS) {
      expect(() => PersonaConfigSchema.parse(persona)).not.toThrow();
    }
  });

  it("each persona has exactly 15 social sensitivity dimensions", () => {
    const EXPECTED_DIMS = [
      "jealousy", "envy", "humiliation", "pride", "shame",
      "affection", "resentment", "suspicion", "admiration", "contempt",
      "neediness", "socialAnxiety", "fearOfExclusion", "desireForStatus", "desireForIntimacy",
    ];
    for (const persona of ALL_PERSONAS) {
      const keys = Object.keys(persona.socialSensitivities).sort();
      expect(keys).toEqual(EXPECTED_DIMS.sort());
    }
  });

  it("all social sensitivity values in [0, 3]", () => {
    for (const persona of ALL_PERSONAS) {
      for (const [dim, value] of Object.entries(persona.socialSensitivities)) {
        expect(value, `${persona.id}.${dim}`).toBeGreaterThanOrEqual(0);
        expect(value, `${persona.id}.${dim}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("getPersonaById returns correct persona", () => {
    expect(getPersonaById("goulart")).toBe(GOULART);
    expect(getPersonaById("bruno")).toBe(BRUNO);
    expect(getPersonaById("caio")).toBe(CAIO);
    expect(getPersonaById("mariana")).toBe(MARIANA);
    expect(getPersonaById("leo")).toBe(LEO);
  });

  it("getPersonaById returns undefined for unknown", () => {
    expect(getPersonaById("unknown")).toBeUndefined();
  });

  it("all personas have unique IDs", () => {
    const ids = ALL_PERSONAS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("baseline stability all >= 0.1", () => {
    for (const persona of ALL_PERSONAS) {
      expect(persona.baselineStability).toBeGreaterThanOrEqual(0.1);
    }
  });
});

// --- Emotion Rules ---
describe("EVENT_IMPULSE_TABLE", () => {
  it("has exactly 15 entries", () => {
    expect(EVENT_IMPULSE_TABLE).toHaveLength(15);
  });

  it("all roles are actor/target/bystander", () => {
    for (const rule of EVENT_IMPULSE_TABLE) {
      expect(["actor", "target", "bystander"]).toContain(rule.role);
    }
  });

  it("all magnitudes in (0, 1]", () => {
    for (const rule of EVENT_IMPULSE_TABLE) {
      expect(rule.magnitude).toBeGreaterThan(0);
      expect(rule.magnitude).toBeLessThanOrEqual(1);
    }
  });

  it("valence/arousal shifts in [-1, 1]", () => {
    for (const rule of EVENT_IMPULSE_TABLE) {
      expect(rule.valenceShift).toBeGreaterThanOrEqual(-1);
      expect(rule.valenceShift).toBeLessThanOrEqual(1);
      expect(rule.arousalShift).toBeGreaterThanOrEqual(-1);
      expect(rule.arousalShift).toBeLessThanOrEqual(1);
    }
  });
});

describe("SOCIAL_EMOTION_DECAY", () => {
  it("has exactly 15 dimensions", () => {
    expect(Object.keys(SOCIAL_EMOTION_DECAY)).toHaveLength(15);
  });

  it("all decay rates in [0.90, 1.00]", () => {
    for (const [dim, rate] of Object.entries(SOCIAL_EMOTION_DECAY)) {
      expect(rate, dim).toBeGreaterThanOrEqual(0.90);
      expect(rate, dim).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("RELATIONAL_UPDATE_RULES", () => {
  it("has at least 5 rules", () => {
    expect(RELATIONAL_UPDATE_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("all magnitudes in (0, 2]", () => {
    for (const rule of RELATIONAL_UPDATE_RULES) {
      expect(rule.magnitude).toBeGreaterThan(0);
      expect(rule.magnitude).toBeLessThanOrEqual(2);
    }
  });
});

// --- Action Pressure Map ---
describe("ACTION_PRESSURE_MAP", () => {
  it("has exactly 15 entries", () => {
    expect(ACTION_PRESSURE_MAP).toHaveLength(15);
  });

  it("all pressure weights positive", () => {
    for (const entry of ACTION_PRESSURE_MAP) {
      expect(entry.pressureWeight).toBeGreaterThan(0);
    }
  });

  it("all visibility biases valid", () => {
    for (const entry of ACTION_PRESSURE_MAP) {
      expect(["public", "private", "either", "hidden"]).toContain(entry.visibilityBias);
    }
  });

  it("getActionPressureEntry returns entry for known action emotion", () => {
    const entry = getActionPressureEntry("warmth");
    expect(entry).toBeDefined();
    expect(entry!.pressureType).toBe("urge_to_message");
  });

  it("getActionPressureEntry returns undefined for unknown", () => {
    expect(getActionPressureEntry("unknown_emotion")).toBeUndefined();
  });
});

// --- Stagnation ---
describe("STAGNATION_THRESHOLDS", () => {
  it("yellow < red < critical", () => {
    expect(STAGNATION_THRESHOLDS.yellow).toBeLessThan(STAGNATION_THRESHOLDS.red);
    expect(STAGNATION_THRESHOLDS.red).toBeLessThan(STAGNATION_THRESHOLDS.critical);
  });

  it("all thresholds in (0, 1]", () => {
    for (const val of Object.values(STAGNATION_THRESHOLDS)) {
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe("STAGNATION_WEIGHTS", () => {
  it("weights sum to 1.0 (within floating point tolerance)", () => {
    const sum = Object.values(STAGNATION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("has exactly 7 metrics", () => {
    expect(Object.keys(STAGNATION_WEIGHTS)).toHaveLength(7);
  });
});
