/**
 * Issue #262: a model that only talks (it never fills `body.act`, like deepseek-v4.1-flash on the live run) must still show the scene's ladder.
 * The sim's mock proposes nothing here (`speechOnly`), so every act is the director's own, started from the actors' feelings as the run seeds
 * them (the scene's prior messages appraised into a grievance, `applySeeds`).
 */
import { describe, expect, it } from "vitest";
import type { ActReactionEvent, ActStartedEvent, DramaEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";

const LADDER = ["glare", "insult", "shove", "slap"];
const startedOf = (events: readonly DramaEvent[]): ActStartedEvent[] => events.filter((e): e is ActStartedEvent => e.kind === "act_started");

describe("a speech-only model on tapa-na-cara", () => {
  it("[#262] the director alone shows glare, insult, shove, slap in order, one rung per beat, within the first two minutes", async () => {
    const result = runDramaSim({ ...(await presetSimConfig("tapa-na-cara")), speechOnly: true, durationMs: 120_000 });
    const started = startedOf(result.events);
    expect(started.length).toBeGreaterThan(0);
    expect(result.proposals.every((p) => p.decision === "initiate"), "the model proposed nothing: every act is the director's").toBe(true);
    const climb = started.filter((e) => e.origin === "director" && LADDER.includes(e.verb));
    expect(climb.slice(0, 4).map((e) => e.verb)).toEqual(LADDER);
    expect(new Set(climb.slice(0, 4).map((e) => e.actor)).size).toBe(1);
    expect(climb[3]!.atMs).toBeLessThanOrEqual(120_000);
  });

  it("the target and the witnesses react to the blows, and the scene stays inside the contract's budget: every probe passes", async () => {
    const result = runDramaSim({ ...(await presetSimConfig("tapa-na-cara")), speechOnly: true });
    const slap = startedOf(result.events).find((e) => e.verb === "slap")!;
    expect(slap).toBeDefined();
    const reactions = result.events.filter((e): e is ActReactionEvent => e.kind === "act_reaction" && e.actId === slap.actId);
    expect(reactions.length).toBeGreaterThan(0);
    const report = probeReport(result);
    expect({ failed: report.failed }).toEqual({ failed: [] });
    const blows = startedOf(result.events).filter((e) => ["shove", "slap", "punch"].includes(e.verb));
    for (let i = 1; i < blows.length; i++) expect(blows[i]!.atMs - blows[i - 1]!.atMs).toBeGreaterThanOrEqual(20_000);
    expect(startedOf(result.events).filter((e) => e.verb === "kill")).toHaveLength(0);
  });

  it("the ladder stays one rung per beat and consent holds: nothing is blocked by the director's own gates", async () => {
    const result = runDramaSim({ ...(await presetSimConfig("tapa-na-cara")), speechOnly: true });
    expect(result.proposals.filter((p) => p.decision === "veto")).toEqual([]);
    expect(result.stats.blocked).toBe(0);
  });
});
