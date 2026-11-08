import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionIntent } from "@perfectman/shared";
import type { AgentCommitInfo } from "@perfectman/server/hotel";
import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, TEST_SECRET, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

async function running(width = 10) {
  const f = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  f.addRoom(12, width);
  f.addHuman(12, 9, "ana", 8, 5);
  const b = await bootSidecar({ fake: f, timing: { baseIntervalMs: 60_000 } });
  fake = b.fake;
  sidecar = b.sidecar;
  f.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => f.received.filter((x) => x.t === "actor_spawn").length === 3, "3 spawns");
  // The cast walks in and is woken once on arrival; the runtime now has a decision context for each.
  await waitFor(() => f.received.filter((x) => x.t === "run_status").at(-1)?.llm_calls === 3, "the arrival wakes", 6000);
  const run = b.sidecar.manager?.getRun(7);
  const handle = run?.simulation;
  if (!run || !handle) throw new Error("the run did not start");
  const state = await handle.repositories.agentStateRepo.get(handle.simulationId, "person-1");
  const space = b.sidecar.manager?.mirror.scoped(7).view("person-1", Date.now());
  if (!state || !space) throw new Error("person-1 is not in the room");
  return { f, b, run, state, space };
}

const intent = (text: string): ActionIntent => ({
  id: "held-1",
  actorId: "person-1",
  intentType: "send_message",
  visibleContent: text,
  personTargets: ["h:9"],
  privateMotiveSummary: "quero falar com a Ana",
  emotionDrivers: [],
  motivationDrivers: [],
  memoryWrites: [],
  fallbackIfBlocked: "no_op",
});

type Fixture = Awaited<ReturnType<typeof running>>;

const commit = ({ run, state, space }: Fixture, text: string, body: AgentCommitInfo["body"]): void =>
  run.onCommitted({
    simulationId: run.simulation?.simulationId ?? "",
    agentId: "person-1",
    reason: "human_chat",
    pulseIndex: 0,
    intent: intent(text),
    outcome: "delayed",
    committedEvents: [],
    ...(body ? { body } : {}),
    space,
    agentState: state,
  });

describe("a line held until its speaker arrives (move_then_speak, ADR-0019)", () => {
  it("walks to the addressee, then resolves the held line through the runtime on arrival", async () => {
    const fx = await running();
    const { f } = fx;
    const spoken = (): boolean => f.chats.some((c) => c.mode === "say" && c.text === "oi Ana, vim te ver");
    commit(fx, "oi Ana, vim te ver", {
      accepted: { order: "move_then_speak", move: { kind: "approach", target: "p1", band: "personal" } },
      targets: { p1: { kind: "person", ref: "h:9" } },
      blocked: [],
      deferral: { targetRef: "h:9", etaMs: 800, expiresAt: Date.now() + 8000 },
    });
    // Nothing is said while the actor is still walking.
    expect(spoken()).toBe(false);
    await waitFor(spoken, "the held line, said after the walk", 6000);
    const walkAt = f.received.findIndex((x) => x.t === "actor_cmd" && x.cmd.k === "walk" && x.actor === f.avatarByRef("person-1")?.id);
    const sayAt = f.received.findIndex((x) => x.t === "actor_cmd" && x.cmd.k === "chat" && x.cmd.mode === "say" && x.cmd.text === "oi Ana, vim te ver");
    expect(walkAt).toBeGreaterThan(-1);
    expect(sayAt).toBeGreaterThan(walkAt);
  });

  it("drops the line when it expires before the speaker gets there, and tells the actor why", async () => {
    const fx = await running();
    const { f, b } = fx;
    // No walk is planned (no move in the block), so nothing can release the line; it expires.
    commit(fx, "essa linha nunca chega", {
      accepted: { order: "move_then_speak" },
      targets: {},
      blocked: [],
      deferral: { targetRef: "h:9", etaMs: 100, expiresAt: Date.now() + 150 },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(f.chats.some((c) => c.text === "essa linha nunca chega")).toBe(false);
    f.pmCommand(7, 12, "stop");
    await waitFor(() => f.received.find((x) => x.t === "run_end"), "run_end", 6000);
    const events = readFileSync(join(b.cfg.dataDir, "runs", "7", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; actorId: string; payload: { reasons?: Array<{ code: string }> } });
    const blocked = events.find((e) => e.type === "body_blocked" && e.payload.reasons?.some((r) => r.code === "not_in_earshot"));
    expect(blocked?.actorId).toBe("person-1");
  });

  it("plans the walk again when the addressee moved off while the speaker walked, and says the line only once within the say radius", async () => {
    const fx = await running(24);
    const { f } = fx;
    const text = "oi Ana, espera por mim";
    const spoken = (): boolean => f.chats.some((c) => c.mode === "say" && c.text === text);
    const actor = f.avatarByRef("person-1");
    const walks = (): number => f.received.filter((x) => x.t === "actor_cmd" && x.cmd.k === "walk" && x.actor === actor?.id).length;
    const before = walks();
    // A line is delivered to the hotel only when some cast member hears it (ADR-0022: "a line nobody hears" is operator-only), and `say` carries 10 tiles.
    // The cast stands near the door and the addressee is about to go to the far corner, so one listener is put there first rather than left to wander by chance.
    const manager = fx.b.sidecar.manager;
    const listener = f.avatarByRef("person-2");
    if (!manager || !listener) throw new Error("no listener to place");
    expect(manager.send({ t: "actor_cmd", run: 7, lease: manager.leaseOf(7) ?? 0, cid: manager.nextCid(7), actor: listener.id, cmd: { k: "walk", x: 20, y: 2 } })).toBe(true);
    await waitFor(() => f.avatarByRef("person-2")?.x === 20 && f.avatarByRef("person-2")?.state === "stand", "the listener at the far end", 6000);
    commit(fx, text, {
      accepted: { order: "move_then_speak", move: { kind: "approach", target: "p1", band: "personal" } },
      targets: { p1: { kind: "person", ref: "h:9" } },
      blocked: [],
      deferral: { targetRef: "h:9", etaMs: 800, expiresAt: Date.now() + 15_000 },
    });
    // The addressee walks to the far corner of the room right after the walk was planned toward where they stood.
    f.moveHuman(12, 9, 23, 0);
    await waitFor(spoken, "the held line, said after the walk is planned again", 12_000);
    expect(walks()).toBeGreaterThan(before + 1);
    const me = f.avatarByRef("person-1");
    const ana = f.rooms.get(12)?.avatars.get(9);
    expect(me && ana ? Math.max(Math.abs(me.x - ana.x), Math.abs(me.y - ana.y)) : 99).toBeLessThanOrEqual(6);
  }, 25_000);
});
