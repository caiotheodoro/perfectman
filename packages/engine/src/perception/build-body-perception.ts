import type {
  AvatarState,
  BodyChange,
  BodyHandleMap,
  BodyHearingLine,
  BodyPerception,
  BodyPersonLine,
  BodyPlaceLine,
  BodyRoomLine,
  CommittedEvent,
  FurniModel,
  HearingLevel,
  Presence,
  RelationalState,
  RoomId,
  SpaceView,
  Zone,
} from "@perfectman/shared";
import {
  ARRIVAL_WINDOW_MS,
  BODY_MAX_TOKENS,
  BODY_TARGET_TOKENS,
  HUMAN_TYPING_EXPIRY_MS,
  SOCIAL_MAX_TILES,
} from "../space/constants.js";
import { sanitizeLabel } from "../space/derive-zones.js";
import { chebyshev, directionStep, distanceBand, facingKind } from "../space/geometry.js";
import type { BodyLanguage } from "../space/text.js";
import {
  compressBodyPerception,
  estimateBodyTokens,
  renderBodyBlock,
  type CompressionLevel,
} from "./render-body-perception.js";

export type BuildBodyPerceptionInput = {
  view: SpaceView;
  /** The agent's visible recent events, oldest first, already redacted for this listener. */
  events?: readonly CommittedEvent[];
  /** The agent's relational states (closeness / threat feed salience). */
  relational?: ReadonlyMap<string, RelationalState>;
  /** ref -> display name for people who are not in the room (arrivals, departures). */
  names?: Readonly<Record<string, string>>;
  /** Room names for rooms that are not the current one; adjacency `name` wins, the id is the last resort. */
  roomNames?: Readonly<Record<RoomId, string>>;
  /** The person the agent is talking with, if the caller knows; else derived from the events. */
  interlocutorRef?: string;
  /** Changes the host diffed itself (for example from the previous view); merged with the derived ones. */
  extraChanges?: BodyChange[];
  language?: BodyLanguage;
  /** Compression stops at the first level that fits (default 350). */
  targetTokens?: number;
  /** Hard cap (default 600): past L3 the builder keeps trimming. */
  maxTokens?: number;
};

export type BuiltBodyPerception = {
  body: BodyPerception;
  /** Only handles that appear in `body`; numbering keeps gaps so a handle never changes meaning within a render. */
  handles: BodyHandleMap;
  level: CompressionLevel;
  tokens: number;
};

const SPEECH_TYPES = new Set(["message_sent", "reply_sent"]);
const ZONE_PRIORITY: Zone["kind"][] = ["bar", "seating", "bed", "window", "feature", "dance_floor", "authored", "decor", "corner", "door", "middle"];
const PLACE_KINDS = new Set<Zone["kind"]>(["bar", "seating", "window", "bed", "feature", "dance_floor", "authored", "door", "corner", "middle"]);
const MAX_PLACES = 8;
const MAX_REACH = 5;

/**
 * Builds the structured "body" block of the perception packet (embodiment.md
 * section 5) and the per-render handle map. Pure. Never exposes ids of people
 * (D43) or whether someone is a human: it reads `Presence.kind` nowhere.
 */
export function buildBodyPerception(input: BuildBodyPerceptionInput): BuiltBodyPerception {
  const language = input.language ?? "pt-BR";
  const target = input.targetTokens ?? BODY_TARGET_TOKENS;
  const cap = input.maxTokens ?? BODY_MAX_TOKENS;

  const full = assemble(input);
  let level: CompressionLevel = 0;
  let body = full.body;
  let tokens = 0;
  for (const l of [0, 1, 2, 3] as const) {
    level = l;
    body = compressBodyPerception(full.body, l);
    tokens = estimateBodyTokens(renderBodyBlock(body, { language }));
    if (tokens <= target) break;
  }
  if (tokens > cap) {
    body = hardTrim(body, cap, language);
    tokens = estimateBodyTokens(renderBodyBlock(body, { language }));
  }

  const present = new Set<string>([
    ...body.people.map((p) => p.handle),
    ...body.places.map((p) => p.handle),
    ...body.reach.map((p) => p.handle),
    ...body.rooms.map((r) => r.handle),
  ]);
  const handles: BodyHandleMap = {};
  for (const [h, t] of Object.entries(full.handles)) if (present.has(h)) handles[h] = t;
  return { body, handles, level, tokens };
}

