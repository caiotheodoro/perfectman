import type {
  BlockedReason,
  BodyHandleMap,
  BodyHandleTarget,
  BodyIntent,
  FurniModel,
  Presence,
  RoomView,
  SpaceView,
  Tile,
  Zone,
} from "@perfectman/shared";
import { ACT_TARGET_MODE } from "@perfectman/shared";
import {
  CMD_BUDGET_COUNT,
  CMD_BUDGET_WINDOW_MS,
  GESTURE_COOLDOWN_MS,
  PENDING_SPEECH_GRACE_MS,
  PUBLIC_MAX_TILES,
  SAY_CLEAR_TILES,
  TICK_MS,
} from "../space/constants.js";
import { bandRadius, chebyshev } from "../space/geometry.js";
import { findPath, ringTiles, routeEtaMs } from "../space/pathing.js";
import { zoneGoalTiles } from "../space/derive-zones.js";

export type BodyValidation = {
  /** The parts that survive. Handles are kept as the model wrote them (an auto-chosen seat gets a synthetic `f<1000+id>`). */
  accepted: BodyIntent;
  /** One entry per refused or degraded part; operator-visible, one line fed back next pulse. */
  blocked: BlockedReason[];
  /** Handle -> target for every handle that appears in `accepted`. */
  targets: Record<string, BodyHandleTarget>;
};

const BUSY_REMAINING_MS = 2000;

/**
 * Pure, never throws, never touches the speech half of the intent
 * (embodiment.md 6.2, ADR-0019 D-70). `handles` is the map the perception
 * builder minted for this render.
 */
export function validateBodyIntent(
  view: SpaceView,
  agentId: string,
  body: BodyIntent,
  now: number,
  handles: BodyHandleMap,
): BodyValidation {
  try {
    return validate(view, agentId, body, now, handles);
  } catch {
    return {
      accepted: { order: body.order ?? "move_then_speak" },
      blocked: [{ code: "stale_space" }],
      targets: {},
    };
  }
}

type Ctx = {
  view: SpaceView;
  room: RoomView;
  self: Presence;
  agentId: string;
  now: number;
  handles: BodyHandleMap;
  blocked: BlockedReason[];
  used: Set<string>;
  extra: Record<string, BodyHandleTarget>;
};

