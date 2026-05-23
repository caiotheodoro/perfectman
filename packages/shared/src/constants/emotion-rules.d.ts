/**
 * Event-to-impulse table: maps event types to MoodImpulse parameters.
 * Engine reads these to derive emotional reactions from simulation events.
 *
 * Each rule specifies:
 *   eventType    — which CommittedEvent type triggers this
 *   role         — "actor" (sent the event) | "target" (named as personTarget) | "bystander" (in channel)
 *   valenceShift — raw valence change before persona scaling [-1, 1]
 *   arousalShift — raw arousal change before persona scaling [-1, 1]
 *   magnitude    — base magnitude [0, 1] — multiplied by persona.emotionalReactivity
 *   affectedDimensions — social emotion dimensions to apply impulse to
 */
export type EventImpulseRule = {
    eventType: string;
    role: "actor" | "target" | "bystander";
    valenceShift: number;
    arousalShift: number;
    magnitude: number;
    affectedDimensions: string[];
};
export declare const EVENT_IMPULSE_TABLE: readonly EventImpulseRule[];
export declare const SOCIAL_EMOTION_DECAY: Readonly<Record<string, number>>;
export type RelationalUpdateRule = {
    trigger: string;
    role: "actor" | "target" | "bystander";
    trustDelta: number;
    affectionDelta: number;
    resentmentDelta: number;
    suspicionDelta: number;
    comfortDelta: number;
    curiosityDelta: number;
    desireForClosenessDelta: number;
    desireForDistanceDelta: number;
    magnitude: number;
};
export declare const RELATIONAL_UPDATE_RULES: readonly RelationalUpdateRule[];
//# sourceMappingURL=emotion-rules.d.ts.map