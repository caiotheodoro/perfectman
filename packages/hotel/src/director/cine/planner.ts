/**
 * The deterministic shot planner (D19, camera-and-audio.md 2).
 *
 * `ShotPlanner.plan` turns one item into a `Program`: timed steps (camera, HUD,
 * SFX, the hotel release of the line, cuts) relative to the program start. It
 * reads no clock and no rng; `now` is the playback timeline and the world is
 * a port, so the same inputs always give the same cues.
 *
 * Rules, in the order they bite:
 * 1. Room change: a transition (door / fade / "meanwhile"), the cut, a new
 *    establishing shot, and a scene card on the first visit.
 * 2. The camera is on the speaker before the line. If the current framing
 *    already covers the speaker nothing moves (a two-shot holds an exchange);
 *    otherwise the shot is cut first and the line is released after its ease.
 * 3. Anti-jitter: a new camera cue waits until the last one has been up for
 *    `minShotMs`.
 */
import { readingSeconds } from "@perfectman/shared";
import type { CutFxKind, PerfectmanUi, Shot, ShotTarget, ShotZoom } from "../generated.js";
import { DEFAULT_CINE } from "./types.js";
import type { CineConfig, CineItem, CineMood, CineWorld, GestureItem, HopItem, LineItem, NarrationSource, ObjectItem, PairItem, Program, Step, ThoughtItem, WalkItem } from "./types.js";

const MAX_CUE_TEXT = 200;
const clip = (text: string, max = MAX_CUE_TEXT): string => (text.length <= max ? text : `${[...text].slice(0, max - 1).join("")}…`);

export function readingMs(text: string, cfg: CineConfig): number {
  return Math.round(readingSeconds(text) * 1000 * cfg.readingScale);
}

/** How long an item holds the stage; used for the lookahead budget, not for scheduling. */
export function estimateMs(item: CineItem, cfg: CineConfig): number {
  switch (item.kind) {
    case "line": return readingMs(clip(item.text), cfg) + cfg.typingLeadMs + cfg.easeMs.close_up + cfg.beatGapMs;
    case "thought": return Math.min(7000, readingMs(clip(item.text), cfg)) + 700;
    case "gesture": return 1500;
    case "walk": return 2000;
    case "hop": return 1600;
    case "pair": return 2400;
    case "object": return 2000;
  }
}

/** False for an item the picture cannot show (no avatar to point at); it is dropped, not cut to. */
export function canStage(item: CineItem, world: CineWorld): boolean {
  switch (item.kind) {
    case "line":
    case "gesture":
      return true;
    case "thought":
    case "hop":
      return world.avatarId(item.ref) !== undefined;
    case "walk":
      return item.steps >= 3 && world.avatarId(item.ref) !== undefined;
    case "pair":
      return world.avatarId(item.ref) !== undefined && world.avatarId(item.with) !== undefined;
    case "object":
      return item.furni !== undefined || item.tile !== undefined;
  }
}

/** The strongest feeling in a mood, 0..1. */
export function moodIntensity(m: CineMood | undefined): number {
  if (!m) return 0;
  return Math.min(1, Math.max(Math.abs(m.valence), m.arousal, m.affection ?? 0));
}

export function emotionLabel(m: CineMood): string {
  if ((m.affection ?? 0) >= 0.6) return "love";
  if (m.valence <= -0.5) return m.arousal >= 0.6 ? "anger" : "sad";
  if (m.valence >= 0.5) return "joy";
  return "tense";
}

const COPY: Record<"pt-BR" | "en", { meanwhile: string }> = {
  "pt-BR": { meanwhile: "Enquanto isso..." },
  en: { meanwhile: "Meanwhile..." },
};

type Camera = { shot: Shot; target: ShotTarget; ref?: string; pair?: readonly [string, string]; room: number };

/** Accumulates the steps of one program. */
class Builder {
  readonly steps: Step[] = [];
  ui(at: number, ui: PerfectmanUi): void {
    this.steps.push({ at: Math.max(0, Math.round(at)), k: "ui", ui });
  }
  add(step: Step): void {
    this.steps.push({ ...step, at: Math.max(0, Math.round(step.at)) });
  }
}

