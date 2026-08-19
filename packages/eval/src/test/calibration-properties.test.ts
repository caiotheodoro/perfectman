import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { weightedKappa, krippendorffAlpha } from "../judge/calibration.js";

// Rating scales for the 1-5 judge axes.
const LEVELS = [1, 2, 3, 4, 5] as const;
const scale = fc.constantFrom(...LEVELS);

// Two same-length rating sequences (the functions return 0 on length mismatch,
// so equal length is a precondition for the agreement/symmetry invariants).
const sameLengthPair = fc.array(fc.tuple(scale, scale), { minLength: 2 });

describe("weightedKappa properties", () => {
  it("is 1 for identical raters", () => {
    fc.assert(
      fc.property(fc.array(scale, { minLength: 2 }), (a) => {
        expect(weightedKappa(a, a)).toBe(1);
      }),
    );
  });

  it("is symmetric (swapping raters yields the same score)", () => {
    fc.assert(
      fc.property(sameLengthPair, (pairs) => {
        const a = pairs.map(([x]) => x);
        const b = pairs.map(([, y]) => y);
        // Rational weights (0.75, 0.9375) accumulate in different orders when
        // raters swap, so symmetry holds up to floating-point epsilon.
        expect(weightedKappa(a, b)).toBeCloseTo(weightedKappa(b, a), 10);
      }),
    );
  });

  it("is finite and at most 1 for valid inputs", () => {
    fc.assert(
      fc.property(sameLengthPair, (pairs) => {
        const a = pairs.map(([x]) => x);
        const b = pairs.map(([, y]) => y);
        const k = weightedKappa(a, b);
        expect(Number.isFinite(k)).toBe(true);
        expect(k).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("krippendorffAlpha properties", () => {
  it("is 1 for identical raters", () => {
    fc.assert(
      fc.property(fc.array(scale, { minLength: 2 }), (a) => {
        expect(krippendorffAlpha(a, a)).toBe(1);
      }),
    );
  });

  it("is symmetric (swapping raters yields the same score)", () => {
    fc.assert(
      fc.property(sameLengthPair, (pairs) => {
        const a = pairs.map(([x]) => x);
        const b = pairs.map(([, y]) => y);
        expect(krippendorffAlpha(a, b)).toBe(krippendorffAlpha(b, a));
      }),
    );
  });

  it("is finite and at most 1 for valid inputs", () => {
    fc.assert(
      fc.property(sameLengthPair, (pairs) => {
        const a = pairs.map(([x]) => x);
        const b = pairs.map(([, y]) => y);
        const n = krippendorffAlpha(a, b);
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeLessThanOrEqual(1);
      }),
    );
  });
});
