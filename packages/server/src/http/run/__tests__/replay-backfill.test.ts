import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SimulationReplay } from "../../../html/replay-types.js";
import { readReplay } from "../run-artifacts.js";
import { backfillReplay } from "../replay-backfill.js";

const replay = (over: Partial<SimulationReplay> = {}): SimulationReplay => ({
  simulationId: "s", simulationName: "Cat", agentIds: ["ana"], agentNames: { ana: "Ana" }, agentArchetypes: { ana: "organizer" },
  channels: [], pulses: [], ...over,
});
const config = {
  storyClock: { start: "23:40", minutesPerPulse: 4 },
  setting: "rooftop",
  agents: [{ id: "ana", persona: { name: "Ana", archetype: "organizer", writingStyle: "tidy" }, promptProfile: { language: "en", messageLength: "short" } }],
};

describe("backfillReplay", () => {
  it("fills the clock, the profiles and the place from the config of an older run", () => {
    const out = backfillReplay(replay(), config);

    expect(out.storyClock).toEqual({ start: "23:40", minutesPerPulse: 4 });
    expect(out.look).toEqual({ setting: "rooftop" });
    expect(out.agentProfiles?.["ana"]).toEqual({ displayName: "Ana", archetype: "organizer", writingStyle: "tidy", language: "en", messageLength: "short" });
  });

  it("never overwrites what the replay already says", () => {
    const own = replay({ storyClock: { start: "01:00", minutesPerPulse: 2 }, look: { setting: "kitchen" }, agentProfiles: { ana: { displayName: "Ana R", archetype: "elder" } } });
    const out = backfillReplay(own, config);

    expect(out.storyClock).toEqual({ start: "01:00", minutesPerPulse: 2 });
    expect(out.look).toEqual({ setting: "kitchen" });
    expect(out.agentProfiles?.["ana"]?.displayName).toBe("Ana R");
  });

  it("invents nothing: a config without them leaves the replay as it was", () => {
    expect(backfillReplay(replay(), {})).toEqual(replay());
    expect(backfillReplay(replay(), null)).toEqual(replay());
    expect(backfillReplay(replay(), { storyClock: { start: "late", minutesPerPulse: 4 }, setting: "moon-base" }).storyClock).toBeUndefined();
  });
});

describe("readReplay", () => {
  it("serves an older run with its own clock", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-runs-"));
    try {
      await mkdir(join(root, "run_1"));
      await writeFile(join(root, "run_1", "replay.json"), JSON.stringify(replay()));
      await writeFile(join(root, "run_1", "config.json"), JSON.stringify(config));
      const served = await readReplay(root, "run_1");

      expect(served?.storyClock?.start).toBe("23:40");
      expect(await readReplay(root, "missing")).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
