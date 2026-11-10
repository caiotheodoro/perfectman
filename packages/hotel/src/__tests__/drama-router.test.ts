import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { DRAMA_HOTEL_TYPES, isDramaFrame } from "../director/drama-frames.js";
import type { DramaFrame, DramaHotelType } from "../director/drama-frames.js";
import type { HotelFrame } from "../director/index.js";
import { NOOP_DRAMA_SINK, routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { actFrames, dramaStateFrame, sceneCutFrames } from "../testing/fake-drama.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";
import type { DramaSession } from "../director/dialect.js";

const METHOD: Record<DramaHotelType, keyof DramaFrameSink> = {
  act_started: "onActStarted",
  act_beat: "onActBeat",
  act_reaction: "onActReaction",
  act_done: "onActDone",
  drama_consent: "onDramaConsent",
  actor_death: "onActorDeath",
  actor_revive: "onActorRevive",
  human_down: "onHumanDown",
  human_up: "onHumanUp",
  scene_cut: "onSceneCut",
  drama_state: "onDramaState",
};

type Call = { method: string; frame?: unknown; session?: DramaSession | null };

/** A sink that records every call; the frames it is given are the very objects the router received. */
function recordingSink(): { sink: DramaFrameSink; calls: Call[] } {
  const calls: Call[] = [];
  const handler = (method: string) => (frame: unknown) => void calls.push({ method, frame });
  const sink: DramaFrameSink = {
    onSession: (session) => void calls.push({ method: "onSession", session }),
    onActStarted: handler("onActStarted"),
    onActBeat: handler("onActBeat"),
    onActReaction: handler("onActReaction"),
    onActDone: handler("onActDone"),
    onDramaConsent: handler("onDramaConsent"),
    onActorDeath: handler("onActorDeath"),
    onActorRevive: handler("onActorRevive"),
    onHumanDown: handler("onHumanDown"),
    onHumanUp: handler("onHumanUp"),
    onSceneCut: handler("onSceneCut"),
    onDramaState: handler("onDramaState"),
  };
  return { sink, calls };
}

/** One sample of every frame the contract adds, built the way the fake hotel plays them. */
function samples(): DramaFrame[] {
  const act = actFrames({ actId: "a1", verb: "kill", with: -702, outcome: "landed", chip: false, witnesses: [-703], owed: [{ who: -703, role: "witness" }], reactions: [{ who: -703, role: "witness", reaction: "freeze_gasp" }], death: { victim: -702, killer: -701 } });
  const human = actFrames({ actId: "a2", verb: "kill", with: 9, outcome: "landed", chip: true, answer: "take", death: { victim: 9, killer: -701, human: true } });
  const frames = [...act, ...human, ...sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702] }), dramaStateFrame({})];
  return frames.map((f, i) => ({ ...f, seq: i + 1 }) as DramaFrame);
}

describe("the frame router skeleton", () => {
  it("[FRM-4] routes each of the eleven drama frames to its typed handler, once, with the frame itself", () => {
    const all = samples();
    expect(new Set(all.map((f) => f.t))).toEqual(new Set(DRAMA_HOTEL_TYPES));
    for (const frame of all) {
      const { sink, calls } = recordingSink();
      routeDramaFrame(frame, sink);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe(METHOD[frame.t]);
      expect(calls[0]?.frame).toBe(frame);
    }
  });

  it("[FRM-4] has one method per frame type and one frame type per method (no handler is shared or missing)", () => {
    expect(Object.keys(METHOD).sort()).toEqual([...DRAMA_HOTEL_TYPES].sort());
    expect(new Set(Object.values(METHOD)).size).toBe(DRAMA_HOTEL_TYPES.length);
    expectTypeOf<DramaHotelType>().toEqualTypeOf<DramaFrame["t"]>();
    expectTypeOf<DramaFrame>().toMatchTypeOf<HotelFrame>();
  });

  it("[FRM-1] hands a whole act over in the order the hotel emitted it", () => {
    const { sink, calls } = recordingSink();
    for (const f of actFrames({ actId: "a17", verb: "slap", with: 9, outcome: "landed", chip: true, answer: "take", witnesses: [-702], owed: [{ who: -702, role: "witness" }], reactions: [{ who: -702, role: "witness", reaction: "freeze_gasp" }] })) {
      routeDramaFrame({ ...f, seq: 1 } as DramaFrame, sink);
    }
    expect(calls.map((c) => c.method)).toEqual(["onActStarted", "onDramaConsent", "onDramaConsent", "onActBeat", "onActReaction", "onActDone"]);
  });

  it("[FRM-2] a blocked act is one act_done and no other handler runs", () => {
    const { sink, calls } = recordingSink();
    for (const f of actFrames({ actId: "b1", verb: "punch", with: 9, outcome: "blocked", reason: "consent_off" })) routeDramaFrame({ ...f, seq: 1 } as DramaFrame, sink);
    expect(calls.map((c) => c.method)).toEqual(["onActDone"]);
  });

  it("[SCENE-4] [DEATH-7] hands over scene_cut before the actor_revive it causes, and actor_gone{died} is not a drama frame", () => {
    const frames = sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702], removed: [-703] });
    expect(frames.map((f) => f.t)).toEqual(["scene_cut", "actor_revive", "actor_gone"]);
    expect(isDramaFrame({ ...frames[2]!, seq: 1 } as HotelFrame)).toBe(false);
    expect(isDramaFrame({ ...frames[0]!, seq: 1 } as HotelFrame)).toBe(true);
  });

  it("the no-op sink reads every frame and does nothing", () => {
    for (const frame of samples()) expect(routeDramaFrame(frame, NOOP_DRAMA_SINK)).toBeUndefined();
  });
});

