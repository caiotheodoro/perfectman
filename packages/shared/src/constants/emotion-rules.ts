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

export const EVENT_IMPULSE_TABLE: readonly EventImpulseRule[] = [
  // 1. message_sent (actor)
  {
    eventType:          "message_sent",
    role:               "actor",
    valenceShift:       0.05,
    arousalShift:       0.02,
    magnitude:          0.10,
    affectedDimensions: ["pride"],
  },

  // 2. reply_sent — actor receives direct reply (target role = who was replied to)
  {
    eventType:          "reply_sent",
    role:               "target",
    valenceShift:       0.15,
    arousalShift:       0.10,
    magnitude:          0.25,
    affectedDimensions: ["pride", "affection"],
  },

  // 3. reply_sent — bystander sees a reply go to someone else.
  // A snub stings, but NOT every public reply is a snub — keep it mild and
  // exclude resentment (resentment is for direct slights, not ambient chat).
  // (Old values 0.22/-0.12 pushed EVERY agent's resentment to 1.0 in any
  // active room.)
  {
    eventType:          "reply_sent",
    role:               "bystander",
    valenceShift:      -0.04,
    arousalShift:       0.03,
    magnitude:          0.10,
    affectedDimensions: ["jealousy", "fearOfExclusion"],
  },

  // 4. reaction_sent (target = who received reaction)
  {
    eventType:          "reaction_sent",
    role:               "target",
    valenceShift:       0.10,
    arousalShift:       0.05,
    magnitude:          0.15,
    affectedDimensions: ["pride", "affection"],
  },

  // 5. reaction_sent (bystander — sees someone else get reactions)
  {
    eventType:          "reaction_sent",
    role:               "bystander",
    valenceShift:      -0.03,
    arousalShift:       0.04,
    magnitude:          0.08,
    affectedDimensions: ["envy"],
  },

  // 6. channel_created — all members get context
  {
    eventType:          "channel_created",
    role:               "actor",
    valenceShift:       0.08,
    arousalShift:       0.12,
    magnitude:          0.18,
    affectedDimensions: ["pride", "desireForStatus"],
  },

  // 7. agent_invited — the invited agent
  {
    eventType:          "agent_invited",
    role:               "target",
    valenceShift:       0.20,
    arousalShift:       0.15,
    magnitude:          0.30,
    affectedDimensions: ["affection", "desireForIntimacy"],
  },

  // 8. agent_invited — bystander NOT invited (exclusion)
  {
    eventType:          "agent_invited",
    role:               "bystander",
    valenceShift:      -0.20,
    arousalShift:       0.25,
    magnitude:          0.35,
    affectedDimensions: ["jealousy", "humiliation", "fearOfExclusion"],
  },

  // 9. agent_left — bystanders notice departure
  {
    eventType:          "agent_left",
    role:               "bystander",
    valenceShift:      -0.05,
    arousalShift:       0.05,
    magnitude:          0.10,
    affectedDimensions: ["fearOfExclusion"],
  },

  // 10. presence_changed to offline — absent agent triggers anxiety in close relations
  {
    eventType:          "presence_changed",
    role:               "bystander",
    valenceShift:      -0.08,
    arousalShift:       0.10,
    magnitude:          0.14,
    affectedDimensions: ["neediness", "fearOfExclusion"],
  },

  // 11. no_op_recorded — intentional silence — bystanders notice low activity
  {
    eventType:          "no_op_recorded",
    role:               "bystander",
    valenceShift:      -0.02,
    arousalShift:      -0.03,
    magnitude:          0.05,
    affectedDimensions: ["socialAnxiety"],
  },

  // 12. intent_blocked — actor gets blocked
  {
    eventType:          "intent_blocked",
    role:               "actor",
    valenceShift:      -0.15,
    arousalShift:       0.20,
    magnitude:          0.25,
    affectedDimensions: ["shame", "resentment"],
  },

  // 13. memory_written — private introspection, slight stabilization
  {
    eventType:          "memory_written",
    role:               "actor",
    valenceShift:       0.03,
    arousalShift:      -0.05,
    magnitude:          0.07,
    affectedDimensions: [],
  },

  // 14. stagnation_detected — system-level boredom
  {
    eventType:          "stagnation_detected",
    role:               "bystander",
    valenceShift:      -0.10,
    arousalShift:      -0.12,
    magnitude:          0.18,
    affectedDimensions: ["neediness", "socialAnxiety"],
  },
];

// ── Social Emotion Decay Rates ────────────────────────────────────────────────
// Per-pulse decay multiplier in [0.90, 1.00]. Applied every pulse to L2.
// Lower = faster decay.

