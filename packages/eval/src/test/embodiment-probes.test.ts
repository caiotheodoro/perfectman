import { describe, it, expect } from "vitest";
import type { BodyFrame, BodyFrameLog, Tile } from "@perfectman/shared";
import { runEmbodimentProbes } from "../probes/embodiment.js";

const T0 = 1_000_000;
const f = (at: number, dir: "in" | "out", kind: string, data: Record<string, unknown>, room = "lounge"): BodyFrame => ({
  atMs: T0 + at,
  dir,
  kind,
  room,
  data,
});
const log = (frames: BodyFrame[], snapshots: BodyFrameLog["snapshots"] = []): BodyFrameLog => ({ frames, snapshots });
const snap = (at: number, occupants: Array<[string, Tile, number]>): BodyFrameLog["snapshots"][number] => ({
  atMs: T0 + at,
  room: "lounge",
  occupants: occupants.map(([ref, tile, dir]) => ({ ref, tile, dir: dir as 0, state: "stand" as const })),
});
/** A log that is long enough for per-minute and per-10-minute rates to mean something. */
const span = (ms: number): BodyFrame => f(ms, "in", "room_ping", { rev: 1 });
const ACTORS = ["a", "b", "c", "d"];

const cases: Array<{ probe: string; pass: BodyFrameLog; fail: BodyFrameLog }> = [
  {
    probe: "teleport-rate",
    pass: log([f(0, "in", "moves", { agentId: "a", tile: [1, 1], dir: 2 }), f(300, "in", "moves", { agentId: "a", tile: [2, 1], dir: 2 })]),
    fail: log([f(0, "in", "moves", { agentId: "a", tile: [1, 1], dir: 2 }), f(300, "in", "moves", { agentId: "a", tile: [5, 1], dir: 2 })]),
  },
  {
    probe: "earshot-violation",
    pass: log([f(0, "in", "chat", { agentId: "a", mode: "say", toRef: "b", sameRoom: true, distance: 3 })]),
    fail: log([f(0, "in", "chat", { agentId: "a", mode: "say", toRef: "b", sameRoom: true, distance: 8 })]),
  },
  {
    probe: "impossible-action-rate",
    pass: log([f(0, "out", "actor_cmd", { agentId: "a", cmd: "walk" }), f(10, "in", "actor_error", { agentId: "a", code: "slow_down" })]),
    fail: log([f(0, "out", "actor_cmd", { agentId: "a", cmd: "gesture" }), f(10, "in", "actor_error", { agentId: "a", code: "refused_walking" })]),
  },
  {
    probe: "jitter-index",
    pass: log([f(0, "in", "moves", { agentId: "a", tile: [1, 1], dir: 2 }), f(300, "in", "moves", { agentId: "a", tile: [2, 1], dir: 2 }), span(60_000)]),
    fail: log([
      ...Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? 2 : 6)).map((dir, i) => f(i * 1000, "in", "moves", { agentId: "a", tile: [1, 1], dir })),
      span(60_000),
    ]),
  },
  {
    probe: "facing-rate",
    pass: log([f(0, "in", "chat", { agentId: "a", mode: "say", toRef: "b" })], [snap(3500, [["a", [5, 4], 2], ["b", [3, 4], 2]])]),
    fail: log([f(0, "in", "chat", { agentId: "a", mode: "say", toRef: "b" })], [snap(3500, [["a", [5, 4], 2], ["b", [3, 4], 6]])]),
  },
  {
    probe: "furniture-use",
    pass: log([f(0, "in", "avatar_state", { agentId: "a", state: "sit" }), f(0, "in", "avatar_state", { agentId: "b", state: "sit" }), f(0, "in", "avatar_state", { agentId: "c", state: "sit" }), f(0, "in", "avatar_state", { agentId: "d", state: "sit" }), span(600_000)]),
    fail: log([f(0, "in", "avatar_state", { agentId: "a", state: "sit" }), span(600_000)]),
  },
  {
    probe: "spread-index",
    pass: log([], [snap(0, [["a", [1, 1], 0], ["b", [6, 1], 0], ["c", [1, 6], 0], ["d", [9, 6], 0]])]),
    fail: log([], [snap(0, [["a", [1, 1], 0], ["b", [2, 1], 0], ["c", [1, 2], 0], ["d", [9, 6], 0]])]),
  },
  {
    probe: "gesture-diversity",
    pass: log(["wave", "laugh", "thumbs", "wave", "laugh", "thumbs"].map((a, i) => f(i, "in", "avatar_action", { agentId: "a", a }))),
    fail: log(Array.from({ length: 6 }, (_, i) => f(i, "in", "avatar_action", { agentId: "a", a: "wave" }))),
  },
  {
    probe: "stale-command-rate",
    pass: log([f(0, "out", "actor_cmd", { agentId: "a", cmd: "walk", stale: false })]),
    fail: log([f(0, "out", "actor_cmd", { agentId: "a", cmd: "walk", stale: true })]),
  },
  {
    probe: "plan-abandon-rate",
    pass: log([
      f(0, "in", "walk_started", { agentId: "a", planId: "p1" }),
      f(900, "in", "arrived", { agentId: "a", planId: "p1" }),
      f(1000, "in", "walk_started", { agentId: "a", planId: "p2" }),
      f(1900, "in", "arrived", { agentId: "a", planId: "p2" }),
    ]),
    fail: log([
      f(0, "in", "walk_started", { agentId: "a", planId: "p1" }),
      f(300, "in", "walk_started", { agentId: "a", planId: "p2" }),
      f(600, "in", "walk_started", { agentId: "a", planId: "p3" }),
      f(900, "in", "arrived", { agentId: "a", planId: "p3" }),
    ]),
  },
  {
    probe: "slowdown-count",
    pass: log([f(0, "out", "actor_cmd", { agentId: "a", cmd: "walk" })]),
    fail: log([f(0, "in", "actor_error", { agentId: "a", code: "slow_down" })]),
  },
];

describe("embodiment probes (docs/embodiment.md section 10)", () => {
  const verdict = (probe: string, l: BodyFrameLog): boolean | undefined =>
    runEmbodimentProbes({ log: l, actorIds: ACTORS }).find((r) => r.probe === probe)?.passed;

  it.each(cases)("$probe passes a clean trace and fails a violating one", ({ probe, pass, fail }) => {
    expect(verdict(probe, pass)).toBe(true);
    expect(verdict(probe, fail)).toBe(false);
  });

  it("prompt-identity-lint fails a prompt that names what someone is, passes one that does not", () => {
    const run = (prompts: string[]) =>
      runEmbodimentProbes({ log: log([]), actorIds: ACTORS, prompts }).find((r) => r.probe === "prompt-identity-lint")?.passed;
    expect(run(["Voce esta no Lounge, perto do bar."])).toBe(true);
    expect(run(["Voce esta no Lounge.", "Rafa e um bot do hotel."])).toBe(false);
  });

  it("a room change is not a teleport", () => {
    const crossing = log([
      f(0, "in", "moves", { agentId: "a", tile: [11, 6], dir: 2 }),
      f(300, "in", "moved_room", { agentId: "a", from: "lounge", to: "hallway" }),
      f(600, "in", "moves", { agentId: "a", tile: [1, 1], dir: 2 }),
    ]);
    expect(verdict("teleport-rate", crossing)).toBe(true);
  });
});
