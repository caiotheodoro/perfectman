/**
 * Properties of the authored script over random scripts, blocks and scene cuts (errata P4-01): whatever the author wrote, a kill is only ever
 * sent for a victim the block lets die, at most once per scene, never in free play and never when drama is not negotiated; and no beat is sent
 * twice, however often a player is started or rebuilt.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import { BeatPlayer } from "../director/drama/beat-player.js";
import type { BeatReport } from "../director/drama/beat-player.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { A, B, C, makeRig } from "../testing/drama-rig.js";

const REFS = ["person-1", "person-2", "person-3"] as const;
const WIRE: Record<string, number> = { "person-1": A, "person-2": B, "person-3": C };

type Raw = { at: number; cut: boolean; actor: number; victim: number; verb: "kill" | "slap" | "glare" };
const beatArb: fc.Arbitrary<Raw> = fc.record({ at: fc.integer({ min: 1, max: 240 }), cut: fc.boolean(), actor: fc.integer({ min: 0, max: 2 }), victim: fc.integer({ min: 0, max: 2 }), verb: fc.constantFrom("kill", "slap", "glare") });
const blockArb: fc.Arbitrary<ScenarioDrama | undefined> = fc.option(
  fc.record({
    max_rung: fc.integer({ min: 0, max: 6 }),
    may_target: fc.subarray(REFS.flatMap((a) => REFS.filter((v) => v !== a).map((v): [string, string] => [a, v]))),
    may_die: fc.subarray([...REFS]),
    permadeath: fc.constant(false),
  }),
  { nil: undefined },
);

const toBeats = (raw: readonly Raw[]): ScenarioBeat[] =>
  raw.map((r, i): ScenarioBeat => {
    const id = `b${i + 1}`;
    if (r.cut) return { id, at_ms: r.at * 1000, kind: "cut", reason: `corte-${id}` };
    const actor = REFS[r.actor]!;
    const victim = REFS[(r.actor + 1 + (r.victim % 2)) % 3]!;
    return { id, at_ms: r.at * 1000, kind: "act", actor, verb: r.verb, with: victim, ...(skips(r) ? { authored_skip: true as const } : {}) };
  });
/** Everything above a glare is authored with a skip, the way a script that jumps the ladder is. */
const skips = (r: Raw): boolean => r.verb !== "glare";

/** One settled beat, as the player that settled it reported it. `gen` is 0 for the first player and 1 for the one rebuilt over the same body. */
type Settled = { id: string; gen: number; outcome: BeatReport["outcome"]; why: string };
type Run = {
  kills: Array<{ scene: string; victim: string; actor: string }>;
  acts: number;
  advances: number;
  ids: string[];
  /** The beat id each `scene_advance` was sent for (the cut's reason carries it), in send order. */
  advanced: string[];
  settled: Settled[];
  /** Beats the first player had settled when it was replaced (a rebuilt player is told these) and beats it had not settled that were already more than `pastToleranceMs` late. */
  atRebuild?: { settled: string[]; late: string[] };
};

/**
 * One run of a script on the real director: a second at a time, a scene cut fed back for every `scene_advance` the hotel would honour.
 * `restart` calls `start()` a second time on the live player; `rebuild` replaces the player at 150 s with a new one told the settled ids (a resume).
 */
async function run(raw: readonly Raw[], drama: ScenarioDrama | undefined, o: { negotiated?: boolean; restart?: boolean; rebuild?: boolean } = {}): Promise<Run> {
  const rig = makeRig({ ...(drama ? { block: drama } : {}), ...(o.negotiated === false ? { session: null } : {}) });
  const kills: Run["kills"] = [];
  const settled: Settled[] = [];
  const beats = toBeats(raw);
  const startedAt = rig.clock.now();
  let gen = 0;
  const make = (played?: string[]) =>
    new BeatPlayer({
      startedAt,
      clock: rig.clock,
      port: () => rig.dir,
      beats,
      drama: resolveRunDrama(drama ? { drama } : {}),
      wireOf: (ref) => WIRE[ref],
      ...(played ? { played } : {}),
      onReport: (r) => {
        settled.push({ id: r.beat.id, gen, outcome: r.outcome, why: r.why });
        if (r.outcome === "played" && r.beat.kind === "act" && r.beat.verb === "kill") kills.push({ scene: rig.dir.scene, victim: r.beat.with ?? "", actor: r.beat.actor });
      },
    });
  let player = make();
  player.start();
  if (o.restart) player.start();
  let atRebuild: Run["atRebuild"];
  let cuts = 0;
  for (let s = 0; s < 300; s++) {
    await rig.clock.advance(1000);
    if (rig.link.advances.length > cuts) {
      cuts = rig.link.advances.length;
      rig.cut({ scene: `7.${cuts + 1}`, prev: `7.${cuts}` });
    }
    if (o.rebuild && s === 150) {
      const played = player.playedIds();
      const now = rig.clock.now();
      atRebuild = { settled: played, late: beats.filter((b) => !played.includes(b.id) && startedAt + b.at_ms + DEFAULT_DRAMA_TUNING.beats.pastToleranceMs < now).map((b) => b.id) };
      player.stop();
      gen = 1;
      player = make(played);
      player.start();
    }
  }
  return {
    kills,
    acts: rig.link.acts.length,
    advances: rig.link.advances.length,
    ids: rig.link.acts.map((a) => a.cmd.act_id),
    advanced: rig.link.advances.map((a) => a.reason?.replace(/^corte-/, "") ?? ""),
    settled,
    ...(atRebuild ? { atRebuild } : {}),
  };
}