/** Past L3: drop what matters least until the block fits the hard cap. Pinned people, self, plan and blocked stay. */
function hardTrim(body: BodyPerception, cap: number, language: BodyLanguage): BodyPerception {
  let b = body;
  const fits = (): boolean => estimateBodyTokens(renderBodyBlock(b, { language })) <= cap;
  const steps: ((x: BodyPerception) => BodyPerception)[] = [
    (x) => ({ ...x, changes: [] }),
    (x) => ({ ...x, groups: [] }),
    (x) => ({ ...x, rooms: x.rooms.slice(0, 1), reach: x.reach.slice(0, 1) }),
    (x) => ({ ...x, places: x.places.slice(0, 2) }),
    (x) => ({ ...x, hearing: x.hearing.slice(0, 2) }),
    (x) => ({ ...x, reach: [], rooms: [] }),
  ];
  for (const step of steps) {
    if (fits()) return b;
    b = step(b);
  }
  while (!fits()) {
    const idx = [...b.people].reverse().findIndex((p) => !p.pinned);
    if (idx === -1) break;
    const at = b.people.length - 1 - idx;
    b = { ...b, people: b.people.filter((_, i) => i !== at) };
  }
  while (!fits() && b.places.length > 0) b = { ...b, places: b.places.slice(0, -1) };
  return b;
}

type Assembled = { body: BodyPerception; handles: BodyHandleMap };

