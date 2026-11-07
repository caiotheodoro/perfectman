import type { BodyCommand, BodyCommandBody, Presence, RoomView, SpeechMode, Tile, Zone } from "@perfectman/shared";
import { chebyshev, dirDiffDeg, sectorTo } from "../space/geometry.js";
import {
  APPROACH_AT,
  BAND,
  CMD_BUDGET,
  DWELL_POSTURE_MS,
  DWELL_ZONE_MS,
  ERRAND_AFTER_MS,
  ERRAND_COOLDOWN_MS,
  ERRAND_STAY_MS,
  FACE_TOLERANCE_DEG,
  FIDGET_COOLDOWN_MS,
  GESTURE_COOLDOWN_MS,
  HUMAN_FACE_HOLD_MS,
  INITIATIVE_COOLDOWN_MS,
  INTERLOCUTOR_MS,
  LAUGH_COOLDOWN_MS,
  MAX_APPROACHERS,
  PAIR_ACQUAINTED_MS,
  PAIR_REFUSAL_COOLDOWN_MS,
  PAIR_TRIES_PER_PERSON,
  POSTURE_JITTER_MS,
  REACH_ATTRACTION,
  REACH_COMFORT,
  SEAT_RANGE,
  SEAT_TRY_COOLDOWN_MS,
  SHOUT_COOLDOWN_MS,
  SIT_EVERY_MS,
  SIT_STAY_MS,
  SPEAKER_RECENT_MS,
  WITHDRAW_AT,
} from "./constants.js";
import { tileKey } from "../space/geometry.js";
import { blockedTiles, isFree, occupiedTiles, pickTile } from "./tiles.js";
import type { EmbodimentPlanner, PlanInput, PlannedCommand, PlannerMemory, SpeechModeChoice } from "./types.js";

/** Keep priority when over budget: moves never drop, then gestures, facing, fidgets. */
const KEEP = { fidget: 1, face: 2, gesture: 3, move: 4 } as const;
type Cand = { cmd: PlannedCommand; keep: number };

const SIGN_HEART = 11;

/**
 * The embodiment planner (docs/embodiment.md 7). Rule order: the validated
 * `body` intent, then the automatic rules. Anti-jitter: dwell, hysteresis,
 * cooldowns, a 4-commands-per-5-s budget. Pure.
 */
export const plan: EmbodimentPlanner = (input) => {
  const { space, now } = input;
  const room = space.room;
  const self = space.self;
  // Stale or degraded space: no body commands at all (embodiment.md 3.1).
  if (!room || !self || room.stale) return [];

  const used = space.body.budget.cmdTimes.filter((t) => now - t < CMD_BUDGET.windowMs).length;
  const remaining = CMD_BUDGET.count - used;
  if (remaining <= 0) return [];

  const ctx: Ctx = { input, room, self, cands: [], mem: input.memory ?? {} };
  fromBodyIntent(ctx);
  if (!input.bodyIntent?.move) automaticRules(ctx);

  const ranked = ctx.cands
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => b.keep - a.keep || a.i - b.i)
    .slice(0, remaining)
    .sort((a, b) => a.i - b.i);
  return ranked.map((c) => c.cmd);
};

/**
 * Turn toward `targetRef` now (a line was just said between the two), without running the other rules:
 * one `face`, inside the command budget, only when the target is in conversation range (`maxTiles`; a person
 * who calls an actor by name from across the room is answered by a head turn at any distance), the actor is not
 * mid-walk and is not already looking their way. The caller records the exchange in the planner memory.
 */
export function planFacing(input: Pick<PlanInput, "space" | "now">, targetRef: string, maxTiles: number = BAND.socialMax): PlannedCommand[] {
  const { space, now } = input;
  const room = space.room;
  const self = space.self;
  if (!room || !self || room.stale || self.state === "walk") return [];
  if (CMD_BUDGET.count - space.body.budget.cmdTimes.filter((t) => now - t < CMD_BUDGET.windowMs).length <= 0) return [];
  const target = room.occupants.find((p) => p.ref === targetRef);
  if (!target || target.ref === self.ref || chebyshev(target.tile, self.tile) > maxTiles) return [];
  if (dirDiffDeg(sectorTo(self.tile, target.tile), self.dir) <= FACE_TOLERANCE_DEG) return [];
  return [{ agentId: self.ref, cmd: "face", targetTile: target.tile }];
}