export class ShotPlanner {
  private room: number | undefined;
  private camera: Camera | undefined;
  private lastCameraAt = Number.NEGATIVE_INFINITY;
  private lastRoomCutAt = Number.NEGATIVE_INFINITY;
  private lastSpeaker: { ref: string; room: number } | undefined;
  private lastHop: { ref: string; to: number; at: number } | undefined;
  private lastSting = Number.NEGATIVE_INFINITY;
  private lastLaughAt = Number.NEGATIVE_INFINITY;
  private murmurRoom: number | undefined;
  private fillers = 0;
  private readonly introduced = new Set<string>();
  private readonly visited = new Set<number>();
  private readonly emotionAt = new Map<string, number>();
  private readonly activity = new Map<number, number>();

  constructor(private readonly cfg: CineConfig = DEFAULT_CINE) {}

  get currentRoom(): number | undefined {
    return this.room;
  }

  /** Playback time of the last room cut; the selector uses it for the room-hold rule. */
  get roomSince(): number {
    return this.lastRoomCutAt;
  }

  /** Who the camera followed through a door last, if recently. */
  followRef(now: number): string | undefined {
    return this.lastHop && now - this.lastHop.at < 8000 ? this.lastHop.ref : undefined;
  }

  /** Playback time something last happened in the room (for "meanwhile"). */
  lastActivityIn(room: number): number | undefined {
    return this.activity.get(room);
  }

  get consecutiveFillers(): number {
    return this.fillers;
  }

  // ---- intro, filler, outro ---------------------------------------------------

  intro(now: number, home: number, world: CineWorld, nar: NarrationSource): Program {
    const b = new Builder();
    const { title, subtitle } = nar.card(home, "title");
    this.room = home;
    this.visited.add(home);
    this.lastRoomCutAt = now;
    this.lastCameraAt = now;
    this.camera = { shot: "establishing", target: { room: true }, room: home };
    b.ui(0, { k: "hud", letterbox: true, fade: { to: 1, ms: 0 } });
    b.ui(0, this.cameraCue("establishing", { room: true }, "fit", 0, this.cfg.introMs));
    b.ui(150, { k: "hud", fade: { to: 0, ms: 900 } });
    b.ui(250, { k: "card", kind: "title", title: clip(title), ...(subtitle ? { subtitle: clip(subtitle) } : {}), ms: this.cfg.introMs - 500 });
    this.ambience(b, 0, home, world);
    this.activity.set(home, now);
    return { beat: "intro", room: home, durationMs: this.cfg.introMs, steps: b.steps };
  }

  /** Dead-air guard: hold the establishing shot, a narrator aside, the room's murmur. */
  filler(now: number, world: CineWorld, nar: NarrationSource): Program | undefined {
    const room = this.room;
    if (room === undefined) return undefined;
    const b = new Builder();
    if (this.camera?.shot !== "establishing" || this.camera.room !== room) {
      b.ui(0, this.cameraCue("establishing", { room: true }, "fit", this.cfg.easeMs.establishing, this.cfg.fillerMs));
      this.camera = { shot: "establishing", target: { room: true }, room };
      this.lastCameraAt = now;
    }
    const text = nar.caption(room, "idle");
    if (text) b.ui(300, { k: "caption", text: clip(text), ms: this.cfg.fillerMs - 400 });
    this.ambience(b, 0, room, world);
    this.fillers++;
    this.activity.set(room, now);
    return { beat: `filler:${this.fillers}`, room, durationMs: this.cfg.fillerMs, steps: b.steps };
  }

  /** The program that closes a cinematic: letterbox off, fade from the last picture. */
  outro(now: number): Program {
    const b = new Builder();
    b.ui(0, { k: "hud", fade: { to: 1, ms: 700 } });
    b.ui(700, { k: "hud", letterbox: false, fade: { to: 0, ms: 400 } });
    if (this.murmurRoom !== undefined) b.ui(0, { k: "sfx", cue: "murmur", stop: `murmur-${this.murmurRoom}` });
    this.murmurRoom = undefined;
    this.lastCameraAt = now;
    return { beat: "outro", room: this.room ?? 0, durationMs: 1100, steps: b.steps };
  }

