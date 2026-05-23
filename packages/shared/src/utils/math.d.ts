/** Clamp value to [min, max] */
export declare function clamp(value: number, min: number, max: number): number;
/** Linear interpolation */
export declare function lerp(a: number, b: number, t: number): number;
/** Angular distance between two angles in radians, shortest path */
export declare function angularDistance(a: number, b: number): number;
/** Angular interpolation (shortest path) */
export declare function angularLerp(current: number, target: number, t: number): number;
/** Damped spring step: moves current toward target with inertia */
export declare function dampedSpring(current: number, target: number, inertia: number, dt: number): number;
/** Mean of an array of numbers. Returns 0 for empty array. */
export declare function meanOf(values: number[]): number;
/** Valence and arousal from circumplex angle + radius */
export declare function circumplexToVA(angle: number, radius: number): {
    valence: number;
    arousal: number;
};
/** Circumplex angle from valence + arousal */
export declare function vaToCircumplexAngle(valence: number, arousal: number): number;
//# sourceMappingURL=math.d.ts.map