function validate(view: SpaceView, agentId: string, body: BodyIntent, now: number, handles: BodyHandleMap): BodyValidation {
  const order = body.order ?? "move_then_speak";
  const accepted: BodyIntent = { order };
  const blocked: BlockedReason[] = [];
  const room = view.room;
  const self = view.self ?? room?.occupants.find((o) => o.ref === agentId);
  if (!room || !self || room.stale || room.degraded) {
    blocked.push({ code: "stale_space" });
    return { accepted, blocked, targets: {} };
  }
  const ctx: Ctx = { view, room, self, agentId, now, handles, blocked, used: new Set(), extra: {} };

  // Command budget: moves are never dropped; then the drama act (the director already vets it), then posture, gesture,
  // expression, face in that order of value.
  const wanted = (["move", "act", "posture", "gesture", "expression", "face"] as const).filter((k) => body[k] !== undefined);
  const used = view.body.budget.cmdTimes.filter((t) => now - t < CMD_BUDGET_WINDOW_MS).length;
  const slots = Math.max(0, CMD_BUDGET_COUNT - used);
  const kept = new Set<string>();
  for (const part of wanted) {
    if (part === "move" || kept.size < slots) kept.add(part);
    else blocked.push({ code: "slow_down", part });
  }

  if (kept.has("move") && body.move) {
    const move = moveFor(ctx, body.move);
    if (move) accepted.move = move;
  }
  if (kept.has("act") && body.act) {
    const act = actFor(ctx, body.act);
    if (act) accepted.act = act;
  }
  if (kept.has("posture") && body.posture) {
    const posture = postureFor(ctx, body.posture);
    if (posture) accepted.posture = posture;
  }
  if (kept.has("gesture") && body.gesture) {
    const g = gestureFor(ctx, body.gesture, accepted.move !== undefined);
    if (g) {
      accepted.gesture = g.gesture;
      if (g.move) accepted.move = g.move;
    }
  }
  if (kept.has("expression") && body.expression) accepted.expression = body.expression;
  if (kept.has("face") && body.face) {
    const h = lookup(ctx, body.face, "face", ["person", "furni", "zone"]);
    if (h && presentInRoom(ctx, h.target)) {
      accepted.face = body.face;
      ctx.used.add(body.face);
    }
  }

  const targets: Record<string, BodyHandleTarget> = { ...ctx.extra };
  for (const handle of ctx.used) {
    const t = handles[handle];
    if (t) targets[handle] = t;
  }
  return { accepted, blocked, targets };
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Part = NonNullable<BlockedReason["part"]>;

function lookup(
  ctx: Ctx,
  handle: string,
  part: Part,
  kinds: BodyHandleTarget["kind"][],
): { target: BodyHandleTarget } | undefined {
  const target = ctx.handles[handle];
  if (!target || !kinds.includes(target.kind)) {
    ctx.blocked.push({ code: "unknown_ref", part, ref: handle });
    return undefined;
  }
  return { target };
}

/** True when the target is in the agent's room; otherwise records target_elsewhere. */
function presentInRoom(ctx: Ctx, target: BodyHandleTarget, handle?: string, part: Part = "face"): boolean {
  const here = (() => {
    switch (target.kind) {
      case "person": return ctx.room.occupants.some((o) => o.ref === target.ref);
      case "zone": return target.roomId === ctx.room.id && ctx.room.zones.some((z) => z.id === target.zoneId);
      case "furni": return target.roomId === ctx.room.id && ctx.room.furni.some((f) => f.id === target.furniId);
      case "room": return true;
    }
  })();
  if (!here) ctx.blocked.push({ code: "target_elsewhere", part, ref: handle ?? "" });
  return here;
}

function person(ctx: Ctx, ref: string): Presence | undefined {
  return ctx.room.occupants.find((o) => o.ref === ref);
}

function zoneOf(ctx: Ctx, target: { zoneId: string }): Zone | undefined {
  return ctx.room.zones.find((z) => z.id === target.zoneId);
}

function furniOf(ctx: Ctx, id: number): FurniModel | undefined {
  return ctx.room.furni.find((f) => f.id === id);
}

function routeTo(ctx: Ctx, goals: Tile[]): Tile[] | null {
  return findPath(ctx.room, ctx.self.tile, goals);
}

function planGoalKey(target: BodyHandleTarget): string {
  switch (target.kind) {
    case "person": return target.ref;
    case "zone": return target.zoneId;
    case "furni": return String(target.furniId);
    case "room": return target.roomId;
  }
}

type Move = NonNullable<BodyIntent["move"]>;

function moveFor(ctx: Ctx, move: Move): Move | undefined {
  const { view, now } = ctx;
  if (move.kind === "stay") return move;

  const plan = view.body.plan;
  const inFlight = plan?.status === "moving";
  const remaining = plan ? plan.etaMs - (now - plan.startedAt) : 0;
  const busy = (target?: BodyHandleTarget): boolean =>
    inFlight &&
    move.kind !== "leave" &&
    move.kind !== "keep_distance" &&
    (remaining <= BUSY_REMAINING_MS || (target !== undefined && plan?.goal === planGoalKey(target)));

  if (move.kind === "leave") {
    if (move.to !== undefined) {
      const h = lookup(ctx, move.to, "move", ["room"]);
      if (!h || h.target.kind !== "room") return undefined;
      if (!ctx.view.adjacency.some((a) => a.roomId === (h.target as { roomId: string }).roomId)) {
        ctx.blocked.push({ code: "room_unreachable", part: "move", ref: move.to });
        return undefined;
      }
      ctx.used.add(move.to);
      return move;
    }
    if (ctx.view.adjacency.length === 0) {
      ctx.blocked.push({ code: "room_unreachable", part: "move" });
      return undefined;
    }
    return move;
  }

  if (move.kind === "approach" || move.kind === "follow" || move.kind === "keep_distance") {
    const handle = move.target;
    const h = lookup(ctx, handle, "move", ["person"]);
    if (!h || h.target.kind !== "person") return undefined;
    const other = person(ctx, h.target.ref);
    if (!other) {
      ctx.blocked.push({ code: "target_elsewhere", part: "move", ref: handle });
      return undefined;
    }
    if (move.kind === "keep_distance") {
      ctx.used.add(handle);
      return move;
    }
    if (busy(h.target)) {
      ctx.blocked.push({ code: "busy_moving", part: "move", ref: handle });
      return undefined;
    }
    const r = move.kind === "approach" ? bandRadius(move.band ?? "personal") : 1;
    if (move.kind === "approach" && chebyshev(ctx.self.tile, other.tile) <= r) {
      ctx.used.add(handle);
      return move;
    }
    let route: Tile[] | null = null;
    for (let d = r; d <= r + 2 && route === null; d++) route = routeTo(ctx, ringTiles(ctx.room, other.tile, d));
    if (route === null) {
      ctx.blocked.push({ code: "no_route", part: "move", ref: handle });
      return undefined;
    }
    ctx.used.add(handle);
    return move;
  }

  // go_to
  const handle = move.place;
  const h = lookup(ctx, handle, "move", ["zone", "furni", "room", "person"]);
  if (!h) return undefined;
  const t = h.target;
  if (t.kind === "room") {
    if (t.roomId !== ctx.room.id && !ctx.view.adjacency.some((a) => a.roomId === t.roomId)) {
      ctx.blocked.push({ code: "room_unreachable", part: "move", ref: handle });
      return undefined;
    }
    ctx.used.add(handle);
    return move;
  }
  if (t.kind === "person") {
    const other = person(ctx, t.ref);
    if (!other) {
      ctx.blocked.push({ code: "target_elsewhere", part: "move", ref: handle });
      return undefined;
    }
    if (busy(t)) {
      ctx.blocked.push({ code: "busy_moving", part: "move", ref: handle });
      return undefined;
    }
    const route = routeTo(ctx, ringTiles(ctx.room, other.tile, 2).concat(ringTiles(ctx.room, other.tile, 1)));
    if (route === null) {
      ctx.blocked.push({ code: "no_route", part: "move", ref: handle });
      return undefined;
    }
    ctx.used.add(handle);
    return move;
  }
  if (!presentInRoom(ctx, t, handle, "move")) return undefined;
  if (busy(t)) {
    ctx.blocked.push({ code: "busy_moving", part: "move", ref: handle });
    return undefined;
  }
  let goals: Tile[];
  let alreadyThere = false;
  if (t.kind === "zone") {
    const zone = zoneOf(ctx, t)!;
    alreadyThere = chebyshev(ctx.self.tile, zone.center) <= zone.radius && zone.furniIds.length === 0;
    goals = zoneGoalTiles(ctx.room, zone);
  } else {
    const f = furniOf(ctx, t.furniId)!;
    goals = f.front.length > 0 ? [...f.front] : [...f.tiles];
  }
  if (!alreadyThere && routeTo(ctx, goals) === null) {
    ctx.blocked.push({ code: "no_route", part: "move", ref: handle });
    return undefined;
  }
  ctx.used.add(handle);
  return move;
}

type Act = NonNullable<BodyIntent["act"]>;

/**
 * The drama `act` (act-contract.md 11.5). Only the act is dropped on a bad target, never the rest of the block or the
 * speech: a verb that needs a target and has none (ACT-7), a solo verb that has one (ACT-8), a handle that is not a
 * `p#` person, a person who is not here, or the actor itself.
 */
function actFor(ctx: Ctx, act: Act): Act | undefined {
  if (ACT_TARGET_MODE[act.verb] === "none") {
    if (act.target === undefined) return act;
    ctx.blocked.push({ code: "unknown_ref", part: "act", ref: act.target, detail: "target_forbidden" });
    return undefined;
  }
  if (act.target === undefined) {
    ctx.blocked.push({ code: "unknown_ref", part: "act", detail: "target_required" });
    return undefined;
  }
  const h = lookup(ctx, act.target, "act", ["person"]);
  if (!h || h.target.kind !== "person") return undefined;
  if (h.target.ref === ctx.agentId) {
    ctx.blocked.push({ code: "unknown_ref", part: "act", ref: act.target, detail: "self" });
    return undefined;
  }
  if (!presentInRoom(ctx, h.target, act.target, "act")) return undefined;
  ctx.used.add(act.target);
  return act;
}

type Posture = NonNullable<BodyIntent["posture"]>;

function postureFor(ctx: Ctx, posture: Posture): Posture | undefined {
  if (posture.pose === "stand" || posture.at === undefined) return posture;
  const wantsKind = posture.pose === "sit" ? "sit" : "lay";
  const fits = (f: FurniModel): boolean => f.kinds.includes(wantsKind) || (wantsKind === "lay" && f.kinds.includes("bed"));
  const takenBy = (f: FurniModel): Presence | undefined =>
    ctx.room.occupants.find((o) => o.ref !== ctx.agentId && o.seatId === f.id);

  const h = lookup(ctx, posture.at, "posture", ["furni", "zone"]);
  if (!h) return { pose: posture.pose };
  const t = h.target;
  if (!presentInRoom(ctx, t, posture.at, "posture")) return undefined;

  let seat: FurniModel | undefined;
  if (t.kind === "furni") seat = furniOf(ctx, t.furniId);
  else if (t.kind === "zone") {
    const zone = zoneOf(ctx, t)!;
    const seats = zone.furniIds.map((id) => furniOf(ctx, id)).filter((f): f is FurniModel => f !== undefined && fits(f));
    seat = pickFreeSeat(ctx, seats, takenBy);
    if (!seat) {
      ctx.blocked.push(seats.length === 0 ? { code: "not_a_seat", part: "posture", ref: posture.at } : { code: "seat_taken", part: "posture", ref: zone.label });
      return seats.length === 0 ? { pose: posture.pose } : undefined;
    }
  }
  if (!seat) return undefined;
  if (!fits(seat)) {
    ctx.blocked.push({ code: "not_a_seat", part: "posture", ref: seat.label });
    return { pose: posture.pose };
  }
  const occupant = takenBy(seat);
  let chosen = seat;
  if (occupant) {
    const zone = ctx.room.zones.find((z) => z.furniIds.includes(seat!.id) && (z.kind === "seating" || z.kind === "bar"));
    const mates = (zone?.furniIds ?? []).map((id) => furniOf(ctx, id)).filter((f): f is FurniModel => f !== undefined && fits(f) && f.id !== seat!.id);
    const alt = pickFreeSeat(ctx, mates, takenBy);
    if (!alt) {
      ctx.blocked.push({ code: "seat_taken", part: "posture", ref: seat.label, detail: occupant.name });
      return undefined;
    }
    chosen = alt;
  }
  if (routeTo(ctx, [...chosen.tiles]) === null && ctx.self.seatId !== chosen.id) {
    ctx.blocked.push({ code: "no_route", part: "posture", ref: chosen.label });
    return undefined;
  }
  if (chosen.id === seat.id) {
    ctx.used.add(posture.at);
    return posture;
  }
  const synthetic = `f${1000 + chosen.id}`;
  ctx.extra[synthetic] = { kind: "furni", roomId: ctx.room.id, furniId: chosen.id };
  return { pose: posture.pose, at: synthetic };
}

function pickFreeSeat(ctx: Ctx, seats: FurniModel[], takenBy: (f: FurniModel) => Presence | undefined): FurniModel | undefined {
  return seats
    .filter((f) => !takenBy(f))
    .sort(
      (a, b) =>
        chebyshev(ctx.self.tile, a.tiles[0] ?? ctx.self.tile) - chebyshev(ctx.self.tile, b.tiles[0] ?? ctx.self.tile) || a.id - b.id,
    )[0];
}

type Gesture = NonNullable<BodyIntent["gesture"]>;

function gestureFor(ctx: Ctx, gesture: Gesture, hasMove: boolean): { gesture: Gesture; move?: Move } | undefined {
  const last = ctx.view.body.dwell.lastGestureAt[gesture.kind];
  if (last !== undefined && ctx.now - last < GESTURE_COOLDOWN_MS) {
    ctx.blocked.push({ code: "cooldown", part: "gesture", ref: gesture.kind });
    return undefined;
  }
  if (gesture.toward === undefined) return { gesture };
  const h = lookup(ctx, gesture.toward, "gesture", ["person"]);
  if (!h || h.target.kind !== "person") return undefined;
  const other = person(ctx, h.target.ref);
  if (!other) {
    ctx.blocked.push({ code: "target_elsewhere", part: "gesture", ref: gesture.toward });
    return undefined;
  }
  const dist = chebyshev(ctx.self.tile, other.tile);
  if (gesture.kind === "kiss" && dist > 1) {
    ctx.blocked.push({ code: "too_far", part: "gesture", ref: gesture.toward });
    if (hasMove) {
      ctx.used.add(gesture.toward);
      return { gesture };
    }
    if (routeTo(ctx, ringTiles(ctx.room, other.tile, 1)) === null) {
      ctx.blocked.push({ code: "no_route", part: "gesture", ref: gesture.toward });
      return undefined;
    }
    ctx.used.add(gesture.toward);
    return { gesture, move: { kind: "approach", target: gesture.toward, band: "intimate" } };
  }
  if (gesture.kind !== "kiss" && dist > PUBLIC_MAX_TILES) {
    ctx.blocked.push({ code: "too_far", part: "gesture", ref: gesture.toward });
    const { toward: _dropped, ...rest } = gesture;
    return { gesture: rest };
  }
  ctx.used.add(gesture.toward);
  return { gesture };
}

// ── speech deferral ──────────────────────────────────────────────────────────

export type SpeechDeferral = {
  /** The person the line is for (an actor ref or `h:<id>`; never rendered). */
  targetRef: string;
  /** The handle the model used. */
  targetHandle?: string;
  /** Chebyshev distance now, in tiles. */
  distance: number;
  /** Walking time to say-radius, ms; 0 when no route could be measured. */
  etaMs: number;
  /** now + 2 x ETA + 5 s. */
  expiresAt: number;
};

/**
 * `move_then_speak` holds the line until the speaker reaches its addressee
 * (embodiment.md 6.3). Returns the deferral when the body moves toward a
 * person who is farther than the say radius; null when the line goes out now.
 * `together` counts as `move_then_speak` unless the addressee is already in
 * range and the line is short (<= 80 chars). The addressee defaults to the
 * target of an approach/follow/go_to-a-person move; pass `addresseeRef` when
 * the speech names someone else.
 */
export function speechNeedsDeferral(
  view: SpaceView,
  agentId: string,
  body: BodyIntent,
  handles: BodyHandleMap,
  opts: { now?: number; addresseeRef?: string; speechChars?: number } = {},
): SpeechDeferral | null {
  try {
    const room = view.room;
    const self = view.self ?? room?.occupants.find((o) => o.ref === agentId);
    if (!room || !self || body.order === "speak_then_move") return null;
    const move = body.move;
    let targetHandle: string | undefined;
    if (move && (move.kind === "approach" || move.kind === "follow")) targetHandle = move.target;
    else if (move && move.kind === "go_to") targetHandle = move.place;
    const t = targetHandle ? handles[targetHandle] : undefined;
    const targetRef = opts.addresseeRef ?? (t?.kind === "person" ? t.ref : undefined);
    if (!targetRef) return null;
    const other = room.occupants.find((o) => o.ref === targetRef);
    if (!other) return null;
    const distance = chebyshev(self.tile, other.tile);
    const inRange = distance <= SAY_CLEAR_TILES;
    if (body.order === "together" && inRange && (opts.speechChars ?? 0) <= 80) return null;
    if (inRange) return null;
    if (!move) return null;
    const route = findPath(room, self.tile, ringTiles(room, other.tile, 2).concat(ringTiles(room, other.tile, 1)));
    const etaMs = route ? routeEtaMs(route, TICK_MS) : 0;
    const now = opts.now ?? view.readAt;
    return {
      targetRef,
      ...(targetHandle !== undefined ? { targetHandle } : {}),
      distance,
      etaMs,
      expiresAt: now + 2 * etaMs + PENDING_SPEECH_GRACE_MS,
    };
  } catch {
    return null;
  }
}
