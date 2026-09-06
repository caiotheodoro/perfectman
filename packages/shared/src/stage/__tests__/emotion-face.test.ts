/**
 * The face is the only place recorded emotion becomes visible, so the
 * resolution order is the contract: explicit beats inferred, and nothing here
 * ever reads message text.
 */
import { describe, expect, it } from "vitest";
import { dominantSocial, emotionLabel, faceFor, gestureEnergy, FACE_POSES } from "../emotion-face.js";

describe("faceFor — explicit readings win", () => {
  it("takes an authored label over everything else", () => {
    const face = faceFor({
      source: "authored",
      label: "smile",
      // Deliberately contradictory: the label is the author's decision.
      values: { valence: -0.9, arousal: 0.9 },
    });
    expect(face).toBe("smile");
  });

  it("matches a label case- and space-insensitively", () => {
    expect(faceFor({ source: "authored", label: "  SHOCKED " })).toBe("shock");
  });

  it("falls through an unrecognised label rather than defaulting to neutral", () => {
    expect(faceFor({ source: "snapshot", label: "wistful", values: { valence: 0.8 } })).toBe("smile");
  });

  it("reads drivers when there is no label, ignoring underscores", () => {
    expect(faceFor({ source: "driver", drivers: ["social_anxiety"] })).toBe("worried");
  });
});

describe("faceFor — inferred readings", () => {
  it("uses the strongest social emotion above the floor", () => {
    const face = faceFor({ source: "snapshot", values: { resentment: 0.7, affection: 0.9 } });
    expect(face).toBe("smile");
  });

  it("ignores a social emotion below the floor", () => {
    // 0.5 is present but not felt strongly enough to move a face.
    expect(faceFor({ source: "snapshot", values: { resentment: 0.5 } })).toBe("neutral");
  });

  it("splits negative valence by arousal", () => {
    expect(faceFor({ source: "snapshot", values: { valence: -0.6, arousal: 0.9 } })).toBe("angry");
    expect(faceFor({ source: "snapshot", values: { valence: -0.6, arousal: 0.2 } })).toBe("worried");
  });

  it("treats mild valence as neutral rather than forcing a mood", () => {
    expect(faceFor({ source: "snapshot", values: { valence: 0.1, arousal: 0.5 } })).toBe("neutral");
  });

  it("reads low energy as tired, which live data can never reach", () => {
    expect(faceFor({ source: "snapshot", values: { energy: 0.1 } })).toBe("tired");
  });

  it("is neutral with nothing to go on", () => {
    expect(faceFor()).toBe("neutral");
    expect(faceFor({ source: "snapshot", values: {} })).toBe("neutral");
  });
});

describe("dominantSocial", () => {
  it("ignores dimensions that have no face", () => {
    // desireForStatus is a real social emotion with no expression assigned.
    expect(dominantSocial({ desireForStatus: 0.95 })).toBeUndefined();
  });

  it("returns the strongest eligible dimension", () => {
    expect(dominantSocial({ shame: 0.65, contempt: 0.88 })).toEqual(["contempt", 0.88]);
  });
});

describe("emotionLabel", () => {
  it("says whether a reading was recorded or authored", () => {
    expect(emotionLabel({ source: "authored", label: "angry" })).toBe("Authored: angry");
    expect(emotionLabel({ source: "snapshot", label: "angry" })).toBe("Recorded: angry");
  });

  it("lists drivers when there is no label", () => {
    expect(emotionLabel({ source: "driver", drivers: ["fear", "shame"] })).toBe("Recorded drivers: fear, shame");
  });

  it("leads with the dominant social emotion, then the circumplex", () => {
    const label = emotionLabel({ source: "snapshot", values: { valence: -0.4, arousal: 0.8, contempt: 0.9 } });
    expect(label).toBe("Recorded contempt 0.9 · valence -0.4 · arousal 0.8");
  });

  it("is empty for no emotion at all", () => {
    expect(emotionLabel()).toBe("");
  });
});

describe("gestureEnergy and poses", () => {
  it("floors a calm agent well above zero so they still move", () => {
    expect(gestureEnergy({ source: "snapshot", values: { arousal: 0 } })).toBe(0.2);
    expect(gestureEnergy()).toBe(0.35);
  });

  it("hides the brows at rest, which is what keeps neutral from reading as worried", () => {
    expect(FACE_POSES.neutral.browOpacity).toBe(0);
    expect(FACE_POSES.worried.browOpacity).toBe(1);
  });
});
