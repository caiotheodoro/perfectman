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
    if (r.cut) return { id, at_ms: r.at * 1000, kind: "cut", reason: "corte" };
    const actor = REFS[r.actor]!;
    const victim = REFS[(r.actor + 1 + (r.victim % 2)) % 3]!;
    return { id, at_ms: r.at * 1000, kind: "act", actor, verb: r.verb, with: victim, ...(skips(r) ? { authored_skip: true as const } : {}) };
  });
/** Everything above a glare is authored with a skip, the way a script that jumps the ladder is. */
const skips = (r: Raw): boolean => r.verb !== "glare";

type Run = { kills: Array<{ scene: string; victim: string; actor: string }>; acts: number; advances: number; ids: string[] };

/** One run of a script on the real director: a second at a time, a scene cut fed back for every `scene_advance` the hotel would honour. */
async function run(raw: readonly Raw[], drama: ScenarioDrama | undefined, o: { negotiated?: boolean; twice?: boolean } = {}): Promise<Run> {
  const rig = makeRig({ ...(drama ? { block: drama } : {}), ...(o.negotiated === false ? { session: null } : {}) });
  const kills: Run["kills"] = [];
  const beats = toBeats(raw);
  const startedAt = rig.clock.now();
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
        if (r.outcome === "played" && r.beat.kind === "act" && r.beat.verb === "kill") kills.push({ scene: rig.dir.scene, victim: r.beat.with ?? "", actor: r.beat.actor });
      },
    });
  let player = make();
  player.start();
  if (o.twice) player.start();
  let cuts = 0;
  for (let s = 0; s < 300; s++) {
    await rig.clock.advance(1000);
    if (rig.link.advances.length > cuts) {
      cuts = rig.link.advances.length;
      rig.cut({ scene: `7.${cuts + 1}`, prev: `7.${cuts}` });
    }
    if (o.twice && s === 150) {
      // A resume: the player is rebuilt over the same body and told what was played.
      const played = player.playedIds();
      player.stop();
      player = make(played);
      player.start();
    }
  }
  return { kills, acts: rig.link.acts.length, advances: rig.link.advances.length, ids: rig.link.acts.map((a) => a.cmd.act_id) };
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
        const once = await run(raw, drama);
        const again = await run(raw, drama, { twice: true });
        expect(again.acts).toBe(once.acts);
        expect(again.advances).toBe(once.advances);
        expect(new Set(again.ids).size).toBe(again.ids.length);
      }),
      { numRuns: 25 },
    );
  });
});
