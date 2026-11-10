import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionIntent } from "@perfectman/shared";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { actFrames } from "../testing/fake-drama.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
const sidecars: Sidecar[] = [];
afterEach(async () => {
  for (const s of sidecars.splice(0)) await s.close();
  await fake?.stop();
  fake = undefined;
});

/** A dialect 2 sidecar against the fake hotel with a run of three in room 12: Duda (person-1), Rafa (person-2), Gabi (person-3). */
async function started() {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, drama: { dead: [] } });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  const booted = await bootSidecar({ fake });
  sidecars.push(booted.sidecar);
  await waitFor(() => fake?.dialect === 2, "dialect 2");
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => fake?.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const ids = await waitFor(() => {
    const a = ["person-1", "person-2", "person-3"].map((r) => fake?.avatarByRef(r, 7)?.id);
    return a.every((x) => x !== undefined) ? (a as number[]) : undefined;
  }, "three actors in the room");
  const run = booted.sidecar.manager?.getRun(7);
  if (!run) throw new Error("no run");
  fake.scriptDramaState({ run: 7, room: 12, enabled: true });
  await waitFor(() => run.dramaSink.active, "the planner side to be on");
  const [duda, rafa, gabi] = ids as [number, number, number];
  return { hotel: fake, run, duda, rafa, gabi, dataDir: booted.cfg.dataDir };
}