/**
 * ACT-5, as the beat player keeps it. A beat is sent at most once however the player is started or rebuilt: one `act_id` or one `scene_advance` per
 * beat, and a beat the first player settled is never settled again. What a rebuilt player does NOT do is carry on a beat the first one had not
 * settled and whose time is already past (errata P5-02): it is dropped `past`, never played late, so a resume does not replay the script. A rebuilt
 * run therefore may send fewer frames than an unbroken one (a cut waiting out the 20 s floor when the player is replaced is lost), never more
 * of any beat.
 */
function expectNoBeatSentTwice(r: Run): void {
  expect(new Set(r.ids).size).toBe(r.ids.length);
  expect(new Set(r.advanced).size).toBe(r.advanced.length);
  const played = r.settled.filter((s) => s.outcome === "played").map((s) => s.id);
  expect(new Set(played).size).toBe(played.length);
  const reported = r.settled.map((s) => s.id);
  expect(new Set(reported).size).toBe(reported.length);
}

describe("BeatPlayer properties", () => {
  it("[SCN-3] [LAD-4] a kill is only sent for a victim in may_die, at most once per scene, and never in free play", async () => {
    let sent = 0;
    let free = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(beatArb, { maxLength: 8 }), blockArb, async (raw, drama) => {
        const r = await run(raw, drama);
        sent += r.kills.length;
        if (drama === undefined) free += 1;
        for (const k of r.kills) expect(drama?.may_die).toContain(k.victim);
        if (drama === undefined) expect(r.kills).toEqual([]);
        const perScene = new Map<string, number>();
        for (const k of r.kills) perScene.set(k.scene, (perScene.get(k.scene) ?? 0) + 1);
        for (const n of perScene.values()) expect(n).toBeLessThanOrEqual(1);
      }),
      { numRuns: 60, seed: 20261109 },
    );
    // The generator reaches what the properties are about: kills are sent, and free play is drawn.
    expect(sent).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
  });

  it("when drama is not negotiated no beat sends an act or a scene_advance", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(beatArb, { maxLength: 8 }), blockArb, async (raw, drama) => {
        const r = await run(raw, drama, { negotiated: false });
        expect(r.acts).toBe(0);
        expect(r.advances).toBe(0);
      }),
      { numRuns: 20 },
    );
  });

  it("[ACT-5] no beat is sent twice, however often the player is started or rebuilt over the same body", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(beatArb, { maxLength: 8 }), blockArb, async (raw, drama) => {
        await expectStartedTwiceIsOnce(raw, drama);
        await expectRebuiltNeverResends(raw, drama);
      }),
      { numRuns: 25 },
    );
  });

  // Counterexamples the property found, pinned. Both are a cut waiting out the 20 s floor when the player is rebuilt at 150 s: the rebuilt player
  // drops it as `past` (P5-02) where the old model expected the unbroken run's frame count.
  it("[ACT-5] regression: three cuts at 110 s, a rebuild at 150 s keeps the two already sent and drops the third as past", async () => {
    const cut: Raw = { at: 110, cut: true, actor: 0, victim: 0, verb: "kill" };
    await expectStartedTwiceIsOnce([cut, cut, cut], undefined);
    const rebuilt = await expectRebuiltNeverResends([cut, cut, cut], undefined);
    expect(rebuilt.advanced).toEqual(["b1", "b2"]);
    expect(rebuilt.atRebuild?.late).toEqual(["b3"]);
  });

  it("[ACT-5] regression: two cuts at 131 s, a rebuild at 150 s keeps the first and drops the second as past", async () => {
    const cut: Raw = { at: 131, cut: true, actor: 0, victim: 0, verb: "kill" };
    await expectStartedTwiceIsOnce([cut, cut], undefined);
    const rebuilt = await expectRebuiltNeverResends([cut, cut], undefined);
    expect(rebuilt.advanced).toEqual(["b1"]);
    expect(rebuilt.atRebuild?.late).toEqual(["b2"]);
  });
});

/** `start()` called again on a live player changes nothing at all: the same frames, in the same number, as one start. */
async function expectStartedTwiceIsOnce(raw: readonly Raw[], drama: ScenarioDrama | undefined): Promise<void> {
  const once = await run(raw, drama);
  const twice = await run(raw, drama, { restart: true });
  expect(twice.acts).toBe(once.acts);
  expect(twice.advances).toBe(once.advances);
  expect(twice.advanced).toEqual(once.advanced);
  expectNoBeatSentTwice(twice);
}

/** A player rebuilt at 150 s over the same body re-sends no beat the first one settled, and plays no beat that was already late when it was built. */
async function expectRebuiltNeverResends(raw: readonly Raw[], drama: ScenarioDrama | undefined): Promise<Run> {
  const rebuilt = await run(raw, drama, { rebuild: true });
  expectNoBeatSentTwice(rebuilt);
  const { settled, late } = rebuilt.atRebuild!;
  for (const s of rebuilt.settled.filter((x) => x.gen === 1)) {
    expect(settled).not.toContain(s.id);
    if (late.includes(s.id)) expect(s).toMatchObject({ outcome: "dropped", why: "past" });
  }
  for (const id of late) expect(rebuilt.settled.filter((x) => x.gen === 1 && x.id === id && x.outcome === "played")).toEqual([]);
  return rebuilt;
}
