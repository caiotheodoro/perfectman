/**
 * A run becomes a timeline of continuous tracks: one pose track per character,
 * a camera, balloons, reaction marks, captions and the light. Nothing is
 * triggered; `sampleTimeline` reads all of it at any moment.
 *
 * Timing comes from the text (see `timing.ts`). Reading is serial, so the next
 * balloon lands about half a second before the last is finished; reactions,
 * gaze and camera moves overlap freely because they need no reading.
 */
import { addresseesOf } from "./addressees.js";
import { poseFrom, toPoseVector, type PoseTarget, type PoseVector } from "./emotion-pose.js";
import { personaSignature } from "./persona-signature.js";
import { computeTangents } from "./sample.js";
import { canChangeMood, type Mood } from "../stage/mood.js";
import { PACES, timing, tokens, type Timing } from "./timing.js";
import type {
  Balloon, BalloonKind, CameraState, Caption, Cue, DirectorOptions, DirectorReplay, DirectorEvent, HuddleMode,
  LightKey, ReactionMark, Scene, Spot, TimedWord, TimelineMessage,
} from "./types.js";

export const STAGE = { w: 1200, h: 600 } as const;

/** Room one huddle member takes, and the gap left between neighbours, so nobody stands on anybody. */
const HUDDLE_W = 0.18 * 1200;
const HUDDLE_STEP = HUDDLE_W * 1.1;
const BYSTANDER_W = 0.12 * 1200;

/** Where a huddle's members stand, nearest the door first (stage pixels, feet position): a tidy row in the left nook. */
export const huddleSpot = (k: number): Spot => ({ x: 150 + k * HUDDLE_STEP, y: k % 2 ? 566 : 552, w: HUDDLE_W });

/**
 * Where everybody who is not in the huddle waits: in a row to the right of it, clear of the members
 * and of each other, so a bystander is never mistaken for part of the group.
 */
export const bystanderSpot = (j: number, count: number, members: number): Spot => {
  const first = huddleSpot(Math.max(0, members - 1)).x + HUDDLE_W / 2 + 40 + BYSTANDER_W / 2;
  const last = STAGE.w - BYSTANDER_W / 2 - 20;
  const step = count > 1 ? Math.min(BYSTANDER_W * 1.1, (last - first) / (count - 1)) : 0;
  return { x: Math.min(last, first + j * step), y: 552 + (j % 2) * 10, w: BYSTANDER_W };
};
/** Seconds the camera takes to move and the cast takes to walk when the shot changes. */
export const CUT_SECONDS = 1.3;

export type PoseKey = { t: number; v: PoseVector; m?: PoseVector };
export type Timeline = {
  mode: HuddleMode;
  pace: number;
  agents: string[];
  keys: Record<string, PoseKey[]>;
  cam: Array<{ t: number; c: CameraState }>;
  light: LightKey[];
  balloons: Balloon[];
  marks: ReactionMark[];
  captions: Caption[];
  scenes: Scene[];
  msgs: Array<TimelineMessage & { timing: Timing; conv: SceneType }>;
  speak: Record<string, Array<[number, number, TimedWord[]]>>;
  lapses: Array<{ t0: number; t1: number; p: number }>;
  pulseT: Record<number, number>;
  cues: Cue[];
  /** One entry per footfall while somebody walks, for the sound of the room. */
  footsteps: Array<{ t: number; actor: string }>;
  /** Which music bed fits the room, changing no faster than the bed hold allows. */
  moods: Array<{ t: number; mood: Mood }>;
  wordTotal: number;
  duration: number;
};
type SceneType = "wide" | "huddle";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const MARKS: Record<string, ReactionMark["kind"]> = { anger: "steam", fear: "sweat", warm: "heart", suspicion: "?", shame: "sweat", proud: "*" };
const GESTURE: Record<string, PoseTarget["armR"]> = { anger: "up", fear: "wring", shame: "hug", warm: "open", rest: "open", proud: "akimbo", suspicion: "folded" };

const capsRatio = (t: string): number => {
  const l = t.replace(/[^A-Za-z]/g, "");
  return l.length ? l.replace(/[^A-Z]/g, "").length / l.length : 0;
};

/** Minutes since midnight for a pulse; the light and the clock chip read this. */
export function storyMinute(replay: Pick<DirectorReplay, "storyClock">, pulse: number): number {
  const clock = replay.storyClock ?? { start: "21:00", minutesPerPulse: 4 };
  const [h, m] = clock.start.split(":").map(Number);
  return (h ?? 21) * 60 + (m ?? 0) + pulse * clock.minutesPerPulse;
}

