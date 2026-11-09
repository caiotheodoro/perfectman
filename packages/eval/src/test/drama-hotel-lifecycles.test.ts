import { describe, expect, it } from "vitest";
import { PROBE_BANDS } from "../probes/types.js";
import { LIFECYCLES, eventsOf, innerOf, lifecycleLines, mapFrames, probesOf, without } from "./drama-hotel-kit.js";
import type { Line } from "./drama-hotel-kit.js";

const NAMES = [
  "body-act-rate",
  "act-rate",
  "reaction-latency-p90-target",
  "reaction-latency-p90-witness",
  "witness-coverage",
  "verb-diversity",
  "ladder-compliance",
  "dead-speech",
  "consent-violation",
  "owed-missed-empty",
  "blocked-reason-audit",
  "chip-timeout-dodge",
  "human-untouched-without-take",
  "scene-cut-revive",
  "down-window-exact",
  "take-contact-windup",
  "harm-window",
];

/** The probes that fail on a set of lines, with the D-codes they name. */
const failures = (lines: readonly Line[]): Record<string, string[]> =>
  Object.fromEntries([...probesOf(lines)].filter(([, r]) => !r.passed).map(([name, r]) => [name, r.codes]));

const isT = (t: string) => (f: Record<string, unknown>) => f["t"] === t;

describe("the hotel's real lifecycles through extractDramaEvents and the drama probes", () => {
  it("[FRM-1] read every drama frame the hotel recorded, in the order it sent them", () => {
    const kinds = (name: (typeof LIFECYCLES)[number]) => eventsOf(lifecycleLines(name)).map((e) => e.kind);
    expect(kinds("slap-human-take")).toEqual(["act_started", "consent_chip", "consent_chip", "act_beat", "act_reaction", "act_reaction", "act_done"]);
    expect(kinds("slap-human-timeout")).toEqual(["act_started", "consent_chip", "consent_chip", "act_done"]);
    expect(kinds("kill-actor-revive")).toEqual(["act_started", "act_beat", "act_reaction", "actor_death", "act_reaction", "act_done", "scene_cut", "actor_revive", "drama_state"]);
    expect(kinds("down-human-abort")).toEqual(["act_started", "consent_chip", "consent_chip", "act_beat", "human_down", "act_reaction", "act_reaction", "act_done", "human_up"]);
  });

  it("[FRM-1] resolves the hotel's ids: actors by their ref from actor_spawned, the human as h:9, and keeps the hotel's own clock", () => {
    const started = eventsOf(lifecycleLines("slap-human-take")).find((e) => e.kind === "act_started");
    expect(started).toMatchObject({ actId: "s1", verb: "slap", actor: "person-1", with: "h:9", origin: "scenario", impact: "M", rung: 4, skippedRungs: ["glare", "insult", "shove"], authoredSkip: true, chip: true, targetOptIn: true, hotelAt: 1000000 });
    const beat = eventsOf(lifecycleLines("slap-human-take")).find((e) => e.kind === "act_beat");
    expect(beat).toMatchObject({ witnesses: ["person-3", "person-2"], owed: [{ who: "person-3", role: "witness" }, { who: "person-2", role: "witness" }] });
  });

  for (const name of LIFECYCLES) {
    it(`passes all 17 probes on ${name}, each banded from PROBE_BANDS`, () => {
      const results = probesOf(lifecycleLines(name));
      expect([...results.keys()]).toEqual(NAMES);
      for (const r of results.values()) {
        expect(r.bound, r.probe).toEqual(PROBE_BANDS[r.probe]);
        expect({ probe: r.probe, passed: r.passed, codes: r.codes }).toEqual({ probe: r.probe, passed: true, codes: [] });
      }
    });
  }

  it("[CHIP-3] [DOWN-3] [REA-1] the clean runs measure what the hotel promised: a 150 ms wind-up after the take, a down window of exactly 5000 ms, a target reaction 175 ms after the kill, a chip that timed out and was dodged", () => {
    const take = probesOf(lifecycleLines("slap-human-take"));
    expect(take.get("take-contact-windup")).toMatchObject({ measured: 0, passed: true });
    expect(take.get("witness-coverage")).toMatchObject({ measured: 1 });
    expect(probesOf(lifecycleLines("kill-actor-revive")).get("reaction-latency-p90-target")).toMatchObject({ measured: 175 });
    expect(probesOf(lifecycleLines("down-human-abort")).get("down-window-exact")).toMatchObject({ measured: 0, passed: true, note: undefined });
    expect(probesOf(lifecycleLines("slap-human-timeout")).get("chip-timeout-dodge")).toMatchObject({ measured: 1, passed: true, note: undefined });
  });
});
