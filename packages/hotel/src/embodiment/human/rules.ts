import type { BodyCommandBody, Presence, RoomView, Tile } from "@perfectman/shared";
import { chebyshev, tileKey } from "../../space/geometry.js";
import { SEAT_RANGE } from "../constants.js";
import { blockedTiles, isFree, occupiedTiles, pickTile } from "../tiles.js";
import type { PlanInput, PlannerMemory } from "../types.js";
import { nearestFree, groupSpot, mustUnstack, relationClass, windowFor } from "./proxemics.js";
import { hbetween, hrand } from "./rng.js";
import { HT, chance, clamp, mix } from "./tuning.js";
import type { HumanLine, HumanLogEntry, HumanPlanCtx } from "./types.js";

/** What a human rule asks for, with the keep priority the planner's budget sorts by (moves stay above gestures above faces). */
export type HumanCand = { keep: number; cmd: BodyCommandBody & { afterArrival?: string; humanTag?: string }; log: Omit<HumanLogEntry, "actor"> };

export type HumanRuleCtx = {
  input: PlanInput;
  human: HumanPlanCtx;
  room: RoomView;
  self: Presence;
  mem: PlannerMemory;
  /** Plan id prefix for the walks this layer starts: the planner and the executor can tell them from the model's and the director's. */
  planId: string;
  /** Ms the actor has been in its current posture (the planner's own clock). */
  postureMs: number;
};

/** The id prefix of every walk the human layer starts. Other walks (a model's `go_to`, `drama:`, a beat's block) are never overridden by it. */
export const HUMAN_PLAN_PREFIX = "hl:";

const KEEP_UNSTACK = 4.5;
const KEEP_HIT = 4.2;
const KEEP_PROX = 4;
const KEEP_GROUP = 3.8;
const KEEP_SPACE = 3.7;
const KEEP_IDLE = 3.5;

/** Recent talk that involves `ref`, newest first. */
function mine(lines: readonly HumanLine[], ref: string, now: number, withinMs: number): HumanLine[] {
  return lines.filter((l) => now - l.atMs <= withinMs && (l.speaker === ref || l.to === ref)).reverse();
}

const last = <T>(a: readonly T[]): T | undefined => a[a.length - 1];

/**
 * The human layer's rules for the planner (cinematic revamp B5, plan items 1 and 5): where to stand in a conversation, and what a person does with
 * their body when nobody is talking to them. Called by `plan` only when `input.human` is present with h > 0; at h = 0 nothing here runs, so the body
 * is what it was. At most one walk comes out of a call (people decide one thing at a time), and a hold (a beat sheet's blocking, an act's choreography)
 * silences every rule but the unstacking, which is a safety.
 */
