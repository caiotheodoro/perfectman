import { describe, expect, it } from "vitest";
import { OWN_VOCAB } from "../director/dialect.js";
import { commandKey, diffPaths, diffSignatures, outcomeSignature, signatures } from "../testing/fixture-diff.js";
import { readDramaFixture } from "../testing/drama-fixtures.js";
import type { FixtureRow } from "../testing/drama-fixtures.js";
import { readHotelRows } from "../testing/hotel-fixtures.js";
import type { HotelRow } from "../testing/hotel-fixtures.js";

/** P1's rows have the same shape as the hotel's; only `given` differs (prose against a structured object). */
const p1Rows = (name: string): HotelRow[] => readDramaFixture(name).map((r: FixtureRow) => ({ in: r.in, expect: r.expect }));

describe("the comparison itself can fail", () => {
  const row = (code: string, detail?: string): Pick<HotelRow, "expect"> => ({ expect: [{ t: "actor_error", code, ...(detail ? { detail } : {}) }] });

  it("reads a signature from the first frame, reports what only one side pins, and ignores order and repeats", () => {
    expect(outcomeSignature({ expect: [{ t: "act_done", outcome: "blocked", reason: "too_far", detail: "moving" }] })).toBe("act_done blocked/too_far/moving");
    expect(outcomeSignature(row("bad_message"))).toBe("actor_error bad_message");
    expect(diffSignatures(signatures([row("a"), row("b", "x"), row("b", "x")]), signatures([row("b", "x"), row("c")]))).toEqual({ onlyP1: ["actor_error a"], onlyHotel: ["actor_error c"], both: ["actor_error b/x"] });
  });

  it("lists every leaf that differs between two frames, with a missing side spelled out", () => {
    expect(diffPaths({ a: 1, b: { c: [1, 2] }, d: 4 }, { a: 1, b: { c: [1, 3] }, e: 5 })).toEqual(['/b/c/1: 2 -> 3', '/d: 4 -> (absent)', '/e: (absent) -> 5']);
    expect(diffPaths({ x: 1 }, { x: 1 })).toEqual([]);
  });

  it("identifies a command without its id and with the default origin spelled out", () => {
    const base = { run: 7, lease: 3, actor: -701 };
    expect(commandKey({ in: { ...base, cmd: { k: "act", act_id: "a", verb: "slap", with: 9 } } })).toBe(commandKey({ in: { ...base, cmd: { k: "act", act_id: "zzz", verb: "slap", with: 9, origin: "director" } } }));
    expect(commandKey({ in: { ...base, cmd: { k: "act", act_id: "a", verb: "slap", with: 9 } } })).not.toBe(commandKey({ in: { ...base, cmd: { k: "act", act_id: "a", verb: "slap", with: 10 } } }));
  });
});

describe("P1's contract-derived fixtures against the hotel's (act-validation.jsonl)", () => {
  const p1 = p1Rows("act-validation.jsonl");
  const hotel = readHotelRows("act-validation.jsonl");
  const diff = diffSignatures(signatures(p1), signatures(hotel));
  const targeted = ["glare", "insult", "shove", "punch", "kill", "hug", "kiss", "turn_back", "restrain", "tend_fallen"];
  const solo = ["die", "recoil", "freeze_gasp", "storm_off", "tableau", "faint"];

  it("[ACT-4] [ACT-6] [ACT-7] [ACT-8] rows only P1 wrote: the 11 required-target and 6 forbidden-target verbs one by one, the authored_skip type, a 50 character unknown verb cut at 40", () => {
    expect(diff.onlyP1).toEqual([
      "actor_error bad_message/act.authored_skip",
      ...solo.map((v) => `actor_error target_forbidden/${v}`),
      ...targeted.map((v) => `actor_error target_required/${v}`),
      `actor_error unknown_verb/${"z".repeat(40)}`,
    ].sort());
  });

  it("[ACT-1] [ACT-2] [ACT-9] [ACT-10] rows only the hotel wrote: everything that needs its world (a dialect 1 link, a stale lease, a run or an actor it does not hold, a bot, a body of another kind, a target not fallen, a target that is gone, a lying actor) and an accepted act that a closed switch then blocks", () => {
    expect(diff.onlyHotel).toEqual([
      "act_done blocked/kill_switch",
      "actor_error action_not_here/lay",
      "actor_error bad_message",
      "actor_error bad_target/bot",
      "actor_error bad_target/kind",
      "actor_error bad_target/not_fallen",
      "actor_error no_such_run",
      "actor_error stale_lease",
      "actor_error target_gone/77777",
      "actor_error unknown_actor",
    ]);
  });

  it("the answers both pinned are the same 11, and every answer P1 expects to a command the hotel also asked is one the hotel gave to it in some world", () => {
    expect(diff.both).toHaveLength(11);
    const hotelAnswers = new Map<string, Set<string>>();
    for (const r of hotel) hotelAnswers.set(commandKey(r), new Set([...(hotelAnswers.get(commandKey(r)) ?? []), outcomeSignature(r)]));
    // The one reuse row is stateful (it answers the row before it), so it is compared by its own test in drama-fixtures.
    const shared = p1.filter((r) => hotelAnswers.has(commandKey(r)) && !outcomeSignature(r).endsWith("act_id_reused"));
    expect(shared).toHaveLength(6);
    for (const r of shared) expect([...(hotelAnswers.get(commandKey(r)) ?? [])], commandKey(r)).toContain(outcomeSignature(r));
  });

  it("the envelope differs: P1 states origin on every command and gives the world as prose, the hotel leaves the default origin out and gives the world as an object", () => {
    expect(p1.every((r) => (r.in?.["cmd"] as Record<string, unknown>)["k"] === "act")).toBe(true);
    expect(readDramaFixture("act-validation.jsonl").every((r) => r.given === undefined || typeof r.given === "string")).toBe(true);
    expect(hotel.filter((r) => r.given).every((r) => typeof r.given === "object")).toBe(true);
    expect(hotel.some((r) => (r.in?.["cmd"] as Record<string, unknown>)["origin"] === undefined)).toBe(true);
  });
});