export function buildTimeline(replay: DirectorReplay, options: DirectorOptions = {}): Timeline {
  const mode: HuddleMode = options.huddle ?? "push";
  const pace = options.pace ?? PACES.normal;
  const agents = replay.agentIds;
  const N = agents.length;
  const T: Timeline = {
    mode, pace, agents, keys: {}, cam: [], light: [], balloons: [], marks: [], captions: [], scenes: [], msgs: [],
    speak: {}, lapses: [], pulseT: {}, cues: [], footsteps: [], moods: [], wordTotal: 0, duration: 0,
  };
  for (const id of agents) { T.keys[id] = []; T.speak[id] = []; }

  const archetype = (id: string): string => replay.agentProfiles?.[id]?.archetype ?? replay.agentArchetypes[id] ?? "";
  const sig = (id: string) => personaSignature({ archetype: archetype(id) });
  const pubChannel = replay.channels.find((c) => c.type === "public_channel");
  const channelOf = (id: string) => replay.channels.find((c) => c.id === id);

  const ringPct = (i: number): [number, number] => [N < 2 ? 50 : 22 + i * (56 / (N - 1)), [91, 94, 92, 91, 96, 89, 95, 93][i % 8] ?? 92];
  const width = N <= 5 ? 0.17 : N <= 6 ? 0.14 : 0.12;
  const ringPx = (i: number): Spot => { const [x, y] = ringPct(i); return { x: x * 12, y: y * 6, w: width * 1200 }; };
  const hudPx = huddleSpot;

  const pos: Record<string, Spot> = {};
  const blur: Record<string, number> = {}, dim: Record<string, number> = {}, hide: Record<string, number> = {};
  agents.forEach((id, i) => { pos[id] = ringPx(i); blur[id] = 0; dim[id] = 0; hide[id] = 0; });

  const mood = (id: string, p: number) => replay.pulses[p]?.agentStates[id]?.coreMood ?? { valence: 0, arousal: 0.4, energy: 1 };
  const social = (id: string, p: number) => replay.pulses[p]?.agentStates[id]?.socialEmotions ?? {};
  const baseP = (id: string, p: number, o: { toward?: number } = {}): PoseTarget => poseFrom(mood(id, p), social(id, p), o);
  const vec = (id: string, P: PoseTarget, at?: Spot): PoseVector => {
    const v = toPoseVector(P, sig(id));
    const q = at ?? pos[id]!;
    v.x = q.x; v.y = q.y; v.w = q.w; v.blur = blur[id] ?? 0; v.dim = dim[id] ?? 0; v.hide = hide[id] ?? 0;
    return v;
  };
  const key = (id: string, t: number, P: PoseTarget, at?: Spot): void => { T.keys[id]!.push({ t, v: vec(id, P, at) }); };

  const minute = (p: number): number => storyMinute(replay, p);
  const nameOf = (id: string): string => replay.agentProfiles?.[id]?.displayName ?? replay.agentNames[id] ?? id;
  const short = (id: string): string => nameOf(id).replace(/^(Dona|Mr\.|Ms\.|Mrs\.|Dr\.)\s+/, "");

  type Conv = { type: SceneType; key: string; members: string[] };
  const convOf = (e: DirectorEvent): Conv => {
    const ch = channelOf(e.channelId);
    const members = (ch?.memberAgentIds ?? []).filter((m) => agents.includes(m));
    if ((pubChannel && e.channelId === pubChannel.id) || members.length >= N || members.length > 3 || members.length < 2) {
      return { type: "wide", key: "wide", members: [...agents] };
    }
    return { type: "huddle", key: e.channelId, members };
  };
  const camFor = (type: SceneType, members: string[]): CameraState => {
    if (type === "wide" || mode === "wide") return { cx: 600, cy: 300, z: 1, pool: type === "wide" ? 0 : 0.5, bg: 0, room: 0 };
    if (mode === "door") return { cx: 600, cy: 300, z: 1, pool: 0.4, bg: 0, room: 1 };
    const xs = members.map((_, k) => hudPx(k).x);
    const cx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return { cx: Math.max(330, cx + 40), cy: 395, z: 1.65, pool: 1, bg: 1.6, room: 0 };
  };

  const state: { scene: Scene | null } = { scene: null };
  let cursor = 0;
  const enterScene = (conv: Conv, p: number, t: number): number => {
    const prev = state.scene;
    const next: Scene = { key: conv.key, type: conv.type, members: conv.members, t0: t, t1: t, cam: camFor(conv.type, conv.members) };
    if (prev) prev.t1 = Math.max(prev.t1, t);
    T.scenes.push(next);
    state.scene = next;
    const tArr = t + CUT_SECONDS;
    T.cam.push({ t, c: prev ? prev.cam : next.cam }, { t: tArr, c: next.cam });
    agents.forEach((id, i) => {
      const P0 = baseP(id, p);
      const old = pos[id]!;
      key(id, t, P0, old);
      let np = ringPx(i);
      let b = 0, d = 0, h = 0;
      if (conv.type === "huddle") {
        const k = conv.members.indexOf(id);
        if (mode === "door") { if (k >= 0) np = { x: 380 + k * 430, y: 520, w: 0.2 * 1200 }; else h = 1; }
        else if (k >= 0) np = hudPx(k);
        else {
          const others = agents.filter((a) => !conv.members.includes(a));
          np = bystanderSpot(others.indexOf(id), others.length, conv.members.length);
          if (mode === "push") { b = 3.2; d = 0.12; }
        }
      }
      pos[id] = np; blur[id] = b; dim[id] = d; hide[id] = h;
      const P1: PoseTarget = { ...P0 };
      const bystander = conv.type === "huddle" && !conv.members.includes(id) && mode !== "door";
      if (bystander) { P1.gx = -1; P1.lean = -3; P1.armL = P1.armR = "folded"; P1.kind = "peek"; }
      if (mode === "door" && conv.type === "huddle" && conv.members.includes(id)) key(id, t + 0.55, P0, { x: 150, y: old.y, w: old.w });
      if (mode === "door" && conv.type === "wide" && prev?.type === "huddle" && prev.members.includes(id)) key(id, t + 0.2, P0, { x: 150, y: np.y, w: np.w });
      key(id, tArr, P1, np);
    });
    if (conv.type === "huddle") T.captions.push({ t0: t + 0.1, t1: t + 2.6, text: `${conv.members.map(short).join(" and ")} slip away from the others`, where: "bl" });
    return tArr;
  };

  const kindOf = (t: string, conv: Conv, arousal: number): BalloonKind => {
    if (conv.type === "huddle") return "whisper";
    if ((capsRatio(t) > 0.6 && t.length > 10) || (t.match(/!/g) ?? []).length >= 2 || arousal > 0.72) return "shout";
    return "speech";
  };

  T.light.push({ t: 0, minute: minute(0) });
  const lastSpeakerIn: Record<string, string | undefined> = {};

  for (let p = 0; p < replay.pulses.length; p++) {
    const pulse = replay.pulses[p]!;
    const says = pulse.committedEvents.filter((e) => e.type === "message_sent" || e.type === "reply_sent");
    const groups: Array<{ conv: Conv; ev: DirectorEvent[] }> = [];
    for (const e of says) {
      const c = convOf(e);
      let g = groups.find((x) => x.conv.key === c.key);
      if (!g) { g = { conv: c, ev: [] }; groups.push(g); }
      g.ev.push(e);
    }
    T.pulseT[p] = cursor;
    if (groups.length === 0) {
      const t0 = cursor, t1 = cursor + 1.1;
      T.lapses.push({ t0, t1, p });
      T.light.push({ t: t1, minute: minute(p) });
      agents.forEach((id) => key(id, t1, baseP(id, p)));
      T.captions.push({ t0: t0 + 0.1, t1: t1 + 0.4, text: "Time passes…", where: "bl" });
      cursor = t1;
      continue;
    }
    T.light.push({ t: cursor, minute: minute(p) });
    for (const g of groups) {
      if (!state.scene || state.scene.key !== g.conv.key) cursor = enterScene(g.conv, p, cursor + (state.scene ? 0.15 : 0));
      const sc = state.scene!;
      const sceneIndex = T.scenes.length - 1;
      type Item = TimelineMessage & { timing: Timing; conv: SceneType; th?: { motive: string; drivers: string[] }; thSec: number };
      const items: Item[] = [];
      const lastBy: Record<string, number> = {};
      g.ev.forEach((e, i) => {
        const text = String(e.payload["content"] ?? "");
        const arousal = mood(e.actorId, p).arousal;
        const kind = kindOf(text, g.conv, arousal);
        const pages = options.pageWords ? options.pageWords({ kind, actor: e.actorId, text, arousal }) : null;
        const tm = timing(text, pace, pages);
        const thinking = pulse.agentThinking?.[e.actorId];
        const first = !g.ev.slice(0, i).some((x) => x.actorId === e.actorId);
        const th = thinking?.privateMotiveSummary && first ? { motive: thinking.privateMotiveSummary, drivers: thinking.emotionDrivers } : undefined;
        const thSec = th ? clamp(0.5 + Math.min(14, tokens(th.motive.split(/(?<=[.;—])\s/)[0] ?? "").length) / pace, 1.2, 2.4) : 0;
        const prev = items[i - 1];
        let s0 = i === 0 || !prev ? cursor + 0.5 : Math.max(prev.s0 + prev.timing.reveal * 0.6, prev.readEnd - 0.5, (lastBy[e.actorId] ?? -9) + 0.3);
        s0 += thSec;
        const ad = addresseesOf(e, { agentNames: replay.agentNames, channel: channelOf(e.channelId), lastOtherSpeaker: lastSpeakerIn[e.channelId] && lastSpeakerIn[e.channelId] !== e.actorId ? lastSpeakerIn[e.channelId] : undefined });
        lastSpeakerIn[e.channelId] = e.actorId;
        const words = tm.tokens.map((tok, k) => ({ t: s0 + (tm.offsets[k] ?? 0), len: tok.length }));
        items.push({
          id: e.id, actor: e.actorId, channelId: e.channelId, text, to: ad.ids, inferred: ad.inferred, pulse: p,
          s0, s1: s0 + tm.reveal, readEnd: s0 + Math.max(tm.reveal, tm.read) + 0.1, wordCount: tm.wordCount, words, sceneIndex,
          timing: tm, conv: g.conv.type, th, thSec,
        });
        lastBy[e.actorId] = s0 + tm.reveal;
        T.speak[e.actorId]!.push([s0, s0 + tm.reveal, words]);
        T.wordTotal += tm.wordCount;
      });
      for (const m of items) {
        const S = m.actor, mem = sc.members;
        const tgt = m.to.find((x) => mem.includes(x) && x !== S) ?? mem.find((x) => x !== S);
        const toward = Math.sign((tgt ? pos[tgt]!.x : pos[S]!.x) - pos[S]!.x) || 0;
        const base = baseP(S, m.pulse);
        const ant: PoseTarget = { ...base, lean: base.lean + 3 * toward, gx: toward, breath: Math.max(1.5, base.breath * 0.8) };
        const talk = baseP(S, m.pulse, { toward });
        talk.gx = toward * 0.9;
        const ges: PoseTarget = { ...talk, armR: GESTURE[talk.kind] ?? talk.armR, armL: talk.kind === "anger" ? "up" : talk.armL, lean: talk.lean + 1.2 * toward };
        key(S, m.s0 - 0.5, ant); key(S, m.s0 + 0.08, talk);
        if (m.timing.reveal > 1.6) key(S, m.s0 + m.timing.reveal * 0.5, ges);
        key(S, m.s1 + 0.45, { ...base, gx: toward * 0.4 });
        for (const L of agents) {
          if (L === S) continue;
          const talking = T.speak[L]!.some(([a0, a1]) => (a0 <= m.s0 + 0.3 && a1 >= m.s0) || (a0 > m.s0 && a0 < m.s1));
          if (talking) continue;
          const lt = Math.sign(pos[S]!.x - pos[L]!.x) || 0;
          const bs = baseP(L, m.pulse);
          if (!mem.includes(L)) {
            const huddle = sc.type === "huddle";
            key(L, m.s0 + 0.3, { ...bs, gx: huddle ? -1 : lt, lean: bs.lean + (huddle ? -3 : 0), kind: "peek" });
            key(L, m.readEnd + 0.5, { ...bs, gx: huddle ? -0.6 : 0 });
            continue;
          }
          key(L, m.s0 + 0.2, { ...bs, gx: lt * 0.9, lean: bs.lean + 2 * lt });
          const R2 = baseP(L, m.pulse, { toward: lt });
          R2.gx = lt * 0.8;
          const tr = m.s0 + Math.max(0.6, m.timing.reveal * 0.45);
          key(L, tr, R2);
          const mk = MARKS[R2.kind];
          if (R2.kind !== "rest" && R2.strength > 0.42 && mk) T.marks.push({ t: tr, dur: 1.8, actor: L, kind: mk });
          key(L, m.readEnd + 0.4, { ...bs, gx: lt * 0.3 });
        }
        const arousal = mood(S, m.pulse).arousal;
        const kind = kindOf(m.text, g.conv, arousal);
        T.balloons.push({
          id: `b${T.balloons.length}`, kind, actor: S, text: m.text, to: m.to, s0: m.s0, s1: m.s1, t0: m.s0 - 0.12, t1: m.readEnd + 0.8,
          arousal, words: m.words, wordCount: m.wordCount, pulse: m.pulse, omniscient: false, sceneIndex,
        });
        if (m.th) {
          T.balloons.push({
            id: `b${T.balloons.length}`, kind: "thought", actor: S, text: m.th.motive, drivers: m.th.drivers,
            s0: m.s0 - m.thSec, s1: m.s0 - m.thSec + 0.25, t0: m.s0 - m.thSec, t1: m.s0 - 0.14,
            arousal, words: [], wordCount: 0, pulse: m.pulse, omniscient: true, sceneIndex,
          });
        }
        m.words.forEach((w, k) => T.cues.push({ t: w.t, actor: S, text: "kamitorebusonaleku".slice(k % 7, (k % 7) + Math.max(2, Math.min(w.len, 6))), whisper: m.conv === "huddle" }));
        T.msgs.push(m);
      }
      const end = Math.max(...items.map((m) => m.readEnd));
      sc.t1 = end + 0.5;
      cursor = end + 0.2;
    }
    T.light.push({ t: cursor, minute: minute(p) + 3 });
  }

  T.duration = cursor + 1.2;
  const lastP = Math.max(0, replay.pulses.length - 1);
  agents.forEach((id) => key(id, T.duration, baseP(id, lastP)));
  T.cam.push({ t: T.duration, c: state.scene ? state.scene.cam : camFor("wide", []) });
  // A tiny gap between two keys would be a snap, so the earlier one gives way.
  for (const id of agents) {
    const sorted = T.keys[id]!.sort((x, y) => x.t - y.t);
    const out: PoseKey[] = [];
    for (const q of sorted) { if (out.length && q.t - out[out.length - 1]!.t < 0.06) out[out.length - 1] = q; else out.push(q); }
    T.keys[id] = out;
    computeTangents(out);
  }
  T.cam.sort((x, y) => x.t - y.t);
  for (let i = 1; i < T.cam.length; i++) if (T.cam[i]!.t <= T.cam[i - 1]!.t) T.cam[i]!.t = T.cam[i - 1]!.t + 1e-3;
  T.light.sort((a, b) => a.t - b.t);
  T.marks.sort((a, b) => a.t - b.t);
  T.cues.sort((a, b) => a.t - b.t);
  T.footsteps = footstepsFrom(T);
  T.moods = moodsFrom(T, replay);
  return T;
}

