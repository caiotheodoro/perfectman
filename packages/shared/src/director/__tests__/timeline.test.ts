import { describe, expect, it } from "vitest";
import { catReplay } from "./fixtures/cat-replay.js";
import { buildTimeline, STAGE } from "../timeline.js";
import { sampleTimeline, stripOmniscient } from "../sample.js";
import { PACES } from "../timing.js";
import type { DirectorReplay } from "../types.js";

const replay: DirectorReplay = catReplay();
const T = buildTimeline(replay);

describe("buildTimeline on the cat run", () => {
  it("builds the same timeline every time", () => {
    const again = buildTimeline(replay);

    expect(JSON.stringify(again.msgs.map((m) => [m.s0, m.readEnd]))).toBe(JSON.stringify(T.msgs.map((m) => [m.s0, m.readEnd])));
    expect(again.duration).toBe(T.duration);
  });

  it("has one message per spoken line and a duration set by the reading", () => {
    expect(T.msgs).toHaveLength(43);
    expect(T.duration).toBeGreaterThan(T.wordTotal / PACES.normal);
  });

  it("never asks a viewer to read two balloons at once", () => {
    for (let i = 1; i < T.msgs.length; i++) {
      const prev = T.msgs[i - 1]!, m = T.msgs[i]!;
      expect(m.s0, `${m.id} lands before ${prev.id} is nearly read`).toBeGreaterThanOrEqual(prev.readEnd - 0.5 - 1e-6);
    }
  });

  it("keeps every balloon up at least as long as its words take to read", () => {
    for (const b of T.balloons.filter((x) => x.kind !== "thought")) {
      expect(b.t1 - b.t0, b.id).toBeGreaterThanOrEqual(0.6 + b.wordCount / T.pace - 0.01);
    }
  });

  it("runs shorter for a fast reader and longer for a relaxed one", () => {
    const fast = buildTimeline(replay, { pace: PACES.fast }).duration;
    const relaxed = buildTimeline(replay, { pace: PACES.relaxed }).duration;

    expect(fast).toBeLessThan(T.duration);
    expect(relaxed).toBeGreaterThan(T.duration);
  });

  it("never snaps a pose: keys are sorted and at least 0.06 s apart", () => {
    for (const id of T.agents) {
      const ks = T.keys[id]!;
      for (let i = 1; i < ks.length; i++) expect(ks[i]!.t - ks[i - 1]!.t).toBeGreaterThanOrEqual(0.06 - 1e-9);
    }
  });

  it("moves smoothly: no pose jumps between two frames at 60 fps, across every shot change and the opening", () => {
    // Shots changing is where motion could jump, so the frames are checked from three seconds before each cut to three after.
    const windows: Array<[number, number]> = [[0, 6], ...T.scenes.map((s): [number, number] => [Math.max(0, s.t0 - 3), Math.min(T.duration, s.t0 + 4.5)])];
    for (const [from, to] of windows) {
      let prev = sampleTimeline(T, from);
      for (let t = from + 1 / 60; t < to; t += 1 / 60) {
        const s = sampleTimeline(T, t);
        for (const id of T.agents) {
          const a = prev.chars[id]!.v, b = s.chars[id]!.v;
          expect(Math.abs(b.lean - a.lean), `${id} lean at ${t.toFixed(2)}`).toBeLessThan(2);
          expect(Math.abs(b.x - a.x), `${id} x at ${t.toFixed(2)}`).toBeLessThan(30);
          expect(Math.abs(b.squash - a.squash)).toBeLessThan(0.05);
        }
        expect(Math.abs(s.cam.z - prev.cam.z)).toBeLessThan(0.05);
        prev = s;
      }
    }
  });

  it("stays on the stage", () => {
    for (let t = 0; t < T.duration; t += 0.5) {
      const s = sampleTimeline(T, t);
      for (const id of T.agents) {
        const v = s.chars[id]!.v;
        expect(v.x).toBeGreaterThan(-STAGE.w * 0.1);
        expect(v.x).toBeLessThan(STAGE.w * 1.1);
        expect(v.y).toBeGreaterThan(0);
        expect(v.y).toBeLessThan(STAGE.h + 1);
      }
    }
  });
});