  // ---- items ------------------------------------------------------------------

  plan(item: CineItem, now: number, world: CineWorld, nar: NarrationSource): Program | undefined {
    if (!canStage(item, world)) return undefined;
    this.fillers = 0;
    const b = new Builder();
    let t = 0;
    if (this.room !== item.room) t = this.transition(b, now, item.room, world, nar);
    let body: number | undefined;
    switch (item.kind) {
      case "line": body = this.line(b, t, now, item, world); break;
      case "thought": body = this.thought(b, t, now, item, world); break;
      case "gesture": body = this.gesture(b, t, now, item, world); break;
      case "walk": body = this.walk(b, t, now, item, world); break;
      case "hop": body = this.hop(b, t, now, item, world); break;
      case "pair": body = this.pair(b, t, now, item, world); break;
      case "object": body = this.object(b, t, now, item, world); break;
    }
    if (body === undefined) return t > 0 ? { beat: item.id, room: item.room, durationMs: t, steps: b.steps } : undefined;
    this.activity.set(item.room, now + t);
    return { beat: item.id, room: item.room, durationMs: t + body, steps: b.steps };
  }

  // ---- transitions ------------------------------------------------------------

  /** Cut to `to`. Returns the program time consumed before the item itself starts. */
  private transition(b: Builder, now: number, to: number, world: CineWorld, nar: NarrationSource): number {
    const from = this.room;
    if (from === undefined) {
      this.room = to;
      this.visited.add(to);
      this.lastRoomCutAt = now;
      return 0;
    }
    const hop = this.lastHop;
    const last = this.activity.get(from);
    const kind: CutFxKind = hop && hop.to === to && now - hop.at < 8000 ? "door" : last !== undefined && now - last < 20_000 ? "meanwhile" : "fade";
    const fxMs = kind === "meanwhile" ? 1400 : kind === "door" ? 700 : 600;
    const first = !this.visited.has(to);
    const label = kind === "meanwhile" ? COPY[this.cfg.language].meanwhile : undefined;
    b.ui(0, { k: "cut_fx", kind, ms: fxMs, ...(label ? { label } : {}) });
    b.ui(0, { k: "sfx", cue: kind === "door" ? "door" : "whoosh", gain: 0.8 });
    const cutAt = Math.round(fxMs / 2);
    b.add({ at: cutAt, k: "cut", room: to, from });
    this.ambience(b, cutAt, to, world);
    b.ui(cutAt + 80, this.cameraCue("establishing", { room: true }, "fit", 0, 1500));
    this.camera = { shot: "establishing", target: { room: true }, room: to };
    this.lastCameraAt = now + cutAt + 80;
    this.lastRoomCutAt = now + cutAt;
    this.room = to;
    this.visited.add(to);
    this.lastSpeaker = undefined;
    let t = cutAt + 80 + 1500;
    if (first) {
      const { title, subtitle } = nar.card(to, "scene");
      b.ui(cutAt + 300, { k: "card", kind: "scene", title: clip(title), ...(subtitle ? { subtitle: clip(subtitle) } : {}), ms: this.cfg.sceneCardMs });
      const aside = nar.caption(to, "scene");
      if (aside) b.ui(cutAt + 500, { k: "caption", text: clip(aside), ms: Math.min(5000, readingMs(clip(aside), this.cfg)) });
      t = Math.max(t, cutAt + 300 + this.cfg.sceneCardMs);
    }
    return t;
  }

  // ---- shots ------------------------------------------------------------------

  private covers(room: number, ref: string): boolean {
    const c = this.camera;
    if (!c || c.room !== room || c.shot === "establishing" || c.shot === "insert") return false;
    return c.ref === ref || (c.pair?.includes(ref) ?? false);
  }

  private minShotWait(now: number): number {
    return Math.max(0, Math.ceil(this.lastCameraAt + this.cfg.minShotMs - now));
  }

  private cameraCue(shot: Shot, target: ShotTarget, zoom: ShotZoom, easeMs: number, holdMs: number, follow = false): PerfectmanUi {
    return { k: "camera", shot, target, zoom, ease_ms: easeMs, hold_ms: Math.max(0, Math.round(holdMs)), ...(follow ? { follow: true } : {}) };
  }

