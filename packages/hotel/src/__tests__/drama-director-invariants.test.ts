import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACT_VERBS, PHYSICAL_VERBS, ladderRung } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";
import { A, B, C, H, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";

/**
 * Properties over random play: whatever the model proposes, the director's own passes decide, and what it sends obeys the
 * contract's budgets. The hotel here always accepts what it is sent (the world is a script), so the director's copy of the
 * counters is the only thing standing between a random sequence and a budget breach.
 */

const HOT = emotion({ dominanceAssertion: 1, impulsiveProvocation: 1, resentfulColdness: 1, contemptuousDismissal: 1, defensiveness: 1, shameWithdrawal: 1 });
const ACTORS = [A, B, C] as const;
const TARGETS = [A, B, C, H] as const;

type Op =
  | { t: "ask"; actor: number; verb: ActVerb; target: number; scenario: boolean; skip: boolean; passive: boolean }
  | { t: "adv"; ms: number }
  | { t: "cut" }
  | { t: "settle" }
  | { t: "state"; calm: boolean; optIn: boolean };

const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ t: fc.constant("ask" as const), actor: fc.constantFrom(...ACTORS), verb: fc.constantFrom(...ACT_VERBS), target: fc.constantFrom(...TARGETS), scenario: fc.boolean(), skip: fc.boolean(), passive: fc.boolean() }) },
  // Authored physical beats, so the budgets are leaned on far more often than random verbs would manage.
  { weight: 6, arbitrary: fc.record({ t: fc.constant("ask" as const), actor: fc.constantFrom(...ACTORS), verb: fc.constantFrom(...PHYSICAL_VERBS), target: fc.constantFrom(...TARGETS), scenario: fc.constant(true), skip: fc.constant(true), passive: fc.constant(false) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("ask" as const), actor: fc.constantFrom(A, C), verb: fc.constant("kill" as ActVerb), target: fc.constantFrom(B, H), scenario: fc.constant(true), skip: fc.constant(true), passive: fc.constant(false) }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("adv" as const), ms: fc.constantFrom(0, 400, 5_000, 19_999, 20_000, 59_999, 61_000) }) },
  { weight: 1, arbitrary: fc.constant({ t: "cut" as const }) },
  { weight: 3, arbitrary: fc.constant({ t: "settle" as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("state" as const), calm: fc.boolean(), optIn: fc.boolean() }) },
);

type Sent = { actId: string; actor: number; verb: ActVerb; target: number | undefined; origin: string; skip: boolean; at: number; scene: string };

const VIOLENT: readonly ActVerb[] = ["shove", "slap", "punch", "kill", "insult"];
const SOLO = new Set<ActVerb>(["die", "recoil", "freeze_gasp", "cry", "storm_off", "tableau", "faint"]);

/** Plays the ops against a director and returns every act it sent, with the instant and the scene it was sent in. */
async function play(ops: readonly Op[], free: boolean): Promise<{ sent: Sent[]; humanViolence: Sent[] }> {
  const rig = makeRig(free ? {} : { block: WIDE_BLOCK });
  const sent: Sent[] = [];
  const open: Sent[] = [];
  const humanViolence: Sent[] = [];
  let scene = 1;
  let optedIn = true;
  for (const o of ops) {
    if (o.t === "adv") await rig.clock.advance(o.ms);
    else if (o.t === "cut") {
      rig.cut({ scene: `7.${scene + 1}`, prev: `7.${scene}` });
      scene++;
    } else if (o.t === "settle") {
      for (const s of open.splice(0)) rig.act({ actId: s.actId, verb: s.verb, actor: s.actor, ...(s.target !== undefined ? { with: s.target } : {}), outcome: "landed" });
    } else if (o.t === "state") {
      optedIn = o.optIn;
      rig.state({ calm: o.calm, optIn: o.optIn ? [H] : [] });
    } else {
      const before = rig.link.acts.length;
      const target = SOLO.has(o.verb) ? undefined : o.target;
      if (o.passive) rig.dir.decide({ actor: o.actor, emotion: HOT });
      else rig.dir.decide({ actor: o.actor, proposal: { verb: o.verb, ...(target !== undefined ? { with: target } : {}), origin: o.scenario ? "scenario" : "model", ...(o.skip ? { authoredSkip: true } : {}) }, ...(o.scenario && o.skip ? {} : { emotion: HOT }) });
      for (const a of rig.link.acts.slice(before)) {
        const s: Sent = { actId: a.cmd.act_id, actor: a.actor, verb: a.cmd.verb, target: a.cmd.with ?? undefined, origin: a.cmd.origin ?? "director", skip: a.cmd.authored_skip === true, at: rig.clock.now(), scene: `7.${scene}` };
        sent.push(s);
        open.push(s);
        if (s.target === H && VIOLENT.includes(s.verb) && !optedIn) humanViolence.push(s);
      }
    }
  }
  return { sent, humanViolence };
}

