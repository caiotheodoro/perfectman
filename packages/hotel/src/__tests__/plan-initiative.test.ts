import { describe, expect, it } from "vitest";
import { leaveDirective, namedIn, noteExchange, plan, planFacing, updateMemory } from "../embodiment/plan.js";
import type { PlanInput, PlannedCommand } from "../embodiment/types.js";
import { NOW, agentState, person, sofa, space } from "../testing/fixtures.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

function run(o: SpaceOpts, over: Partial<PlanInput> = {}): PlannedCommand[] {
  return plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), ...over });
}

describe("seats, initiative and facing from a distance", () => {
  const seat = sofa(1, [6, 3]);
  const FIRST = NOW - 400_000;

  it("sits at a free seat after a long stretch on foot, but not mid-conversation and not before", () => {
    const mem = { firstPlanAt: FIRST };
    expect(run({ furni: [seat] }, { memory: mem })).toEqual([{ agentId: "duda", cmd: "sit", furniId: 1 }]);
    expect(run({ furni: [seat] }, { memory: { firstPlanAt: NOW - 60_000 } })).toEqual([]);
    expect(run({ furni: [seat], others: [person("h:9", [6, 6], { lastSpokeAt: NOW - 1000 })] }, { memory: mem }).some((c) => c.cmd === "sit")).toBe(false);
    expect(run({ furni: [seat] }, { memory: { ...mem, lastSeatTryAt: NOW - 5000 } })).toEqual([]);
  });

  it("gets up after a long sit when nobody is talking to it, and sits again only after standing a while", () => {
    expect(run({ self: { state: "sit" }, furni: [seat] }, { memory: { firstPlanAt: FIRST, lastSatAt: NOW - 300_000 } })).toEqual([{ agentId: "duda", cmd: "stand" }]);
    expect(run({ self: { state: "sit" }, furni: [seat] }, { memory: { firstPlanAt: FIRST, lastSatAt: NOW - 30_000 } })).toEqual([]);
    expect(run({ furni: [seat] }, { memory: { firstPlanAt: FIRST, lastSatAt: NOW - 300_000, lastStoodAt: NOW - 10_000 } })).toEqual([]);
  });

  it("every actor of a cast of four sits at least once in 10 minutes when seats are free", () => {
    const names = ["duda", "rafa", "gabi", "leo"];
    for (const ref of names) {
      let mem: PlanInput["memory"] = { firstPlanAt: NOW };
      let sat = 0;
      let state: "stand" | "sit" = "stand";
      for (let t = 0; t <= 600_000; t += 6_000) {
        const now = NOW + t;
        const cmds = plan({ space: { ...space({ self: { state }, furni: [seat] }), readAt: now }, agentState: agentState(), committedEvents: [], now, rng: seededRng(3), memory: mem });
        const sitCmd = cmds.find((c) => c.cmd === "sit");
        if (sitCmd) { sat += 1; state = "sit"; }
        if (cmds.some((c) => c.cmd === "stand")) state = "stand";
        if (cmds.length > 0) mem = updateMemory(mem ?? {}, cmds, now, [4, 4], "12");
      }
      expect(sat, ref).toBeGreaterThanOrEqual(1);
    }
  });

  it("reaches for a person it is drawn to: close enough, a hug or a kiss through the same pair act", () => {
    const rel = { desireForCloseness: 0.8, desireForDistance: 0.1, attraction: 0.6, comfort: 0.6 };
    const mem = { firstPlanAt: FIRST };
    const cmds = run({ others: [person("h:9", [6, 4], { name: "Ana" })] }, { agentState: agentState({ rel: { "h:9": rel } }), memory: mem });
    expect(cmds.find((c) => c.cmd === "pair")).toMatchObject({ kind: "hug", with: "h:9" });
    const kiss = run({ others: [person("h:9", [6, 4], { name: "Ana" })] }, { agentState: agentState({ rel: { "h:9": { ...rel, attraction: 0.8 } } }), memory: mem });
    expect(kiss.find((c) => c.cmd === "pair")).toMatchObject({ kind: "kiss" });
  });

  it("holds the initiative to its budgets: not new in the room, not twice in a row, not after a dodge, not past 3 tries", () => {
    const rel = { desireForCloseness: 0.8, desireForDistance: 0.1, attraction: 0.6, comfort: 0.6 };
    const o = { others: [person("h:9", [6, 4], { name: "Ana" })] };
    const st = agentState({ rel: { "h:9": rel } });
    const pairs = (m: PlanInput["memory"]) => run(o, { agentState: st, memory: m }).some((c) => c.cmd === "pair");
    expect(pairs({ firstPlanAt: NOW - 10_000 })).toBe(false);
    expect(pairs({ firstPlanAt: FIRST, lastInitiativeAt: NOW - 20_000 })).toBe(false);
    expect(pairs({ firstPlanAt: FIRST, pairRefusedAt: { "h:9": NOW - 20_000 } })).toBe(false);
    expect(pairs({ firstPlanAt: FIRST, pairTries: { "h:9": 3 } })).toBe(false);
    expect(pairs({ firstPlanAt: FIRST })).toBe(true);
    const newcomer = { others: [person("h:9", [6, 4], { name: "Ana", since: NOW - 2000 })] };
    expect(run(newcomer, { agentState: st, memory: { firstPlanAt: FIRST } }).some((c) => c.cmd === "pair")).toBe(false);
  });

  it("a goal that names a person and a gesture is acted on once the person has been around a while", () => {
    const o = { others: [person("h:9", [6, 4], { name: "Ana" })] };
    const drives = { goalText: "Ficou encantada por Ana e quer dar um beijo nela assim que tiver coragem." };
    const cmds = run(o, { memory: { firstPlanAt: FIRST }, drives });
    expect(cmds.find((c) => c.cmd === "pair")).toMatchObject({ kind: "kiss", with: "h:9" });
    expect(run(o, { memory: { firstPlanAt: NOW - 20_000 }, drives }).some((c) => c.cmd === "pair")).toBe(false);
    expect(run(o, { memory: { firstPlanAt: FIRST }, drives: { goalText: "Gosta de Ana, so isso." } }).some((c) => c.cmd === "pair")).toBe(false);
  });

  it("goes on an errand to the room its goal or motive names, once, and comes back after a visit", () => {
    const adjacency = [{ roomId: "16", viaDoor: [0, 5] as [number, number], travelS: 4, name: "Quarto" }, { roomId: "18", viaDoor: [0, 5] as [number, number], travelS: 4, name: "Cozinha" }];
    const drives = { goalText: "Deixou o violão no Quarto e quer ir buscar, passando pela porta." };
    const go = run({ adjacency }, { memory: { firstPlanAt: FIRST }, drives });
    expect(go.some((c) => c.cmd === "walk") && go.find((c) => c.cmd === "move_room")).toMatchObject({ cmd: "move_room", to: "16" });
    expect(run({ adjacency }, { memory: { firstPlanAt: NOW - 20_000 }, drives }).length).toBe(0);
    expect(run({ adjacency }, { memory: { firstPlanAt: FIRST, lastErrandAt: NOW - 60_000 }, drives })).toEqual([]);
    expect(run({ adjacency }, { memory: { firstPlanAt: FIRST }, drives: { goalText: "Gosta do Quarto." } })).toEqual([]);
    expect(run({ adjacency }, { memory: { firstPlanAt: FIRST }, drives: { motive: "vou até a Cozinha pegar água" } }).find((c) => c.cmd === "move_room")).toMatchObject({ to: "18" });
    // updateMemory records it, so the way back is planned from the visit's room
    const mem = updateMemory({ firstPlanAt: FIRST }, [{ agentId: "duda", cmd: "move_room", to: "16" }], NOW - 80_000, [0, 5], "12");
    expect(mem.errand).toEqual({ from: "12", to: "16", at: NOW - 80_000 });
    const visiting = { ...mem, errand: { from: "16", to: "12", at: NOW - 80_000 } };
    const home = plan({ space: space({ adjacency }), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(1), memory: visiting, drives });
    expect(home.find((c) => c.cmd === "move_room")).toMatchObject({ to: "16" });
    const short = plan({ space: space({ adjacency }), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(1), memory: { ...visiting, errand: { from: "16", to: "12", at: NOW - 20_000 } }, drives });
    expect(short).toEqual([]);
  });

  it("turns toward a person who calls it from across the room, at any distance, but a quiet far person is not faced", () => {
    const far = space({ self: { dir: 6 }, others: [person("h:9", [11, 8])] });
    expect(planFacing({ space: far, now: NOW }, "h:9")).toEqual([]);
    expect(planFacing({ space: far, now: NOW }, "h:9", Number.POSITIVE_INFINITY)).toEqual([{ agentId: "duda", cmd: "face", targetTile: [11, 8] }]);
  });

  it("keeps facing the person it is talking with after they step away", () => {
    const cmds = run({ self: { dir: 6 }, others: [person("h:9", [11, 8])] }, { memory: noteExchange({ firstPlanAt: NOW }, "h:9", NOW - 1000) });
    expect(cmds).toEqual([{ agentId: "duda", cmd: "face", targetTile: [11, 8] }]);
  });

  it("keeps its eyes on a person who is talking with it for a few seconds, even when another actor speaks", () => {
    const o = { self: { dir: 6 as const }, others: [person("h:9", [9, 4]), person("rafa", [4, 8], { lastSpokeAt: NOW - 500 })] };
    const held = run(o, { memory: noteExchange({ firstPlanAt: NOW }, "h:9", NOW - 1000) });
    expect(held[0]).toEqual({ agentId: "duda", cmd: "face", targetTile: [9, 4] });
    const late = run(o, { memory: noteExchange({ firstPlanAt: NOW }, "h:9", NOW - 9000) });
    expect(late[0]).toEqual({ agentId: "duda", cmd: "face", targetTile: [4, 8] });
  });
});

