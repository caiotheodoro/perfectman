import fc from "fast-check";
import { ACT_ORIGINS, ACT_TARGET_MODE, ACT_VERBS } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { validateActCmd } from "../director/act-cmd.js";
import { VOCAB_ENUMS } from "../director/verb-vocab.generated.js";
import { checkFrame } from "../testing/frame-schema.js";
import { readDramaFixture } from "../testing/drama-fixtures.js";
import type { FixtureRow } from "../testing/drama-fixtures.js";

const cmdOf = (row: FixtureRow): unknown => (row.in["cmd"] as { k: string } | undefined);
const expectErr = (row: FixtureRow): { code: string; detail?: string } => row.expect[0] as { code: string; detail?: string };

describe("fixtures/drama/act-validation.jsonl (contract-derived)", () => {
  const rows = readDramaFixture("act-validation.jsonl");

  it("has one row per rule case: 8 ACT-4, the ACT-5 pair, 2 ACT-6, 11 ACT-7, 7 ACT-8 and 2 ACT-9 rows, every expect one actor_error", () => {
    expect(rows).toHaveLength(8 + 2 + 2 + 11 + 7 + 2);
    for (const row of rows) {
      expect(row.expect).toHaveLength(1);
      expect(row.in["t"]).toBe("actor_cmd");
      expect(row.expect[0]?.["t"]).toBe("actor_error");
      expect(row.expect[0]?.["cid"]).toBe(row.in["cid"]);
    }
  });

  it("[ACT-1] [ACT-4] [ACT-5] [ACT-6] [ACT-7] [ACT-8] [ACT-9] the sidecar's own pre-send check answers every row with the code and detail the contract fixes", () => {
    const consumed = new Set<string>();
    for (const row of rows) {
      const ctx = { run: row.in["run"] as number, actor: row.in["actor"] as number };
      const got = validateActCmd(cmdOf(row), ctx, consumed);
      const want = expectErr(row);
      expect(got, JSON.stringify(row.in["cmd"])).toEqual({ code: want.code, ...(want.detail !== undefined ? { detail: want.detail } : {}) });
    }
  });

  it("[ACT-5] a retry with a new id is not a reuse, and a command refused before ACT-4 consumes nothing", () => {
    const consumed = new Set<string>();
    const ctx = { run: 7, actor: -701 };
    expect(validateActCmd({ k: "act", act_id: "n1", verb: "slap", with: 9, intensity: 2 }, ctx, consumed)).toEqual({ code: "bad_message", detail: "act.intensity" });
    expect(consumed.has("n1")).toBe(false);
    expect(validateActCmd({ k: "act", act_id: "n1", verb: "slap", with: 9 }, ctx, consumed)).toBeUndefined();
    expect(validateActCmd({ k: "act", act_id: "n1", verb: "slap", with: 9 }, ctx, consumed)).toEqual({ code: "bad_message", detail: "act_id_reused" });
    expect(validateActCmd({ k: "act", act_id: "n2", verb: "slap", with: 9 }, ctx, consumed)).toBeUndefined();
  });

  it("[ACT-4] a valid command of every verb passes, the effective intensity range is closed, and text belongs to insult only", () => {
    const ctx = { run: 7, actor: -701 };
    const ok = (cmd: Record<string, unknown>): boolean => validateActCmd({ k: "act", ...cmd }, ctx, new Set()) === undefined;
    expect(ok({ act_id: "a", verb: "insult", with: 9, text: "x".repeat(200), intensity: 1, origin: "scenario", authored_skip: true })).toBe(true);
    expect(ok({ act_id: "a", verb: "cry", intensity: 0 })).toBe(true);
    expect(validateActCmd({ k: "act", act_id: "a", verb: "cry", text: "hi" }, ctx, new Set())).toEqual({ code: "bad_message", detail: "act.text" });
    expect(validateActCmd({ k: "act", act_id: "a", verb: "slap", with: 9.5 }, ctx, new Set())).toEqual({ code: "bad_message", detail: "act.with" });
    expect(validateActCmd({ k: "act", verb: "slap", with: 9 }, ctx, new Set())).toEqual({ code: "bad_message", detail: "act.act_id" });
    expect(validateActCmd({ k: "act", act_id: "a", with: 9 }, ctx, new Set())).toEqual({ code: "bad_message", detail: "act.verb" });
    expect(validateActCmd({ k: "walk" }, ctx, new Set())).toEqual({ code: "bad_message" });
  });
});