  private pairZoom(a: string, b: string, world: CineWorld): 1 | 2 {
    const ta = world.tileOf(a);
    const tb = world.tileOf(b);
    if (!ta || !tb) return 1;
    return Math.max(Math.abs(ta[0] - tb[0]), Math.abs(ta[1] - tb[1])) <= 4 ? 2 : 1;
  }

  /**
   * Put the camera on `ref` (alone, or with `partner` for a two-shot) at or
   * after `at`. Returns the program time at which the shot is fully up, or 0
   * when the current framing already covers `ref`.
   */
  private frame(b: Builder, at: number, now: number, room: number, ref: string, world: CineWorld, hold: number, partner?: string): number {
    const avatar = world.avatarId(ref);
    const partnerAvatar = partner ? world.avatarId(partner) : undefined;
    const wait = at + this.minShotWait(now + at);
    if (avatar === undefined) {
      // Nothing to point at: fall back to the room so the viewer still sees something.
      if (this.camera?.shot === "establishing" && this.camera.room === room) return at;
      b.ui(wait, this.cameraCue("establishing", { room: true }, "fit", this.cfg.easeMs.establishing, hold));
      this.camera = { shot: "establishing", target: { room: true }, room };
      this.lastCameraAt = now + wait;
      return wait + this.cfg.easeMs.establishing;
    }
    if (partner && partnerAvatar !== undefined) {
      const pair: [number, number] = [avatar, partnerAvatar];
      b.ui(wait, this.cameraCue("two_shot", { pair }, this.pairZoom(ref, partner, world), this.cfg.easeMs.two_shot, hold));
      this.camera = { shot: "two_shot", target: { pair }, pair: [ref, partner], room };
      this.lastCameraAt = now + wait;
      return wait + this.cfg.easeMs.two_shot;
    }
    b.ui(wait, this.cameraCue("close_up", { avatar }, 2, this.cfg.easeMs.close_up, hold));
    this.camera = { shot: "close_up", target: { avatar }, ref, room };
    this.lastCameraAt = now + wait;
    return wait + this.cfg.easeMs.close_up;
  }

  // ---- per-kind ---------------------------------------------------------------

  private partnerOf(item: LineItem, world: CineWorld): { ref: string; exchange: boolean } | undefined {
    const here = new Set(world.occupants(item.room));
    if (item.to && item.to !== item.ref && here.has(item.to)) return { ref: item.to, exchange: true };
    const last = this.lastSpeaker;
    if (last && last.room === item.room && last.ref !== item.ref && here.has(last.ref)) return { ref: last.ref, exchange: true };
    return undefined;
  }

  private line(b: Builder, t0: number, now: number, item: LineItem, world: CineWorld): number {
    const text = clip(item.text);
    const ms = readingMs(text, this.cfg);
    const partner = this.partnerOf(item, world);
    const cam = this.camera;
    const covered = this.covers(item.room, item.ref);
    const high = item.salience >= this.cfg.closeUpSalience;
    // A salient line inside a two-shot earns its close-up once the shot has been up long enough.
    const climax = covered && high && cam?.shot === "two_shot" && this.minShotWait(now + t0) === 0;
    let shotAt = 0;
    if (!covered || climax) {
      const withPartner = !climax && !high && partner?.exchange ? partner.ref : undefined;
      shotAt = this.frame(b, t0, now, item.room, item.ref, world, ms + this.cfg.typingLeadMs, withPartner) - t0;
    }
    const lineAt = t0 + Math.max(shotAt, this.cfg.typingLeadMs);
    b.add({ at: lineAt - this.cfg.typingLeadMs, k: "typing", ref: item.ref });
    b.add({ at: lineAt, k: "release", item });
    this.speakerExtras(b, lineAt, now + lineAt, item, world, ms);
    this.lastSpeaker = { ref: item.ref, room: item.room };

    let end = lineAt + ms;
    // Reaction: the listener's face for the tail of a long line, when they feel something.
    const listener = partner?.ref;
    if (listener && ms >= 3500 && moodIntensity(world.moodOf(listener)) >= this.cfg.reactionIntensity) {
      const avatar = world.avatarId(listener);
      const earliest = Math.max(lineAt + 1200, Math.ceil(this.lastCameraAt - now) + this.cfg.minShotMs);
      if (avatar !== undefined && earliest + this.cfg.minShotMs <= end) {
        b.ui(earliest, this.cameraCue("reaction", { avatar }, 2, this.cfg.easeMs.reaction, end - earliest));
        this.camera = { shot: "reaction", target: { avatar }, ref: listener, room: item.room };
        this.lastCameraAt = now + earliest;
      }
    }
    end += this.cfg.beatGapMs;
    return end - t0;
  }

