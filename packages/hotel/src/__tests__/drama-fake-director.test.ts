import { afterEach, describe, expect, it } from "vitest";
import { DirectorClient } from "../director/director-client.js";
import type { HotelFrame } from "../director/index.js";
import { nodeSocketFactory } from "../director/transport.js";
import { contractExamples } from "../testing/contract-examples.js";
import { FakeDirector } from "../testing/fake-director.js";
import { actFrames, dramaStateFrame, sceneCutFrames } from "../testing/fake-drama.js";
import { checkFrame } from "../testing/frame-schema.js";
import { TEST_SECRET, waitFor } from "../testing/helpers.js";
import { ManualClock } from "../testing/manual-clock.js";

const examples = contractExamples().filter((e) => e.direction === "hotel_to_sidecar");

/** The contract's example frame of type `t` with the given fields; `seq` and the instants are not compared (the hotel's own comparison ignores them too). */
function example(t: string, match: Record<string, unknown>): Record<string, unknown> {
  const hit = examples.find((e) => e.frame["t"] === t && Object.entries(match).every(([k, v]) => e.frame[k] === v));
  if (!hit) throw new Error(`no example ${t} ${JSON.stringify(match)} in the contract`);
  return hit.frame;
}

const stripTimes = (frame: object): unknown => {
  const { seq: _seq, at: _at, ...rest } = frame as Record<string, unknown>;
  const owed = Array.isArray(rest["owed"]) ? (rest["owed"] as Record<string, unknown>[]).map(({ due_at: _due, ...o }) => o) : undefined;
  return owed ? { ...rest, owed } : rest;
};

const atOf = (frame: object | undefined): number => (frame as { at: number }).at;

const same = (built: object, wanted: Record<string, unknown>): void => expect(stripTimes(built)).toEqual(stripTimes(wanted));

describe("the fake director scripts the contract's own examples", () => {
  it("[FRM-1] the chipped slap on human 9 (act a17) is exactly the five hotel frames of the contract, in order", () => {
    const frames = actFrames({
      actId: "a17", verb: "slap", with: 9, intensity: 0.6, chip: true, answer: "take", outcome: "landed",
      witnesses: [-703, -702, 11], owed: [{ who: -702, role: "witness" }, { who: -703, role: "witness" }],
      reactions: [{ who: -702, role: "witness", reaction: "freeze_gasp" }],
    });
    expect(frames.map((f) => f.t)).toEqual(["act_started", "drama_consent", "drama_consent", "act_beat", "act_reaction", "act_done"]);
    same(frames[0]!, example("act_started", { act_id: "a17" }));
    same(frames[1]!, example("drama_consent", { act_id: "a17", phase: "shown" }));
    same(frames[2]!, example("drama_consent", { act_id: "a17", phase: "answered" }));
    same(frames[3]!, example("act_beat", { act_id: "a17" }));
    same(frames[4]!, example("act_reaction", { act_id: "a17" }));
    same(frames[5]!, example("act_done", { act_id: "a17" }));
  });

  it("[FRM-2] [CHIP-1] the blocked acts of the contract are one act_done each: punch on an opted-out human, and free-play slap on an actor", () => {
    const consentOff = actFrames({ actId: "a18", verb: "punch", with: 9, outcome: "blocked", reason: "consent_off" });
    const freePlay = actFrames({ actId: "a19", verb: "slap", with: -702, outcome: "blocked", reason: "no_scenario_gate", detail: "free_play" });
    expect(consentOff).toHaveLength(1);
    same(consentOff[0]!, example("act_done", { act_id: "a18" }));
    same(freePlay[0]!, example("act_done", { act_id: "a19" }));
  });

  it("[DEATH-1] [DOWN-3] a killed actor is actor_death and a killed human is human_down then, a window later, human_up", () => {
    const actor = actFrames({ actId: "a20", verb: "kill", with: -702, outcome: "landed", death: { victim: -702, killer: -701 } });
    same(actor.find((f) => f.t === "actor_death")!, example("actor_death", { act_id: "a20" }));
    expect(actor.some((f) => f.t === "human_down")).toBe(false);
    const human = actFrames({ actId: "a21", verb: "kill", with: 9, outcome: "landed", chip: true, answer: "take", death: { victim: 9, killer: -701, human: true } });
    same(human.find((f) => f.t === "human_down")!, example("human_down", { act_id: "a21" }));
    same(human.find((f) => f.t === "human_up")!, example("human_up", { act_id: "a21" }));
    expect(human.some((f) => f.t === "actor_death")).toBe(false);
    const down = human.find((f) => f.t === "human_down");
    const up = human.find((f) => f.t === "human_up");
    expect(atOf(up) - atOf(down)).toBe(5000);
    expect(human.at(-1)?.t).toBe("human_up");
  });

  it("[SCENE-4] [DEATH-7] a cut is scene_cut then actor_revive, as the contract shows them; a permadeath actor is actor_gone{died}", () => {
    const [cut, revive] = sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702] });
    same(cut!, example("scene_cut", { scene: "7.3" }));
    same(revive!, example("actor_revive", { actor: -702 }));
    const perma = sceneCutFrames({ scene: "7.3", prev: "7.2", removed: [-702] });
    expect(perma.map((f) => f.t)).toEqual(["scene_cut", "actor_gone"]);
    expect(perma[1]).toMatchObject({ actor: -702, run: 7, reason: "died" });
  });

  it("[NEG-9] the drama_state frames are the contract's, the paused one with paused_until", () => {
    same(dramaStateFrame({ scene: "7.2", optIn: [9] }), example("drama_state", { paused: false }));
    same(dramaStateFrame({ scene: "7.2", optIn: [9], paused: true, pausedUntil: 1730000900000 }), example("drama_state", { paused: true }));
  });

  it("[FRM-1] a dodged or declined chipped act never reaches contact: no act_beat, and the chip answer is on act_done", () => {
    for (const outcome of ["dodged", "declined"] as const) {
      const frames = actFrames({ actId: "a30", verb: "slap", with: 9, chip: true, answer: outcome === "dodged" ? "dodge" : "push_back", outcome });
      expect(frames.map((f) => f.t)).toEqual(["act_started", "drama_consent", "drama_consent", "act_done"]);
      expect(frames.at(-1)).toMatchObject({ outcome, answer: outcome === "dodged" ? "dodge" : "push_back" });
    }
    const timeout = actFrames({ actId: "a31", verb: "slap", with: 9, chip: true, answer: "timeout", outcome: "dodged" });
    const shown = timeout.find((f) => f.t === "drama_consent" && f.phase === "shown");
    const answered = timeout.find((f) => f.t === "drama_consent" && f.phase === "answered");
    expect(atOf(answered) - atOf(shown)).toBe(4000);
  });

  it("[CHIP-3] [CHIP-5] a hug on a human who stayed silent ends timeout, and reaches contact (the initiator's steps complete)", () => {
    const frames = actFrames({ actId: "a32", verb: "hug", with: 9, chip: true, answer: "timeout", outcome: "timeout" });
    expect(frames.map((f) => f.t)).toEqual(["act_started", "drama_consent", "drama_consent", "act_beat", "act_done"]);
    expect(frames[1]).toMatchObject({ family: "affection" });
    expect(frames.at(-1)).toMatchObject({ outcome: "timeout", answer: "timeout" });
  });

  it("[REA-2] a solo verb has no target on any of its frames", () => {
    for (const f of actFrames({ actId: "a40", verb: "faint", with: 9, outcome: "landed", witnesses: [-702] })) expect(f, f.t).not.toHaveProperty("with");
  });

  it("every frame any script builds parses against the generated types' schema", () => {
    const scripts = [
      actFrames({ actId: "s1", verb: "kill", with: -702, outcome: "landed", chip: false, witnesses: [-703], owed: [{ who: -702, role: "target" }], reactions: [{ who: -702, role: "target", reaction: "die" }], death: { victim: -702, killer: -701 } }),
      actFrames({ actId: "s2", verb: "punch", with: 9, chip: true, answer: "take", outcome: "landed" }),
      actFrames({ actId: "s3", verb: "slap", with: 9, outcome: "aborted", reason: "calm_room" }),
      actFrames({ actId: "s4", verb: "cry", outcome: "landed" }),
      sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702], removed: [-703] }),
      [dramaStateFrame({ paused: true, pausedUntil: 1 })],
    ].flat();
    for (const f of scripts) expect(checkFrame("hotel_to_sidecar", f), JSON.stringify(f)).toEqual({ ok: true, errors: [] });
  });
});