describe("scenes and the camera", () => {
  it("pushes in on a private pair and pulls back out for the group", () => {
    const huddle = T.scenes.find((s) => s.type === "huddle")!;
    const inside = sampleTimeline(T, huddle.t0 + 2);
    const wide = sampleTimeline(T, 0.2);

    expect(inside.cam.z).toBeGreaterThan(1.5);
    expect(wide.cam.z).toBe(1);
    expect(sampleTimeline(T, T.duration).cam.z).toBeLessThan(inside.cam.z);
  });

  it("blurs the people who are not in the huddle and leaves the pair sharp", () => {
    const huddle = T.scenes.find((s) => s.type === "huddle")!;
    const s = sampleTimeline(T, huddle.t0 + 2);
    const inPair = huddle.members.map((m) => s.chars[m]!.v.blur);
    const out = T.agents.filter((a) => !huddle.members.includes(a)).map((a) => s.chars[a]!.v.blur);

    expect(Math.max(...inPair)).toBe(0);
    expect(Math.min(...out)).toBeGreaterThan(1);
  });

  it("holds a conversation on camera for at least 2.5 s before cutting away", () => {
    for (const sc of T.scenes) expect(sc.t1 - sc.t0).toBeGreaterThanOrEqual(2.5);
  });

  it("stages the door variant in a second room and the wide variant without moving the camera", () => {
    const door = buildTimeline(replay, { huddle: "door" });
    const wide = buildTimeline(replay, { huddle: "wide" });
    const dh = door.scenes.find((s) => s.type === "huddle")!;
    const wh = wide.scenes.find((s) => s.type === "huddle")!;

    expect(sampleTimeline(door, dh.t0 + 2).cam.room).toBe(1);
    expect(sampleTimeline(wide, wh.t0 + 2).cam.z).toBe(1);
  });
});

describe("who is talking to whom", () => {
  it("infers addressees on a replay that did not record them, and says so", () => {
    expect(T.msgs.every((m) => m.inferred)).toBe(true);
    expect(T.msgs.some((m) => m.to.length > 0)).toBe(true);
  });

  it("uses what the engine recorded, and does not call it inferred", () => {
    const recorded = catReplay();
    const first = recorded.pulses.flatMap((p) => p.committedEvents)[0]!;
    first.payload["addresseeIds"] = ["priya"];
    const t = buildTimeline(recorded);
    const m = t.msgs.find((x) => x.id === first.id)!;

    expect(m.to).toEqual(["priya"]);
    expect(m.inferred).toBe(false);
  });
});

describe("the fiction-only lens", () => {
  it("shows private thoughts only to the omniscient viewer", () => {
    const withThought = T.balloons.find((b) => b.kind === "thought")!;
    const t = (withThought.t0 + withThought.t1) / 2;

    expect(sampleTimeline(T, t).balloons.some((b) => b.kind === "thought")).toBe(true);
    expect(sampleTimeline(T, t, { omniscient: false }).balloons.some((b) => b.kind === "thought")).toBe(false);
  });

  it("can be stripped for export, so no renderer can forget a flag", () => {
    const stripped = stripOmniscient(T);

    expect(stripped.balloons.some((b) => b.omniscient)).toBe(false);
    expect(stripped.balloons.filter((b) => b.kind !== "thought")).toHaveLength(T.balloons.filter((b) => b.kind !== "thought").length);
    expect(JSON.stringify(stripped.balloons)).not.toContain("privateMotive");
  });
});

