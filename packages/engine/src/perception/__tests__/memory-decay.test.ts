import { describe, it, expect } from "vitest";
import {
  effectiveConfidence,
  shouldEvictMemory,
  MEMORY_DECAY_RATES,
} from "../memory-salience.js";
import type { Memory } from "@perfectman/shared";

const PULSE_INTERVAL_MS = 1000;

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m",
    agentId: "goulart",
    simulationId: "sim",
    type: "episodic",
    subjectAgentIds: [],
    sourceEventIds: [],
    summary: "something happened",
    emotionalTone: "neutral",
    confidence: 0.5,
    intensity: 0,
    unresolved: false,
    createdAt: 100,
    lastReinforcedAt: 100,
    ...overrides,
  };
}

describe("effectiveConfidence", () => {
  it("equals raw confidence at zero age (just reinforced)", () => {
    const m = memory({ confidence: 0.8, lastReinforcedAt: 500 });
    expect(effectiveConfidence(m, 500, PULSE_INTERVAL_MS)).toBeCloseTo(0.8);
  });

  it("decreases across pulses with no interaction (AC1)", () => {
    const m = memory({ confidence: 0.8, intensity: 0, type: "episodic", lastReinforcedAt: 0 });
    const at0 = effectiveConfidence(m, 0, PULSE_INTERVAL_MS);
    const at10 = effectiveConfidence(m, 10 * PULSE_INTERVAL_MS, PULSE_INTERVAL_MS);
    const at20 = effectiveConfidence(m, 20 * PULSE_INTERVAL_MS, PULSE_INTERVAL_MS);
    expect(at10).toBeLessThan(at0);
    expect(at20).toBeLessThan(at10);
  });

  it("approaches but never drops below the confidence-scaled floor as age grows without bound", () => {
    // Power-law decay falls off slowly: even at 1e6 pulses of age the
    // episodic (fastest-decaying) rate is nowhere near the floor, so the
    // approach must be checked at an astronomically large age instead.
    const m = memory({ confidence: 0.8, intensity: 0, type: "episodic", lastReinforcedAt: 0 });
    const floor = 0.8 * 0.1;
    const near = effectiveConfidence(m, 1e6 * PULSE_INTERVAL_MS, PULSE_INTERVAL_MS);
    const far = effectiveConfidence(m, 1e15 * PULSE_INTERVAL_MS, PULSE_INTERVAL_MS);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThanOrEqual(floor);
    expect(far).toBeCloseTo(floor, 2);
  });

  it("a high-intensity memory decays slower than a low-intensity one of the same type and age (AC2)", () => {
    const now = 20 * PULSE_INTERVAL_MS;
    const highIntensity = memory({ confidence: 0.8, intensity: 0.9, type: "episodic", lastReinforcedAt: 0 });
    const lowIntensity = memory({ confidence: 0.8, intensity: 0.1, type: "episodic", lastReinforcedAt: 0 });
    expect(effectiveConfidence(highIntensity, now, PULSE_INTERVAL_MS)).toBeGreaterThan(
      effectiveConfidence(lowIntensity, now, PULSE_INTERVAL_MS),
    );
  });

  it("orders per-type decay rates from slowest (pending_intention) to fastest (episodic)", () => {
    expect(MEMORY_DECAY_RATES.pending_intention).toBeLessThan(MEMORY_DECAY_RATES.self);
    expect(MEMORY_DECAY_RATES.self).toBeLessThan(MEMORY_DECAY_RATES.social_theory);
    expect(MEMORY_DECAY_RATES.social_theory).toBeLessThan(MEMORY_DECAY_RATES.relationship);
    expect(MEMORY_DECAY_RATES.relationship).toBeLessThan(MEMORY_DECAY_RATES.emotional_residue);
    expect(MEMORY_DECAY_RATES.emotional_residue).toBeLessThan(MEMORY_DECAY_RATES.episodic);
  });

  it("reinforcing a memory (bumping lastReinforcedAt toward now) raises its subsequent effective confidence relative to leaving it unreinforced (AC4)", () => {
    const base = memory({ confidence: 0.8, intensity: 0, type: "episodic", lastReinforcedAt: 0 });
    const reinforcedAt = 5 * PULSE_INTERVAL_MS;
    const reinforced: Memory = { ...base, lastReinforcedAt: reinforcedAt };
    const laterNow = 20 * PULSE_INTERVAL_MS;

    expect(effectiveConfidence(reinforced, laterNow, PULSE_INTERVAL_MS)).toBeGreaterThan(
      effectiveConfidence(base, laterNow, PULSE_INTERVAL_MS),
    );
  });
});

describe("shouldEvictMemory", () => {
  const now = 21 * PULSE_INTERVAL_MS;

  it("evicts a low-confidence, aged (>20 pulses), non-unresolved memory (AC3)", () => {
    const stale = memory({
      confidence: 0.03,
      intensity: 0,
      type: "episodic",
      unresolved: false,
      lastReinforcedAt: 0,
    });
    expect(shouldEvictMemory(stale, now, PULSE_INTERVAL_MS)).toBe(true);
  });

  it("keeps an unresolved memory of the same age/confidence (Zeigarnik exemption, AC3)", () => {
    const stale = memory({
      confidence: 0.03,
      intensity: 0,
      type: "episodic",
      unresolved: true,
      lastReinforcedAt: 0,
    });
    expect(shouldEvictMemory(stale, now, PULSE_INTERVAL_MS)).toBe(false);
  });

  it("keeps a pending_intention memory of the same age/confidence (exempt by type)", () => {
    const stale = memory({
      confidence: 0.1,
      intensity: 0,
      type: "pending_intention",
      unresolved: false,
      lastReinforcedAt: 0,
    });
    expect(shouldEvictMemory(stale, now, PULSE_INTERVAL_MS)).toBe(false);
  });

  it("keeps a memory that has not aged past the threshold even if already low-confidence", () => {
    const recent = memory({
      confidence: 0.02,
      intensity: 0,
      type: "episodic",
      unresolved: false,
      lastReinforcedAt: now, // age 0
    });
    expect(shouldEvictMemory(recent, now, PULSE_INTERVAL_MS)).toBe(false);
  });

  it("keeps an aged memory whose effective confidence is still above the eviction threshold", () => {
    const stillStrong = memory({
      confidence: 1,
      intensity: 0,
      type: "relationship", // slow decay, but not exempt-by-type
      unresolved: false,
      lastReinforcedAt: 0,
    });
    expect(shouldEvictMemory(stillStrong, now, PULSE_INTERVAL_MS)).toBe(false);
  });
});