let fake: FakeDirector | undefined;
const sidecars: Sidecar[] = [];
afterEach(async () => {
  for (const s of sidecars.splice(0)) await s.close();
  await fake?.stop();
  fake = undefined;
});

async function boot(o: { offer?: boolean }) {
  const { sink, calls } = recordingSink();
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, ...(o.offer ? { drama: { dead: [-702] } } : {}) });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const booted = await bootSidecar({ fake, dramaSink: sink });
  sidecars.push(booted.sidecar);
  return { calls, ...booted };
}

describe("a drama-capable sidecar against a hotel that offers nothing", () => {
  it("[VV-6] connects as PROTO 1, starts a run and spawns its cast exactly as before", async () => {
    const booted = await bootSidecar();
    sidecars.push(booted.sidecar);
    fake = booted.fake;
    const hotel = booted.fake;
    expect(hotel.ack).toMatchObject({ proto: 1 });
    expect(hotel.ack?.caps).toBeUndefined();
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
    expect(hotel.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "act")).toBe(false);
  });
});

describe("the manager routes the frames of a dialect 2 link", () => {
  it("[FRM-4] [NEG-5] sends every drama frame of a negotiated link to the sink, in order, and the session first", async () => {
    const { fake: hotel, calls } = await boot({ offer: true });
    await waitFor(() => hotel.dialect === 2, "dialect 2");
    expect(calls[0]).toEqual({ method: "onSession", session: { enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [-702] } });
    hotel.scriptAct({ actId: "a1", verb: "slap", with: -702, outcome: "landed", chip: false, witnesses: [-703], owed: [{ who: -703, role: "witness" }] });
    hotel.scriptSceneCut({ scene: "7.3", prev: "7.2", revived: [-702] });
    await waitFor(() => calls.some((c) => c.method === "onActorRevive"), "the revive");
    expect(calls.map((c) => c.method).slice(1)).toEqual(["onActStarted", "onActBeat", "onActDone", "onSceneCut", "onActorRevive"]);
  });

  it("[NEG-5] reads and drops them when the link is dialect 1, and with no sink at all", async () => {
    const { fake: hotel, calls } = await boot({ offer: false });
    expect(calls).toEqual([{ method: "onSession", session: null }]);
    hotel.scriptAct({ actId: "a1", verb: "slap", with: -702, outcome: "landed" }, { force: true });
    hotel.send({ t: "lease", run: 99, lease: 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual([{ method: "onSession", session: null }]);
  });

  it("[NEG-9] after a resumed run's lease the sink gets one drama_state per room, and a replacement dead set from the new hello", async () => {
    const { fake: hotel, calls } = await boot({ offer: true });
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
    await waitFor(() => hotel.avatarByRef("person-1", 7), "an actor in the room");
    calls.length = 0;
    hotel.offer = { dead: [] };
    hotel.dropConnection();
    await waitFor(() => calls.some((c) => c.method === "onDramaState"), "the drama_state after the resume", 8000);
    expect(calls.map((c) => c.method).slice(0, 2)).toEqual(["onSession", "onDramaState"]);
    expect(calls[0]).toMatchObject({ session: { dead: [] } });
    expect(calls[1]?.frame).toMatchObject({ t: "drama_state", run: 7, room: 12, scene: "7.1", enabled: true, calm: false, paused: false, opt_in: [9] });
  }, 20_000);
});