/** The planner memory after a line between this actor and `otherRef`: they are in an exchange for a while. */
export function noteExchange(mem: PlannerMemory, otherRef: string, now: number): PlannerMemory {
  return { ...mem, interlocutor: { ref: otherRef, until: now + INTERLOCUTOR_MS }, ...(otherRef.startsWith("h:") ? { holdFace: { ref: otherRef, until: now + HUMAN_FACE_HOLD_MS } } : {}) };
}

type Ctx = { input: PlanInput; room: RoomView; self: Presence; cands: Cand[]; mem: PlannerMemory };

function cmdBase(ctx: Ctx): { agentId: string; intentId?: string } {
  return { agentId: ctx.self.ref, ...(ctx.input.intent?.id ? { intentId: ctx.input.intent.id } : {}) };
}

const planId = (ctx: Ctx): string => `${ctx.self.ref}:${ctx.input.now.toString(36)}`;

function push(ctx: Ctx, keep: number, cmd: BodyCommandBody & { afterArrival?: string; fidget?: boolean }): void {
  ctx.cands.push({ keep, cmd: { ...cmdBase(ctx), ...cmd } as PlannedCommand });
}

// ---- rule 1: the validated body intent ---------------------------------------

function person(ctx: Ctx, handle: string | undefined): Presence | undefined {
  const t = handle ? ctx.input.handles?.[handle] : undefined;
  return t?.kind === "person" ? ctx.room.occupants.find((p) => p.ref === t.ref) : undefined;
}

function zone(ctx: Ctx, handle: string | undefined): Zone | undefined {
  const t = handle ? ctx.input.handles?.[handle] : undefined;
  return t?.kind === "zone" ? ctx.room.zones.find((z) => z.id === t.zoneId) : undefined;
}

function furni(ctx: Ctx, handle: string | undefined): RoomView["furni"][number] | undefined {
  const t = handle ? ctx.input.handles?.[handle] : undefined;
  return t?.kind === "furni" ? ctx.room.furni.find((f) => f.id === t.furniId) : undefined;
}

function walkTo(ctx: Ctx, to: Tile): void {
  push(ctx, KEEP.move, { cmd: "walk", to, plan: planId(ctx) });
}

function freeSeatNear(ctx: Ctx, near: Tile, within: number): RoomView["furni"][number] | undefined {
  const taken = new Set(ctx.room.occupants.filter((p) => p.seatId !== undefined).map((p) => p.seatId));
  return ctx.room.furni
    .filter((f) => f.kinds.includes("sit") && !taken.has(f.id) && f.tiles.some((t) => chebyshev(t, near) <= within))
    .sort((a, b) => chebyshev(a.tiles[0] ?? near, near) - chebyshev(b.tiles[0] ?? near, near))[0];
}