  /** Lower-third on first speech, the overhead emotion cue, and the stings. */
  private speakerExtras(b: Builder, at: number, abs: number, item: LineItem, world: CineWorld, ms: number): void {
    const avatar = world.avatarId(item.ref);
    if (!this.introduced.has(item.ref)) {
      this.introduced.add(item.ref);
      const role = world.roleOf(item.ref);
      b.ui(at, { k: "lower_third", name: clip(world.nameOf(item.ref), 40), ...(role ? { role: clip(role, 40) } : {}), ms: 2600 });
    }
    const mood = world.moodOf(item.ref);
    if (mood && avatar !== undefined && moodIntensity(mood) >= this.cfg.emotionCueIntensity && abs - (this.emotionAt.get(item.ref) ?? Number.NEGATIVE_INFINITY) >= this.cfg.emotionCueGapMs) {
      this.emotionAt.set(item.ref, abs);
      b.ui(at, { k: "cue", id: avatar, emotion: emotionLabel(mood), ms: Math.min(4000, ms) });
    }
    const sting = mood && !Number.isNaN(mood.valence) ? this.stingFor(mood) : undefined;
    if (sting && abs - this.lastSting >= this.cfg.stingGapMs) {
      this.lastSting = abs;
      b.ui(at, { k: "sfx", cue: sting, gain: 0.6 });
    }
  }

  private stingFor(m: CineMood): string | undefined {
    if (m.valence <= -0.7 && m.arousal <= 0.45) return "sting_sad";
    if (m.valence <= -0.4 && m.arousal >= 0.85) return "sting_tension";
    if ((m.affection ?? 0) >= 0.85) return "sting_romance";
    return undefined;
  }

  private thought(b: Builder, t0: number, now: number, item: ThoughtItem, world: CineWorld): number | undefined {
    const avatar = world.avatarId(item.ref);
    if (avatar === undefined) return undefined;
    const text = clip(item.text);
    const ms = Math.min(7000, readingMs(text, this.cfg));
    const shotAt = this.covers(item.room, item.ref) ? 0 : this.frame(b, t0, now, item.room, item.ref, world, ms) - t0;
    b.ui(t0 + shotAt, { k: "thought", id: avatar, text, ms });
    const mood = world.moodOf(item.ref);
    if (mood && moodIntensity(mood) >= this.cfg.emotionCueIntensity) b.ui(t0 + shotAt, { k: "cue", id: avatar, emotion: emotionLabel(mood), ms: Math.min(4000, ms) });
    return shotAt + ms + 300;
  }

  private gesture(b: Builder, t0: number, now: number, item: GestureItem, world: CineWorld): number {
    const shotAt = this.covers(item.room, item.ref) ? 0 : this.frame(b, t0, now, item.room, item.ref, world, 1500) - t0;
    const at = t0 + shotAt;
    b.add({ at, k: "release", item });
    if (item.gesture === "laugh") {
      b.ui(at, { k: "sfx", cue: "laugh", gain: 0.7 });
      // Two laughs close together is a gag.
      if (now + at - this.lastLaughAt < 8000 && now + at - this.lastSting >= this.cfg.stingGapMs) {
        this.lastSting = now + at;
        b.ui(at + 400, { k: "sfx", cue: "sting_comedy", gain: 0.5 });
      }
      this.lastLaughAt = now + at;
    }
    return shotAt + 1500;
  }

