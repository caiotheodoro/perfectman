import type { ActionEmotions, AvatarState } from "@perfectman/shared";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { validateActCmd } from "../director/act-cmd.js";
import type { ActSend } from "../director/director-client.js";
import type { Dialect, DramaSession } from "../director/dialect.js";
import { DramaDirector } from "../director/drama/director.js";
import type { DramaDirectorDeps, DramaLink } from "../director/drama/director.js";
import type { EmotionReading, RelationReading } from "../director/drama/ports.js";
import type { DramaTuning } from "../director/drama/tuning.js";
import type { DramaWorld, WorldAvatar } from "../director/drama/world.js";
import type { ActorCmd, HotelFrame } from "../director/index.js";
import { routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrame } from "../director/drama-frames.js";
import { actFrames, dramaStateFrame, sceneCutFrames } from "./fake-drama.js";
import type { ActScript } from "./fake-drama.js";
import { ManualClock } from "./manual-clock.js";

/** Run 7, room 12, three actors (-701 person-1, -702 person-2, -703 person-3) and one human (9), the contract's own numbers. */
export const RUN = 7;
export const ROOM = 12;
export const A = -701;
export const B = -702;
export const C = -703;
export const H = 9;

/** A block that lets everything through up to the kill: person-1 may slap, punch and kill person-2 and the human, who may die. */
export const WIDE_BLOCK: ScenarioDrama = { max_rung: 6, may_target: [["person-1", "person-2"], ["person-1", "@human"], ["person-2", "person-1"]], may_die: ["person-2", "@human"], permadeath: false };

export class FakeLink implements DramaLink {
  dialect: Dialect = 2;
  hasLease = true;
  readonly acts: Array<{ run: number; actor: number; cmd: Extract<ActorCmd, { k: "act" }> }> = [];
  readonly advances: Array<{ run: number; reason?: string }> = [];
  private readonly consumed = new Set<string>();
  private cid = 100;

  sendAct(p: { run: number; actor: number; cmd: Extract<ActorCmd, { k: "act" }> }): ActSend {
    if (this.dialect !== 2) return { sent: false, reason: "dialect" };
    if (!this.hasLease) return { sent: false, reason: "no_lease" };
    const error = validateActCmd(p.cmd, { run: p.run, actor: p.actor }, this.consumed);
    if (error) return { sent: false, reason: "invalid", error };
    this.acts.push(p);
    return { sent: true, cid: ++this.cid };
  }

  sendSceneAdvance(run: number, reason?: string): ActSend {
    if (this.dialect !== 2) return { sent: false, reason: "dialect" };
    if (!this.hasLease) return { sent: false, reason: "no_lease" };
    this.advances.push({ run, ...(reason ? { reason } : {}) });
    return { sent: true };
  }
}

type Avatar = WorldAvatar & { ref?: string; room: number };

export class ScriptWorld implements DramaWorld {
  readonly avatars = new Map<number, Avatar>();
  cast = 6;

  constructor() {
    this.put(A, { ref: "person-1", tile: [5, 5] });
    this.put(B, { ref: "person-2", tile: [6, 5] });
    this.put(C, { ref: "person-3", tile: [5, 6] });
    this.put(H, { human: true, tile: [4, 5] });
  }

  put(id: number, o: { ref?: string; tile?: readonly [number, number]; state?: AvatarState; human?: boolean; room?: number }): void {
    const prior = this.avatars.get(id);
    this.avatars.set(id, {
      id,
      human: o.human ?? prior?.human ?? false,
      tile: o.tile ?? prior?.tile ?? [0, 0],
      state: o.state ?? prior?.state ?? "stand",
      room: o.room ?? prior?.room ?? ROOM,
      ...(o.ref ?? prior?.ref ? { ref: (o.ref ?? prior?.ref) as string } : {}),
    });
  }

  remove(id: number): void {
    this.avatars.delete(id);
  }

  idOf(ref: string): number | undefined {
    return [...this.avatars.values()].find((a) => a.ref === ref)?.id;
  }

  refOf(id: number): string | undefined {
    return this.avatars.get(id)?.ref;
  }

  roomOf(id: number): number | undefined {
    return this.avatars.get(id)?.room;
  }

  avatarsIn(room: number): WorldAvatar[] {
    return [...this.avatars.values()].filter((a) => a.room === room).map(({ id, human, tile, state }) => ({ id, human, tile, state }));
  }

  castSize(): number {
    return this.cast;
  }
}

export const SESSION: DramaSession = { enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] };

export type Rig = {
  dir: DramaDirector;
  clock: ManualClock;
  link: FakeLink;
  world: ScriptWorld;
  /** Feeds frames to the director the way the router does (one handler per frame). */
  hotel(frames: ReadonlyArray<Record<string, unknown>>): void;
  /** One scripted act lifecycle (`actFrames`), fed. */
  act(script: ActScript): void;
  cut(p: { scene: string; prev: string; revived?: number[]; removed?: number[] }): void;
  state(p?: Parameters<typeof dramaStateFrame>[0]): void;
  recorded: Array<{ dir: string; room: string | undefined; kind: string; data: Record<string, unknown> }>;
};

export function makeRig(o: { block?: ScenarioDrama; tuning?: DramaTuning; resumed?: boolean; session?: DramaSession | null; noState?: boolean; deps?: Partial<DramaDirectorDeps> } = {}): Rig {
  const clock = new ManualClock();
  const link = new FakeLink();
  const world = new ScriptWorld();
  const recorded: Rig["recorded"] = [];
  const dir = new DramaDirector({
    run: RUN,
    clock,
    link,
    world,
    scenario: resolveRunDrama(o.block ? { drama: o.block } : {}),
    session: o.session === undefined ? SESSION : o.session,
    record: (d, room, kind, data) => void recorded.push({ dir: d, room, kind, data }),
    ...(o.tuning ? { tuning: o.tuning } : {}),
    ...(o.resumed ? { resumed: true } : {}),
    ...o.deps,
  });
  let seq = 0;
  const hotel: Rig["hotel"] = (frames) => {
    for (const f of frames) routeDramaFrame({ ...f, seq: ++seq } as unknown as DramaFrame, dir);
  };
  const rig: Rig = {
    dir,
    clock,
    link,
    world,
    hotel,
    act: (script) => hotel(actFrames({ run: RUN, room: ROOM, scene: dir.scene, ...script })),
    cut: (p) => hotel(sceneCutFrames({ run: RUN, room: ROOM, ...p })),
    state: (p = {}) => hotel([dramaStateFrame({ run: RUN, room: ROOM, scene: dir.scene, optIn: [H], ...p })]),
    recorded,
  };
  if (!o.noState && !o.resumed) rig.state({ scene: `${RUN}.1` });
  return rig;
}

export const NO_TENDENCY: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

/** An emotion reading with the named tendencies set and, toward each target, a grievance (resentment 0.8) unless the relation says otherwise. */
export function emotion(tendencies: Partial<ActionEmotions>, o: { toward?: number[]; relation?: Partial<RelationReading>; core?: EmotionReading["core"] } = {}): EmotionReading {
  const relation: RelationReading = { resentment: 0.8, threat: 0, envy: 0, suspicion: 0, lastNegativeAt: null, ...o.relation };
  return { actionEmotions: { ...NO_TENDENCY, ...tendencies }, relations: new Map((o.toward ?? [B, A, H, C]).map((id) => [id, relation])), ...(o.core ? { core: o.core } : {}) };
}

export type { HotelFrame };