function fromBodyIntent(ctx: Ctx): void {
  const b = ctx.input.bodyIntent;
  if (!b) return;
  const { room, self, input } = ctx;

  const m = b.move;
  if (m) {
    switch (m.kind) {
      case "approach":
      case "follow": {
        const target = person(ctx, m.target);
        if (!target) break;
        const ideal = m.kind === "approach" ? (m.band === "intimate" ? BAND.intimate : m.band === "social" ? 4 : BAND.personal) : BAND.personal;
        if (chebyshev(self.tile, target.tile) <= Math.max(ideal, 1)) break;
        if (crowdedApproach(ctx, target)) break;
        const to = pickTile({ room, self: self.ref, near: target.tile, radius: ideal + 1, awayFrom: { tile: target.tile, ideal }, rng: input.rng, avoid: walkingGoals(ctx) });
        if (to) walkTo(ctx, to);
        break;
      }
      case "go_to": {
        const z = zone(ctx, m.place);
        const f = furni(ctx, m.place);
        if (z) {
          const to = pickTile({ room, self: self.ref, near: z.center, radius: Math.max(1, z.radius), rng: input.rng });
          if (to && chebyshev(self.tile, to) > 0) walkTo(ctx, to);
        } else if (f) {
          const spot = f.front.find((t) => isFree(room, blockedTiles(room), t, occupiedTiles(room, self.ref))) ?? f.front[0];
          if (spot) walkTo(ctx, spot);
        }
        break;
      }
      case "keep_distance": {
        const target = person(ctx, m.target);
        if (!target || chebyshev(self.tile, target.tile) >= m.min) break;
        const to = pickTile({ room, self: self.ref, near: self.tile, radius: m.min, awayFrom: { tile: target.tile, ideal: m.min }, rng: input.rng });
        if (to) walkTo(ctx, to);
        break;
      }
      case "leave": {
        const t = m.to ? input.handles?.[m.to] : undefined;
        const roomId = t?.kind === "room" ? t.roomId : undefined;
        if (roomId !== undefined && chebyshev(self.tile, room.door) <= 1) push(ctx, KEEP.move, { cmd: "move_room", to: roomId });
        else if (roomId !== undefined) {
          const id = planId(ctx);
          push(ctx, KEEP.move, { cmd: "walk", to: room.door, plan: id });
          push(ctx, KEEP.move, { cmd: "move_room", to: roomId, afterArrival: id });
        } else walkTo(ctx, room.door);
        break;
      }
      case "stay":
        break;
    }
  }

  const p = b.posture;
  if (p) {
    if (p.pose === "stand" && self.state !== "stand") push(ctx, KEEP.move, { cmd: "stand" });
    else if (p.pose === "lay" && self.state !== "lay") push(ctx, KEEP.move, { cmd: "lay" });
    else if (p.pose === "sit" && self.state !== "sit") {
      const f = furni(ctx, p.at);
      const z = zone(ctx, p.at);
      const seat = f?.kinds.includes("sit") ? f : freeSeatNear(ctx, (z?.center ?? self.tile) as Tile, z ? Math.max(2, z.radius) : 3);
      if (seat) push(ctx, KEEP.move, { cmd: "sit", furniId: seat.id });
    }
  }

  const g = b.gesture;
  if (g) {
    const toward = person(ctx, g.toward);
    if (g.kind === "kiss" && toward && pairAllowed(ctx, toward)) {
      // The executor owns the choreography (approach, face, act, hold, part).
      push(ctx, KEEP.move, { cmd: "pair", kind: "kiss", with: toward.ref, pair: `pr:${planId(ctx)}` });
    } else {
      if (toward) push(ctx, KEEP.face, { cmd: "face", targetTile: toward.tile });
      gesture(ctx, g.kind, g.style, KEEP.gesture);
    }
  }
  if (b.expression) push(ctx, KEEP.face, { cmd: "expression", face: b.expression });
  const fp = person(ctx, b.face);
  const ff = furni(ctx, b.face);
  if (fp) push(ctx, KEEP.face, { cmd: "face", targetTile: fp.tile });
  else if (ff?.tiles[0]) push(ctx, KEEP.face, { cmd: "face", targetTile: ff.tiles[0] });
}

/**
 * Pair precheck (embodiment.md 7.4): a human target is free (D31, the reaction
 * chip is the consent); an actor target needs attraction and comfort.
 */
function pairAllowed(ctx: Ctx, target: Presence): boolean {
  if (target.kind === "human") return !recentlyRefused(ctx, target);
  const rel = ctx.input.agentState.relationalStates.get(target.ref);
  return rel !== undefined && rel.attraction >= 0.4 && rel.comfort >= 0.4;
}

/** A human who dodged or pushed away one of this actor's pair acts in the last minute is not approached or paired again. */
function recentlyRefused(ctx: Ctx, target: Presence): boolean {
  if (target.kind !== "human") return false;
  const at = ctx.mem.pairRefusedAt?.[target.ref];
  return at !== undefined && ctx.input.now - at < PAIR_REFUSAL_COOLDOWN_MS;
}