describe("P1's contract-derived fixtures against the hotel's (blocked-all-reasons.jsonl)", () => {
  const p1 = p1Rows("blocked-all-reasons.jsonl");
  const hotel = readHotelRows("blocked-all-reasons.jsonl");

  it("[GATE-1] to [GATE-10] pin the same 20 blocked reasons and details, and neither file has one the other lacks", () => {
    const diff = diffSignatures(signatures(p1), signatures(hotel));
    expect([diff.onlyP1, diff.onlyHotel]).toEqual([[], []]);
    expect(diff.both).toHaveLength(20);
  });

  it("the hotel pins more rows per reason: 20 rows of P1 against 32, the extra twelve being the calm gate on each of its 7 verbs, the paused room, shove and insult against an opted-out human, a glare out of range, and kill and die in free play", () => {
    expect([p1.length, hotel.length]).toEqual([20, 32]);
    const count = (rows: HotelRow[], sig: string) => rows.filter((r) => outcomeSignature(r) === sig).length;
    expect([count(p1, "act_done blocked/calm_room"), count(hotel, "act_done blocked/calm_room")]).toEqual([1, 7]);
    expect([count(p1, "act_done blocked/rate_limit"), count(hotel, "act_done blocked/rate_limit")]).toEqual([1, 2]);
    expect([count(p1, "act_done blocked/consent_off"), count(hotel, "act_done blocked/consent_off")]).toEqual([1, 3]);
    expect([count(p1, "act_done blocked/too_far/distance"), count(hotel, "act_done blocked/too_far/distance")]).toEqual([1, 2]);
    expect([count(p1, "act_done blocked/no_scenario_gate/free_play"), count(hotel, "act_done blocked/no_scenario_gate/free_play")]).toEqual([1, 3]);
  });

  it("[GATE-3] the hotel's paused room blocks a violent act on a human as rate_limit, a row P1 did not write (SAFE-4)", () => {
    const paused = hotel.find((r) => r.given?.["paused"] === true);
    expect(paused && outcomeSignature(paused)).toBe("act_done blocked/rate_limit");
  });

  it("the hotel's rows carry a structured world (switch, calm, paused, harm window, positions, chip state, scenario block, ladder history), P1's a sentence", () => {
    const keys = new Set(hotel.flatMap((r) => Object.keys(r.given ?? {})));
    for (const key of ["switch", "calm", "paused", "harm_in_window", "harm_max", "actors", "humans", "witnesses", "drama", "ladder", "fallen"]) expect(keys.has(key), key).toBe(true);
    expect(readDramaFixture("blocked-all-reasons.jsonl").every((r) => typeof r.given === "string")).toBe(true);
  });
});

describe("P1's contract-derived fixtures against the hotel's (hello-offer.jsonl)", () => {
  const p1 = readDramaFixture("hello-offer.jsonl");
  const hotel = readHotelRows("hello-offer.jsonl");

  it("[NEG-2] look from opposite ends: P1's `in` is the hotel's hello and its `expect` the sidecar's hello_ack; the hotel's `in` is null and its `expect` its own hello", () => {
    expect(p1.every((r) => r.in["t"] === "hello" && r.expect[0]?.["t"] === "hello_ack")).toBe(true);
    expect(hotel.every((r) => r.in === null && r.expect[0]?.["t"] === "hello")).toBe(true);
    expect([p1.length, hotel.length]).toEqual([5, 2]);
  });

  it("[NEG-3] [SAFE-2] [VV-3] the offering hello differs by exactly the runtime switch (the contract's example says true, the hotel's is false until an admin turns it on), the dead set, the vocab sha and the build", () => {
    const offer = p1[0]?.in;
    const real = hotel[1]?.expect[0];
    expect(diffPaths(offer, real)).toEqual([
      "/drama/dead: [-702] -> []",
      "/drama/enabled: true -> false",
      `/drama/verb_vocab/sha256: "3f1c9a5e7b2d40688a1c0e94f5d27b3a6c8e1d0f9b4a7c25e83d6f0a1b9c4d72" -> "${OWN_VOCAB.sha256}"`,
      '/hotel/build: "517ae35" -> "dev"',
      "/seq: 1 -> (absent)",
      "/session: \"b2f1\" -> (absent)",
    ]);
  });

  it("[NEG-1] the hello of a hotel with the switch off is the same in both files apart from the build, `seq` and the session", () => {
    expect(diffPaths(p1[1]?.in, hotel[0]?.expect[0])).toEqual(['/hotel/build: "517ae35" -> "dev"', "/seq: 1 -> (absent)", "/session: \"b2f1\" -> (absent)"]);
  });

  it("[VV-3] the vocab the real hotel hello carries is the sidecar's vendored one: version, rev and sha256 all equal", () => {
    const vocab = (hotel[1]?.expect[0]?.["drama"] as { verb_vocab: unknown }).verb_vocab;
    expect(vocab).toEqual(OWN_VOCAB);
  });
});
