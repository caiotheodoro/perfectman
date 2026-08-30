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

// Element-identity context in failure messages (Q8): a failing range check names the value.
function expectAllInRange(
  values: number[],
  min: number,
  max: number,
  label: string,
  opts: { exclusiveMin?: boolean; exclusiveMax?: boolean } = {},
): void {
  for (const v of values) {
    const msg = `${label} out of range: ${v}`;
    if (opts.exclusiveMin) expect(v, msg).toBeGreaterThan(min);
    else expect(v, msg).toBeGreaterThanOrEqual(min);
    if (opts.exclusiveMax) expect(v, msg).toBeLessThan(max);
    else expect(v, msg).toBeLessThanOrEqual(max);
  }
}

// --- Circumplex ---
describe("CIRCUMPLEX_POSITIONS", () => {
  it("has exactly 12 geometrically valid positions", () => {
    expect(CIRCUMPLEX_POSITIONS).toHaveLength(12);
    const TAU = 2 * Math.PI;
    expectAllInRange(CIRCUMPLEX_POSITIONS.map(p => p.angle), 0, TAU, "angle", { exclusiveMax: true });
    expectAllInRange(CIRCUMPLEX_POSITIONS.map(p => p.valence), -1, 1, "valence");
    expectAllInRange(CIRCUMPLEX_POSITIONS.map(p => p.arousal), 0, 1, "arousal");
  });

  it("getCircumplexByLabel finds known position and rejects unknown", () => {
    expect(getCircumplexByLabel("happy")?.angle).toBe(0);
    expect(getCircumplexByLabel("nonexistent")).toBeUndefined();
  });
});

// --- Personas ---
describe("Personas", () => {
  it("has exactly 5 personas with unique IDs, all valid against PersonaConfigSchema", () => {
    expect(ALL_PERSONAS).toHaveLength(5);
    expect(new Set(ALL_PERSONAS.map(p => p.id)).size).toBe(ALL_PERSONAS.length);
    for (const persona of ALL_PERSONAS) {
      expect(() => PersonaConfigSchema.parse(persona), persona.id).not.toThrow();
    }
  });

  it("each persona has exactly 15 social sensitivity dimensions with values in [0, 3]", () => {
    const EXPECTED_DIMS = [
      "jealousy", "envy", "humiliation", "pride", "shame",
      "affection", "resentment", "suspicion", "admiration", "contempt",
      "neediness", "socialAnxiety", "fearOfExclusion", "desireForStatus", "desireForIntimacy",
    ];
    for (const persona of ALL_PERSONAS) {
      const keys = Object.keys(persona.socialSensitivities).sort();
      expect(keys, persona.id).toEqual(EXPECTED_DIMS.sort());
      expectAllInRange(Object.values(persona.socialSensitivities), 0, 3, `${persona.id}.sensitivity`);
    }
  });

  it("all personas have baseline stability >= 0.1", () => {
    for (const persona of ALL_PERSONAS) {
      expect(persona.baselineStability, persona.id).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("getPersonaById returns the correct persona and rejects unknown", () => {
    expect(getPersonaById("goulart")).toBe(GOULART);
    expect(getPersonaById("bruno")).toBe(BRUNO);
    expect(getPersonaById("caio")).toBe(CAIO);
    expect(getPersonaById("mariana")).toBe(MARIANA);
    expect(getPersonaById("leo")).toBe(LEO);
    expect(getPersonaById("unknown")).toBeUndefined();
  });
});

// --- Emotion Rules ---
describe("EVENT_IMPULSE_TABLE", () => {
  it("has 14 well-formed impulse rules", () => {
    expect(EVENT_IMPULSE_TABLE).toHaveLength(14);
    for (const rule of EVENT_IMPULSE_TABLE) {
      expect(["actor", "target", "bystander"]).toContain(rule.role);
      expectAllInRange([rule.magnitude], 0, 1, `${rule.role}.magnitude`, { exclusiveMin: true });
      expectAllInRange([rule.valenceShift], -1, 1, `${rule.role}.valenceShift`);
      expectAllInRange([rule.arousalShift], -1, 1, `${rule.role}.arousalShift`);
    }
  });
});

describe("SOCIAL_EMOTION_DECAY", () => {
  it("has 15 dimensions decaying in [0.90, 1.00]", () => {
    expect(Object.keys(SOCIAL_EMOTION_DECAY)).toHaveLength(15);
    expectAllInRange(Object.values(SOCIAL_EMOTION_DECAY), 0.9, 1, "decay");
  });
});

describe("RELATIONAL_UPDATE_RULES", () => {
  it("has at least 5 rules with magnitudes in (0, 2]", () => {
    expect(RELATIONAL_UPDATE_RULES.length).toBeGreaterThanOrEqual(5);
    expectAllInRange(RELATIONAL_UPDATE_RULES.map(r => r.magnitude), 0, 2, "magnitude", { exclusiveMin: true });
  });
});

// --- Action Pressure Map ---
describe("ACTION_PRESSURE_MAP", () => {
  it("has 15 well-formed entries", () => {
    expect(ACTION_PRESSURE_MAP).toHaveLength(15);
    for (const entry of ACTION_PRESSURE_MAP) {
      expectAllInRange([entry.pressureWeight], 0, Number.MAX_VALUE, `${entry.actionEmotion}.weight`, { exclusiveMin: true });
      expect(["public", "private", "either", "hidden"]).toContain(entry.visibilityBias);
    }
  });

  it("getActionPressureEntry returns the entry for a known action emotion and rejects unknown", () => {
    expect(getActionPressureEntry("warmth")?.pressureType).toBe("urge_to_message");
    expect(getActionPressureEntry("unknown_emotion")).toBeUndefined();
  });
});

// --- Stagnation ---
describe("STAGNATION_THRESHOLDS", () => {
  it("orders yellow < red < critical, all in (0, 1]", () => {
    expect(STAGNATION_THRESHOLDS.yellow).toBeLessThan(STAGNATION_THRESHOLDS.red);
    expect(STAGNATION_THRESHOLDS.red).toBeLessThan(STAGNATION_THRESHOLDS.critical);
    expectAllInRange(Object.values(STAGNATION_THRESHOLDS), 0, 1, "threshold", { exclusiveMin: true });
  });
});

describe("STAGNATION_WEIGHTS", () => {
  it("has exactly 7 metrics summing to 1.0", () => {
    expect(Object.keys(STAGNATION_WEIGHTS)).toHaveLength(7);
    const sum = Object.values(STAGNATION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