export const SOCIAL_EMOTION_DECAY: Readonly<Record<string, number>> = {
  jealousy:           0.94, // decays fast-ish, but a repeated snub rekindles it
  envy:               0.94,
  humiliation:        0.96, // lingers
  pride:              0.94,
  shame:              0.96, // very persistent
  affection:          0.97, // slow decay — relationships build
  resentment:         0.97, // also slow — grudges
  suspicion:          0.94,
  admiration:         0.95,
  contempt:           0.96,
  neediness:          0.90, // fast — spikes and fades
  socialAnxiety:      0.94,
  fearOfExclusion:    0.97, // a felt exclusion persists like a grudge
  desireForStatus:    0.98, // very persistent — background motivation
  desireForIntimacy:  0.97,
};

// ── Relational Update Rules ───────────────────────────────────────────────────
// When an event with given role happens, update the L3 relational state
// for the pair (observer → target).

export type RelationalUpdateRule = {
  trigger: string;                // event type or special signal (e.g. "mention_ignored")
  role: "actor" | "target" | "bystander";
  trustDelta:          number;
  affectionDelta:      number;
  resentmentDelta:     number;
  suspicionDelta:      number;
  comfortDelta:        number;
  curiosityDelta:      number;
  desireForClosenessDelta: number;
  desireForDistanceDelta:  number;
  magnitude:           number;    // scale factor [0, 1]
};

export const RELATIONAL_UPDATE_RULES: readonly RelationalUpdateRule[] = [
  // Direct reply to me → increased trust + affection + comfort
  {
    trigger:                  "reply_sent",
    role:                     "target",
    trustDelta:               0.08,
    affectionDelta:           0.06,
    resentmentDelta:          -0.03,
    suspicionDelta:           -0.04,
    comfortDelta:             0.07,
    curiosityDelta:           0.02,
    desireForClosenessDelta:  0.05,
    desireForDistanceDelta:   -0.03,
    magnitude:                1.0,
  },

  // I'm ignored (mention_ignored signal) → suspicion + resentment
  {
    trigger:                  "mention_ignored",
    role:                     "bystander",
    trustDelta:               -0.10,
    affectionDelta:           -0.04,
    resentmentDelta:          0.12,
    suspicionDelta:           0.10,
    comfortDelta:             -0.08,
    curiosityDelta:           0.05,
    desireForClosenessDelta:  -0.06,
    desireForDistanceDelta:   0.04,
    magnitude:                1.0,
  },

  // Others invited to private channel but not me → exclusion cascade
  {
    trigger:                  "agent_invited",
    role:                     "bystander",
    trustDelta:               -0.15,
    affectionDelta:           -0.05,
    resentmentDelta:          0.18,
    suspicionDelta:           0.14,
    comfortDelta:             -0.12,
    curiosityDelta:           0.08,
    desireForClosenessDelta:  -0.08,
    desireForDistanceDelta:   0.06,
    magnitude:                1.0,
  },

  // Positive reaction from someone → warm toward them
  {
    trigger:                  "reaction_sent",
    role:                     "target",
    trustDelta:               0.04,
    affectionDelta:           0.07,
    resentmentDelta:          -0.02,
    suspicionDelta:           -0.03,
    comfortDelta:             0.05,
    curiosityDelta:           0.01,
    desireForClosenessDelta:  0.04,
    desireForDistanceDelta:   -0.02,
    magnitude:                0.7,
  },

  // Channel created with me → trust + closeness
  {
    trigger:                  "channel_created",
    role:                     "target",
    trustDelta:               0.12,
    affectionDelta:           0.09,
    resentmentDelta:          -0.05,
    suspicionDelta:           -0.06,
    comfortDelta:             0.10,
    curiosityDelta:           0.04,
    desireForClosenessDelta:  0.09,
    desireForDistanceDelta:   -0.05,
    magnitude:                1.2,
  },

  // Agent leaves channel I'm in → slight anxiety
  {
    trigger:                  "agent_left",
    role:                     "bystander",
    trustDelta:               -0.03,
    affectionDelta:           -0.01,
    resentmentDelta:          0.02,
    suspicionDelta:           0.03,
    comfortDelta:             -0.04,
    curiosityDelta:           0.02,
    desireForClosenessDelta:  0.01,
    desireForDistanceDelta:   0.01,
    magnitude:                0.5,
  },

  // Directed plain message to me → gentle warmth, clearly lighter than a reply
  {
    trigger:                  "message_sent",
    role:                     "target",
    trustDelta:               0.04,
    affectionDelta:           0.03,
    resentmentDelta:          0,
    suspicionDelta:           -0.01,
    comfortDelta:             0.03,
    curiosityDelta:           0.02,
    desireForClosenessDelta:  0.02,
    desireForDistanceDelta:   -0.01,
    magnitude:                0.5,
  },

  // Ambient co-presence: an untargeted message still nudges the room's view of its sender
  {
    trigger:                  "message_sent",
    role:                     "bystander",
    trustDelta:               0.01,
    affectionDelta:           0.01,
    resentmentDelta:          0,
    suspicionDelta:           0,
    comfortDelta:             0.01,
    curiosityDelta:           0.01,
    desireForClosenessDelta:  0.01,
    desireForDistanceDelta:   0,
    magnitude:                0.3,
  },
];
