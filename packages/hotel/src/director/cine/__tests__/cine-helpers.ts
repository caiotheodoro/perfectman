import type { CineItem, CineMood, CineWorld, NarrationSource, Program, Step, Tile } from "../types.js";
import type { PerfectmanUi } from "../../generated.js";

type Actor = { ref: string; name: string; role?: string; avatar: number; room: number; tile: Tile };

/** Four people in two rooms: Duda and Rafa in the lounge (12), Gabi and Leo in the kitchen (13). */
export class FakeWorld implements CineWorld {
  readonly actors = new Map<string, Actor>();
  readonly moods = new Map<string, CineMood>();
  readonly rooms = new Map<number, string>([[12, "Lounge"], [13, "Cozinha"]]);

  constructor() {
    this.add({ ref: "duda", name: "Duda", role: "conciliadora", avatar: -701, room: 12, tile: [4, 4] });
    this.add({ ref: "rafa", name: "Rafa", role: "cético", avatar: -702, room: 12, tile: [6, 4] });
    this.add({ ref: "gabi", name: "Gabi", role: "performer", avatar: -703, room: 13, tile: [3, 3] });
    this.add({ ref: "leo", name: "Leo", role: "anfitrião", avatar: -704, room: 13, tile: [5, 3] });
  }
  add(a: Actor): void {
    this.actors.set(a.ref, a);
  }
  avatarId(ref: string): number | undefined {
    return this.actors.get(ref)?.avatar;
  }
  nameOf(ref: string): string {
    return this.actors.get(ref)?.name ?? ref;
  }
  roleOf(ref: string): string | undefined {
    return this.actors.get(ref)?.role;
  }
  tileOf(ref: string): Tile | undefined {
    return this.actors.get(ref)?.tile;
  }
  roomOf(ref: string): number | undefined {
    return this.actors.get(ref)?.room;
  }
  occupants(room: number): string[] {
    return [...this.actors.values()].filter((a) => a.room === room).map((a) => a.ref);
  }
  roomName(room: number): string {
    return this.rooms.get(room) ?? `#${room}`;
  }
  moodOf(ref: string): CineMood | undefined {
    return this.moods.get(ref);
  }
  move(ref: string, room: number): void {
    const a = this.actors.get(ref);
    if (a) a.room = room;
  }
}

export const NARRATION: NarrationSource = {
  card: (room, kind) => ({ title: kind === "title" ? "Sexta no lounge" : `Cena ${room}`, subtitle: "com amigos" }),
  caption: (_room, kind) => (kind === "idle" ? "Ninguém diz nada." : "Eles se encontram."),
};

let seq = 0;
export function item<K extends CineItem["kind"]>(kind: K, over: Omit<Extract<CineItem, { kind: K }>, "kind" | "id" | "seq" | "at" | "salience"> & { salience?: number; at?: number }): Extract<CineItem, { kind: K }> {
  seq++;
  return { salience: 0.3, at: 0, ...over, kind, id: `t${seq}`, seq } as Extract<CineItem, { kind: K }>;
}

export const line = (ref: string, text: string, over: { room?: number; to?: string; salience?: number; mode?: "say" | "shout" | "whisper"; at?: number } = {}) =>
  item("line", { ref, text, room: over.room ?? 12, mode: over.mode ?? "say", ...(over.to ? { to: over.to } : {}), ...(over.salience !== undefined ? { salience: over.salience } : {}), ...(over.at !== undefined ? { at: over.at } : {}) });

export const uis = (p: Program): PerfectmanUi[] => p.steps.filter((s): s is Extract<Step, { k: "ui" }> => s.k === "ui").map((s) => s.ui);
export const cameras = (p: Program) => p.steps.flatMap((s) => (s.k === "ui" && s.ui.k === "camera" ? [{ at: s.at, ui: s.ui }] : []));
export const releaseAt = (p: Program): number | undefined => p.steps.find((s) => s.k === "release")?.at;

import { ManualClock } from "../../../clock/manual-clock.js";
import { silentLogger } from "../../../util/log.js";
import type { PlannedCommand } from "../../../embodiment/types.js";
import type { SidecarMsg } from "../../index.js";
import { CinematicDirector } from "../cinematic-director.js";
import { Narrator } from "../narrator.js";
import type { CineConfig } from "../types.js";

export type UiFrame = Extract<SidecarMsg, { t: "ui_push" }>;

/** A cinematic director on a manual clock, with the hotel side recorded: ui frames out, commands to the executor. */
export function rig(over: Partial<CineConfig> = {}, opts: { home?: number } = {}) {
  const clock = new ManualClock();
  const world = new FakeWorld();
  const sent: SidecarMsg[] = [];
  const delivered: Array<{ at: number; cmd: PlannedCommand }> = [];
  const thoughts: string[] = [];
  const inner = {
    send: (cmds: PlannedCommand[]) => void delivered.push(...cmds.map((cmd) => ({ at: clock.now(), cmd }))),
    sendThought: (_agent: string, text: string) => void thoughts.push(text),
  };
  const narrator = new Narrator({ clock, language: "pt-BR" });
  const director = new CinematicDirector({ run: 7, home: opts.home ?? 12, clock, world, narrator, send: (m) => (sent.push(m), true), logger: silentLogger, config: over });
  const exec = director.wrapExecutor(inner);
  const say = (ref: string, text: string, mode: "say" | "shout" | "whisper" = "say", to?: string): void => exec.send([{ agentId: ref, cmd: "chat", mode, text, ...(to ? { to } : {}) }]);
  const frames = (): UiFrame[] => sent.filter((m): m is UiFrame => m.t === "ui_push");
  const spoken = () => delivered.filter((d) => d.cmd.cmd === "chat");
  return { clock, world, sent, delivered, thoughts, inner, narrator, director, exec, say, frames, spoken, t0: clock.now() };
}