  private walk(b: Builder, t0: number, now: number, item: WalkItem, world: CineWorld): number | undefined {
    const avatar = world.avatarId(item.ref);
    if (avatar === undefined || item.steps < 3) return undefined;
    const hold = Math.min(4000, Math.max(1500, item.steps * 300));
    const at = t0 + this.minShotWait(now + t0);
    b.ui(at, this.cameraCue("tracking", { avatar }, item.steps > 6 ? 1 : 2, this.cfg.easeMs.tracking, hold, true));
    // The walk itself is held back until the camera is on the walker (cinematic-director.ts); a no-op when it went straight through.
    b.add({ at, k: "release", item });
    this.camera = { shot: "tracking", target: { avatar }, ref: item.ref, room: item.room };
    this.lastCameraAt = now + at;
    return at - t0 + hold;
  }

  private hop(b: Builder, t0: number, now: number, item: HopItem, world: CineWorld): number | undefined {
    const avatar = world.avatarId(item.ref);
    if (avatar === undefined) return undefined;
    const at = t0 + this.minShotWait(now + t0);
    b.ui(at, this.cameraCue("tracking", { avatar }, 1, this.cfg.easeMs.tracking, 1600, true));
    b.ui(at + 1100, { k: "sfx", cue: "door", gain: 0.8 });
    b.add({ at: at + 900, k: "release", item });
    this.camera = { shot: "tracking", target: { avatar }, ref: item.ref, room: item.room };
    this.lastCameraAt = now + at;
    this.lastHop = { ref: item.ref, to: item.to, at: now + at + 1600 };
    return at - t0 + 1600;
  }

  private pair(b: Builder, t0: number, now: number, item: PairItem, world: CineWorld): number | undefined {
    const a = world.avatarId(item.ref);
    const p = world.avatarId(item.with);
    if (a === undefined || p === undefined) return undefined;
    const at = t0 + this.minShotWait(now + t0);
    b.ui(at, this.cameraCue("insert", { pair: [a, p] }, 2, this.cfg.easeMs.close_up, 2200));
    this.camera = { shot: "insert", target: { pair: [a, p] }, room: item.room };
    this.lastCameraAt = now + at;
    b.ui(at + 300, { k: "sfx", cue: item.pair, gain: 0.8 });
    b.add({ at: at + 300, k: "release", item });
    if (item.pair === "kiss" && now + at - this.lastSting >= this.cfg.stingGapMs) {
      this.lastSting = now + at;
      b.ui(at + 200, { k: "sfx", cue: "sting_romance", gain: 0.6 });
    }
    b.ui(at + 300, { k: "cue", id: a, emotion: "love", ms: 2000 });
    b.ui(at + 300, { k: "cue", id: p, emotion: "love", ms: 2000 });
    return at - t0 + 2200;
  }

  private object(b: Builder, t0: number, now: number, item: ObjectItem, _world: CineWorld): number | undefined {
    const target: ShotTarget | undefined = item.furni !== undefined ? { furni: item.furni } : item.tile ? { tile: [item.tile[0], item.tile[1]] } : undefined;
    if (!target) return undefined;
    const at = t0 + this.minShotWait(now + t0);
    b.ui(at, this.cameraCue("insert", target, 2, this.cfg.easeMs.close_up, 1800));
    this.camera = { shot: "insert", target, room: item.room };
    this.lastCameraAt = now + at;
    if (item.sfx) b.ui(at + 200, { k: "sfx", cue: item.sfx, gain: 0.7 });
    if (item.label) b.ui(at + 300, { k: "caption", text: clip(item.label), ms: 2400 });
    return at - t0 + 2000;
  }

  // ---- ambience ---------------------------------------------------------------

  /** The room's crowd murmur: one loop at a time, three or more people to earn it. */
  private ambience(b: Builder, at: number, room: number, world: CineWorld): void {
    const busy = world.occupants(room).length >= 3;
    if (this.murmurRoom !== undefined && (this.murmurRoom !== room || !busy)) {
      b.ui(at, { k: "sfx", cue: "murmur", stop: `murmur-${this.murmurRoom}` });
      this.murmurRoom = undefined;
    }
    if (busy && this.murmurRoom !== room) {
      b.ui(at, { k: "sfx", cue: "murmur", loop: true, id: `murmur-${room}`, gain: 0.3 });
      this.murmurRoom = room;
    }
  }
}
