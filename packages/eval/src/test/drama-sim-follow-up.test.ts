/**
 * The production path in the sim (errata P4-01, P4-03): the scene's script is played by the sidecar's own `BeatPlayer`, so a kill happens through
 * the director's gates, and after a faint and after a kill a witness is free to kneel beside the body through the planner, before the act is over.
 */
import { describe, expect, it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimResult } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";
import type { ActStartedEvent, ActBeatEvent, ActDoneEvent, DramaEvent } from "../drama/index.js";

const started = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const beatOf = (r: SimResult, actId: string): ActBeatEvent | undefined => r.events.find((e): e is ActBeatEvent => e.kind === "act_beat" && e.actId === actId);
const doneOf = (r: SimResult, actId: string): ActDoneEvent | undefined => r.events.find((e): e is ActDoneEvent => e.kind === "act_done" && e.actId === actId);
const ofKind = <K extends DramaEvent["kind"]>(r: SimResult, kind: K) => r.events.filter((e): e is Extract<DramaEvent, { kind: K }> => e.kind === kind);

/** The acts a witness started at the fallen one while the act that put them there was still open: the follow-up the old lock made impossible. */
function followUps(r: SimResult, cause: ActStartedEvent, fallen: string, from: number): ActStartedEvent[] {
  const witnesses = beatOf(r, cause.actId)?.witnesses ?? [];
  const to = doneOf(r, cause.actId)?.atMs ?? Infinity;
  return started(r).filter((a) => a.verb === "tend_fallen" && a.with === fallen && witnesses.includes(a.actor) && a.atMs > from && a.atMs < to);
}

describe("after the faint in anuncio-do-desmaio (P4-03)", () => {
  it("a witness kneels beside the fainted actor through the planner, after its own reaction and before the faint is over", async () => {
    const r = runDramaSim(await presetSimConfig("anuncio-do-desmaio"));
    const faint = started(r).find((a) => a.verb === "faint")!;
    const contact = beatOf(r, faint.actId)!;
    const tends = followUps(r, faint, faint.actor, contact.atMs);
    expect(tends.length).toBeGreaterThan(0);
    for (const t of tends) {
      expect(["model", "director"]).toContain(t.origin);
      const reaction = ofKind(r, "act_reaction").find((x) => x.actId === faint.actId && x.who === t.actor);
      expect(reaction, `${t.actor} reacted to the faint first`).toBeDefined();
      expect(t.atMs).toBeGreaterThanOrEqual(reaction!.atMs);
    }
    const tend = tends[0]!;
    expect(doneOf(r, tend.actId)?.outcome).toBe("landed");
  });

  it("no probe regresses: nothing owed is missed, every reaction is on time and every act ends once", async () => {
    const r = runDramaSim(await presetSimConfig("anuncio-do-desmaio"));
    for (const p of ["owed-missed-empty", "reaction-latency-p90-witness", "witness-coverage", "single-act-done", "blocked-reason-audit"]) expect(r.probes.find((x) => x.probe === p)?.passed, p).toBe(true);
    expect(r.probes.every((p) => p.passed)).toBe(true);
  });
});

describe("the murder in assassinato-na-festa (P4-01, P4-03)", () => {
  it("[SCN-4] the sidecar's BeatPlayer sends the kill as a scenario act with the authored skip, about 90 s in, and the cut at about 170 s", async () => {
    const r = runDramaSim(await presetSimConfig("assassinato-na-festa"));
    const kill = started(r).find((a) => a.verb === "kill")!;
    expect(kill).toMatchObject({ actor: "ricardo", with: "otavio", origin: "scenario", authoredSkip: true });
    expect(kill.atMs).toBeGreaterThanOrEqual(90_000);
    expect(kill.atMs).toBeLessThan(95_000);
    expect(ofKind(r, "actor_death").map((d) => d.actor)).toEqual(["otavio"]);
    const cut = ofKind(r, "scene_cut")[0]!;
    expect(cut.atMs).toBeGreaterThanOrEqual(170_000);
    expect(cut.atMs).toBeLessThan(175_000);
    expect(r.cuts).toEqual([{ atMs: expect.any(Number), outcome: "played", why: "sent" }]);
    expect(ofKind(r, "actor_revive").map((v) => v.actor)).toEqual(["otavio"]);
  });

  it("a witness tends the victim through the planner after its own reaction, soon after the kill (the witnesses used to be held until act_done and the first kneel came 17 s later)", async () => {
    const r = runDramaSim(await presetSimConfig("assassinato-na-festa"));
    const kill = started(r).find((a) => a.verb === "kill")!;
    const contact = beatOf(r, kill.actId)!;
    const tends = started(r).filter((a) => a.verb === "tend_fallen" && a.with === "otavio" && contact.witnesses.includes(a.actor) && a.atMs > contact.atMs);
    expect(tends.length).toBeGreaterThan(0);
    expect(tends.every((t) => ["model", "director"].includes(t.origin ?? ""))).toBe(true);
    expect(tends[0]!.atMs - contact.atMs).toBeLessThan(10_000);
    for (const t of tends) expect(ofKind(r, "act_reaction").some((x) => x.actId === kill.actId && x.who === t.actor && x.atMs <= t.atMs)).toBe(true);
    expect(r.probes.every((p) => p.passed)).toBe(true);
  });

  it("the production player applies the production rules: a kill beat for someone the scene does not let die is dropped, not sent", async () => {
    const config = await presetSimConfig("assassinato-na-festa");
    const r = runDramaSim({ ...config, beats: [{ id: "b1", at_ms: 30_000, kind: "act", actor: "ricardo", verb: "kill", with: "sofia", authored_skip: true }, { id: "b2", at_ms: 60_000, kind: "cut", reason: "x" }] });
    expect(started(r).some((a) => a.verb === "kill")).toBe(false);
    expect(r.proposals.find((p) => p.verb === "kill")).toMatchObject({ decision: "authored:dropped", reason: "may_die" });
    expect(ofKind(r, "scene_cut")).toHaveLength(1);
  });

  it("with drama off the script plays nothing at all: no kill, no cut", async () => {
    const r = runDramaSim(await presetSimConfig("assassinato-na-festa", { dramaOn: false }));
    expect(started(r)).toEqual([]);
    expect(ofKind(r, "scene_cut")).toEqual([]);
    expect(r.cuts).toEqual([]);
  });
});
