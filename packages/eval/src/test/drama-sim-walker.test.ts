/**
 * The sim walks an authored contact beat's pair together, as a run does (habbo#41, errata P5-10): the `BeatPlayer` is built with `walkCloser`,
 * so a beat that starts `too_far` is retried for `walkWindowMs` and dropped only when the pair never comes adjacent (`retry_window_expired`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "@perfectman/hotel/drama";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";
import type { ActStartedEvent } from "../drama/index.js";

const started = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const killProposal = (r: SimResult) => r.proposals.find((p) => p.verb === "kill" && p.decision.startsWith("authored:"));

/** assassinato-na-festa with the pair at opposite ends of the room, so the authored kill (at 90 s) starts out of reach. */
async function apart(over: Partial<SimConfig> = {}): Promise<SimConfig> {
  const c = await presetSimConfig("assassinato-na-festa");
  const far: Record<string, [number, number]> = { ricardo: [10, 1], otavio: [1, 6] };
  return { ...c, ...over, actors: c.actors.map((a) => (far[a.ref] ? { ...a, tile: far[a.ref]! } : a)) };
}

describe("an authored kill that starts out of reach (assassinato-na-festa, pair apart)", () => {
  it("walks the pair together and plays: the kill is sent as a scenario act, not dropped as too_far", async () => {
    const r = runDramaSim(await apart());
    expect(killProposal(r)).toMatchObject({ actor: "ricardo", with: "otavio", decision: "authored:approve" });
    const kill = started(r).find((a) => a.verb === "kill");
    expect(kill).toMatchObject({ actor: "ricardo", with: "otavio", origin: "scenario", authoredSkip: true });
    expect(kill!.atMs).toBeGreaterThan(90_000);
    expect(r.events.filter((e) => e.kind === "actor_death").map((d) => d.actor)).toEqual(["otavio"]);
  });

  it("is dropped as retry_window_expired when the pair never gets adjacent inside the window", async () => {
    const r = runDramaSim(await apart({ tuning: { ...DEFAULT_DRAMA_TUNING, beats: { ...DEFAULT_DRAMA_TUNING.beats, walkWindowMs: 1500, walkRetryMs: 500 } } }));
    expect(killProposal(r)).toMatchObject({ actor: "ricardo", decision: "authored:veto", reason: "too_far", detail: "retry_window_expired" });
    expect(started(r).some((a) => a.verb === "kill")).toBe(false);
    expect(r.events.some((e) => e.kind === "actor_death")).toBe(false);
  });
});
