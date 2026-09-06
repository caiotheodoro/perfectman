/**
 * Recorded emotion → a face.
 *
 * Ported out of `packages/eval/src/video/avatar.ts` so the browser stage and the
 * MP4 renderer resolve expressions the same way. The comment that came with it
 * is the important part and still holds: this is a visual approximation of
 * recorded state, never a dialogue classifier. Nothing here reads the message
 * text.
 *
 * Only top-level emotion dimensions are eligible. Per-target relational values
 * (`relational.<target>.<key>`) stay private context and never reach a face.
 */

export type FaceState = "neutral" | "angry" | "worried" | "tired" | "smile" | "shock";

/** Where an emotion reading came from, which the caption states rather than hides. */
export type RecordedEmotion = {
  source: "snapshot" | "driver" | "authored";
  label?: string;
  drivers?: string[];
  values?: Record<string, number>;
};

/**
 * The drawn pose per state: eye height, both brow paths, mouth path, and
 * whether brows are visible at all. Neutral hides the brows, which is what
 * keeps a resting face from looking permanently concerned.
 */
export type FacePose = {
  eyeRy: number;
  browLeft: string;
  browRight: string;
  mouth: string;
  browOpacity: number;
};

export const FACE_POSES: Record<FaceState, FacePose> = {
  neutral: { eyeRy: 6, browLeft: "M30 33L44 33", browRight: "M56 33L70 33", mouth: "M43 64Q50 64 57 64", browOpacity: 0 },
  angry: { eyeRy: 4.3, browLeft: "M29 28L44 36", browRight: "M56 36L71 28", mouth: "M40 67Q50 58 60 67", browOpacity: 1 },
  worried: { eyeRy: 7, browLeft: "M30 35L44 28", browRight: "M56 28L70 35", mouth: "M43 67Q50 60 57 67", browOpacity: 1 },
  tired: { eyeRy: 3.5, browLeft: "M30 33L44 34", browRight: "M56 34L70 33", mouth: "M43 66Q50 64 57 66", browOpacity: 0.7 },
  smile: { eyeRy: 5.5, browLeft: "M30 30L44 31", browRight: "M56 31L70 30", mouth: "M40 61Q50 76 60 61", browOpacity: 0 },
  shock: { eyeRy: 8, browLeft: "M30 26L44 25", browRight: "M56 25L70 26", mouth: "M43 64Q50 64 57 64", browOpacity: 1 },
};

const SOCIAL_FACES: Record<string, FaceState> = {
  resentment: "angry", contempt: "angry", jealousy: "angry", envy: "angry",
  humiliation: "worried", shame: "worried", suspicion: "worried", neediness: "worried",
  socialAnxiety: "worried", fearOfExclusion: "worried",
  affection: "smile", admiration: "smile", pride: "smile", joy: "smile", relief: "smile",
};

const LABEL_FACES: Record<string, FaceState> = {
  angry: "angry", anger: "angry", rage: "angry", furious: "angry", irritated: "angry",
  worried: "worried", afraid: "worried", anxious: "worried", sad: "worried",
  tired: "tired", bored: "tired", sleepy: "tired",
  smile: "smile", happy: "smile", joy: "smile", relieved: "smile", satisfied: "smile",
  shock: "shock", shocked: "shock", surprised: "shock", neutral: "neutral", calm: "neutral",
};

/** Strongest social emotion at or above the visibility floor, if any. */
export function dominantSocial(values: Record<string, number>): [string, number] | undefined {
  return Object.entries(values)
    .filter(([key, value]) => SOCIAL_FACES[key] !== undefined && value >= 0.6)
    .sort((a, b) => b[1] - a[1])[0];
}

/**
 * Resolution order, most explicit first: an authored label, then emotion
 * drivers, then a dominant social emotion, then the valence/arousal circumplex.
 *
 * The live protocol carries no `energy`, so `tired` is only reachable from a
 * stored replay or an authored script.
 */
export function faceFor(emotion?: RecordedEmotion): FaceState {
  if (!emotion) return "neutral";

  const label = emotion.label?.toLowerCase().trim();
  if (label && LABEL_FACES[label]) return LABEL_FACES[label];

  const drivers = (emotion.drivers ?? []).map((d) => d.toLowerCase().replaceAll("_", ""));
  if (drivers.some((d) => ["anger", "resentment", "hostility", "irritation"].includes(d))) return "angry";
  if (drivers.some((d) => ["fear", "anxiety", "socialanxiety", "shame", "guilt"].includes(d))) return "worried";
  if (drivers.some((d) => ["joy", "relief", "gratitude", "warmth", "affection"].includes(d))) return "smile";

  const values = emotion.values ?? {};
  const social = dominantSocial(values);
  if (social) return SOCIAL_FACES[social[0]] ?? "neutral";

  if (typeof values["valence"] === "number") {
    if (values["valence"] < -0.25) return (values["arousal"] ?? 0) > 0.65 ? "angry" : "worried";
    if (values["valence"] > 0.25) return "smile";
  }
  if (typeof values["energy"] === "number" && values["energy"] < 0.25) return "tired";
  return "neutral";
}

/** Caption under a figure. Always states provenance — recorded is not authored. */
export function emotionLabel(emotion?: RecordedEmotion): string {
  if (!emotion) return "";
  const prefix = emotion.source === "authored" ? "Authored" : "Recorded";
  if (emotion.label) return `${prefix}: ${emotion.label}`;
  if (emotion.drivers?.length) return `${prefix} drivers: ${emotion.drivers.join(", ")}`;

  const values = Object.entries(emotion.values ?? {}).filter(([key]) =>
    ["valence", "arousal", "energy"].includes(key),
  );
  const social = dominantSocial(emotion.values ?? {});
  if (social) values.unshift(social);
  return values.length
    ? `${prefix} ${values.map(([key, value]) => `${key} ${value}`).join(" · ")}`
    : `${prefix} state`;
}

/**
 * Arousal drives how big a gesture reads. Floored well above zero so a calm
 * agent still moves — a motionless figure looks broken, not composed.
 */
export function gestureEnergy(emotion?: RecordedEmotion): number {
  const arousal = emotion?.values?.["arousal"];
  return typeof arousal === "number" ? Math.max(0.2, Math.min(1, arousal)) : 0.35;
}