describe("the sidecar's pre-send check, over random acts", () => {
  const ctx = { run: 7, actor: -701 };
  const actArb = fc.record({
    verb: fc.constantFrom(...ACT_VERBS),
    id: fc.stringMatching(/^[A-Za-z0-9_.:-]{1,32}$/),
    target: fc.integer({ min: 1, max: 5000 }),
    intensity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    origin: fc.option(fc.constantFrom(...ACT_ORIGINS), { nil: undefined }),
    skip: fc.option(fc.boolean(), { nil: undefined }),
  });
  const build = (a: { verb: (typeof ACT_VERBS)[number]; id: string; target: number; intensity: number | undefined; origin: string | undefined; skip: boolean | undefined }) => ({
    k: "act",
    act_id: a.id,
    verb: a.verb,
    ...(ACT_TARGET_MODE[a.verb] === "required" ? { with: a.target } : {}),
    ...(a.intensity !== undefined ? { intensity: a.intensity } : {}),
    ...(a.origin !== undefined ? { origin: a.origin } : {}),
    ...(a.skip !== undefined ? { authored_skip: a.skip } : {}),
  });

  it("[ACT-4] [ACT-7] [ACT-8] an act built from the closed enums, in-range numbers and the right target mode always passes", () => {
    fc.assert(fc.property(actArb, (a) => validateActCmd(build(a), ctx, new Set()) === undefined));
  });

  it("[ACT-4] an intensity outside [0, 1] or a non-finite one is refused as act.intensity, whatever else the act is", () => {
    const bad = fc.oneof(fc.double({ min: 1.0001, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: -0.0001, noNaN: true }), fc.constant(Infinity), fc.constant(-Infinity));
    fc.assert(fc.property(actArb, bad, (a, intensity) => {
      const got = validateActCmd({ ...build(a), intensity }, ctx, new Set());
      return got?.code === "bad_message" && got.detail === "act.intensity";
    }));
  });
});

describe("fixtures/drama/blocked-all-reasons.jsonl (contract-derived)", () => {
  const rows = readDramaFixture("blocked-all-reasons.jsonl");
  const DETAILS: Record<string, string[]> = {
    no_scenario_gate: ["max_rung", "may_target", "may_die", "free_play", "skip"],
    too_far: ["distance", "moving", "posture"],
    ladder: ["rung", "zero_witness"],
    budget: ["physical", "kill"],
    cooldown: ["verb", "chip_cooldown", "chip_busy"],
  };

  it("[FRM-2] every row is one blocked act_done and nothing else, with no act_started, and says which world it presumes", () => {
    for (const row of rows) {
      expect(typeof row.given).toBe("string");
      expect(row.expect).toHaveLength(1);
      const done = row.expect[0] as { t: string; outcome: string; owed_missed: unknown[]; downgraded: unknown[] };
      expect([done.t, done.outcome, done.owed_missed, done.downgraded]).toEqual(["act_done", "blocked", [], []]);
    }
  });

  it("[GATE-1] [GATE-2] [GATE-3] [GATE-4] [GATE-5] [GATE-6] [GATE-7] [GATE-8] [GATE-9] [GATE-10] covers each of the ten blocked reasons, and every detail the contract names", () => {
    const reasons = new Set(rows.map((r) => (r.expect[0] as { reason: string }).reason));
    expect([...reasons].sort()).toEqual([...VOCAB_ENUMS.blocked_reasons].sort());
    for (const [reason, details] of Object.entries(DETAILS)) {
      const seen = rows.filter((r) => (r.expect[0] as { reason: string }).reason === reason).map((r) => (r.expect[0] as { detail?: string }).detail);
      expect(seen.sort(), reason).toEqual([...details].sort());
    }
  });

  it("[ACT-1] every command in it is a valid act: it passes the sidecar's pre-send check and the wire schema", () => {
    const consumed = new Set<string>();
    for (const row of rows) {
      expect(validateActCmd(cmdOf(row), { run: 7, actor: -701 }, consumed), row.given).toBeUndefined();
      expect(checkFrame("sidecar_to_hotel", row.in), row.given).toEqual({ ok: true, errors: [] });
    }
  });
});

describe("fixtures/drama/*.jsonl: every frame parses with the generated types' schema", () => {
  it("[FRM-4] [NEG-2] the expect frames of act-validation and blocked-all-reasons are hotel frames, and hello-offer's in and expect are the two directions", () => {
    for (const name of ["act-validation.jsonl", "blocked-all-reasons.jsonl"]) {
      for (const row of readDramaFixture(name)) for (const f of row.expect) expect(checkFrame("hotel_to_sidecar", f), JSON.stringify(f)).toEqual({ ok: true, errors: [] });
    }
    for (const row of readDramaFixture("hello-offer.jsonl")) {
      expect(checkFrame("hotel_to_sidecar", row.in), JSON.stringify(row.in)).toEqual({ ok: true, errors: [] });
      for (const f of row.expect) expect(checkFrame("sidecar_to_hotel", f), JSON.stringify(f)).toEqual({ ok: true, errors: [] });
    }
  });

  it("[NEG-2] the schema check bites: a misspelt field, a bad enum member and a missing field all fail", () => {
    const [row] = readDramaFixture("blocked-all-reasons.jsonl");
    const done = row!.expect[0]!;
    expect(checkFrame("hotel_to_sidecar", { ...done, reasn: "x" }).ok).toBe(false);
    expect(checkFrame("hotel_to_sidecar", { ...done, reason: "ladder_skip" }).ok).toBe(false);
    const { room: _room, ...noRoom } = done;
    expect(checkFrame("hotel_to_sidecar", noRoom).ok).toBe(false);
    expect(checkFrame("sidecar_to_hotel", { ...row!.in, cmd: { k: "act", act_id: "a", verb: "bite" } }).ok).toBe(false);
  });
});
