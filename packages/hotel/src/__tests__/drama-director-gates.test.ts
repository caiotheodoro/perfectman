import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { VERB_GATES } from "../director/drama/tuning.js";
import { actFrames } from "../testing/fake-drama.js";
import { readDramaFixture } from "../testing/drama-fixtures.js";
import { A, B, C, H, ROOM, RUN, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";
import { ACT_VERBS, KNOWN_ACT_VERBS } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";

const vocab = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../schema/verb-vocab.json"), "utf8")) as { verbs: Record<string, { gates: Record<string, unknown> }> };

type Row = { rule: string; block: ScenarioDrama | "free" | "wide"; setup?: (r: Rig) => void | Promise<void>; authoredSkip?: boolean; bare?: boolean };

/** What each row of `blocked-all-reasons.jsonl` presumes of the world (its `given`), keyed by the row's act id. */
const ROWS: Record<string, Row> = {
  k1: { rule: "GATE-1", block: "wide", setup: (r) => r.state({ enabled: false }) },
  k2: { rule: "GATE-2", block: "wide", setup: (r) => r.state({ calm: true }) },
  k3: {
    rule: "GATE-3",
    block: "wide",
    setup: (r) => {
      for (const [i, who] of [A, B, C].entries()) r.act({ actId: `h${i}`, verb: "shove", actor: who, with: H, outcome: "landed", chip: true, answer: "take" });
    },
  },
  k4: { rule: "GATE-4", block: "wide", setup: (r) => r.hotel([{ t: "actor_death", run: RUN, room: ROOM, actor: B, cause: "kill", act_id: "x", killer: C, scene: r.dir.scene, at: 1 }]) },
  k5: { rule: "GATE-5", block: "free" },
  k6: { rule: "GATE-5", block: { max_rung: 3, may_target: [], may_die: [], permadeath: false } },
  k7: { rule: "GATE-5", block: { max_rung: 4, may_target: [], may_die: [], permadeath: false } },
  k8: { rule: "GATE-5", block: { max_rung: 6, may_target: [["person-1", "person-2"]], may_die: [], permadeath: false } },
  k9: { rule: "GATE-5", block: "wide", authoredSkip: true },
  k10: { rule: "GATE-6", block: "wide", setup: (r) => r.state({ optIn: [] }) },
  k11: { rule: "GATE-7", block: "wide", setup: (r) => r.world.put(B, { tile: [8, 5] }) },
  k12: { rule: "GATE-7", block: "wide", setup: (r) => r.world.put(B, { state: "walk" }) },
  k13: { rule: "GATE-7", block: "wide", setup: (r) => r.world.put(B, { state: "lay" }) },
  k14: { rule: "GATE-8", block: "free" },
  k15: {
    rule: "LAD-11",
    block: "wide",
    setup: (r) => {
      r.world.remove(C);
      r.world.remove(H);
      r.act({ actId: "p1", verb: "shove", actor: A, with: B, outcome: "landed" });
    },
  },
  k16: {
    rule: "GATE-9",
    block: "free",
    setup: async (r) => {
      r.act({ actId: "p1", verb: "insult", actor: A, with: B, outcome: "landed" });
      r.act({ actId: "p2", verb: "shove", actor: C, with: B, outcome: "landed" });
      await r.clock.advance(19_000);
    },
  },
  k17: {
    rule: "GATE-9",
    block: "wide",
    setup: async (r) => {
      r.act({ actId: "p1", verb: "punch", actor: A, with: B, outcome: "landed" });
      r.act({ actId: "p2", verb: "kill", actor: C, with: A, outcome: "dodged" });
      await r.clock.advance(25_000);
    },
  },
  k18: { rule: "GATE-10", block: "wide", setup: (r) => r.act({ actId: "p1", verb: "glare", actor: A, with: B, outcome: "landed" }) },
  k19: { rule: "GATE-10", block: "wide", setup: (r) => r.act({ actId: "p1", verb: "hug", actor: C, with: H, outcome: "dodged", chip: true, answer: "dodge" }) },
  k20: { rule: "GATE-10", block: "wide", setup: (r) => r.hotel(actFrames({ actId: "p1", verb: "kiss", actor: C, with: H, run: RUN, room: ROOM, scene: r.dir.scene, outcome: "landed", chip: true, answer: "take" }).slice(0, 2)) },
};

describe("the director's gate function over the shared blocked-all-reasons table", () => {
  const rows = readDramaFixture("blocked-all-reasons.jsonl");

  it("[GATE-5] covers every row of the fixture and no more", () => {
    expect(rows.map((r) => (r.in["cmd"] as { act_id: string }).act_id)).toEqual(Object.keys(ROWS));
  });

  for (const row of rows) {
    const cmd = row.in["cmd"] as { act_id: string; verb: ActVerb; with: number; authored_skip?: boolean };
    const spec = ROWS[cmd.act_id]!;
    it(`[${spec.rule}] ${cmd.act_id}: ${row.given} -> blocked ${String((row.expect[0] as { reason: string }).reason)}`, async () => {
      const block = spec.block === "free" ? undefined : spec.block === "wide" ? WIDE_BLOCK : spec.block;
      const rig = makeRig(block ? { block } : {});
      await spec.setup?.(rig);
      const sentBefore = rig.link.acts.length;
      const decision = rig.dir.decide({ actor: A, proposal: { verb: cmd.verb, with: cmd.with, origin: "model", ...(cmd.authored_skip || spec.authoredSkip ? { authoredSkip: true } : {}) }, emotion: emotion({ dominanceAssertion: 1, resentfulColdness: 1 }) });
      const want = row.expect[0] as { reason: string; detail?: string };
      expect(decision).toMatchObject({ kind: "veto", reason: want.reason, ...(want.detail ? { detail: want.detail } : {}) });
      expect(rig.link.acts.length).toBe(sentBefore);
    });
  }
});

describe("what the gates let through", () => {
  it("[LAD-1] approves the first glare of a scene and sends it as origin model", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "model" }, emotion: emotion({ resentfulColdness: 0.9 }) });
    expect(d).toMatchObject({ kind: "approve", verb: "glare", with: B, origin: "model", rung: 1, skippedRungs: [] });
    expect(rig.link.acts).toHaveLength(1);
    expect(rig.link.acts[0]?.cmd).toMatchObject({ k: "act", verb: "glare", with: B, origin: "model" });
  });

  it("[GATE-4] lets tend_fallen reach a fallen target and refuses it for a standing one", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel([{ t: "actor_death", run: RUN, room: ROOM, actor: B, cause: "kill", act_id: "x", killer: C, scene: rig.dir.scene, at: 1 }]);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "tend_fallen", with: B, origin: "model" } })).toMatchObject({ kind: "approve", verb: "tend_fallen" });
    expect(rig.dir.decide({ actor: C, proposal: { verb: "tend_fallen", with: A, origin: "model" } })).toMatchObject({ kind: "unsent", cause: "invalid", error: { code: "bad_target", detail: "not_fallen" } });
  });

  it("[GATE-2] calm blocks contact verbs and leaves glare and insult alone", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ calm: true });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "hug", with: B, origin: "model" } })).toMatchObject({ kind: "veto", reason: "calm_room" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "insult", with: B, origin: "model" }, emotion: emotion({ impulsiveProvocation: 0.9 }) })).toMatchObject({ kind: "approve" });
  });

  it("[GATE-6] a hug at an opted-out human is not blocked, a violent act is", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ optIn: [] });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "hug", with: H, origin: "model" } })).toMatchObject({ kind: "approve" });
    expect(rig.dir.decide({ actor: C, proposal: { verb: "glare", with: H, origin: "model" }, emotion: emotion({ resentfulColdness: 1 }) })).toMatchObject({ kind: "approve" });
  });

  it("[GATE-7] approves a contact verb only once the principals are adjacent and still", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(B, { tile: [8, 5] });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "hug", with: B, origin: "model" } })).toMatchObject({ kind: "veto", reason: "too_far", detail: "distance" });
    rig.world.put(B, { tile: [6, 5] });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "hug", with: B, origin: "model" } })).toMatchObject({ kind: "approve" });
  });

  it("[VV-4] the director's gate table equals the verb table's gates, verb by verb", () => {
    expect(Object.keys(VERB_GATES).sort()).toEqual([...KNOWN_ACT_VERBS].sort());
    for (const verb of ACT_VERBS) {
      const g = vocab.verbs[verb]!.gates;
      const mine = VERB_GATES[verb];
      expect({ calmBlocks: mine.calmBlocks, consent: mine.consent, budget: mine.budget, cooldown: mine.cooldown, scenario: mine.scenario, maxDist: mine.maxDist, still: mine.still }).toEqual({
        calmBlocks: g["calm_blocks"],
        consent: g["consent"],
        budget: g["budget"],
        cooldown: g["cooldown"],
        scenario: g["scenario"],
        maxDist: g["max_dist"],
        still: g["still"],
      });
    }
  });
});
