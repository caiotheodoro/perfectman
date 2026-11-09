import type { ActVerb } from "@perfectman/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ActLedger } from "../embodiment/act-ledger.js";
import type { OwedDebt } from "../embodiment/act-ledger.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import { isReplaceable } from "../embodiment/reactions.js";
import { ReactionScheduler } from "../embodiment/reaction-scheduler.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames } from "../testing/fake-drama.js";
import { agentState } from "../testing/fixtures.js";
import { avatar, snapshot } from "../testing/fixtures.js";
import { ManualClock } from "../testing/manual-clock.js";

const CAST = ["duda", "rafa", "gabi", "leo", "bia", "caro"] as const;
const WIRE = Object.fromEntries(CAST.map((r, i) => [r, -(701 + i)])) as Record<(typeof CAST)[number], number>;
const REF = new Map<number, string>([...CAST.map((r) => [WIRE[r], r] as const), [9, "h:9"]]);
const TILES: Record<string, [number, number]> = { duda: [3, 3], rafa: [4, 3], gabi: [6, 4], leo: [3, 6], bia: [8, 5], caro: [2, 5] };
const ZERO = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

const VERBS = ["glare", "insult", "shove", "slap", "punch", "kill", "hug", "kiss", "faint", "die"] as const satisfies readonly ActVerb[];
const QUALIFYING = new Set(["face", "expression", "action", "act", "sit", "walk", "move_room", "appearance"]);

type Scene = { verb: (typeof VERBS)[number]; actor: number; target: number; witnesses: number[]; at: number; tableLate: boolean; leaves: number | null; feelings: number };

const sceneArb: fc.Arbitrary<Scene> = fc.record({
  verb: fc.constantFrom(...VERBS),
  actor: fc.integer({ min: 0, max: 5 }),
  target: fc.integer({ min: 0, max: 6 }),
  witnesses: fc.subarray([0, 1, 2, 3, 4, 5]),
  at: fc.integer({ min: 0, max: 1500 }),
  tableLate: fc.boolean(),
  leaves: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  feelings: fc.integer({ min: 0, max: 3 }),
});