function assemble(input: BuildBodyPerceptionInput): Assembled {
  const { view } = input;
  const events = input.events ?? [];
  const blocked = view.body.lastBlocked ?? [];
  const plan = view.body.plan
    ? {
        goal: sanitizeLabel(view.body.plan.goal),
        ...(view.body.plan.status === "moving"
          ? { etaMs: Math.max(0, view.body.plan.etaMs - (view.readAt - view.body.plan.startedAt)) }
          : {}),
        status: view.body.plan.status,
      }
    : undefined;

  const room = view.room;
  const self = view.self;
  if (view.where === "in_transit" || !room) {
    return {
      body: {
        self: { room: "", posture: "stand", dwellS: 0 },
        ...(plan ? { plan } : {}),
        blocked: [...blocked],
        people: [], groups: [], changes: [], hearing: [], reach: [], places: [], rooms: [],
      },
      handles: {},
    };
  }

  const now = view.readAt;
  const handles: BodyHandleMap = {};
  const selfTile = self?.tile ?? room.door;
  const speakers = events.filter((e) => SPEECH_TYPES.has(e.type));
  const lastThree = speakers.slice(-3);
  const recentSpeakerIds = new Set(lastThree.map((e) => e.actorId));

  // Pinned: the interlocutor and whoever the agent last addressed. Never trimmed.
  const pinnedRefs = new Set<string>();
  // Nobody is in a conversation with someone on the floor (DOWN-1): a body is neither pinned nor the interlocutor.
  const onFloor = new Set(room.occupants.filter((o) => o.fallen).map((o) => o.ref));
  const interlocutor = input.interlocutorRef ?? deriveInterlocutor(speakers.filter((e) => !onFloor.has(e.actorId)), view.agentId);
  if (interlocutor && !onFloor.has(interlocutor)) pinnedRefs.add(interlocutor);
  const myLast = [...speakers].reverse().find((e) => e.actorId === view.agentId);
  for (const id of (myLast?.payload["addresseeIds"] as string[] | undefined) ?? []) if (!onFloor.has(id)) pinnedRefs.add(id);

  // People
  const others = room.occupants.filter((o) => o.ref !== view.agentId);
  type Cand = { p: Presence; dist: number; closeness: number; threat: number; pinned: boolean; recent: boolean };
  const cands: Cand[] = others.map((p) => {
    const rel = input.relational?.get(p.ref);
    return {
      p,
      dist: chebyshev(selfTile, p.tile),
      closeness: rel ? Math.max(rel.affection, rel.attraction, rel.desireForCloseness) : 0,
      threat: rel?.threat ?? 0,
      pinned: pinnedRefs.has(p.ref),
      recent: recentSpeakerIds.has(p.ref),
    };
  });
  const salient = (c: Cand): boolean =>
    c.pinned || c.recent || c.dist <= SOCIAL_MAX_TILES || c.closeness > 0.5 || c.threat > 0.5;
  const shown = cands
    .filter(salient)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.recent) - Number(a.recent) ||
        a.dist - b.dist ||
        a.p.name.localeCompare(b.p.name) ||
        a.p.ref.localeCompare(b.p.ref),
    );
  const people: BodyPersonLine[] = shown.map((c, i) => {
    const handle = `p${i + 1}`;
    handles[handle] = { kind: "person", ref: c.p.ref };
    const band = distanceBand(c.dist);
    const activity = activityOf(c.p, now);
    return {
      handle,
      name: sanitizeLabel(c.p.name, 24),
      band,
      steps: c.dist,
      posture: c.p.state,
      ...(c.dist <= SOCIAL_MAX_TILES ? { facing: facingKind(c.p.dir, c.p.tile, selfTile) } : {}),
      ...(activity ? { activity } : {}),
      ...(band === "intimate" && !c.pinned && c.closeness < 0.3 ? { tooClose: true } : {}),
      ...(c.pinned ? { pinned: true } : {}),
    };
  });
  const groups = groupHidden(
    cands.filter((c) => !salient(c)),
    room.zones,
    now,
  );

  // Where I am
  const inside = room.zones
    .filter((z) => chebyshev(selfTile, z.center) <= z.radius)
    .sort((a, b) => ZONE_PRIORITY.indexOf(a.kind) - ZONE_PRIORITY.indexOf(b.kind) || a.radius - b.radius);
  const myZone = inside[0];
  const posture: AvatarState = self?.state ?? "stand";
  const facingLabel = self ? facingThing(view, self) : undefined;
  const dwellFrom = Math.max(view.body.dwell.postureSince, view.body.dwell.placeSince, self?.since ?? 0);
  const dwellS = dwellFrom > 0 ? Math.max(0, Math.floor((now - dwellFrom) / 1000)) : 0;

  // Places (z#)
  const seatTaken = new Set(room.occupants.filter((o) => o.seatId !== undefined && o.ref !== view.agentId).map((o) => o.seatId!));
  const placeZones = room.zones
    .filter((z) => PLACE_KINDS.has(z.kind) && z.id !== myZone?.id)
    .map((z) => ({ z, steps: chebyshev(selfTile, z.center) }))
    .sort((a, b) => a.steps - b.steps || ZONE_PRIORITY.indexOf(a.z.kind) - ZONE_PRIORITY.indexOf(b.z.kind) || a.z.id.localeCompare(b.z.id))
    .slice(0, MAX_PLACES);
  const places: BodyPlaceLine[] = placeZones.map(({ z, steps }, i) => {
    const handle = `z${i + 1}`;
    handles[handle] = { kind: "zone", roomId: room.id, zoneId: z.id };
    const seats = z.furniIds.map((id) => room.furni.find((f) => f.id === id)).filter((f): f is FurniModel => !!f && f.kinds.includes("sit"));
    return {
      handle,
      label: z.label,
      steps,
      ...(seats.length > 0 ? { totalSeats: seats.length, freeSeats: seats.filter((f) => !seatTaken.has(f.id)).length } : {}),
    };
  });

  // Reach (f#)
  const reachFurni = room.furni
    .map((f) => ({ f, d: Math.min(...f.tiles.map((t) => chebyshev(selfTile, t))) }))
    .filter((x) => x.d <= 2 && x.f.kinds.some((k) => k !== "door"))
    .sort((a, b) => a.d - b.d || a.f.id - b.f.id)
    .slice(0, MAX_REACH);
  const reach: BodyPlaceLine[] = reachFurni.map(({ f }, i) => {
    const handle = `f${i + 1}`;
    handles[handle] = { kind: "furni", roomId: room.id, furniId: f.id };
    return { handle, label: f.label };
  });

  // Rooms (r#)
  const rooms: BodyRoomLine[] = [...view.adjacency]
    .sort((a, b) => a.travelS - b.travelS || a.roomId.localeCompare(b.roomId))
    .map((a, i) => {
      const handle = `r${i + 1}`;
      handles[handle] = { kind: "room", roomId: a.roomId };
      return { handle, name: sanitizeLabel(a.name ?? input.roomNames?.[a.roomId] ?? a.roomId, 24), travelS: Math.round(a.travelS) };
    });

  const body: BodyPerception = {
    self: {
      room: sanitizeLabel(room.name, 24),
      ...(myZone ? { zone: myZone.label } : {}),
      posture,
      ...(facingLabel ? { facing: facingLabel } : {}),
      dwellS,
    },
    ...(plan ? { plan } : {}),
    blocked: [...blocked],
    people,
    groups,
    changes: changesOf(input, room.id, now, others),
    hearing: hearingOf(input, room.occupants),
    reach,
    places,
    rooms,
    ...(room.degraded || room.stale ? { degraded: true } : {}),
  };
  return { body, handles };
}

function deriveInterlocutor(speakers: readonly CommittedEvent[], me: string): string | undefined {
  const recent = [...speakers].reverse().slice(0, 4);
  const toMe = recent.find((e) => e.actorId !== me && includes(e.payload["mentionedAgentIds"], me) || (e.actorId !== me && includes(e.payload["addresseeIds"], me)));
  if (toMe) return toMe.actorId;
  const last = recent.find((e) => e.actorId !== me);
  if (last) return last.actorId;
  const mine = recent.find((e) => e.actorId === me);
  const addressee = (mine?.payload["addresseeIds"] as string[] | undefined)?.[0];
  return addressee;
}