/** Tiles other actors are walking to right now: nobody is sent to the same spot. */
function walkingGoals(ctx: Ctx): Set<string> {
  const goals = new Set<string>();
  for (const p of ctx.room.occupants) if (p.ref !== ctx.self.ref && p.kind === "actor" && p.walkGoal) goals.add(tileKey(p.walkGoal));
  return goals;
}

/** A human already has MAX_APPROACHERS actors heading their way: another one would crowd them. */
function crowdedApproach(ctx: Ctx, target: Presence): boolean {
  if (target.kind !== "human") return false;
  let n = 0;
  for (const p of ctx.room.occupants) {
    if (p.ref === ctx.self.ref || p.kind !== "actor" || !p.walkGoal) continue;
    if (chebyshev(p.walkGoal, target.tile) <= BAND.socialMax / 2) n++;
  }
  return n >= MAX_APPROACHERS;
}

/** Gesture with the 15 s cooldown per kind and never the same twice in a row. */
function gesture(ctx: Ctx, kind: string, style: number | undefined, keep: number): boolean {
  const { input, mem } = ctx;
  const last = ctx.input.space.body.dwell.lastGestureAt[kind];
  if (last !== undefined && input.now - last < GESTURE_COOLDOWN_MS) return false;
  if (mem.lastGesture?.a === kind && input.now - mem.lastGesture.at < GESTURE_COOLDOWN_MS * 2) return false;
  const a = kind === "kiss" ? "kiss" : kind;
  push(ctx, keep, { cmd: "gesture", a, ...(style !== undefined ? { style } : kind === "sign" ? { style: SIGN_HEART } : {}) });
  return true;
}

// ---- rules 2-10 ---------------------------------------------------------------

