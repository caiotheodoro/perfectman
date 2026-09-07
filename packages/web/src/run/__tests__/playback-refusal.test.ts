/**
 * Not every rejected play() means the browser said no. Pausing an element
 * while its play() is still settling rejects that promise with an AbortError,
 * and the soundtrack does that on purpose when it unlocks. Only a real refusal
 * should flip the sound control off.
 */
import { describe, expect, it } from "vitest";
import { isPlaybackRefusal } from "../useSoundtrack.js";

describe("isPlaybackRefusal", () => {
  it("treats autoplay policy and unsupported media as refusals", () => {
    expect(isPlaybackRefusal(new DOMException("blocked", "NotAllowedError"))).toBe(true);
    expect(isPlaybackRefusal(new DOMException("bad file", "NotSupportedError"))).toBe(true);
  });
  it("lets an interrupted play() pass", () => {
    expect(isPlaybackRefusal(new DOMException("interrupted", "AbortError"))).toBe(false);
  });
  it("does not flip the control over an unknown failure", () => {
    expect(isPlaybackRefusal(new Error("weird"))).toBe(false);
    expect(isPlaybackRefusal(undefined)).toBe(false);
  });
});
