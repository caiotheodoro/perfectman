import type { AgentState, CoreMood, Direction8, FurniModel, Presence, RelationalState, RoomView, SocialEmotions, SpaceView, Tile, Zone } from "@perfectman/shared";
import { deriveRoomZones } from "../space/zones.js";
import { defaultBody } from "../space/space-mirror.js";

export const NOW = 1_000_000;

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0,
  admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
};

export function agentState(over: { mood?: Partial<CoreMood>; social?: Partial<SocialEmotions>; rel?: Record<string, Partial<RelationalState>> } = {}): AgentState {
  const mood: CoreMood = { valence: 0, arousal: 0.3, stability: 0.5, energy: 0.7, circumplexAngle: 0, circumplexRadius: 0, momentumValence: 0, momentumArousal: 0, ...over.mood };
  const rels = new Map<string, RelationalState>();
  for (const [id, r] of Object.entries(over.rel ?? {})) {
    rels.set(id, {
      targetAgentId: id, trust: 0, affection: 0, resentment: 0, attraction: 0, suspicion: 0, admiration: 0, envy: 0, comfort: 0,
      threat: 0, curiosity: 0, desireForCloseness: 0.5, desireForDistance: 0.2, interactionCount: 0, lastInteractionAt: null,
      lastPositiveAt: null, lastNegativeAt: null, ...r,
    });
  }
  return {
    agentId: "duda", simulationId: "s", personaId: "p", presence: "active", coreMood: mood,
    socialEmotions: { ...ZERO_SOCIAL, ...over.social }, relationalStates: rels, memories: [], initiativeAccumulators: [],
    lastProcessedEventId: null, lastActionAt: null, lastRuminationPulse: null, arrivalPulse: null, createdAt: 0, updatedAt: 0,
  };
}

export function person(ref: string, tile: Tile, over: Partial<Presence> = {}): Presence {
  return { ref, name: ref, kind: ref.startsWith("h:") ? "human" : "actor", tile, dir: 2 as Direction8, state: "stand", since: 0, lastMovedAt: NOW - 60_000, ...over };
}

export function sofa(id: number, tile: Tile): FurniModel {
  return { id, defId: "sofa_blue", label: "sofa", kinds: ["sit"], tiles: [tile, [tile[0] + 1, tile[1]]], front: [tile, [tile[0] + 1, tile[1]]], state: 0 };
}

export type SpaceOpts = {
  self?: Partial<Presence>;
  others?: Presence[];
  furni?: FurniModel[];
  zones?: Zone[];
  stale?: boolean;
  w?: number;
  h?: number;
  body?: Partial<SpaceView["body"]>;
};

/** A 12 x 10 open room with the actor "duda" in it, as one agent sees it. */
export function space(o: SpaceOpts = {}): SpaceView {
  const w = o.w ?? 12;
  const h = o.h ?? 10;
  const self = person("duda", [4, 4], o.self);
  const furni = o.furni ?? [];
  const base = { id: "12", w, h, heights: new Uint8Array(w * h), door: [0, 5] as Tile, furni: new Map(furni.map((f) => [f.id, f])) };
  const room: RoomView = {
    id: "12", name: "Lounge", template: "studio", w, h, rev: 5, syncedAtWall: NOW, door: [0, 5], doorDir: 2 as Direction8,
    heights: base.heights, furni, zones: o.zones ?? deriveRoomZones({ ...base, occupants: new Map([self, ...(o.others ?? [])].map((p) => [p.ref, p])) }), occupants: [self, ...(o.others ?? [])], adjacency: [], degraded: false,
    stale: o.stale ?? false,
  };
  return { agentId: "duda", readAt: NOW, where: "12", room, self, adjacency: [], body: { ...defaultBody(NOW - 120_000), ...o.body } };
}

import type { Avatar, HotelFrame, RoomSnapshot } from "../director/index.js";

export function avatar(id: number, name: string, x: number, y: number, over: Partial<Avatar> = {}): Avatar {
  return { id, name, x, y, dir: 2, state: "stand", look: { skin: 1, hair: 1, shirt: 1, pants: 1 }, ...over };
}

/** A 10 x 8 room snapshot with a sofa seat and a bar. */
export function snapshot(room = 12, rev = 1, avatars: Avatar[] = [], width = 10): RoomSnapshot {
  const row = "0".repeat(width);
  return {
    room, rev, name: "Lounge", template: "studio", owner: 9,
    layout: { rows: Array.from({ length: 8 }, () => row), door: [0, 4], door_dir: 2 },
    walk: Array.from({ length: 8 }, () => row),
    defs: {
      sofa_blue: { name: "Blue sofa", w: 2, d: 1, h: 50, walkable: false, seat: true, lay: false, wall: false, states: 1 },
      bar_counter: { name: "Bar counter", w: 1, d: 2, h: 100, walkable: false, seat: false, lay: false, wall: false, states: 1 },
    },
    furni: [{ id: 1, def: "sofa_blue", x: 4, y: 2, rot: 0 }, { id: 2, def: "bar_counter", x: 8, y: 1, rot: 0 }],
    seats: [{ furni: 1, tiles: [[4, 2], [5, 2]], dir: 4, lay: false }],
    avatars,
  };
}

export type DeltaFrame = Extract<HotelFrame, { t: "delta" }>;
export const delta = (room: number, rev: number, msg: DeltaFrame["msg"]): DeltaFrame => ({ t: "delta", seq: 0, room, rev, msg });
