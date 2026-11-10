/**
 * A slow model must not cost a scene its authored script. The script (`beats`) is the sidecar's `BeatPlayer` on the run's clock, a different path from the
 * model's consults and from the cinematic buffer (whose `{"k":"drop","beat":"b2","why":"stale"}` track entries are buffer items, a walk that waited too long
 * to be filmed, not scenario beats: both lists number their entries `b1`, `b2`). So the murder preset's kill (second 90) and its cut (second 170) play at
 * their second whether the model is consulted every 6 s or once in ten minutes.
 */
import { describe, expect, it } from "vitest";
import type { ActStartedEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";

describe("the authored script and a slow model", () => {
  it.each([6000, 30_000, 120_000, 600_000])("assassinato-na-festa plays its kill at 90 s and its cut at 170 s with the model consulted every %i ms", async (consultMs) => {
    const config = await presetSimConfig("assassinato-na-festa", { durationMs: 240_000 });
    expect(config.beats?.map((b) => [b.kind, b.at_ms])).toEqual([["act", 90_000], ["cut", 170_000]]);
    const result = runDramaSim({ ...config, consultMs, speechOnly: true });
    const kill = result.events.find((e): e is ActStartedEvent => e.kind === "act_started" && e.verb === "kill");
    expect(kill, "the authored kill").toBeDefined();
    expect(kill!.origin).toBe("scenario");
    expect(kill!.atMs).toBeGreaterThanOrEqual(90_000);
    expect(kill!.atMs).toBeLessThanOrEqual(95_000);
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]).toMatchObject({ outcome: "played", why: "sent" });
    expect(result.cuts[0]!.atMs).toBeGreaterThanOrEqual(170_000);
    expect(result.cuts[0]!.atMs).toBeLessThanOrEqual(175_000);
  });

  it("the same when the model proposes acts of its own and is slow to answer: no authored beat is dropped, and none is played late", async () => {
    const result = runDramaSim({ ...(await presetSimConfig("assassinato-na-festa", { durationMs: 240_000 })), consultMs: 120_000 });
    expect(result.events.filter((e) => e.kind === "act_started" && e.origin === "scenario").map((e) => (e as ActStartedEvent).verb)).toEqual(["kill"]);
    expect(result.cuts.map((c) => c.outcome)).toEqual(["played"]);
  });
});