function automaticRules(ctx: Ctx): void {
  const { input, room, self, mem } = ctx;
  const { now, agentState, space } = input;
  const postureOk = now - space.body.dwell.postureSince >= DWELL_POSTURE_MS;
  const placeOk = now - space.body.dwell.placeSince >= DWELL_ZONE_MS;
  const mood = agentState.coreMood;
  const social = agentState.socialEmotions;

  // 2. Face the speaker within 6 tiles, unless already within 45 degrees.
  const speaker = room.occupants
    .filter((p) => p.ref !== self.ref && p.lastSpokeAt !== undefined && now - (p.lastSpokeAt ?? 0) <= SPEAKER_RECENT_MS && chebyshev(p.tile, self.tile) <= BAND.socialMax)
    .sort((a, b) => (b.lastSpokeAt ?? 0) - (a.lastSpokeAt ?? 0))[0];
  // Keep facing whoever the exchange is with, not only whoever spoke last.
  const talking = mem.interlocutor && mem.interlocutor.until > now ? room.occupants.find((p) => p.ref === mem.interlocutor?.ref) : undefined;
  const held = mem.holdFace && mem.holdFace.until > now ? room.occupants.find((p) => p.ref === mem.holdFace?.ref) : undefined;
  const faceTarget = held ?? speaker ?? talking;
  if (faceTarget && self.state !== "walk") {
    const want = sectorTo(self.tile, faceTarget.tile);
    if (dirDiffDeg(want, self.dir) > FACE_TOLERANCE_DEG) push(ctx, KEEP.face, { cmd: "face", targetTile: faceTarget.tile });
  }

  // Interlocutor: the speaker, else the nearest person in conversation range.
  const other = speaker ?? room.occupants.filter((p) => p.ref !== self.ref).sort((a, b) => chebyshev(a.tile, self.tile) - chebyshev(b.tile, self.tile))[0];
  const rel = other ? agentState.relationalStates.get(other.ref) : undefined;
  const closeness = rel?.desireForCloseness ?? 0.5;
  const distance = rel?.desireForDistance ?? 0.2;
  const dist = other ? chebyshev(other.tile, self.tile) : 0;

  // 4. Withdrawal beats approach: strong distance desire or threat inside the personal band.
  if (other && rel && (rel.desireForDistance > 0.6 || rel.threat > 0.5) && dist <= WITHDRAW_AT + 1) {
    const to = pickTile({ room, self: self.ref, near: self.tile, radius: 3, awayFrom: { tile: other.tile, ideal: BAND.personal + 1 }, rng: input.rng });
    if (to && allowedMove(ctx, to)) walkTo(ctx, to);
  } else if (other && speaker && dist >= APPROACH_AT && closeness > distance) {
    // 3. Interlocutor distance: approach to the personal band (dead band 2..3, hysteresis).
    if (!crowdedApproach(ctx, other) && !recentlyRefused(ctx, other)) {
      const to = pickTile({ room, self: self.ref, near: other.tile, radius: 3, awayFrom: { tile: other.tile, ideal: BAND.personal }, rng: input.rng, avoid: walkingGoals(ctx) });
      if (to && allowedMove(ctx, to)) walkTo(ctx, to);
    }
  }

  // 6. Warmth: smile, occasional laugh.
  if (mood.valence > 0.5 && social.affection > 0.3) {
    if (mem.lastExpression !== "smile") push(ctx, KEEP.face, { cmd: "expression", face: "smile" });
    if (input.rng() < 0.25 && (mem.lastLaughAt === undefined || now - mem.lastLaughAt >= LAUGH_COOLDOWN_MS)) {
      gesture(ctx, "laugh", undefined, KEEP.gesture);
    }
  }

  // 7. Shame or anxiety: drift to a corner or wall (dwell >= 30 s in the zone).
  if ((social.shame > 0.6 || social.socialAnxiety > 0.6) && placeOk) {
    const corner = room.zones.filter((z) => z.kind === "corner").sort((a, b) => chebyshev(a.center, self.tile) - chebyshev(b.center, self.tile))[0];
    if (corner && chebyshev(corner.center, self.tile) > 1) {
      const to = pickTile({ room, self: self.ref, near: corner.center, radius: 1, rng: input.rng });
      if (to && allowedMove(ctx, to)) walkTo(ctx, to);
    }
  }

  // 10. Tired: sit at the nearest free seat.
  if (mood.energy < 0.25 && self.state === "stand" && postureOk) {
    const seat = freeSeatNear(ctx, self.tile, 8);
    if (seat) push(ctx, KEEP.move, { cmd: "sit", furniId: seat.id });
  }

  // 8. Fidget after a no_op streak: face something near, or sit if a seat is within 3 tiles.
  if ((input.noOpStreak ?? 0) >= 3 && !talking && (mem.lastFidgetAt === undefined || now - mem.lastFidgetAt >= FIDGET_COOLDOWN_MS)) {
    const seat = self.state === "stand" && postureOk ? freeSeatNear(ctx, self.tile, 3) : undefined;
    if (seat) push(ctx, KEEP.fidget, { cmd: "sit", furniId: seat.id, fidget: true });
    else {
      const thing = room.furni.filter((f) => f.tiles[0] && chebyshev(f.tiles[0], self.tile) <= 4).sort((a, b) => chebyshev(a.tiles[0] ?? self.tile, self.tile) - chebyshev(b.tiles[0] ?? self.tile, self.tile))[0];
      if (thing?.tiles[0]) push(ctx, KEEP.fidget, { cmd: "face", targetTile: thing.tiles[0], fidget: true });
    }
  }

  // 11. Seats are for using: sit down after a long stretch on foot, get up after a long sit. Not while someone
  // is talking with this actor (a seated avatar cannot turn to the person).
  const exchangeOn = speaker !== undefined || talking !== undefined;
  const posture = postureClock(ctx);
  if (!exchangeOn && !ctx.input.bodyIntent?.posture) {
    if (self.state === "stand" && posture >= SIT_EVERY_MS + jitter(self.ref) && (mem.lastSeatTryAt === undefined || now - mem.lastSeatTryAt >= SEAT_TRY_COOLDOWN_MS)) {
      const seat = freeSeatNear(ctx, self.tile, SEAT_RANGE);
      if (seat) push(ctx, KEEP.move, { cmd: "sit", furniId: seat.id });
    } else if (self.state === "sit" && posture >= SIT_STAY_MS + jitter(self.ref)) {
      push(ctx, KEEP.move, { cmd: "stand" });
    }
  }

  // 12. Initiative from what the actor feels and wants. Always inside the budgets, and a pair act on a human is
  // still the reaction chip (D31): the human can dodge, accept or push away, and a refusal is remembered.
  initiative(ctx, exchangeOn);
}


