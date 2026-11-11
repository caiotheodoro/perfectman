/**
 * What the beat sheet says to the actors and to the body: the note that is live for an actor at a second (reveals reach only the people they are for, a pause
 * silences everyone, the moment's purpose reaches all, the climax is announced a few seconds ahead), the blocking, props and faces as body commands, and the
 * authored silence holding the actors' lines and nothing else. No dialogue is ever written.
 */
import { describe, expect, it } from "vitest";
import { BEAT_CRAFT_MAX_CHARS, mockBeatSheet } from "@perfectman/shared";
import type { RoomView } from "@perfectman/shared";
import { SheetNotes } from "../director/drama/sheet-notes.js";
import { planBlock, planFace, planProp, placeToTile } from "../embodiment/sheet-stage.js";
import type { StageCtx } from "../embodiment/sheet-stage.js";
import type { PlannedCommand } from "../embodiment/types.js";
import { SheetRuntime } from "../run/sheet-run.js";
import { defaultSceneDrama, resolveRunDrama } from "../authoring/scenario-drama.js";
import { ManualClock } from "../testing/manual-clock.js";

const NAMES = new Map([["person-1", "Heloísa"], ["person-2", "Otávio"], ["person-3", "Renato"]]);
const sheet = mockBeatSheet({ cast: [...NAMES].map(([id, name]) => ({ id, name })), language: "pt-BR" });
const notes = new SheetNotes(sheet, NAMES, "pt-BR");

describe("SheetNotes", () => {
  it("opens with the premise and the stakes, for everyone", () => {
    for (const who of NAMES.keys()) expect(notes.textFor(who, 500)).toContain("Heloísa cobra de Otávio");
    expect(notes.textFor("person-1", 500)).toContain("Em jogo");
  });

  it("gives an actor their own note while it lasts, and not another's", () => {
    const a = notes.textFor("person-1", 30_000)!;
    const b = notes.textFor("person-2", 30_000)!;
    expect(a).toContain("Seu objetivo: Aperta sem gritar");
    expect(a).toContain("Jogada: accuse");
    expect(a).toContain("Por baixo: quer ouvir B confessar");
    expect(b).not.toContain("Aperta sem gritar");
  });

  it("a reveal is a private note to the people it is for, and fades after 45 s", () => {
    const at = sheet.beats.find((b) => b.kind === "reveal" && b.via === "show")!.at_ms;
    expect(notes.textFor("person-1", at + 1_000)).toContain("Você acaba de saber: Heloísa descobriu que Otávio escondeu a verdade");
    expect(notes.textFor("person-1", at + 1_000)).toContain("Está diante de você");
    expect(notes.textFor("person-2", at + 1_000) ?? "").not.toContain("Você acaba de saber");
    expect(notes.textFor("person-1", at + 60_000) ?? "").not.toContain("Você acaba de saber: Heloísa descobriu");
  });

  it("the reversal reaches everyone it names, with the way it was said", () => {
    const rev = sheet.beats.find((b) => b.kind === "reveal" && b.via === "say")!;
    for (const who of NAMES.keys()) expect(notes.textFor(who, rev.at_ms + 500)).toContain("Você acaba de saber: Otávio lembra algo");
  });

  it("a pause silences everyone for its length and wins over every other line", () => {
    const p = sheet.beats.find((b) => b.kind === "pause")!;
    const text = notes.textFor("person-2", p.at_ms + 100)!;
    expect(text.startsWith("Silêncio agora")).toBe(true);
    expect(notes.textFor("person-2", p.at_ms + 4_000 + 100) ?? "").not.toContain("Silêncio agora");
  });

  it("announces the peak to its two people before it, and to nobody else", () => {
    const at = sheet.arc.climax_at_ms;
    expect(notes.textFor("person-1", at - 5_000)).toContain("O ápice está perto");
    expect(notes.textFor("person-2", at - 5_000)).toContain("O ápice está perto");
    expect(notes.textFor("person-3", at - 5_000) ?? "").not.toContain("O ápice está perto");
  });

  it("shows the stage directions the blocking and props imply, for a few seconds", () => {
    const prop = sheet.beats.find((b) => b.kind === "prop" && b.op === "show")!;
    expect(notes.textFor("person-3", prop.at_ms + 1_000)).toContain("Heloísa mostra envelope a Otávio.");
    expect(notes.textFor("person-3", prop.at_ms + 20_000) ?? "").not.toContain("mostra envelope");
  });

  it("never exceeds the craft budget and is deterministic", () => {
    for (let t = 0; t <= 260_000; t += 1_000) {
      for (const who of NAMES.keys()) {
        const a = notes.textFor(who, t);
        expect(a === undefined || a.length <= BEAT_CRAFT_MAX_CHARS).toBe(true);
        expect(notes.textFor(who, t)).toBe(a);
      }
    }
  });

  it("speaks English for an English scene", () => {
    const en = new SheetNotes(mockBeatSheet({ cast: [...NAMES].map(([id, name]) => ({ id, name })), language: "en" }), NAMES, "en");
    expect(en.textFor("person-1", 30_000)).toContain("Your aim:");
    expect(en.textFor("person-1", 500)).toContain("At stake:");
  });
});

