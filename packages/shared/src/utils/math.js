/** Clamp value to [min, max] */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/** Linear interpolation */
export function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
}
/** Angular distance between two angles in radians, shortest path */
export function angularDistance(a, b) {
    let diff = ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (diff > Math.PI)
        diff -= 2 * Math.PI;
    return Math.abs(diff);
}
/** Angular interpolation (shortest path) */
export function angularLerp(current, target, t) {
    let diff = ((target - current) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (diff > Math.PI)
        diff -= 2 * Math.PI;
    return current + diff * clamp(t, 0, 1);
}
/** Damped spring step: moves current toward target with inertia */
export function dampedSpring(current, target, inertia, dt) {
    return current + (target - current) * clamp(inertia * dt, 0, 1);
}
/** Mean of an array of numbers. Returns 0 for empty array. */
export function meanOf(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
/** Valence and arousal from circumplex angle + radius */
export function circumplexToVA(angle, radius) {
    return {
        valence: Math.cos(angle) * radius,
        arousal: (Math.sin(angle) + 1) / 2,
    };
}
/** Circumplex angle from valence + arousal */
export function vaToCircumplexAngle(valence, arousal) {
    // arousal maps [0,1] → [-1,1] for sin
    const a = arousal * 2 - 1;
    return Math.atan2(a, valence);
}
//# sourceMappingURL=math.js.map