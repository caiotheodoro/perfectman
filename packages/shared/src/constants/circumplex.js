const TAU = 2 * Math.PI;
export const CIRCUMPLEX_POSITIONS = [
    // 0° — happy (high valence, mid arousal)
    { label: "happy", angle: 0, valence: 0.8, arousal: 0.6 },
    // 30° — elated (high valence, high arousal)
    { label: "elated", angle: TAU * 1 / 12, valence: 0.7, arousal: 0.9 },
    // 60° — excited (mid valence, high arousal)
    { label: "excited", angle: TAU * 2 / 12, valence: 0.4, arousal: 1.0 },
    // 90° — alert (neutral-negative valence, high arousal)
    { label: "alert", angle: TAU * 3 / 12, valence: -0.1, arousal: 0.9 },
    // 120° — tense (negative valence, high arousal)
    { label: "tense", angle: TAU * 4 / 12, valence: -0.5, arousal: 0.9 },
    // 150° — angry (very negative valence, high arousal)
    { label: "angry", angle: TAU * 5 / 12, valence: -0.8, arousal: 0.8 },
    // 180° — sad (very negative valence, low-mid arousal)
    { label: "sad", angle: TAU * 6 / 12, valence: -0.8, arousal: 0.3 },
    // 210° — depressed (very negative valence, low arousal)
    { label: "depressed", angle: TAU * 7 / 12, valence: -0.7, arousal: 0.1 },
    // 240° — bored (negative valence, very low arousal)
    { label: "bored", angle: TAU * 8 / 12, valence: -0.3, arousal: 0.1 },
    // 270° — calm (neutral valence, very low arousal)
    { label: "calm", angle: TAU * 9 / 12, valence: 0.2, arousal: 0.1 },
    // 300° — relaxed (mid valence, low arousal)
    { label: "relaxed", angle: TAU * 10 / 12, valence: 0.5, arousal: 0.2 },
    // 330° — content (high valence, low-mid arousal)
    { label: "content", angle: TAU * 11 / 12, valence: 0.7, arousal: 0.4 },
];
/** Lookup by label (lowercase) */
export function getCircumplexByLabel(label) {
    return CIRCUMPLEX_POSITIONS.find(p => p.label === label.toLowerCase());
}
//# sourceMappingURL=circumplex.js.map