// ---- the body: blocking, props, faces ---------------------------------------------------------------------------------

function room(): RoomView {
  const w = 12;
  const h = 12;
  const person = (ref: string, name: string, tile: [number, number]) => ({ ref, name, kind: "actor" as const, tile, dir: 2 as const, state: "stand" as const, since: 0, lastMovedAt: 0 });
  return {
    id: "12", name: "Terraço", template: "t", w, h, rev: 1, syncedAtWall: 0, door: [0, 5], doorDir: 2, heights: new Uint8Array(w * h).fill(1), stale: false, adjacency: [], degraded: false,
    furni: [
      { id: 1, defId: "table", label: "mesa", kinds: ["table"], tiles: [[6, 6], [7, 6]], front: [[6, 5]], state: 0 },
      { id: 2, defId: "safe", label: "cofre", kinds: ["decor"], tiles: [[10, 2]], front: [[10, 3]], state: 0 },
    ],
    zones: [{ id: "z1", kind: "window", label: "janela", center: [2, 9], radius: 2, furniIds: [], tags: [], source: "keyword" }],
    occupants: [person("person-1", "Heloísa", [3, 3]), person("person-2", "Otávio", [8, 8])],
  };
}
const ctx = (self = "person-1"): StageCtx => ({ room: room(), self, rng: () => 0.5, tileOf: (ref) => room().occupants.find((p) => p.ref === ref)?.tile, isPerson: (ref) => ref.startsWith("person-"), now: 1, plan: "drama:sheet:x" });
const chebyshev = (a: readonly number[], b: readonly number[]): number => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!));
/** The tile of a planned walk. */
const walkTo = (c: PlannedCommand | undefined): readonly [number, number] => {
  if (!c || c.cmd !== "walk") throw new Error("not a walk");
  return c.to as [number, number];
};