describe("the fake hotel as a link", () => {
  let fake: FakeDirector | undefined;
  let client: DirectorClient | undefined;
  afterEach(async () => {
    client?.stop();
    await fake?.stop();
    client = fake = undefined;
  });

  it("[NEG-5] [ACT-1] plays an act lifecycle to a dialect 2 client and answers an act command with it (autoAct), seq by seq", async () => {
    fake = await FakeDirector.start({ secret: TEST_SECRET, drama: {}, autoAct: true });
    fake.addRoom(12);
    const frames: HotelFrame[] = [];
    client = new DirectorClient({
      url: fake.url, secret: TEST_SECRET, clock: new ManualClock(), socketFactory: nodeSocketFactory, rng: () => 0.5, sidecar: { version: "1", build: "t" },
      handlers: { onHello: () => [], onFrame: (f) => frames.push(f), onConnectionChange: () => undefined },
    });
    client.start();
    await waitFor(() => fake?.dialect === 2, "dialect 2");
    fake.grantLease(7, 3);
    await waitFor(() => client?.leaseOf(7) === 3, "the lease");
    fake.addHuman(12, 9, "ana", 6, 5);
    fake.rooms.get(12)?.avatars.set(-701, { id: -701, name: "Duda", x: 1, y: 1, dir: 2, state: "stand", ref: "person-1", run: 7 });
    client.trackRun(7);
    expect(client.sendAct({ run: 7, actor: -701, cmd: { k: "act", act_id: "a1", verb: "glare", with: 9, intensity: 0.4 } })).toMatchObject({ sent: true });
    await waitFor(() => frames.some((f) => f.t === "act_done"), "the act lifecycle");
    expect(fake.acts).toHaveLength(1);
    expect(frames.filter((f) => ["act_started", "act_beat", "act_done"].includes(f.t)).map((f) => f.t)).toEqual(["act_started", "act_beat", "act_done"]);
    expect(frames.find((f) => f.t === "act_started")).toMatchObject({ act_id: "a1", verb: "glare", actor: -701, with: 9, intensity: 0.4, run: 7 });
    const seqs = frames.map((f) => f.seq);
    expect(seqs).toEqual(seqs.map((_s, i) => (seqs[0] ?? 0) + i));
  });
});