export function humanRules(c: HumanRuleCtx): HumanCand[] {
  const { human, self, room, input, mem } = c;
  const { h } = human;
  const now = input.now;
  const out: HumanCand[] = [];
  const draw = (tag: string, ...k: Array<string | number>): number => hrand(human.seed, tag, self.ref, ...k);
  const bucket = Math.floor(now / 5000);
  let n = 0;
  const rng = (): number => hrand(human.seed, "pick", self.ref, bucket, n++);
  const cool = (tag: string, ms: number): boolean => mem.humanAt?.[tag] !== undefined && now - mem.humanAt[tag]! < ms;
  const walk = (keep: number, to: Tile, rule: string, tag: string, extra: Partial<HumanLogEntry> = {}): void => {
    out.push({ keep, cmd: { cmd: "walk", to, plan: `${HUMAN_PLAN_PREFIX}${c.planId}`, humanTag: tag }, log: { kind: "walk", rule, tile: to, ...extra } });
  };

  // A walk the model, the director or a beat started is theirs: nothing here overrides it.
  if (self.state === "walk") return out;

  // ---- never on top of somebody else ----
  if (mustUnstack(self, room) && !cool("unstack", HT.prox.unstackCooldownMs)) {
    const to = nearestFree(room, self, new Set(room.occupants.filter((p) => p.ref !== self.ref && p.walkGoal).map((p) => tileKey(p.walkGoal!))));
    if (to && self.state !== "sit" && self.state !== "lay") {
      walk(KEEP_UNSTACK, to, "unstack", "unstack");
      return out;
    }
  }
  if (human.hold) return out;

  const lines = mine(human.lines, self.ref, now, 20_000);
  const latest = lines[0];
  const otherRef = latest ? (latest.speaker === self.ref ? latest.to : latest.speaker) : mem.interlocutor && mem.interlocutor.until > now ? mem.interlocutor.ref : undefined;
  const other = otherRef ? room.occupants.find((p) => p.ref === otherRef && p.fallen === undefined) : undefined;
  const exchangeOn = latest !== undefined && now - latest.atMs <= 12_000;
  const mood = input.agentState.coreMood;
  const social = input.agentState.socialEmotions;

  // ---- 1. proxemics: a conversation distance by relation and emotion; never farther than earshot while talking ----
  if (other && self.state === "stand") {
    const rel = input.agentState.relationalStates.get(other.ref);
    const hit = human.hitBy !== undefined && human.hitBy.ref === other.ref && now - human.hitBy.at <= HT.prox.stepBackWithinMs;
    const row = lines.some((l) => l.hostile !== undefined && now - l.atMs <= 25_000) && mood.arousal >= 0.5;
    const cls = relationClass(rel, mood, { heated: row, hit });
    const w = windowFor(cls, h);
    const dist = chebyshev(self.tile, other.tile);
    const outside = dist > w.max || dist < w.min;
    // Who gives way: the one who spoke last to the other (they walk up to be heard), or, when the other spoke last, the one who has waited a pulse for them to come.
    const iSpokeLast = latest?.speaker === self.ref;
    const waited = latest !== undefined && now - latest.atMs >= HT.prox.settleMs;
    const comingMyWay = other.walkGoal !== undefined && chebyshev(other.walkGoal, self.tile) <= w.max;
    const mover = !comingMyWay && (iSpokeLast || waited || latest === undefined || (hit && dist < w.min));
    if (outside && mover && draw("prox", bucket) < chance(HT.prox.moveChance, h) && !cool("prox", 3500)) {
      const reserved = new Set(room.occupants.filter((p) => p.ref !== self.ref && p.walkGoal).map((p) => tileKey(p.walkGoal!)));
      const to = pickTile({ room, self: self.ref, near: other.tile, radius: w.ideal + 2, awayFrom: { tile: other.tile, ideal: w.ideal }, rng, avoid: reserved });
      if (to && chebyshev(to, self.tile) > 0 && chebyshev(to, other.tile) >= w.min) {
        walk(hit ? KEEP_HIT : KEEP_PROX, to, hit ? "step_back" : dist > w.max ? `approach:${cls}` : `give_way:${cls}`, "prox", { to: other.ref, dist, detail: `window ${w.min}-${w.max} ideal ${w.ideal}` });
        return out;
      }
    }
  }

  // ---- 2. a group is a ring, not a line ----
  if (self.state === "stand" && !cool("group", HT.prox.groupAdjustCooldownMs)) {
    const talk = human.lines.filter((l) => now - l.atMs <= 30_000);
    const members = new Set<string>();
    for (const l of talk) {
      members.add(l.speaker);
      if (l.to) members.add(l.to);
    }
    members.delete(self.ref);
    const others = room.occupants.filter((p) => members.has(p.ref) && p.fallen === undefined && chebyshev(p.tile, self.tile) <= HT.prox.groupLinkTiles + 2);
    if (others.length >= HT.prox.groupMinSize - 1 && draw("group", bucket) < chance(0.7, h)) {
      const reserved = new Set(room.occupants.filter((p) => p.ref !== self.ref && p.walkGoal).map((p) => tileKey(p.walkGoal!)));
      const to = groupSpot(self, room, others.map((p) => p.tile), reserved);
      if (to) {
        walk(KEEP_GROUP, to, "group_ring", "group", { detail: `${others.length + 1} in the group` });
        return out;
      }
    }
  }

  // ---- 3. give space to whoever holds the floor ----
  const floor = last(human.lines.filter((l) => now - l.atMs <= 5000 && l.speaker !== self.ref));
  if (floor && floor.to !== self.ref && self.state === "stand" && !cool("space", HT.prox.speakerSpaceCooldownMs)) {
    const speaker = room.occupants.find((p) => p.ref === floor.speaker);
    if (speaker && chebyshev(speaker.tile, self.tile) < HT.prox.speakerSpace && draw("space", bucket) < chance(0.8, h)) {
      const reserved = new Set(room.occupants.filter((p) => p.ref !== self.ref && p.walkGoal).map((p) => tileKey(p.walkGoal!)));
      const to = pickTile({ room, self: self.ref, near: self.tile, radius: 3, awayFrom: { tile: speaker.tile, ideal: HT.prox.speakerSpace + 1 }, rng, avoid: reserved });
      if (to && chebyshev(to, self.tile) > 0) {
        walk(KEEP_SPACE, to, "give_space", "space", { to: speaker.ref });
        return out;
      }
    }
  }

  // ---- 4. idle life, only when nobody is talking to the actor ----
  if (!exchangeOn && !input.bodyIntent?.posture && !input.bodyIntent?.move) idleLife(c, out, { rng, draw, cool, walk, bucket, other });
  return out;
}