describe("planBlock, planProp, planFace", () => {
  it("walks beside a person, to a piece of furniture's front, or to a zone", () => {
    const person = planBlock({ near: "person-2" }, "walk", ctx())!;
    expect(person[0]).toMatchObject({ agentId: "person-1", cmd: "walk", plan: "drama:sheet:x" });
    expect(chebyshev(walkTo(person[0]), [8, 8])).toBeLessThanOrEqual(1);
    const furniture = planBlock({ near: "mesa" }, "enter", ctx())!;
    expect(chebyshev(walkTo(furniture[0]), [6, 5])).toBeLessThanOrEqual(1);
    const zone = planBlock({ zone: "janela" }, "walk", ctx())!;
    expect(chebyshev(walkTo(zone[0]), [2, 9])).toBeLessThanOrEqual(2);
    expect(planBlock({ tile: [9, 9] }, "walk", ctx())).toHaveLength(1);
  });

  it("a name the room does not have is 'nowhere to go' (the player may release it late), and a person already there is nothing to do", () => {
    expect(planBlock({ near: "lareira" }, "walk", ctx())).toBeUndefined();
    expect(planBlock({ zone: "piscina" }, "walk", ctx())).toBeUndefined();
    expect(planBlock({ tile: [3, 3] }, "walk", { ...ctx(), rng: () => 0 })).toEqual([]);
  });

  it("exit goes out through the door", () => {
    expect(walkTo(planBlock({ near: "mesa" }, "exit", ctx())![0])).toEqual([0, 5]);
  });

  it("show and hand walk up to the person and face them; take and read go to the object; break is a flash of anger", () => {
    const show = planProp("show", "envelope", "person-2", ctx());
    expect(show.map((c) => c.cmd)).toEqual(["walk", "face"]);
    const take = planProp("take", "cofre", undefined, ctx());
    expect(take.map((c) => c.cmd)).toEqual(["walk", "face"]);
    expect(planProp("break", "vaso", undefined, ctx())).toEqual([{ agentId: "person-1", cmd: "expression", face: "angry" }]);
    expect(planProp("take", "envelope", undefined, ctx())).toEqual([]);
  });

  it("a face the wire lacks is the nearest old one", () => {
    expect(planFace("person-1", "fear")).toEqual([{ agentId: "person-1", cmd: "expression", face: "surprised" }]);
    expect(planFace("person-1", "smug", ["smug"])).toEqual([{ agentId: "person-1", cmd: "expression", face: "smug" }]);
    expect(chebyshev(placeToTile({ zone: "janela" }, ctx()) ?? [99, 99], [2, 9])).toBeLessThanOrEqual(2);
  });
});

// ---- the authored silence --------------------------------------------------------------------------------------------

describe("SheetRuntime: an authored pause holds the lines, not the body", () => {
  function runtime() {
    const clock = new ManualClock();
    const sent: Array<PlannedCommand[]> = [];
    const chats: string[] = [];
    const rt = new SheetRuntime(sheet, {
      run: 1, clock, rng: () => 0.5, logger: { debug() {}, info() {}, warn() {}, error() {} } as never, view: () => undefined, send: () => undefined, isOwn: () => true, isGone: () => false, port: () => undefined,
      drama: resolveRunDrama({ drama: defaultSceneDrama(["person-1", "person-2", "person-3"])! }), wireOf: () => undefined, names: NAMES, language: "pt-BR",
    });
    const wrapped = rt.wrap({
      send: (c) => void sent.push(c),
      sendChat: (c) => (chats.push(c.text), true),
      sendThought: () => undefined,
    });
    return { clock, rt, wrapped, sent, chats };
  }

  it("without a pause everything passes at once", () => {
    const { wrapped, sent, chats } = runtime();
    wrapped.send([{ agentId: "person-1", cmd: "chat", mode: "say", text: "oi" }, { agentId: "person-1", cmd: "walk", to: [1, 1] }]);
    wrapped.sendChat!({ agentId: "person-2", cmd: "chat", mode: "say", text: "olá" });
    expect(sent).toHaveLength(1);
    expect(chats).toEqual(["olá"]);
  });

  it("during a pause the lines wait and the walks pass; after it they come out one at a time, in order, none lost", async () => {
    const { clock, rt, wrapped, sent, chats } = runtime();
    rt.start();
    const pause = sheet.beats.find((b) => b.kind === "pause")!;
    await clock.advance(pause.at_ms + 100);
    wrapped.send([{ agentId: "person-1", cmd: "chat", mode: "say", text: "primeira" }, { agentId: "person-1", cmd: "walk", to: [1, 1] }, { agentId: "person-2", cmd: "typing", on: true }]);
    wrapped.sendChat!({ agentId: "person-2", cmd: "chat", mode: "say", text: "segunda" });
    // the walk went through; the typing indicator and the lines did not
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((c) => c.cmd)).toEqual(["walk"]);
    expect(chats).toEqual([]);
    await clock.advance(pause.kind === "pause" ? pause.ms : 0);
    await clock.advance(200);
    expect(sent.flat().filter((c) => c.cmd === "chat").map((c) => (c as { text: string }).text)).toEqual(["primeira"]);
    expect(chats).toEqual([]);
    await clock.advance(1_500);
    expect(chats).toEqual(["segunda"]);
    rt.stop();
  });
});
