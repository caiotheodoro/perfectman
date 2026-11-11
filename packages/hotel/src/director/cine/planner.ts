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
import { cineLead, cineThinkMs, cutLine, feelOf, interrupts } from "../../embodiment/human/turn.js";
import { hbetween } from "../../embodiment/human/rng.js";
import { readHostility } from "../drama/hostility.js";
import { HT } from "../../embodiment/human/tuning.js";
import type { CutFxKind, PerfectmanUi, Shot, ShotTarget, ShotZoom } from "../generated.js";
import { canonicalSfx } from "./cue-vocab.js";
import { DEFAULT_CINE } from "./types.js";
import type { ActItem, CameraIntent, CineConfig, CineItem, CineMood, CineWorld, EntranceItem, GestureItem, HopItem, LineItem, NarrationSource, ObjectItem, PairItem, Program, Step, StoryPhase, ThoughtItem, WalkItem } from "./types.js";

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
    case "act": return 2600;
    case "entrance": return 2400;
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
    case "act":
      return true;
    case "entrance":
      return world.avatarId(item.ref) !== undefined;
  }
}

/**
 * What an act does to the picture. `contact` acts land a hit: the table's `contact_at_ms` after the act starts is when
 * the planner stops the room and shakes the camera. The table's own camera steps still cut between the people; these
 * are the moves they cannot make. Numbers are starting points for the clip review, kept small so a shove is not a punch.
 */
export type ActFx = { contactMs: number; hitstopMs: number; shakePx: number; shakeMs: number; slowmo?: { factor: number; ms: number; after: number }; vignette?: { intensity: number; holdMs: number }; grade?: { tint: string; intensity: number; holdMs: number }; push?: number; sting?: string };
export const ACT_FX: Readonly<Record<string, ActFx>> = {
  shove: { contactMs: 250, hitstopMs: 60, shakePx: 4, shakeMs: 250 },
  slap: { contactMs: 300, hitstopMs: 90, shakePx: 6, shakeMs: 350 },
  punch: { contactMs: 350, hitstopMs: 120, shakePx: 9, shakeMs: 450, vignette: { intensity: 0.3, holdMs: 500 } },
  restrain: { contactMs: 200, hitstopMs: 0, shakePx: 3, shakeMs: 250 },
  kill: { contactMs: 500, hitstopMs: 140, shakePx: 10, shakeMs: 520, slowmo: { factor: 0.35, ms: 1500, after: 140 }, vignette: { intensity: 0.65, holdMs: 2800 }, grade: { tint: "#5a0d0d", intensity: 0.5, holdMs: 1200 } },
  faint: { contactMs: 800, hitstopMs: 0, shakePx: 0, shakeMs: 0, slowmo: { factor: 0.5, ms: 1600, after: 0 }, vignette: { intensity: 0.4, holdMs: 2400 } },
  die: { contactMs: 0, hitstopMs: 0, shakePx: 0, shakeMs: 0, slowmo: { factor: 0.5, ms: 1600, after: 0 }, vignette: { intensity: 0.5, holdMs: 3000 } },
};

/**
 * The sounds the new moves bring, by move. The table's verb timelines already play each act's contact sound and
 * sting (`thud`, `slap`, `sting_tension`, `sting_sad`), so these are only for what the planner adds on top.
 */
export const SFX_FOR_MOVE: Readonly<Record<string, { cue: string; gain: number }>> = {
  slowmo: { cue: "whoosh_short", gain: 0.5 },
  dolly_out: { cue: "whoosh_short", gain: 0.3 },
  dolly_in_escalation: { cue: "sting_tension", gain: 0.35 },
};

/** The verbs the director watches for. */
export const ACT_VERBS: ReadonlySet<string> = new Set(Object.keys(ACT_FX));

/** The strongest feeling in a mood, 0..1. */
export function moodIntensity(m: CineMood | undefined): number {
  if (!m) return 0;
  return Math.min(1, Math.max(Math.abs(m.valence), m.arousal, m.affection ?? 0));
}

/** A canonical `cue.emotion` (camera-and-audio.md 8.2): anger is `angry`, tension is `afraid`. */
export function emotionLabel(m: CineMood): string {
  if ((m.affection ?? 0) >= 0.6) return "love";
  if (m.valence <= -0.5) return m.arousal >= 0.6 ? "angry" : "sad";
  if (m.valence >= 0.5) return "joy";
  return "afraid";
}