describe("a director's line that sends someone out of the room", () => {
  const rooms = [
    { roomId: "13", name: "Jardim", travelS: 6 },
    { roomId: "14", name: "Cozinha", travelS: 3 },
  ];

  it("names the room when the line names one, in either language and with or without accents", () => {
    expect(leaveDirective("Teo, vai para o Jardim buscar água", rooms)).toBe("13");
    expect(leaveDirective("Agora: saia do Quarto e vá à cozinha", rooms)).toBe("14");
    expect(leaveDirective("go get some water in the Cozinha", rooms)).toBe("14");
  });

  it("takes the nearest room for \"another room\" and nothing for a line that is not about leaving", () => {
    expect(leaveDirective("Agora: saia do Quarto e va para outra sala buscar agua.", rooms)).toBe("14");
    expect(leaveDirective("leave the room, now", rooms)).toBeUndefined();
    expect(leaveDirective("leave for another room", rooms)).toBe("14");
    expect(leaveDirective("fala mais baixo, a Nina esta cansada", rooms)).toBeUndefined();
    expect(leaveDirective("o Jardim estava lindo ontem", rooms)).toBeUndefined();
    expect(leaveDirective("sai daqui", [])).toBeUndefined();
  });

  it("finds the cast members a line names", () => {
    const cast = new Map([["person-1", "Nina"], ["person-2", "Teo Silva"], ["person-3", "Bia"]]);
    expect(namedIn("Teo sai do Quarto batendo a porta e vai para outra sala.", cast)).toEqual(["person-2"]);
    expect(namedIn("Nina e Bia, ouçam", cast)).toEqual(["person-1", "person-3"]);
    expect(namedIn("todo mundo para a rua", cast)).toEqual([]);
  });

  it("the planner walks to the door and takes it, once the exit is a leave intent", () => {
    const view = space({ self: { tile: [5, 5] } });
    const cmds = plan({ space: { ...view, adjacency: [{ roomId: "13", viaDoor: [0, 4], travelS: 5, name: "Jardim" }] }, agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(1), bodyIntent: { order: "together", move: { kind: "leave", to: "r1" } }, handles: { r1: { kind: "room", roomId: "13" } } });
    expect(cmds.map((c) => c.cmd)).toEqual(["walk", "move_room"]);
    expect(cmds[1]).toMatchObject({ cmd: "move_room", to: "13", afterArrival: (cmds[0] as { plan?: string }).plan });
  });
});