describe("the sound of the room", () => {
  it("steps whenever somebody walks, and only then", () => {
    expect(T.footsteps.length).toBeGreaterThan(0);
    for (const s of T.footsteps) {
      const ks = T.keys[s.actor]!;
      const moving = ks.some((k, i) => i > 0 && k.t >= s.t && ks[i - 1]!.t <= s.t && Math.hypot(k.v.x - ks[i - 1]!.v.x, k.v.y - ks[i - 1]!.v.y) > 30);
      expect(moving, `${s.actor} at ${s.t.toFixed(2)}`).toBe(true);
    }
    for (let i = 1; i < T.footsteps.length; i++) expect(T.footsteps[i]!.t).toBeGreaterThanOrEqual(T.footsteps[i - 1]!.t);
  });

  it("picks a music bed from the room's recorded state and holds it for at least eight seconds", () => {
    expect(T.moods[0]!.t).toBe(0);
    for (let i = 1; i < T.moods.length; i++) {
      expect(T.moods[i]!.t - T.moods[i - 1]!.t).toBeGreaterThanOrEqual(8);
      expect(T.moods[i]!.mood).not.toBe(T.moods[i - 1]!.mood);
    }
  });

  it("keeps the same steps and moods for the fiction-only cut", () => {
    const stripped = stripOmniscient(T);

    expect(stripped.footsteps).toEqual(T.footsteps);
    expect(stripped.moods).toEqual(T.moods);
  });
});

describe("who stands where when a few people slip away", () => {
  const people = ["a", "b", "c", "d", "e"];
  const state = { coreMood: { valence: 0, arousal: 0.4, energy: 1 }, socialEmotions: {} };
  const replayFor = (privateMembers: string[]): DirectorReplay => ({
    agentIds: people,
    agentNames: Object.fromEntries(people.map((p) => [p, p.toUpperCase()])),
    agentArchetypes: Object.fromEntries(people.map((p) => [p, "organizer"])),
    channels: [
      { id: "pub", name: "room", type: "public_channel", memberAgentIds: people },
      { id: "priv", name: "aside", type: "private_channel", memberAgentIds: privateMembers },
    ],
    pulses: [
      { pulseIndex: 0, committedEvents: [{ id: "e0", channelId: "pub", actorId: "a", type: "message_sent", payload: { content: "hello all" } }], agentStates: Object.fromEntries(people.map((p) => [p, state])) },
      { pulseIndex: 1, committedEvents: [{ id: "e1", channelId: "priv", actorId: privateMembers[0]!, type: "message_sent", payload: { content: "a word in private" } }], agentStates: Object.fromEntries(people.map((p) => [p, state])) },
    ],
  });

  const placed = (T: Timeline, scene: Timeline["scenes"][number]) => Object.fromEntries(T.agents.map((id) => {
    const at = T.keys[id]!.filter((k) => k.t <= scene.t0 + 1.3 + 1e-6).at(-1)!;
    return [id, { x: at.v.x, w: at.v.w }];
  }));

  for (const members of [["b", "c"], ["b", "c", "d"]]) {
    for (const huddle of ["push", "wide"] as const) {
      it(`keeps ${members.length} people in a private talk apart from each other and from everyone else (${huddle} shot)`, () => {
        const T = buildTimeline(replayFor(members), { huddle });
        const scene = T.scenes.find((s) => s.type === "huddle")!;
        const at = placed(T, scene);
        const ids = T.agents;
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          const A = at[ids[i]!]!, B = at[ids[j]!]!;
          expect(Math.abs(A.x - B.x), `${ids[i]} and ${ids[j]} stand on each other`).toBeGreaterThanOrEqual(((A.w + B.w) / 2) * 0.9);
        }
        const memberXs = members.map((m) => at[m]!.x), otherXs = ids.filter((i) => !members.includes(i)).map((i) => at[i]!.x);
        expect(Math.min(...otherXs), "a bystander is inside the group's row").toBeGreaterThan(Math.max(...memberXs));
        for (const id of ids) expect(at[id]!.x + at[id]!.w / 2, `${id} is off the right edge`).toBeLessThanOrEqual(STAGE.w + 1);
      });
    }
  }
});
