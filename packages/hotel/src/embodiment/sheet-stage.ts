import { wireFace } from "@perfectman/shared";
import type { Face, PropOp, RoomView, SheetPlace, Tile } from "@perfectman/shared";
import { chebyshev } from "../space/geometry.js";
import { pickTile } from "./tiles.js";
import type { PlannedCommand } from "./types.js";

/**
 * The beat sheet's blocking, props and faces as body commands (Contract A: `block`, `prop`, `expression`). Pure: the room as the actor sees it comes in, planned
 * commands come out, nothing is sent. A name the room does not have is not an error here (the sheet may be written before the room is known): the nearest
 * thing that can be reached is used, and `undefined`/empty says there was nowhere to go, which the sheet player may release late.
 */

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();

/** A furniture or zone whose label the name matches (whole-word first, then either containing the other). */
function findPlace(room: RoomView, name: string): { tile: Tile; front?: Tile; label: string } | undefined {
  const key = fold(name);
  if (key === "") return undefined;
  const items: Array<{ label: string; tile: Tile; front?: Tile }> = [
    ...room.furni.map((f) => ({ label: fold(f.label), tile: (f.front[0] ?? f.tiles[0] ?? [0, 0]) as Tile, ...(f.front[0] ? { front: f.front[0] as Tile } : {}) })),
    ...room.zones.map((z) => ({ label: fold(`${z.label} ${z.kind}`), tile: z.center as Tile })),
  ];
  const exact = items.find((i) => i.label.split(" ").includes(key) || i.label === key);
  const loose = exact ?? items.find((i) => i.label !== "" && (i.label.includes(key) || key.includes(i.label)));
  return loose;
}

export type StageCtx = {
  room: RoomView;
  /** The actor being moved. */
  self: string;
  rng: () => number;
  /** A person's tile in the room, by agent ref (own actors and, if present, humans). */
  tileOf: (ref: string) => Tile | undefined;
  /** Whether a name is an agent ref of the scene (so `near: "person-2"` walks up to a person, not to a chair). */
  isPerson: (ref: string) => boolean;
  now: number;
  /** The plan id the walk carries; the executor holds commands that wait for its arrival. */
  plan: string;
};

/** The tile `place` stands for in this room, or undefined when there is nowhere sensible to go. */
export function placeToTile(place: SheetPlace, ctx: StageCtx): Tile | undefined {
  const { room, self, rng } = ctx;
  if (place.tile) return pickTile({ room, self, near: place.tile, radius: 1, rng }) ?? undefined;
  if (place.near !== undefined) {
    if (ctx.isPerson(place.near)) {
      const at = ctx.tileOf(place.near);
      if (at) return pickTile({ room, self, near: at, radius: 1, awayFrom: { tile: at, ideal: 1 }, rng }) ?? undefined;
    }
    const found = findPlace(room, place.near);
    if (found) return pickTile({ room, self, near: found.front ?? found.tile, radius: 1, rng }) ?? undefined;
  }
  if (place.zone !== undefined) {
    const found = findPlace(room, place.zone);
    if (found) return pickTile({ room, self, near: found.tile, radius: 2, rng }) ?? undefined;
  }
  return undefined;
}

/** `block`: the walk to the place (or out through the door for `exit`). Empty when the actor is already there; undefined when there is nowhere to go (the player may try again later). */
export function planBlock(place: SheetPlace, how: "walk" | "enter" | "exit" | "storm" | undefined, ctx: StageCtx): PlannedCommand[] | undefined {
  const me = ctx.room.occupants.find((p) => p.ref === ctx.self);
  const to = how === "exit" ? (ctx.room.door as Tile) : placeToTile(place, ctx);
  if (!to) return undefined;
  if (me && chebyshev(me.tile, to) === 0) return [];
  return [{ agentId: ctx.self, cmd: "walk", to, plan: ctx.plan }];
}

/**
 * `prop`: the body part of handling an object. The room has no verb for holding one, so the actor goes where the thing is (the furniture or, for `hand` and
 * `show`, the person it is for) and faces it; what the prop *is* reaches the talk through the actor's note (`SheetNotes`). `break` is a flash of anger.
 */
export function planProp(op: PropOp, prop: string, to: string | undefined, ctx: StageCtx): PlannedCommand[] {
  const out: PlannedCommand[] = [];
  const personTarget = to !== undefined && ctx.isPerson(to) ? to : undefined;
  if ((op === "hand" || op === "show") && personTarget) {
    const at = ctx.tileOf(personTarget);
    const me = ctx.room.occupants.find((p) => p.ref === ctx.self);
    if (at && me && chebyshev(me.tile, at) > 1) {
      const step = pickTile({ room: ctx.room, self: ctx.self, near: at, radius: 1, awayFrom: { tile: at, ideal: 1 }, rng: ctx.rng });
      if (step) out.push({ agentId: ctx.self, cmd: "walk", to: step, plan: ctx.plan });
    }
    if (at) out.push({ agentId: ctx.self, cmd: "face", targetTile: at });
    return out;
  }
  const found = findPlace(ctx.room, prop);
  if (found && op !== "break") {
    const me = ctx.room.occupants.find((p) => p.ref === ctx.self);
    const goal = found.front ?? found.tile;
    if (me && chebyshev(me.tile, goal) > 1) {
      const step = pickTile({ room: ctx.room, self: ctx.self, near: goal, radius: 1, rng: ctx.rng });
      if (step) out.push({ agentId: ctx.self, cmd: "walk", to: step, plan: ctx.plan });
    }
    out.push({ agentId: ctx.self, cmd: "face", targetTile: found.tile });
  }
  if (op === "break") out.push({ agentId: ctx.self, cmd: "expression", face: wireFace("angry") });
  return out;
}

/** `expression`: the face, with a new one nearest the old ones until the wire has fear, disgust and smug. */
export function planFace(actor: string, face: Face, native?: readonly string[]): PlannedCommand[] {
  return [{ agentId: actor, cmd: "expression", face: wireFace(face, native) }];
}