function includes(v: unknown, id: string): boolean {
  return Array.isArray(v) && v.includes(id);
}

function activityOf(p: Presence, now: number): string | undefined {
  if (p.fallen) return "fallen";
  if (p.action && p.action.until > now) return p.action.a;
  if (p.typing) return "typing";
  if (p.lastSpokeAt !== undefined && now - p.lastSpokeAt < HUMAN_TYPING_EXPIRY_MS) return "talking";
  return undefined;
}

function groupHidden(hidden: { p: Presence; dist: number }[], zones: Zone[], now: number) {
  const groups = new Map<string, { count: number; band: ReturnType<typeof distanceBand>; where?: string; activity?: string }>();
  for (const { p, dist } of hidden) {
    const band = distanceBand(dist);
    const zone = zones
      .filter((z) => z.kind !== "middle" && chebyshev(p.tile, z.center) <= z.radius)
      .sort((a, b) => ZONE_PRIORITY.indexOf(a.kind) - ZONE_PRIORITY.indexOf(b.kind))[0];
    const activity = p.state === "dance" ? "dance" : activityOf(p, now);
    const key = `${band}|${zone?.id ?? ""}|${activity ?? ""}`;
    const g = groups.get(key) ?? { count: 0, band, ...(zone ? { where: zone.label } : {}), ...(activity ? { activity } : {}) };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.band.localeCompare(b.band));
}

/** The nearest thing straight ahead within a few tiles: furniture label, else a person's name. */
function facingThing(view: SpaceView, self: Presence): string | undefined {
  const room = view.room!;
  const [dx, dy] = directionStep(self.dir);
  for (let i = 1; i <= 6; i++) {
    const t: [number, number] = [self.tile[0] + dx * i, self.tile[1] + dy * i];
    const f = room.furni.find((x) => x.tiles.some((ft) => ft[0] === t[0] && ft[1] === t[1]));
    if (f) {
      const z = room.zones.find((zz) => zz.furniIds.includes(f.id) && (zz.kind === "bar" || zz.kind === "feature" || zz.kind === "window"));
      return z?.label ?? f.label;
    }
    const o = room.occupants.find((x) => x.ref !== self.ref && x.tile[0] === t[0] && x.tile[1] === t[1]);
    if (o) return sanitizeLabel(o.name, 24);
  }
  return undefined;
}

function changesOf(input: BuildBodyPerceptionInput, roomId: RoomId, now: number, others: Presence[]): BodyChange[] {
  const out: BodyChange[] = [];
  const seen = new Set<string>();
  const add = (c: BodyChange): void => {
    const key = `${c.kind}|${c.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  for (const p of others) {
    if (p.since > 0 && now - p.since <= ARRIVAL_WINDOW_MS && p.since <= now) add({ kind: "arrived", name: sanitizeLabel(p.name, 24) });
  }
  const nameOf = (ref: string): string | undefined => {
    const n = others.find((p) => p.ref === ref)?.name ?? input.names?.[ref];
    return n ? sanitizeLabel(n, 24) : undefined;
  };
  for (const e of input.events ?? []) {
    if (e.type !== "moved_room" || e.actorId === input.view.agentId) continue;
    const name = nameOf(e.actorId);
    if (!name) continue;
    const from = e.payload["from"];
    const to = e.payload["to"];
    if (to === roomId) add({ kind: "arrived", name });
    else if (from === roomId) {
      const via = input.view.adjacency.find((a) => a.roomId === to);
      const viaName = via ? sanitizeLabel(via.name ?? input.roomNames?.[via.roomId] ?? via.roomId, 24) : undefined;
      add({ kind: "left", name, ...(viaName ? { via: viaName } : {}) });
    }
  }
  for (const c of input.extraChanges ?? []) add(c);
  return out.slice(0, 5);
}

function hearingOf(input: BuildBodyPerceptionInput, occupants: Presence[]): BodyHearingLine[] {
  const me = input.view.agentId;
  const byName = new Map<string, BodyHearingLine>();
  const recent = (input.events ?? []).filter((e) => SPEECH_TYPES.has(e.type) && e.actorId !== me).slice(-6);
  for (const e of recent) {
    const heardAs = e.payload["heardAs"] as HearingLevel | undefined;
    const hearing = (e.payload["hearing"] as Record<string, HearingLevel> | undefined)?.[me];
    const level = heardAs ?? hearing;
    if (!level) continue;
    const raw = (e.payload["senderName"] as string | undefined) ?? occupants.find((o) => o.ref === e.actorId)?.name ?? input.names?.[e.actorId];
    if (!raw) continue;
    const name = sanitizeLabel(raw, 24);
    byName.set(name, { name, level });
  }
  return [...byName.values()].slice(-4);
}