/** Milliseconds since this actor last changed between sitting and standing (or since its first plan). */
function postureClock(ctx: Ctx): number {
  const m = ctx.mem;
  const from = Math.max(m.lastSatAt ?? 0, m.lastStoodAt ?? 0, m.firstPlanAt ?? ctx.input.now);
  return ctx.input.now - from;
}

/** A stable 0..POSTURE_JITTER_MS offset per actor, so the cast does not sit and stand in unison. */
function jitter(ref: string): number {
  let h = 2166136261;
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 16777619);
  return (h >>> 0) % POSTURE_JITTER_MS;
}

/** A wish to go somewhere, in either language: `ir buscar`, `vou`, `passar pela porta`, `go get`. */
const MOVE_VERB = /\b(ir|vou|vai|buscar|pegar|passar|passando|sair|voltar|go|going|fetch|get|head|walk)\b/;
const fold = (text: string): string => text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const hasWord = (text: string, word: string): boolean => word.length >= 3 && new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);

/**
 * Rule 12. What an actor does with no model call behind it, from state it already has:
 *  - it reaches for someone it is attracted to and comfortable with (approach, then a hug or a kiss);
 *  - its authored goal names a person and a gesture ("quer dar um beijo na Ana"): it works up to it once it knows them;
 *  - its goal or its private motive names an adjacent room ("deixou o violão no Quarto"): it goes there, stays a
 *    while, and comes back.
 * Budgets: one initiative pair act per INITIATIVE_COOLDOWN_MS, PAIR_TRIES_PER_PERSON per person, nobody who just
 * refused, nobody the actor has known for less than PAIR_ACQUAINTED_MS, one errand per ERRAND_COOLDOWN_MS.
 */
function initiative(ctx: Ctx, exchange: boolean): void {
  const { input, room, self, mem } = ctx;
  const { now, space, agentState } = input;
  if (self.state === "walk" || input.bodyIntent?.move || input.bodyIntent?.gesture) return;
  const first = mem.firstPlanAt ?? now;
  const text = fold([input.drives?.goalText, input.drives?.motive].filter(Boolean).join(" . "));

  // -- errand to another room, and the way back
  const err = mem.errand;
  if (err && !err.back && room.id === err.to && now - err.at >= ERRAND_STAY_MS && space.adjacency.some((a) => a.roomId === err.from)) {
    pushLeave(ctx, err.from);
    return;
  }
  if (!exchange && now - first >= ERRAND_AFTER_MS && now - (mem.lastErrandAt ?? 0) >= ERRAND_COOLDOWN_MS && MOVE_VERB.test(text)) {
    const dest = space.adjacency.find((a) => a.name !== undefined && hasWord(text, fold(a.name)));
    if (dest) {
      pushLeave(ctx, dest.roomId);
      return;
    }
  }

  // -- reaching for a person
  if (mem.lastInitiativeAt !== undefined && now - mem.lastInitiativeAt < INITIATIVE_COOLDOWN_MS) return;
  const candidates = room.occupants.filter((p) => p.ref !== self.ref);
  const tries = (p: Presence): number => mem.pairTries?.[p.ref] ?? 0;
  for (const p of candidates) {
    if (tries(p) >= PAIR_TRIES_PER_PERSON || recentlyRefused(ctx, p)) continue;
    const rel = agentState.relationalStates.get(p.ref);
    const dist = chebyshev(p.tile, self.tile);
    if (now - first < PAIR_ACQUAINTED_MS || p.state === "walk" || now - p.since < 8000) continue;
    const named = p.name.length >= 3 && hasWord(text, fold(p.name).split(/\s+/)[0] ?? "");
    const wantsKiss = named && /\b(beij\w*|kiss\w*)\b/.test(text);
    const wantsHug = named && /\b(abra[cç]\w*|abrac\w*|hug\w*)\b/.test(text);
    const drawn = rel !== undefined && rel.attraction >= REACH_ATTRACTION && rel.comfort >= REACH_COMFORT && rel.desireForCloseness > rel.desireForDistance && rel.threat < 0.3;
    if (!wantsKiss && !wantsHug && !drawn) continue;
    if (p.kind === "actor" && !pairAllowed(ctx, p)) continue;
    if (dist > BAND.socialMax + 2) continue;
    const kind = wantsKiss || (drawn && (rel?.attraction ?? 0) >= 0.7) ? "kiss" : "hug";
    // The executor walks up, faces, acts, holds and parts; the sidecar asks a human with the chip.
    push(ctx, KEEP.move, { cmd: "pair", kind, with: p.ref, pair: `pi:${planId(ctx)}` });
    return;
  }
}

