/**
 * What the film sounds like: a room tone that tightens when two people slip
 * away, footfalls when somebody walks, a music bed that follows the room's
 * recorded mood, and the optional mumbled voices. Every mood has several tracks:
 * the next one starts when a track is nearly over, and a mood that comes back
 * later gets a different one, so a long film does not repeat itself.
 *
 * Nothing plays until a person asks (browsers want a gesture anyway), and
 * everything fades out when the film is paused, so a paused film is quiet.
 */
import { bedVolume, playlist, type Bed, type Mood, type Sample, type Timeline } from "@perfectman/shared";
import { Babble } from "./babble.js";

const AUDIO_BASE = "/audio";
/** Seconds for a bed to fade fully in or out, matching the live soundtrack's crossfade. */
const FADE_SECONDS = 2;
const TONE_WIDE = 0.05;
const TONE_HUDDLE = 0.022;
const STEP_LEVEL = 0.09;

/** Move `current` toward `target` by at most `step`. */
export function stepToward(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** The bed the film wants at `t`: the latest mood change not after it. */
export function moodAt(moods: Timeline["moods"], t: number): Mood {
  let mood: Mood = moods[0]?.mood ?? "calm";
  for (const m of moods) { if (m.t <= t) mood = m.mood; else break; }
  return mood;
}

/** Seconds before a track ends at which the next one begins to fade in. */
const HANDOVER_SECONDS = FADE_SECONDS + 1;

type Track = { el: HTMLAudioElement; vol: number; bed: Bed };

export class FilmAudio {
  readonly babble: Babble;
  private ctx: AudioContext | null = null;
  private tone: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private tracks = new Map<string, Track>();
  /** How many tracks of each mood have been used up, so a returning mood gets a new one. */
  private turn: Record<Mood, number> = { calm: 0, tension: 0, warmth: 0 };
  private lastMood: Mood | null = null;
  private heard = new Set<Mood>();
  private volumeLocked = false;
  private level = 0;
  sound = false;

  /** `seed` picks where in each mood's list a run starts; by default every film starts somewhere new. */
  constructor(private readonly indexOf: (actor: string) => number, private readonly seed: string = String(Math.random())) {
    this.babble = new Babble(indexOf, () => this.context());
  }

  /** The shared audio context. It is created on first use, which must be inside a user gesture. */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    void this.ctx.resume();
    return this.ctx;
  }

  setVoices(on: boolean): void {
    if (on) this.babble.enable(); else this.babble.disable();
  }

  setSound(on: boolean): void {
    this.sound = on;
    if (!on) return;
    const ctx = this.context();
    if (ctx && !this.tone) this.tone = this.makeTone(ctx);
    if (typeof Audio === "undefined") return;
    const probe = new Audio();
    probe.volume = 0.5;
    // iOS ignores writes to an element's volume; a bed at full level over the dialogue is worse than none.
    this.volumeLocked = probe.volume !== 0.5;
  }

  /** The track this mood should be playing now. */
  private wanted(mood: Mood): Bed {
    const list = playlist(mood, this.seed);
    return list[this.turn[mood] % list.length]!;
  }

  private track(bed: Bed): Track {
    let tr = this.tracks.get(bed.file);
    if (!tr) {
      const el = new Audio(`${AUDIO_BASE}/${bed.file}`);
      el.volume = 0;
      el.preload = "auto";
      tr = { el, vol: 0, bed };
      this.tracks.set(bed.file, tr);
    }
    return tr;
  }

  private makeTone(ctx: AudioContext): { gain: GainNode; filter: BiquadFilterNode } {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; } // brown-ish noise
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    return { gain, filter };
  }

  private footfall(actor: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sine";
    o.frequency.setValueAtTime(110 + (this.indexOf(actor) % 5) * 12, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    f.type = "lowpass";
    f.frequency.value = 400;
    g.gain.setValueAtTime(STEP_LEVEL, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Call every frame with the time just played, the time now, and the sample at `now`. */
  frame(T: Timeline, S: Sample, from: number, to: number, dt: number, playing: boolean): void {
    this.babble.play(T.cues, from, to);
    const audible = this.sound && playing;
    if (this.sound && playing && to > from) {
      for (const s of T.footsteps) { if (s.t > to) break; if (s.t > from && to - s.t < 0.25) this.footfall(s.actor); }
    }
    // Room tone: quieter and duller when the camera is in on a private pair.
    if (this.tone && this.ctx) {
      const huddle = S.scene?.type === "huddle" ? S.cam.pool : 0;
      const target = audible ? TONE_WIDE + (TONE_HUDDLE - TONE_WIDE) * huddle : 0;
      this.level = stepToward(this.level, target, dt * 0.05);
      this.tone.gain.gain.value = this.level;
      this.tone.filter.frequency.value = 700 - 320 * huddle;
    }
    this.music(moodAt(T.moods, to), audible, dt);
  }

  private music(mood: Mood, audible: boolean, dt: number): void {
    if (!this.sound || this.volumeLocked || typeof Audio === "undefined") return;
    if (mood !== this.lastMood) {
      // A mood heard before gets its next track; the first time, its first.
      if (this.heard.has(mood)) this.turn[mood] += 1;
      this.heard.add(mood);
      this.lastMood = mood;
    }
    let bed = this.wanted(mood);
    const now = this.tracks.get(bed.file);
    if (now && audible && !now.el.paused && Number.isFinite(now.el.duration) && now.el.duration - now.el.currentTime < HANDOVER_SECONDS) {
      this.turn[mood] += 1;
      bed = this.wanted(mood);
    }
    const current = this.track(bed);
    for (const tr of this.tracks.values()) {
      const goal = tr === current && audible ? bedVolume(tr.bed) : 0;
      if (tr.vol === 0 && goal > 0 && tr.el.paused) tr.el.currentTime = 0;
      tr.vol = stepToward(tr.vol, goal, (bedVolume(tr.bed) * dt) / FADE_SECONDS);
      tr.el.volume = Math.min(1, tr.vol);
      if (tr.vol > 0 && tr.el.paused) void tr.el.play().catch(() => undefined);
      else if (tr.vol === 0 && goal === 0 && !tr.el.paused) tr.el.pause();
    }
  }

  destroy(): void {
    this.babble.disable();
    for (const tr of this.tracks.values()) { tr.el.pause(); tr.el.src = ""; }
    this.tracks.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.tone = null;
  }
}
