/**
 * 12 reference positions on the circumplex (Russell 1980).
 * Each position has a canonical angle (radians) and label.
 * angle = 0 at pure valence-positive, increases counter-clockwise.
 */
export type CircumplexPosition = {
    label: string;
    angle: number;
    valence: number;
    arousal: number;
};
export declare const CIRCUMPLEX_POSITIONS: readonly CircumplexPosition[];
/** Lookup by label (lowercase) */
export declare function getCircumplexByLabel(label: string): CircumplexPosition | undefined;
//# sourceMappingURL=circumplex.d.ts.map