const ops = fc.array(op, { minLength: 1, maxLength: 70 });
const RUNS = { numRuns: 600 };

describe("ladder and budget invariants over random play", () => {
  it("[LAD-4] never more than one kill per scene, whatever its origin", async () => {
    await fc.assert(
      fc.asyncProperty(ops, fc.boolean(), async (seq, free) => {
        const { sent } = await play(seq, free);
        const perScene = new Map<string, number>();
        for (const s of sent) if (s.verb === "kill") perScene.set(s.scene, (perScene.get(s.scene) ?? 0) + 1);
        expect([...perScene.values()].every((n) => n <= 1)).toBe(true);
      }),
      RUNS,
    );
  });

  it("[LAD-3] never two physical beats less than 20 s apart in one scene", async () => {
    await fc.assert(
      fc.asyncProperty(ops, fc.boolean(), async (seq, free) => {
        const { sent } = await play(seq, free);
        const physical = sent.filter((s) => (PHYSICAL_VERBS as readonly string[]).includes(s.verb));
        for (const scene of new Set(physical.map((s) => s.scene))) {
          const times = physical.filter((s) => s.scene === scene).map((s) => s.at).sort((x, y) => x - y);
          for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(20_000);
        }
      }),
      RUNS,
    );
  });

  it("[LAD-2] never a rung jump without an authored skip", async () => {
    await fc.assert(
      fc.asyncProperty(ops, fc.boolean(), async (seq, free) => {
        const { sent } = await play(seq, free);
        const top = new Map<string, number>();
        for (const s of sent) {
          const r = ladderRung(s.verb);
          if (r === undefined || s.target === undefined) continue;
          const key = `${s.scene}|${s.actor}|${s.target}`;
          const cur = top.get(key) ?? 0;
          if (r > Math.max(cur, 1) + 1) {
            expect(s.skip).toBe(true);
            expect(s.origin).toBe("scenario");
          }
          top.set(key, Math.max(cur, r));
        }
      }),
      RUNS,
    );
  });

  it("[SCN-1] free play: nothing above rung 3, no kill and no die is ever sent, and no skip", async () => {
    await fc.assert(
      fc.asyncProperty(ops, async (seq) => {
        const { sent } = await play(seq, true);
        for (const s of sent) {
          expect(ladderRung(s.verb) ?? 0).toBeLessThanOrEqual(3);
          expect(["kill", "die"]).not.toContain(s.verb);
          expect(s.skip).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("[GATE-6] never a violent act at a human who has not opted in", async () => {
    await fc.assert(
      fc.asyncProperty(ops, fc.boolean(), async (seq, free) => {
        expect((await play(seq, free)).humanViolence).toEqual([]);
      }),
      RUNS,
    );
  });

  it("[ACT-4] [ACT-5] every act id is unique and every verb and field is inside the contract", async () => {
    await fc.assert(
      fc.asyncProperty(ops, fc.boolean(), async (seq, free) => {
        const { sent } = await play(seq, free);
        expect(new Set(sent.map((s) => s.actId)).size).toBe(sent.length);
        for (const s of sent) {
          expect(ACT_VERBS).toContain(s.verb);
          expect(s.actor).not.toBe(s.target);
        }
      }),
      RUNS,
    );
  });

  it("[LAD-5] [SCN-3] no kill is sent without the scenario's own say: only at someone in may_die", async () => {
    await fc.assert(
      fc.asyncProperty(ops, async (seq) => {
        const { sent } = await play(seq, false);
        for (const s of sent.filter((x) => x.verb === "kill")) expect([B, H]).toContain(s.target);
      }),
      RUNS,
    );
  });

  it("[ACT-12] no actor is ever sent a second act while its first is open", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(A, B, C), { minLength: 2, maxLength: 12 }), async (actors) => {
        const rig = makeRig({ block: WIDE_BLOCK });
        const open = new Set<number>();
        for (const a of actors) {
          const d = rig.dir.decide({ actor: a, emotion: HOT });
          if (d.kind === "initiate") {
            expect(open.has(a)).toBe(false);
            open.add(a);
          }
          await rig.clock.advance(7_000);
        }
      }),
      RUNS,
    );
  });
});