describe("the planner side of the drama contract against the fake hotel", () => {
  it("[REA-1] [REA-3] a witness the hotel says owes a reaction answers with a qualifying command inside its window, while the act is still open; the hotel's frames are read from the run's own sink", async () => {
    const { hotel, gabi, duda, rafa } = await started();
    const before = hotel.received.filter((f) => f.t === "actor_cmd").length;
    // The real hotel closes an act seconds after contact (FRM-1): play the start and the beat now and the end later.
    const frames = actFrames({ actId: "e1", verb: "slap", actor: duda, with: rafa, run: 7, outcome: "landed", witnesses: [gabi], owed: [{ who: gabi, role: "witness" }] });
    const beatAt = Date.now();
    for (const f of frames.slice(0, 2)) hotel.send(f);
    const reply = await waitFor(
      () => hotel.received.slice(before).find((f) => f.t === "actor_cmd" && f.actor === gabi && ["face", "expression", "action", "act"].includes(f.cmd.k)),
      "gabi's reaction",
      3000,
    );
    expect(reply).toMatchObject({ t: "actor_cmd", actor: gabi });
    expect(Date.now() - beatAt).toBeLessThan(3000);
    for (const f of frames.slice(2)) hotel.send(f);
  });

  it("[REA-2] nothing owed, nothing sent: a human target and a witness list with no owed row leave the cast without a single act", async () => {
    const { hotel, gabi, duda } = await started();
    hotel.scriptAct({ actId: "e2", verb: "slap", actor: duda, with: 9, run: 7, outcome: "landed", chip: true, answer: "take", witnesses: [gabi, 9], owed: [] });
    await new Promise((r) => setTimeout(r, 900));
    expect(hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "act")).toEqual([]);
  });

  it("[DEATH-2] [DEATH-7] a killed actor is out of the speaker pool until its revive: the run's ledger and executor say so, and it speaks again after", async () => {
    const { hotel, run, duda, rafa } = await started();
    hotel.scriptAct({ actId: "e3", verb: "kill", actor: duda, with: rafa, run: 7, outcome: "landed", death: { victim: rafa, killer: duda } });
    await waitFor(() => run.dramaSink.isDead("person-2"), "person-2 dead");
    const quiet = hotel.received.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(hotel.received.slice(quiet).filter((f) => f.t === "actor_cmd" && f.actor === rafa)).toEqual([]);
    hotel.scriptSceneCut({ run: 7, room: 12, scene: "7.3", prev: "7.2", revived: [rafa] });
    await waitFor(() => !run.dramaSink.isDead("person-2"), "person-2 alive again");
  });

  it("[P7] a model's act refused for want of a motive is a note in its next prompt, once, with the name it aimed at, and the run counts it", async () => {
    const { run } = await started();
    const handle = run.simulation;
    const mirror = sidecars[0]?.manager?.mirror.scoped(7);
    if (!handle || !mirror) throw new Error("no run");
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, "person-1");
    const space = mirror.view("person-1", Date.now());
    if (!state || !space) throw new Error("person-1 is not in the room");
    const intent = (id: string): ActionIntent => ({ id, actorId: "person-1", intentType: "send_message", visibleContent: "olha só", personTargets: [], privateMotiveSummary: "quero partir pra cima", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] });
    const commit = (id: string, act: boolean) =>
      run.onCommitted({
        simulationId: handle.simulationId,
        agentId: "person-1",
        reason: "base",
        pulseIndex: 0,
        intent: intent(id),
        outcome: "committed",
        committedEvents: [],
        body: { accepted: { order: "move_then_speak", ...(act ? { act: { verb: "glare", target: "p1" } } : {}) }, targets: { p1: { kind: "person", ref: "person-2" } }, blocked: [] },
        space,
        agentState: state,
      });
    // No emotion state came with the turn: nothing drives a glare, and the director says motive.
    commit("n1", true);
    const told = mirror.bodyOf("person-1", Date.now()).lastBlocked;
    expect(told).toMatchObject([{ code: "ladder", part: "act", detail: "motive", ref: expect.stringMatching(/\S/) }]);
    expect(run.dramaSink.counters()["act_blocked_notes"]).toBe(1);
    // Read by one prompt: the next commit of the same actor clears it.
    commit("n2", false);
    expect(mirror.bodyOf("person-1", Date.now()).lastBlocked).toBeUndefined();
  });

  it("[P7] a hostile line of the cast reaches the grievance ledger through the run's commit seam, for the pairs the scenario lets and no other", async () => {
    const { run, hotel, dataDir } = await started();
    const handle = run.simulation;
    const mirror = sidecars[0]?.manager?.mirror.scoped(7);
    if (!handle || !mirror) throw new Error("no run");
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, "person-2");
    const space = mirror.view("person-2", Date.now());
    if (!state || !space) throw new Error("person-2 is not in the room");
    const line = (id: string, content: string, payload: Record<string, unknown>) => ({
      id, simulationId: handle.simulationId, channelId: "room:12", actorId: "person-2", type: "message_sent" as const, payload: { content, ...payload }, sourceEventIds: [], emotionalSalience: "medium" as const,
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" }, createdAt: Date.now(), pulseIndex: 0,
    });
    const commit = (e: ReturnType<typeof line>) =>
      run.onCommitted({
        simulationId: handle.simulationId, agentId: "person-2", reason: "base", pulseIndex: 0,
        intent: { id: e.id, actorId: "person-2", intentType: "send_message", visibleContent: String(e.payload["content"]), personTargets: [], privateMotiveSummary: "x", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] },
        outcome: "committed", committedEvents: [e], space, agentState: state,
      });
    // The run of this test is a scene with no drama block of its own, so it has the conservative default (every ordered pair of its actors): Duda is provoked by Rafa.
    commit(line("l1", "Duda, você é um imbecil", { mentionedAgentIds: ["person-1"], addresseeIds: ["person-1"] }));
    expect(run.dramaSink.provocation.levelOf("person-1", "person-2")).toBe(0.5);
    expect(run.dramaSink.provocation.levelOf("person-2", "person-1")).toBe(0);
    expect(run.dramaSink.counters()).toEqual({ grievance_raised: 1, grievance_insult: 1 });
    // A line that is not hostile moves nobody.
    commit(line("l2", "Duda, me passa o gelo?", { mentionedAgentIds: ["person-1"] }));
    expect(run.dramaSink.counters()).toEqual({ grievance_raised: 1, grievance_insult: 1 });
    // A block that lost a stale furniture handle and kept the rest is counted (the parser strips it; the commit seam sees what was left out).
    run.onCommitted({
      simulationId: handle.simulationId, agentId: "person-2", reason: "base", pulseIndex: 0,
      intent: { id: "l3", actorId: "person-2", intentType: "send_message", visibleContent: "oi", personTargets: [], privateMotiveSummary: "x", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] },
      outcome: "committed", committedEvents: [], space, agentState: state,
      body: { accepted: { order: "move_then_speak", expression: "angry" }, targets: {}, blocked: [{ code: "unknown_ref", part: "posture", ref: "f02" }] },
    });
    // The run's summary carries the counters (only the ones that are not zero).
    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((x) => x.t === "run_end"), "run_end", 6000);
    const summary = JSON.parse(readFileSync(join(dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number> };
    expect(summary.counters).toMatchObject({ grievance_raised: 1, grievance_insult: 1, unknown_ref_stripped: 1 });
    expect(summary.counters["earshot_drops"]).toBeUndefined();
  });
});