/** One run of the whole planner side against scripted hotel frames: a ledger, the reaction scheduler and the real executor on a manual clock. */
async function play(scenes: Scene[]) {
  const clock = new ManualClock(50_000);
  const mirror = new HotelSpaceMirror();
  let rev = 1;
  const roomAvatars = [...CAST.map((r) => avatar(WIRE[r], r, TILES[r]![0], TILES[r]![1])), avatar(9, "ana", 7, 7)];
  const refresh = (): void => mirror.applySnapshot(snapshot(12, ++rev, roomAvatars), clock.now());
  refresh();
  for (const r of CAST) mirror.registerActor({ ref: r, id: WIRE[r], run: 7, name: r }, "12", clock.now());
  const sent: Array<{ at: number; who: string; k: string }> = [];
  const exec = new BodyExecutor({
    run: 7, clock, rng: () => 0.5, mirror, lease: () => 3, nextCid: () => sent.length + 1,
    send: (m) => {
      if (m.t === "actor_cmd") sent.push({ at: clock.now(), who: REF.get(m.actor) ?? "?", k: m.cmd.k });
      return true;
    },
    hooks: { blocked: () => undefined, arrived: () => undefined, pairAborted: () => undefined, pairOutcome: () => undefined },
  });
  const debts: Array<OwedDebt & { beatAt: number; settledAt?: number; leftAt?: number }> = [];
  const ledger: ActLedger = new ActLedger({
    refOf: (id) => REF.get(id) ?? `h:${id}`, near: () => [], now: () => clock.now(),
    hooks: { beat: (f, owed) => { for (const o of owed) debts.push({ ...o, beatAt: clock.now() }); sched.onBeat(f, owed); } },
  });
  let n = 0;
  const sched = new ReactionScheduler({
    clock, ledger, isOwn: (ref) => (CAST as readonly string[]).includes(ref),
    state: (ref) => ({ agentState: agentState({ rel: ref === "gabi" ? { duda: { threat: 0.9 } } : {} }), actionEmotions: { ...ZERO, defensiveness: ref === "leo" ? 0.8 : 0, vulnerableRetreat: ref === "bia" ? 0.9 : 0 } }),
    presence: (ref) => mirror.presenceOf(ref),
    nextActId: () => `pr${++n}`,
    send: (cmds) => exec.send(cmds),
  });

  const timeline: Array<{ t: number; run: () => void }> = [];
  scenes.forEach((s, i) => {
    const actor = WIRE[CAST[s.actor]!];
    const target = s.target === 6 ? 9 : WIRE[CAST[s.target]!];
    const solo = verbIsSolo(s.verb);
    if (!solo && target === actor) return;
    const witnesses = s.witnesses.map((w) => WIRE[CAST[w]!]).filter((w) => w !== actor && w !== (solo ? undefined : target));
    const owedWitness = s.verb !== "hug" && s.verb !== "kiss";
    const owed = [
      ...(!solo && target < 0 && s.verb !== "hug" ? [{ who: target, role: "target" as const }] : []),
      ...(owedWitness ? witnesses.map((who) => ({ who, role: "witness" as const })) : []),
    ];
    // What the table would do if the sidecar did nothing: always for a label it will not let the planner replace; at 700 ms or much later for the rest.
    const tableReactions = owed.filter((o) => !isReplaceable(s.verb, o.role)).map((o) => ({ who: o.who, role: o.role, reaction: "stagger" }));
    const frames = actFrames({ actId: `s${i}`, verb: s.verb, actor, ...(solo ? {} : { with: target }), outcome: "landed", at: 50_000 + s.at, witnesses, owed, reactions: tableReactions });
    const at = s.at;
    timeline.push({ t: at, run: () => feedFrames(ledger, frames.slice(0, 2)) });
    frames.slice(2, -1).forEach((f, k) => timeline.push({ t: at + 800 + k * 10, run: () => feedFrames(ledger, [f]) }));
    if (s.leaves !== null) timeline.push({ t: at + 100, run: () => ledger.onGone(CAST[s.leaves!]!, false) });
    timeline.push({ t: at + 3300, run: () => feedFrames(ledger, frames.slice(-1)) });
  });
  timeline.sort((a, b) => a.t - b.t);
  let now = 0;
  for (const ev of timeline) {
    await clock.advance(Math.max(0, ev.t - now));
    now = Math.max(now, ev.t);
    refresh();
    ev.run();
  }
  for (let t = 0; t < 4000; t += 100) {
    await clock.advance(100);
    refresh();
  }
  return { debts, sent, ledger };
}

const verbIsSolo = (v: ActVerb): boolean => v === "faint" || v === "die";

describe("properties of the reaction obligations (REA-1, REA-3, REA-10)", () => {
  it("[REA-1] [REA-10] property: no actor with an unmet owed debt idles past its deadline, however the acts and the table's replies fall; a debt the actor left behind is the only excuse", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(sceneArb, { minLength: 1, maxLength: 5 }), async (scenes) => {
        const { debts, sent } = await play(scenes);
        for (const d of debts) {
          const replaceable = isReplaceable(d.verb, d.role);
          if (!replaceable) continue; // the table's own reaction is certain for these (REA-10); the planner must not need to act
          const due = d.receivedAt + d.dueInMs;
          const answered = sent.some((s) => s.who === d.who && QUALIFYING.has(s.k) && s.at >= d.receivedAt && s.at <= due);
          const left = scenes.some((s) => s.leaves !== null && CAST[s.leaves] === d.who);
          if (!answered && !left) throw new Error(`${d.who} owed ${d.verb} (${d.actId}) until ${due - d.receivedAt} ms and sent nothing: ${JSON.stringify(sent.filter((s) => s.who === d.who))}`);
        }
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it("[REA-3] property: a reactor sends at most one command per debt, so a table reaction never meets a second planner command", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(sceneArb, { minLength: 1, maxLength: 4 }), async (scenes) => {
        const { debts, sent } = await play(scenes);
        for (const who of CAST) {
          const mine = debts.filter((d) => d.who === who && isReplaceable(d.verb, d.role)).length;
          expect(sent.filter((s) => s.who === who).length).toBeLessThanOrEqual(mine);
        }
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});