type IdleKit = {
  rng: () => number;
  draw: (tag: string, ...k: Array<string | number>) => number;
  cool: (tag: string, ms: number) => boolean;
  walk: (keep: number, to: Tile, rule: string, tag: string, extra?: Partial<HumanLogEntry>) => void;
  bucket: number;
  other: Presence | undefined;
};

function freeSeat(room: RoomView, near: Tile, within: number): RoomView["furni"][number] | undefined {
  const taken = new Set(room.occupants.filter((p) => p.seatId !== undefined).map((p) => p.seatId));
  return room.furni
    .filter((f) => f.kinds.includes("sit") && !taken.has(f.id) && f.tiles.some((t) => chebyshev(t, near) <= within))
    .sort((a, b) => chebyshev(a.tiles[0] ?? near, near) - chebyshev(b.tiles[0] ?? near, near) || a.id - b.id)[0];
}

/** Spots to go to when avoiding someone: a window, a rail, the door. Not within 3 tiles of the person avoided. */
function avoidSpots(room: RoomView): Tile[] {
  const spots: Tile[] = [];
  for (const f of room.furni) {
    const label = `${f.label} ${f.defId}`.toLowerCase();
    if (f.kinds.includes("window") || /window|rail|balcon|parapet|janela/.test(label)) for (const t of f.front.length > 0 ? f.front : f.tiles) spots.push(t);
  }
  spots.push(room.door);
  return spots;
}