function pushLeave(ctx: Ctx, roomId: string): void {
  const { room, self } = ctx;
  if (chebyshev(self.tile, room.door) <= 1) push(ctx, KEEP.move, { cmd: "move_room", to: roomId });
  else {
    const id = planId(ctx);
    push(ctx, KEEP.move, { cmd: "walk", to: room.door, plan: id });
    push(ctx, KEEP.move, { cmd: "move_room", to: roomId, afterArrival: id });
  }
}

/** No direction reversal within the dwell window (anti-jitter), except model-chosen moves. */
function allowedMove(ctx: Ctx, to: Tile): boolean {
  const last = ctx.mem.lastMove;
  if (!last || ctx.input.now - last.at >= DWELL_ZONE_MS) return true;
  const dx = to[0] - ctx.self.tile[0];
  const dy = to[1] - ctx.self.tile[1];
  return dx * last.dx + dy * last.dy >= 0;
}

// ---- memory and speech mode ------------------------------------------------------

/** Folds sent commands into the planner memory (the executor calls this on send). */
export function updateMemory(mem: PlannerMemory, cmds: readonly PlannedCommand[], now: number, from: Tile, roomId?: string): PlannerMemory {
  const next: PlannerMemory = { ...mem };
  for (const c of cmds) {
    if (c.cmd === "sit") {
      next.lastSatAt = now;
      next.lastSeatTryAt = now;
    } else if (c.cmd === "stand") next.lastStoodAt = now;
    else if (c.cmd === "pair" && c.pair.startsWith("pi:")) {
      next.lastInitiativeAt = now;
      next.pairTries = { ...next.pairTries, [c.with]: (next.pairTries?.[c.with] ?? 0) + 1 };
    } else if (c.cmd === "move_room" && roomId !== undefined) {
      const back = next.errand?.from === c.to && next.errand.to === roomId;
      next.errand = back ? { ...next.errand!, back: true } : { from: roomId, to: c.to, at: now };
      next.lastErrandAt = now;
    }
    if (c.cmd === "walk") next.lastMove = { at: now, dx: c.to[0] - from[0], dy: c.to[1] - from[1] };
    else if (c.cmd === "gesture") {
      next.lastGesture = { a: c.a, at: now };
      if (c.a === "laugh") next.lastLaughAt = now;
    } else if (c.cmd === "expression") next.lastExpression = c.face;
    if (c.fidget) next.lastFidgetAt = now;
  }
  return next;
}

/** Shouting is the planner's choice, not the model's (embodiment.md 6.3): arousal > 0.8 on shout-worthy text, once per 60 s. */
export function chooseSpeechMode(
  arousal: number,
  content: string,
  mem: PlannerMemory,
  now: number,
  committed: SpeechMode,
): SpeechModeChoice {
  if (committed !== "say") return { mode: committed };
  const letters = content.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const worthy = (content.match(/!/g)?.length ?? 0) >= 2 || (letters.length >= 5 && upper / letters.length > 0.6);
  if (arousal > 0.8 && worthy && (mem.lastShoutAt === undefined || now - mem.lastShoutAt >= SHOUT_COOLDOWN_MS)) {
    return { mode: "shout", reason: "arousal" };
  }
  return { mode: "say" };
}
