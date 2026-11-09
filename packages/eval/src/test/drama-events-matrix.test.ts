import { describe, it, expect } from "vitest";
import { extractDramaEvents, type ActOutcome, type ChipAnswer } from "../drama/index.js";
import { chipTimeoutDodge } from "../probes/drama-contract.js";
import { CONTRACT_FIXTURES, contractEvents, contractLines, innerOf, of, wire } from "./drama-contract-kit.js";

const NEW_FRAMES = ["act_started", "act_beat", "act_reaction", "act_done", "drama_consent", "actor_death", "actor_revive", "human_down", "human_up", "scene_cut", "drama_state"];

describe("act contract matrix rows read through the extractor", () => {
  it("[FRM-1] yields a chipped slap's events in the contract's order, act_done last", () => {
    const a17 = contractEvents("contract-slap-human-take").filter((e) => "actId" in e && e.actId === "a17");
    expect(a17.map((e) => (e.kind === "consent_chip" ? `consent_chip:${e.phase}` : e.kind))).toEqual([
      "act_started",
      "consent_chip:shown",
      "consent_chip:answered",
      "act_beat",
      "act_reaction",
      "act_reaction",
      "act_done",
    ]);
  });

  it("[FRM-1] puts human_down between the beat and act_done, and lets human_up come after act_done", () => {
    const kinds = contractEvents("contract-kill-human-down")
      .filter((e) => e.kind !== "speech" && e.kind !== "drama_state")
      .map((e) => e.kind);
    expect(kinds.indexOf("act_beat")).toBeLessThan(kinds.indexOf("human_down"));
    expect(kinds.indexOf("human_down")).toBeLessThan(kinds.indexOf("act_done"));
    expect(kinds.at(-1)).toBe("human_up");
  });

  it("[FRM-4] every new frame carries the run its wrapper files it under, and the events keep it", () => {
    for (const name of CONTRACT_FIXTURES) {
      for (const line of contractLines(name)) {
        const frame = innerOf(line);
        if (NEW_FRAMES.includes(String(frame["t"]))) expect(frame["run"], `${name} ${String(frame["t"])}`).toBe(line["run"]);
      }
    }
    expect(of(contractEvents("contract-slap-human-take"), "act_started").every((e) => e.run === 7)).toBe(true);
  });

  it("[CHIP-2] reads a chip's shown frame with its 4000 ms lifetime", () => {
    expect(of(contractEvents("contract-slap-human-take"), "consent_chip").find((e) => e.phase === "shown")).toMatchObject({ ttlMs: 4000, family: "violent" });
  });

  it("[CHIP-8] pairs a shown chip with its answer by act_id, and an aborted act has a shown chip and no answer", () => {
    const chips = of(contractEvents("contract-slap-human-take"), "consent_chip");
    expect(chips.map((c) => [c.phase, c.actId])).toEqual([
      ["shown", "a17"],
      ["answered", "a17"],
    ]);
    const aborted = of(contractEvents("contract-blocked-aborted"), "consent_chip");
    expect(aborted.map((c) => [c.phase, c.actId])).toEqual([["shown", "a23"]]);
  });

  it("[TBL-6] reads the kill-on-actor fixture: the death, the nested die as the target's reaction, no human_down", () => {
    const events = contractEvents("contract-kill-actor-revive");
    expect(of(events, "act_reaction").find((e) => e.reaction === "die")).toMatchObject({ who: "person-2", role: "target" });
    expect(of(events, "actor_death")).toHaveLength(1);
    expect(of(events, "human_down")).toEqual([]);
  });

  it("[LAD-9] reads the steps that were downgraded, as the hotel names them", () => {
    const frame = { t: "act_done", act_id: "s", verb: "shove", actor: -701, with: -702, outcome: "landed", owed_missed: [], downgraded: ["forced_step"], at: 5000 };
    expect(of(extractDramaEvents([wire(frame, 5000)]), "act_done")[0]!.downgraded).toEqual(["forced_step"]);
  });
});

/** CHIP-3 to CHIP-6 and the table of section 3.6: what each chip answer ends as. */
describe("[CHIP-4, CHIP-5] chip answers and the outcome they end as", () => {
  const OUTCOME: Record<"violent" | "kiss" | "hug", Record<ChipAnswer, ActOutcome>> = {
    violent: { take: "landed", dodge: "dodged", push_back: "declined", timeout: "dodged" },
    kiss: { take: "landed", dodge: "dodged", push_back: "declined", timeout: "dodged" },
    hug: { take: "landed", dodge: "dodged", push_back: "declined", timeout: "timeout" },
  };
  const rows = (["violent", "kiss", "hug"] as const).flatMap((family) => (["take", "dodge", "push_back", "timeout"] as const).map((answer) => [family, answer, OUTCOME[family][answer]] as const));
  const verbOf = { violent: "slap", kiss: "kiss", hug: "hug" } as const;

  it.each(rows)("%s with answer %s ends %s", (family, answer, outcome) => {
    const verb = verbOf[family];
    const frames = [
      wire({ t: "act_started", act_id: "c", verb, actor: -701, with: 9, intensity: 0.5, scene: "7.2", chip: true, target_opt_in: true, at: 1000 }, 1000),
      wire({ t: "drama_consent", act_id: "c", phase: "answered", actor: -701, with: 9, verb, family: family === "violent" ? "violent" : "affection", answer, at: 2000 }, 2000),
      wire({ t: "act_done", act_id: "c", verb, actor: -701, with: 9, outcome, answer, owed_missed: [], downgraded: [], at: 2300 }, 2300),
    ];
    const events = extractDramaEvents(frames);
    expect(of(events, "consent_chip")[0]).toMatchObject({ rawAnswer: answer });
    expect(of(events, "act_done")[0]).toMatchObject({ outcome, answer });
    if (answer === "timeout") expect(chipTimeoutDodge({ events, actorIds: [] })).toMatchObject({ measured: 1, judged: 1 });
  });
});