/** Seconds between footfalls and the least distance that counts as walking. */
const STEP_EVERY = 0.3;
const WALK_PIXELS = 30;

function footstepsFrom(T: Timeline): Timeline["footsteps"] {
  const out: Timeline["footsteps"] = [];
  for (const id of T.agents) {
    const keys = T.keys[id]!;
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1]!, b = keys[i]!;
      if (Math.hypot(b.v.x - a.v.x, b.v.y - a.v.y) <= WALK_PIXELS) continue;
      for (let t = a.t + STEP_EVERY; t < b.t - 0.05; t += STEP_EVERY) out.push({ t, actor: id });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/** What the whole room feels like at a pulse, read from everyone's recorded state. */
function roomMood(replay: DirectorReplay, pulse: number): Mood {
  const states = Object.values(replay.pulses[pulse]?.agentStates ?? {});
  if (states.length === 0) return "calm";
  const mean = (f: (s: Record<string, number>) => number): number => states.reduce((a, s) => a + f(s.socialEmotions), 0) / states.length;
  const tension = mean((e) => (e["resentment"] ?? 0) * 3 + (e["suspicion"] ?? 0) * 3 + (e["jealousy"] ?? 0) * 1.6 + (e["fearOfExclusion"] ?? 0) * 0.7);
  const warmth = mean((e) => (e["affection"] ?? 0) * 1.7 + (e["admiration"] ?? 0) * 1.6);
  if (tension > 0.4 && tension >= warmth) return "tension";
  if (warmth > 0.45) return "warmth";
  return "calm";
}

function moodsFrom(T: Timeline, replay: DirectorReplay): Timeline["moods"] {
  const out: Timeline["moods"] = [{ t: 0, mood: roomMood(replay, 0) }];
  let last = 0;
  for (let p = 1; p < replay.pulses.length; p++) {
    const t = T.pulseT[p];
    if (t === undefined) continue;
    const next = roomMood(replay, p);
    if (next !== out[out.length - 1]!.mood && canChangeMood(last, t)) { out.push({ t, mood: next }); last = t; }
  }
  return out;
}