function idleLife(c: HumanRuleCtx, out: HumanCand[], k: IdleKit): void {
  const { human, self, room, input, mem } = c;
  const { h } = human;
  const now = input.now;
  const mood = input.agentState.coreMood;
  const social = input.agentState.socialEmotions;
  const standing = self.state === "stand";

  // Sit when tired or beaten.
  const beaten = mood.valence < HT.idle.defeatedValence && Math.max(social.shame, social.humiliation) >= 0.4;
  if (standing && (mood.energy < mix(0.25, HT.idle.tiredEnergy, h) || beaten) && c.postureMs >= 20_000 && !k.cool("tired", 40_000)) {
    const seat = freeSeat(room, self.tile, SEAT_RANGE - 4);
    if (seat) {
      out.push({ keep: KEEP_IDLE, cmd: { cmd: "sit", furniId: seat.id, humanTag: "tired" }, log: { kind: "idle", rule: beaten ? "sit:defeated" : "sit:tired" } });
      return;
    }
  }

  // Avoid: a window, a rail or the door, away from the one who shames or presses them.
  const avoids = Math.max(social.shame, social.humiliation) >= HT.idle.avoidShame || (k.other !== undefined && (input.agentState.relationalStates.get(k.other.ref)?.desireForDistance ?? 0) >= HT.idle.avoidDistance);
  if (standing && avoids && !k.cool("avoid", HT.idle.avoidCooldownMs) && k.draw("avoid", k.bucket) < chance(0.6, h)) {
    const from = k.other?.tile;
    const spots = avoidSpots(room).filter((t) => (from === undefined || chebyshev(t, from) >= 3) && chebyshev(t, self.tile) >= 3);
    const spot = spots.sort((a, b) => chebyshev(a, self.tile) - chebyshev(b, self.tile) || tileKey(a).localeCompare(tileKey(b)))[0];
    const to = spot ? pickTile({ room, self: self.ref, near: spot, radius: 1, rng: k.rng }) : undefined;
    if (to && chebyshev(to, self.tile) > 1) {
      k.walk(KEEP_IDLE, to, "avoid:to_window", "avoid");
      return;
    }
  }

  // Step out of the room for a while after a humiliation, and come back (the errand machinery brings the actor home).
  const humiliated = Math.max(social.humiliation, social.shame) >= HT.idle.stepOutHumiliation;
  if (standing && humiliated && !k.cool("stepout", HT.idle.stepOutCooldownMs) && input.space.adjacency.length > 0 && k.draw("stepout", k.bucket) < chance(0.5, h)) {
    const dest = [...input.space.adjacency].sort((a, b) => a.travelS - b.travelS || a.roomId.localeCompare(b.roomId))[0];
    if (dest) {
      if (chebyshev(self.tile, room.door) <= 1) out.push({ keep: KEEP_IDLE, cmd: { cmd: "move_room", to: dest.roomId, humanTag: "stepout" }, log: { kind: "idle", rule: "step_out", detail: dest.roomId } });
      else {
        const id = `${HUMAN_PLAN_PREFIX}${c.planId}`;
        out.push({ keep: KEEP_IDLE, cmd: { cmd: "walk", to: room.door, plan: id, humanTag: "stepout" }, log: { kind: "idle", rule: "step_out:to_door", tile: room.door } });
        out.push({ keep: KEEP_IDLE, cmd: { cmd: "move_room", to: dest.roomId, afterArrival: id, humanTag: "stepout" }, log: { kind: "idle", rule: "step_out", detail: dest.roomId } });
      }
      return;
    }
  }

  // Pace when anxious: short legs back and forth, not more than a few a minute.
  const anxious = social.socialAnxiety >= HT.idle.paceAnxiety || (mood.arousal >= HT.idle.paceArousal && mood.valence < -0.1);
  const legs = (mem.humanPace ?? []).filter((t) => now - t < 60_000);
  if (standing && anxious && legs.length < HT.idle.paceLegsPerMin && !k.cool("pace", mix(HT.idle.paceEveryMs[1], HT.idle.paceEveryMs[0], h))) {
    const len = Math.round(hbetween(human.seed, HT.idle.paceLegTiles, "pace-len", self.ref, legs.length, k.bucket));
    const back = mem.lastMove ? [-Math.sign(mem.lastMove.dx), -Math.sign(mem.lastMove.dy)] : [Math.sign(hrand(human.seed, "pdx", self.ref) - 0.5), 0];
    const dx = back[0] === 0 && back[1] === 0 ? 1 : back[0]!;
    const dy = back[1] ?? 0;
    const want: Tile = [self.tile[0] + dx * len, self.tile[1] + dy * len];
    const blocked = blockedTiles(room);
    const occupied = occupiedTiles(room, self.ref);
    const to = isFree(room, blocked, want, occupied) ? want : pickTile({ room, self: self.ref, near: want, radius: 1, rng: k.rng });
    if (to && chebyshev(to, self.tile) >= 2) {
      k.walk(KEEP_IDLE - 0.1, to, "pace:anxious", "pace");
      return;
    }
  }

  // Weight shift: sit down after a stretch on foot, get up after a stretch seated, on a human pace and never in unison.
  const period = HT.idle.weightShiftEveryMs / Math.max(0.2, h);
  const jitter = 1 + (hrand(human.seed, "ws", self.ref, Math.floor(c.postureMs / 10_000)) - 0.5) * 2 * HT.idle.weightShiftJitter;
  if (c.postureMs >= clamp(period * jitter, 20_000, 300_000) && !k.cool("shift", 30_000)) {
    if (standing) {
      const seat = freeSeat(room, self.tile, SEAT_RANGE);
      if (seat) out.push({ keep: KEEP_IDLE - 0.2, cmd: { cmd: "sit", furniId: seat.id, humanTag: "shift" }, log: { kind: "idle", rule: "weight_shift:sit" } });
    } else if (self.state === "sit") {
      out.push({ keep: KEEP_IDLE - 0.2, cmd: { cmd: "stand", humanTag: "shift" }, log: { kind: "idle", rule: "weight_shift:stand" } });
    }
  }
}