const COPY: Record<"pt-BR" | "en", { meanwhile: string }> = {
  "pt-BR": { meanwhile: "Enquanto isso..." },
  en: { meanwhile: "Meanwhile..." },
};

type Camera = { shot: Shot; target: ShotTarget; ref?: string; pair?: readonly [string, string]; room: number; /** The rest zoom of the shot (1 when it is the whole room). */ zoom?: number; /** How far a slow push has taken it past `zoom` (1 = not at all). */ pushed?: number };

const MOVE_DEFAULT_MS = { dolly_in: 4000, dolly_out: 2500, shake: 400, slowmo: 1500, vignette: 3000, hitstop: 120 } as const;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
  private phase: StoryPhase = "setup";
  /** Every shot the film cut to, on the playback clock: the variety and cut-rate rules read it. */
  private readonly shotLog: Array<{ at: number; shot: Shot }> = [];

  /** The next item the director would play, if it is a line (the director sets it; the human layer's turn-taking looks ahead one line). */
  peek: (() => LineItem | undefined) | undefined;
  /** Lines whose speaker already has the typing bubble up (started inside the line before): the item id, and how long it has been typing when the line's program starts. */
  private readonly pretyped = new Map<string, { ref: string; typedMs: number }>();
  private lastInterruptAt: number | undefined;

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

  /** Where the scene is in its arc (a beat sheet's `phase`). Without one the film stays in `setup` and frames by salience alone. */
  setPhase(phase: StoryPhase): void {
    this.phase = phase;
  }

  get storyPhase(): StoryPhase {
    return this.phase;
  }

  /** The shot kinds cut to in the last `varietyWindowMs` ending at `now` (playback time). */
  shotKinds(now: number): Set<Shot> {
    return new Set(this.shotLog.filter((s) => now - s.at <= this.cfg.varietyWindowMs).map((s) => s.shot));
  }

  /** Camera changes in the last minute. */
  cutsLastMinute(now: number): number {
    return this.shotLog.filter((s) => now - s.at <= 60_000).length;
  }

  /**
   * Whether a shot of `kind` should be put in for variety: the window is short of its target kinds, `kind` is one it
   * lacks, the last cut was a while ago and the cut rate has room.
   */
  private wantsKind(kind: Shot, abs: number): boolean {
    if (this.shotKinds(abs).size >= this.cfg.minShotKinds || this.shotKinds(abs).has(kind)) return false;
    return abs - this.lastCameraAt >= this.cfg.varietyGapMs && this.cutsLastMinute(abs) < this.cfg.maxCutsPerMin;
  }

  private logShot(shot: Shot, abs: number): void {
    this.shotLog.push({ at: abs, shot });
    while (this.shotLog.length > 400 || (this.shotLog[0] && abs - this.shotLog[0].at > this.cfg.varietyWindowMs * 2)) this.shotLog.shift();
  }

  /** The planner no longer knows what the camera is on (the table's own shots cut it during an act). */
  private forgetCamera(abs: number): void {
    this.camera = undefined;
    this.lastCameraAt = Math.max(this.lastCameraAt, abs);
  }

  // ---- intro, filler, outro ---------------------------------------------------

  intro(now: number, home: number, world: CineWorld, nar: NarrationSource): Program {
    const b = new Builder();
    const { title, subtitle } = nar.card(home, "title");
    this.room = home;
    this.visited.add(home);
    this.lastRoomCutAt = now;
    this.lastCameraAt = now;
    this.logShot("establishing", now);
    this.camera = { shot: "establishing", target: { room: true }, room: home };
    b.ui(0, { k: "hud", letterbox: true, fade: { to: 1, ms: 0 } });
    b.ui(0, this.cameraCue("establishing", { room: true }, "fit", 0, this.cfg.introMs));
    b.ui(150, { k: "hud", fade: { to: 0, ms: 900 } });
    b.ui(250, { k: "card", kind: "title", title: clip(title), ...(subtitle ? { subtitle: clip(subtitle) } : {}), ms: this.cfg.introMs - 500 });
    // The room the film opens in gets its narrator aside like any room the camera cuts to, so a film that never leaves it still has one.
    const aside = nar.caption(home, "scene");
    if (aside) b.ui(Math.max(400, Math.round(this.cfg.introMs * 0.4)), { k: "caption", text: clip(aside), ms: Math.min(5000, readingMs(clip(aside), this.cfg)) });
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
      this.logShot("establishing", now);
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
    if (this.murmurRoom !== undefined) b.ui(0, { k: "sfx", cue: "crowd_murmur", stop: `murmur-${this.murmurRoom}` });
    this.murmurRoom = undefined;
    this.lastCameraAt = now;
    return { beat: "outro", room: this.room ?? 0, durationMs: 1100, steps: b.steps };
  }

  // ---- items ------------------------------------------------------------------

  plan(item: CineItem, now: number, world: CineWorld, nar: NarrationSource): Program | undefined {
    if (!canStage(item, world)) return undefined;
    this.fillers = 0;
    const b = new Builder();
    // A bubble started for a line that did not come next (another item took its turn) is put down.
    for (const [id, p] of [...this.pretyped]) {
      if (id === item.id) continue;
      this.pretyped.delete(id);
      b.add({ at: 0, k: "typing", ref: p.ref, on: false });
    }
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
      case "act": body = this.act(b, t, now, item); break;
      case "entrance": body = this.entrance(b, t, now, item, world); break;
    }
    if (body === undefined) return t > 0 ? { beat: item.id, room: item.room, durationMs: t, steps: b.steps } : undefined;
    this.activity.set(item.room, now + t);
    return { beat: item.id, room: item.room, durationMs: t + body, steps: b.steps };
  }

  // ---- transitions ------------------------------------------------------------

  /** An act the director saw start: its moves, relative to the act's start, to be scheduled at once (not behind the film's current program). */
  planAct(item: ActItem, now: number): Program | undefined {
    const b = new Builder();
    const duration = this.act(b, 0, now, item);
    return b.steps.length === 0 ? undefined : { beat: item.id, room: item.room, durationMs: duration, steps: b.steps };
  }

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
    b.ui(0, { k: "sfx", cue: kind === "door" ? "door_open" : "transition_whoosh", gain: 0.8 });
    const cutAt = Math.round(fxMs / 2);
    b.add({ at: cutAt, k: "cut", room: to, from });
    this.ambience(b, cutAt, to, world);
    b.ui(cutAt + 80, this.cameraCue("establishing", { room: true }, "fit", 0, 1500));
    this.camera = { shot: "establishing", target: { room: true }, room: to };
    this.lastCameraAt = now + cutAt + 80;
    this.logShot("establishing", now + cutAt + 80);
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
      this.logShot("establishing", now + wait);
      return wait + this.cfg.easeMs.establishing;
    }
    if (partner && partnerAvatar !== undefined) {
      const pair: [number, number] = [avatar, partnerAvatar];
      const zoom = this.pairZoom(ref, partner, world);
      b.ui(wait, this.cameraCue("two_shot", { pair }, zoom, this.cfg.easeMs.two_shot, hold));
      this.camera = { shot: "two_shot", target: { pair }, pair: [ref, partner], room, zoom, pushed: 1 };
      this.lastCameraAt = now + wait;
      this.logShot("two_shot", now + wait);
      return wait + this.cfg.easeMs.two_shot;
    }
    b.ui(wait, this.cameraCue("close_up", { avatar }, 2, this.cfg.easeMs.close_up, hold));
    this.camera = { shot: "close_up", target: { avatar }, ref, room, zoom: 2, pushed: 1 };
    this.lastCameraAt = now + wait;
    this.logShot("close_up", now + wait);
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

  private line(b: Builder, t00: number, now: number, item: LineItem, world: CineWorld): number {
    let t0 = t00;
    const text = clip(item.text);
    const ms = readingMs(text, this.cfg);
    const partner = this.partnerOf(item, world);
    // Variety: a film that has not shown a wide shot in a while shows one before the line (the norms ask for at least `minShotKinds` kinds in every window).
    if (item.room === this.room && this.camera?.shot !== "establishing" && world.occupants(item.room).length >= 2 && this.wantsKind("establishing", now + t0)) {
      const at = t0 + this.minShotWait(now + t0);
      b.ui(at, this.cameraCue("establishing", { room: true }, "fit", this.cfg.easeMs.establishing, 1700));
      this.camera = { shot: "establishing", target: { room: true }, room: item.room, zoom: 1, pushed: 1 };
      this.lastCameraAt = now + at;
      this.logShot("establishing", now + at);
      t0 = at + this.cfg.easeMs.establishing + 900;
    }
    const cam = this.camera;
    const covered = this.covers(item.room, item.ref);
    // The reveal and the climax get the close-up whatever the line says; so does a line the film owes one for variety.
    const story = this.phase === "climax" || this.phase === "reversal";
    const high = item.salience >= this.cfg.closeUpSalience || story;
    const upgrade = high || (item.salience >= 0.35 && this.wantsKind("close_up", now + t0));
    // A salient line inside a two-shot earns its close-up once the shot has been up long enough.
    const climax = covered && upgrade && cam?.shot === "two_shot" && this.minShotWait(now + t0) === 0;
    // The human layer's turn-taking (B5): the bubble before the line follows its length; a speaker whose bubble came up inside the line before has less left to type.
    const hum = this.cfg.human && this.cfg.human.likeness > 0 ? this.cfg.human : undefined;
    const lead = hum ? cineLead({ chars: text.length, baseMs: this.cfg.typingLeadMs, h: hum.likeness, seed: hum.seed, actor: item.ref, n: item.seq }) : undefined;
    const pre = this.pretyped.get(item.id);
    this.pretyped.delete(item.id);
    const leadMs = lead ? Math.max(0, lead.leadMs - (pre?.typedMs ?? 0)) : this.cfg.typingLeadMs;
    // A speaker walking up to the person it is about to address (the human layer sent the walk): the bubble comes up when the walk ends.
    const walkMs = item.walkMs ?? 0;
    let shotAt = 0;
    if (!covered || climax) {
      const withPartner = !climax && !upgrade && partner?.exchange ? partner.ref : undefined;
      shotAt = this.frame(b, t0, now, item.room, item.ref, world, ms + leadMs, withPartner) - t0;
    }
    const lineAt = t0 + Math.max(shotAt, leadMs, walkMs + (walkMs > 0 ? leadMs : 0));
    if (!pre) {
      b.add({ at: lineAt - leadMs, k: "typing", ref: item.ref });
      if (lead?.hesitate && lead.hesitate.afterMs + lead.hesitate.forMs < leadMs) {
        b.add({ at: lineAt - leadMs + lead.hesitate.afterMs, k: "typing", ref: item.ref, on: false });
        b.add({ at: lineAt - leadMs + lead.hesitate.afterMs + lead.hesitate.forMs, k: "typing", ref: item.ref });
      }
    }
    const next = hum ? this.peek?.() : undefined;
    b.add({ at: lineAt, k: "release", item });
    this.speakerExtras(b, lineAt, now + lineAt, item, world, ms);
    this.lastSpeaker = { ref: item.ref, room: item.room };
    this.storyMoves(b, lineAt, now + lineAt, ms, story && high);

    let end = lineAt + ms;
    // The next speaker starts typing inside this line (people type while the other talks), after a pause by feeling; a slow feeling holds the floor a moment longer.
    if (hum && next && next.ref !== item.ref && next.room === item.room) {
      const nextLead = cineLead({ chars: clip(next.text).length, baseMs: this.cfg.typingLeadMs, h: hum.likeness, seed: hum.seed, actor: next.ref, n: next.seq });
      const m = world.moodOf(next.ref);
      const think = cineThinkMs({ feel: m ? feelOf({ arousal: m.arousal, valence: m.valence, ...(m.shame !== undefined ? { shame: m.shame } : {}) }) : "neutral", h: hum.likeness, seed: hum.seed, actor: next.ref, n: next.seq });
      const start = Math.max(lineAt + HT.turn.cineAfterLandMs + think, end - nextLead.leadMs);
      // The bubble cannot start after this program ends: a long pause stretches the program to the moment the bubble comes up.
      end = Math.max(end, start);
      const typed = Math.max(0, end - start);
      b.add({ at: start, k: "typing", ref: next.ref, for: next.id });
      if (nextLead.hesitate && nextLead.hesitate.afterMs + nextLead.hesitate.forMs < typed) {
        b.add({ at: start + nextLead.hesitate.afterMs, k: "typing", ref: next.ref, on: false, for: next.id });
        b.add({ at: start + nextLead.hesitate.afterMs + nextLead.hesitate.forMs, k: "typing", ref: next.ref, for: next.id });
      }
      this.pretyped.set(next.id, { ref: next.ref, typedMs: typed });
    }
    // Reaction: the listener's face for the tail of a long line, when they feel something.
    const listener = partner?.ref;
    // A film with no reaction shot in its window cuts to the listener on a long enough line even if they hide what they feel.
    const feels = listener !== undefined && moodIntensity(world.moodOf(listener)) >= this.cfg.reactionIntensity;
    if (listener && ms >= 3500 && (feels || this.wantsKind("reaction", now + lineAt + 1200))) {
      const avatar = world.avatarId(listener);
      const earliest = Math.max(lineAt + 1200, Math.ceil(this.lastCameraAt - now) + this.cfg.minShotMs);
      if (avatar !== undefined && earliest + this.cfg.minShotMs <= end && this.cutsLastMinute(now + earliest) < this.cfg.maxCutsPerMin) {
        b.ui(earliest, this.cameraCue("reaction", { avatar }, 2, this.cfg.easeMs.reaction, end - earliest));
        this.camera = { shot: "reaction", target: { avatar }, ref: listener, room: item.room, zoom: 2, pushed: 1 };
        this.lastCameraAt = now + earliest;
        this.logShot("reaction", now + earliest);
      }
    }
    end += this.cfg.beatGapMs;
    return end - t0;
  }

  /**
   * The human layer's talk-over (B5), asked when a line is about to play: if the next line waiting on the film is from a heated speaker who has an answer ready, this
   * line trails off in a dash and the program ends early so the answer lands on top of it. Decided at the last moment because the answer is rarely queued when the line
   * is planned. Returns the part the room sees and how long the line holds the stage (its cut share of the reading time plus the overlap gap).
   */
  /** Whether `id` is still waiting to be pre-typed: a step that started its bubble early is skipped when this is false (the line was planned, or talked over and typed afresh). */
  stillPretyped(id: string): boolean {
    return this.pretyped.has(id);
  }

  talkOver(item: LineItem, nowRel: number, world: CineWorld): { cut: string; holdMs: number } | undefined {
    const hum = this.cfg.human;
    const next = this.peek?.();
    if (!hum || hum.likeness <= 0 || !next || next.ref === item.ref || next.room !== item.room || next.mode !== "say" || item.mode !== "say" || item.cut !== undefined) return undefined;
    const text = clip(item.text);
    const a = world.moodOf(item.ref);
    const o = world.moodOf(next.ref);
    if (!a || !o) return undefined;
    // What the two lines themselves carry heats the speakers before their feelings have caught up with them: a hostile word, a shout.
    const heatOf = (t: string): number => (readHostility(t).own ? 0.25 : 0) + Math.min(0.15, (t.match(/!/g)?.length ?? 0) * 0.05);
    const yes = interrupts({ h: hum.likeness, seed: hum.seed, n: item.seq, speaker: { actor: item.ref, arousal: a.arousal + heatOf(text), words: text.split(/\s+/).length }, other: { actor: next.ref, arousal: o.arousal + heatOf(next.text) }, now: nowRel, ...(this.lastInterruptAt !== undefined ? { lastInterruptAt: this.lastInterruptAt } : {}) });
    if (!yes) return undefined;
    const cut = cutLine(text, hum.seed, item.ref, item.seq);
    if (!cut) return undefined;
    this.lastInterruptAt = nowRel;
    // The answer plays next, earlier than this program planned: its bubble starts in its own program, not in a step of this one that would now fire too late.
    this.pretyped.delete(next.id);
    const holdMs = Math.round(readingMs(text, this.cfg) * (cut.length / Math.max(text.length, 1))) + Math.round(hbetween(hum.seed, HT.turn.overlapGapMs, "cine-overlap", item.ref, item.seq));
    return { cut, holdMs };
  }

  private lastVignetteAt = Number.NEGATIVE_INFINITY;

  /**
   * What the story does to the picture while someone speaks: in the escalation the shot pushes in a little more with
   * each line (and the tension sting comes in, rate limited like the others); at a reveal or the climax the edges close in.
   */
  private storyMoves(b: Builder, at: number, abs: number, holdMs: number, peak: boolean): void {
    const cam = this.camera;
    if (!cam || cam.shot === "establishing" || cam.shot === "insert") return;
    if (this.phase === "escalation") {
      const limit = 1 + 2 * this.cfg.escalationDolly;
      const pushed = cam.pushed ?? 1;
      if (pushed + 1e-6 < limit) {
        const next = Math.min(limit, pushed * (1 + this.cfg.escalationDolly));
        const to = Math.round(clamp((cam.zoom ?? 1) * next, 0.5, 2.5) * 100) / 100;
        b.ui(at, { k: "camera_fx", move: "dolly", to_zoom: to, ms: Math.round(clamp(holdMs, 1500, 12_000)), curve: "linear" });
        cam.pushed = next;
        if (abs - this.lastSting >= this.cfg.stingGapMs) {
          this.lastSting = abs;
          b.ui(at, { k: "sfx", cue: SFX_FOR_MOVE.dolly_in_escalation?.cue ?? "sting_tension", gain: SFX_FOR_MOVE.dolly_in_escalation?.gain ?? 0.35 });
        }
      }
    } else if (peak && abs - this.lastVignetteAt >= 12_000) {
      this.lastVignetteAt = abs;
      b.ui(at, { k: "camera_fx", move: "vignette", intensity: this.phase === "climax" ? 0.55 : 0.35, ms: 700, hold_ms: this.cfg.climaxVignetteMs });
    }
  }

  /** Lower-third on first speech, the overhead emotion cue, and the stings. */
  private speakerExtras(b: Builder, at: number, abs: number, item: LineItem, world: CineWorld, ms: number): void {
    const avatar = world.avatarId(item.ref);
    if (!this.introduced.has(item.ref)) {
      this.introduced.add(item.ref);
      const role = world.roleOf(item.ref);
      const shown = role && role !== "connector" && role !== "skeptic" && role !== "performer" ? role : undefined;
      b.ui(at, { k: "lower_third", name: clip(world.nameOf(item.ref), 40), ...(shown ? { role: clip(shown, 40) } : {}), ms: 2600 });
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
    this.logShot("tracking", now + at);
    return at - t0 + hold;
  }

  private hop(b: Builder, t0: number, now: number, item: HopItem, world: CineWorld): number | undefined {
    const avatar = world.avatarId(item.ref);
    if (avatar === undefined) return undefined;
    const at = t0 + this.minShotWait(now + t0);
    b.ui(at, this.cameraCue("tracking", { avatar }, 1, this.cfg.easeMs.tracking, 1600, true));
    b.ui(at + 1100, { k: "sfx", cue: "door_open", gain: 0.8 });
    b.ui(at + 1450, { k: "sfx", cue: "door_close", gain: 0.6 });
    b.add({ at: at + 900, k: "release", item });
    this.camera = { shot: "tracking", target: { avatar }, ref: item.ref, room: item.room };
    this.lastCameraAt = now + at;
    this.logShot("tracking", now + at);
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
    this.logShot("insert", now + at);
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
    this.logShot("insert", now + at);
    // An object's own sfx must be drawn from the vocabulary too (camera-and-audio.md 8.1); anything else is dropped.
    const sfx = item.sfx ? canonicalSfx(item.sfx) : undefined;
    if (sfx) b.ui(at + 200, { k: "sfx", cue: sfx, gain: 0.7 });
    if (item.label) b.ui(at + 300, { k: "caption", text: clip(item.label), ms: 2400 });
    return at - t0 + 2000;
  }

  // ---- ambience ---------------------------------------------------------------

  /**
   * An act with a body: what the table's own shots cannot do. At contact the room stops (every avatar, not only the
   * pair), the camera shakes by what the blow weighs, a kill drops into slow motion with the edges closing in and a
   * red cast, and a fall slows down under a vignette. `contactMs` is the table's contact time after the act started;
   * the program is relative to that start. The camera is unknown afterwards (the table cut it), so the next line frames afresh.
   */
  private act(b: Builder, t0: number, now: number, item: ActItem): number {
    const fx = ACT_FX[item.verb];
    if (!fx) return 0;
    const contact = Math.max(0, item.contactMs > 0 ? item.contactMs : fx.contactMs);
    const at = t0 + contact;
    const abs = now + at;
    if (fx.hitstopMs > 0) b.ui(at, { k: "camera_fx", move: "hitstop", ms: fx.hitstopMs });
    if (fx.shakePx > 0) b.ui(at, { k: "camera_fx", move: "shake", amp_px: fx.shakePx, ms: fx.shakeMs });
    if (fx.slowmo) {
      const slowAt = at + fx.slowmo.after;
      b.ui(slowAt, { k: "camera_fx", move: "slowmo", factor: fx.slowmo.factor, ms: fx.slowmo.ms });
      b.ui(slowAt, { k: "sfx", cue: SFX_FOR_MOVE.slowmo?.cue ?? "whoosh_short", gain: SFX_FOR_MOVE.slowmo?.gain ?? 0.5 });
    }
    if (fx.vignette) {
      this.lastVignetteAt = abs;
      b.ui(at, { k: "camera_fx", move: "vignette", intensity: fx.vignette.intensity, ms: 180, hold_ms: fx.vignette.holdMs });
    }
    if (fx.grade) b.ui(at, { k: "camera_fx", move: "grade", tint: fx.grade.tint, intensity: fx.grade.intensity, ms: 150, hold_ms: fx.grade.holdMs });
    this.forgetCamera(abs + 1500);
    return contact + (fx.slowmo ? fx.slowmo.after + fx.slowmo.ms : 600);
  }

  /** Someone comes through the door: the wide shot (every room is established once; a late arrival is worth showing again). */
  private entrance(b: Builder, t0: number, now: number, item: EntranceItem, world: CineWorld): number | undefined {
    if (world.avatarId(item.ref) === undefined) return undefined;
    const at = t0 + this.minShotWait(now + t0);
    // The wide shot holds as long as a filler's does (scaled with the rest of the pacing), a little shorter.
    const hold = Math.round(this.cfg.fillerMs * 0.7);
    b.ui(at, this.cameraCue("establishing", { room: true }, "fit", this.cfg.easeMs.establishing, hold));
    b.ui(at + Math.min(150, Math.round(hold / 4)), { k: "sfx", cue: "door_open", gain: 0.6 });
    this.camera = { shot: "establishing", target: { room: true }, room: item.room, zoom: 1, pushed: 1 };
    this.lastCameraAt = now + at;
    this.logShot("establishing", now + at);
    return at - t0 + hold;
  }

  /**
   * A camera beat of a beat sheet: the shot it names and the move it asks for, now. An authored beat is not held
   * back by the anti-jitter rule (the sheet decided), only by the cut-rate ceiling. Unknown people are skipped:
   * no avatar, no shot.
   */
  planIntent(intent: CameraIntent, now: number, world: CineWorld): Program | undefined {
    const room = intent.room ?? this.room;
    if (room === undefined) return undefined;
    const b = new Builder();
    const refs = intent.on === undefined ? [] : typeof intent.on === "string" ? [intent.on] : [...intent.on];
    const ids = refs.map((r) => world.avatarId(r));
    if (ids.some((id) => id === undefined) && intent.shot !== "establishing") return undefined;
    const [a, p] = ids as [number | undefined, number | undefined];
    let at = 0;
    const hold = intent.ms ?? 3000;
    const rest = intent.zoom ?? (intent.shot === "close_up" || intent.shot === "reaction" || intent.shot === "insert" ? 2 : 1);
    let target: ShotTarget | undefined;
    switch (intent.shot) {
      case "establishing": target = { room: true }; break;
      case "two_shot": target = a !== undefined && p !== undefined ? { pair: [a, p] } : undefined; break;
      case "insert": target = a !== undefined && p !== undefined ? { pair: [a, p] } : a !== undefined ? { avatar: a } : undefined; break;
      default: target = a !== undefined ? { avatar: a } : undefined;
    }
    if (!target) return undefined;
    const kind = intent.shot;
    if (this.cutsLastMinute(now) >= this.cfg.maxCutsPerMin + 2) return undefined;
    const ease = intent.shot === "tracking" ? this.cfg.easeMs.tracking : intent.shot === "close_up" || intent.shot === "reaction" ? this.cfg.easeMs.close_up : this.cfg.easeMs.two_shot;
    b.ui(at, this.cameraCue(kind, target, kind === "establishing" ? "fit" : (rest === 0.5 ? 0.5 : rest >= 2 ? 2 : 1), ease, hold, kind === "tracking"));
    const cam: Camera = { shot: kind, target, room, zoom: kind === "establishing" ? 1 : rest, pushed: 1, ...(refs[0] ? { ref: refs[0] } : {}), ...(refs.length === 2 ? { pair: [refs[0] as string, refs[1] as string] as const } : {}) };
    this.camera = cam;
    this.lastCameraAt = now;
    this.logShot(kind, now);
    if (intent.move) {
      at = ease + 80;
      this.intentMove(b, at, now + at, intent, cam, hold);
    }
    return { beat: `intent:${kind}`, room, durationMs: Math.max(hold, at), steps: b.steps };
  }

  /** The `camera_fx` cue(s) of an intent's move, with the defaults the contract leaves out. */
  private intentMove(b: Builder, at: number, abs: number, intent: CameraIntent, cam: Camera, hold: number): void {
    const move = intent.move;
    if (!move) return;
    const ms = Math.round(clamp(intent.ms ?? MOVE_DEFAULT_MS[move], 0, 30_000));
    const here = (cam.zoom ?? 1) * (cam.pushed ?? 1);
    switch (move) {
      case "dolly_in":
      case "dolly_out": {
        const share = clamp(intent.amount ?? 0.3, 0.02, 1.5);
        const to = Math.round(clamp(move === "dolly_in" ? here * (1 + share) : here / (1 + share), 0.5, 2.5) * 100) / 100;
        b.ui(at, { k: "camera_fx", move: "dolly", to_zoom: to, ms, curve: move === "dolly_in" ? "in_out" : "out" });
        cam.pushed = to / (cam.zoom ?? 1);
        if (move === "dolly_out") b.ui(at, { k: "sfx", cue: SFX_FOR_MOVE.dolly_out?.cue ?? "whoosh_short", gain: SFX_FOR_MOVE.dolly_out?.gain ?? 0.3 });
        return;
      }
      case "shake":
        b.ui(at, { k: "camera_fx", move: "shake", amp_px: Math.round(clamp(intent.amount ?? 6, 1, 24)), ms });
        return;
      case "slowmo":
        b.ui(at, { k: "camera_fx", move: "slowmo", factor: clamp(intent.amount ?? 0.4, 0.25, 1), ms });
        b.ui(at, { k: "sfx", cue: SFX_FOR_MOVE.slowmo?.cue ?? "whoosh_short", gain: SFX_FOR_MOVE.slowmo?.gain ?? 0.5 });
        return;
      case "vignette":
        this.lastVignetteAt = abs;
        b.ui(at, { k: "camera_fx", move: "vignette", intensity: clamp(intent.amount ?? 0.5, 0.05, 1), ms: 600, hold_ms: Math.max(0, ms - 600) });
        return;
      case "hitstop":
        b.ui(at, { k: "camera_fx", move: "hitstop", ms: Math.round(clamp(intent.amount ?? 120, 30, 1000)) });
        void hold;
        return;
    }
  }

  /** The room's crowd murmur: one loop at a time, three or more people to earn it. */
  private ambience(b: Builder, at: number, room: number, world: CineWorld): void {
    const busy = world.occupants(room).length >= 3;
    if (this.murmurRoom !== undefined && (this.murmurRoom !== room || !busy)) {
      b.ui(at, { k: "sfx", cue: "crowd_murmur", stop: `murmur-${this.murmurRoom}` });
      this.murmurRoom = undefined;
    }
    if (busy && this.murmurRoom !== room) {
      b.ui(at, { k: "sfx", cue: "crowd_murmur", loop: true, id: `murmur-${room}`, gain: 0.3 });
      this.murmurRoom = room;
    }
  }
}
