import { describe, it, expect } from "vitest";
import { runTurnTakingProbe } from "../embodiment/turn-taking.js";

/**
 * Scripted, labeled turn-taking probes (embodiment.md 8.3). The room, the
 * scheduler, the arbiter and the prompt are real; the model is a seeded
 * stand-in with the Phase 1 spike's priors. These bands are about the
 * machinery, not about any real model.
 */
describe("turn-taking probes through the real hotel runtime", () => {
  it("unaddressed line: the arbiter turns dog-piling into one answer, and denied lines become recorded silences", async () => {
    const governed = await runTurnTakingProbe({ scenario: "unaddressed", lines: 200, arbiter: true });
    const ungoverned = await runTurnTakingProbe({ scenario: "unaddressed", lines: 200, arbiter: false });
    expect(governed.dogPileRate).toBeLessThanOrEqual(0.05);
    expect(ungoverned.dogPileRate).toBeGreaterThan(0.15);
    expect(governed.interjectionRate).toBeLessThanOrEqual(0.05);
    expect(governed.answersPerLine).toBeLessThanOrEqual(1);
    expect(governed.arbiterDenials).toBeGreaterThan(0);
    expect(governed.fallbackCommitted).toBe(governed.arbiterDenials);
    expect(ungoverned.arbiterDenials).toBe(0);
  });

  it("addressed line: the addressee answers and nobody else speaks before it", async () => {
    const governed = await runTurnTakingProbe({ scenario: "addressed", lines: 200, arbiter: true });
    const ungoverned = await runTurnTakingProbe({ scenario: "addressed", lines: 200, arbiter: false });
    expect(governed.addresseeAnsweredRate).toBeGreaterThanOrEqual(0.95);
    expect(governed.dogPileRate).toBeLessThanOrEqual(0.05);
    expect(ungoverned.dogPileRate).toBeGreaterThan(0.2);
    // Timing rule 2: once the addressee has answered, nobody else speaks until the room has been quiet.
    expect(governed.interjectionRate).toBeLessThanOrEqual(0.05);
    expect(ungoverned.interjectionRate).toBeGreaterThan(0.2);
  });

  it("a typing human gets silence: no bot line lands in the 6 s after the first typing frame", async () => {
    const governed = await runTurnTakingProbe({ scenario: "typing", lines: 20, arbiter: true });
    const ungoverned = await runTurnTakingProbe({ scenario: "typing", lines: 20, arbiter: false });
    expect(governed.botLinesWhileTyping).toBe(0);
    expect(governed.arbiterDenials).toBeGreaterThan(0);
    expect(ungoverned.botLinesWhileTyping).toBeGreaterThan(0);
  });

  it("a quiet room: nothing but the one answer in the first 10 s, ambient talk once it has been quiet", async () => {
    const m = await runTurnTakingProbe({ scenario: "quiet", lines: 30, arbiter: true });
    expect(m.ambientBeforeQuiet).toBe(0);
    expect(m.ambientAfterQuiet).toBeGreaterThan(0);
  });

  it("addressed reply latency through the split scheduler meets p50 <= 5 s and p95 about 10 s on the fast model profile", async () => {
    const m = await runTurnTakingProbe({ scenario: "latency", lines: 60, arbiter: true });
    expect(m.addressedLatencyMs.n).toBeGreaterThanOrEqual(50);
    expect(m.addressedLatencyMs.p50).toBeLessThanOrEqual(5_000);
    // The stand-in model's own p95 is 6 s plus a 0.8 to 4 s persona delay, so across seeds the
    // scripted p95 lands at 10 s +- 1 s whichever arbiter runs (60 lines: 8.1 to 11.6 s).
    // The 10 s target belongs to the real-model probe; this bound only catches a scheduler regression.
    expect(m.addressedLatencyMs.p95).toBeLessThanOrEqual(10_500);
  });
});
