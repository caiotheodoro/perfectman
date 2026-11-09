import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyFrame } from "@perfectman/shared";
import { extractDramaEvents, type BodyActEvent, type DramaEvent } from "../drama/index.js";
import { normalizeFrame } from "../hotel/index.js";
import { bodyActRate, runDramaProbes } from "../probes/drama.js";
import { PROBE_BANDS } from "../probes/types.js";
import { beat, bodyAct, death, done, input, reaction, speech, started } from "./drama-probe-fixtures.js";

describe("runDramaProbes", () => {
  const clean: DramaEvent[] = [
    started("g", 0, "a", "glare", { with: "b" }),
    beat("g", 100, [["b", "target"]]),
    reaction("g", 500, "b", "target"),
    started("i", 10_000, "a", "insult", { with: "b" }),
    beat("i", 10_300, [["b", "target"], ["c", "witness"]]),
    reaction("i", 10_800, "b", "target"),
    reaction("i", 11_300, "c"),
    bodyAct("c", 12_000),
    done("i", 13_300),
  ];
  const names = [
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
  ];

  it("returns one ProbeResult per probe, banded from PROBE_BANDS, passing a clean scene", () => {
    const results = runDramaProbes(input(clean, { durationMs: 60_000 }));
    expect(results.map((r) => r.probe)).toEqual(names);
    for (const r of results) {
      expect(r.bound).toEqual(PROBE_BANDS[r.probe]);
      expect(r.passed).toBe(true);
      expect(r.codes).toEqual([]);
    }
  });

  it("fails the probes a bad scene breaks and attaches evidence and D-codes", () => {
    const bad: DramaEvent[] = [
      started("s", 0, "a", "slap", { with: "h:9" }),
      beat("s", 300, [["c", "witness"]]),
      done("s", 3_300),
      death("b", 4_000),
      speech("b", 5_000),
    ];
    const results = new Map(runDramaProbes(input(bad)).map((r) => [r.probe, r]));
    expect(results.get("ladder-compliance")).toMatchObject({ passed: false, codes: ["D3"], evidence: { offendingActIds: ["s"] } });
    expect(results.get("consent-violation")).toMatchObject({ passed: false, measured: 1, codes: ["D7"], evidence: { offendingActIds: ["s"] } });
    expect(results.get("human-untouched-without-take")).toMatchObject({ passed: false, measured: 1, codes: ["D7"] });
    expect(results.get("dead-speech")).toMatchObject({ passed: false, measured: 1, codes: ["D4"] });
    expect(results.get("reaction-latency-p90-target")).toMatchObject({ passed: true }); // a human target owes nothing
    expect(results.get("witness-coverage")).toMatchObject({ passed: false, codes: ["D1"] });
    expect(results.get("act-rate")).toMatchObject({ passed: true });
  });

  it("names D1 when a target never reacted, and D6 when acts are spammed", () => {
    const spam = Array.from({ length: 5 }, (_, i) => [started(`s${i}`, i * 1_000, "a", "glare", { with: "b" }), beat(`s${i}`, i * 1_000, [["b", "target"]])]).flat();
    const results = new Map(runDramaProbes(input(spam)).map((r) => [r.probe, r]));
    expect(results.get("reaction-latency-p90-target")).toMatchObject({ passed: false, codes: ["D1"], evidence: { target: { unreactedActIds: ["s0", "s1", "s2", "s3", "s4"] } } });
    expect(results.get("act-rate")).toMatchObject({ passed: false, codes: ["D6"] });
    expect(results.get("verb-diversity")).toMatchObject({ passed: true, measured: 0.2 });
  });
});

describe("real run 7 frames", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../drama/__fixtures__/run7-wrapper-excerpt.jsonl");
  const frames: BodyFrame[] = readFileSync(FIXTURE, "utf8")
    .trim()
    .split("\n")
    .map((l) => normalizeFrame(JSON.parse(l) as Record<string, unknown>)!);
  const events = extractDramaEvents(frames);

  it("reads a sane, non-zero body-act-rate per actor-minute", () => {
    const actorIds = [...new Set(events.filter((e): e is BodyActEvent => e.kind === "body_act" && !e.actor.startsWith("h:")).map((e) => e.actor))];
    const durationMs = Math.max(...frames.map((f) => f.atMs)) - Math.min(...frames.map((f) => f.atMs));
    const r = bodyActRate({ events, actorIds, durationMs });
    expect(r.bodyActs).toBeGreaterThan(0);
    expect(r.measured).toBeGreaterThan(0);
    expect(r.measured).toBeLessThan(10); // the 17 baseline runs average 0.86; anything near the hotel's rate limit would be a bug
  });

  it("finds no acts, violence or dead speech in a run from before acts existed", () => {
    const actorIds = ["person-1", "person-2", "person-3", "person-4"];
    const r = new Map(runDramaProbes({ events, actorIds }).map((x) => [x.probe, x]));
    expect(r.get("act-rate")!.measured).toBe(0);
    expect(r.get("ladder-compliance")!.measured).toBe(1);
    expect(r.get("dead-speech")!.measured).toBe(0);
    expect(r.get("consent-violation")!.measured).toBe(0);
  });
});
