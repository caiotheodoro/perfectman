/** Deterministic seeded RNG — mulberry32 algorithm */
export type SeededRng = {
    /** Returns a float in [0, 1) */
    next(): number;
    /** Returns an integer in [0, max) */
    nextInt(max: number): number;
    readonly seed: number;
};
export declare function createSeededRng(seed: number): SeededRng;
//# sourceMappingURL=rng.d.ts.map