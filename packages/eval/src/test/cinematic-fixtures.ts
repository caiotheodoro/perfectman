/**
 * Synthetic runs for the cinematic score's tests: a run directory written from a short spec, in the shapes the real recorder writes
 * (events.jsonl, frames.jsonl, director-track.jsonl, replay.json). Every number a test asserts is worked out from the spec by hand.
 * Nothing here is a real run, and no line is a real grade.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const T0 = 1_800_000_000_000;

export type FxActor = { ref: string; name: string; avatar: number };
export type FxLine = { tS: number; ref: string; text: string; replyToIndex?: number; motive?: string };
export type FxAct = { tS: number; verb: string; actor: string; target?: string; outcome?: string; reactions?: number; owed?: number; missed?: number; contact?: boolean };
export type FxCmd = { tS: number; ref: string; cmd: Record<string, unknown> };
export type FxArrival = { tS: number; ref: string; x: number; y: number };
export type FxCue = { tMs: number; shot: string; ref?: string; pairRefs?: string[]; room?: number; easeMs?: number; holdMs?: number };
export type FxTrackLine = { tMs: number; ms: number; ref: string; room?: number };
export type FxMemory = { tS: number; intensity: number; tone: string };

export type FxSpec = {
  run?: number;
  durationS: number;
  cast?: FxActor[];
  lines?: FxLine[];
  acts?: FxAct[];
  cmds?: FxCmd[];
  arrivals?: FxArrival[];
  moveRooms?: Array<{ tS: number; ref: string }>;
  memories?: FxMemory[];
  cues?: FxCue[];
  trackLines?: FxTrackLine[];
  cuts?: Array<{ tMs: number; room?: number }>;
  drops?: Array<{ tMs: number; why: string }>;
  otherCues?: number;
  models?: string[];
  noTrack?: boolean;
  noFrames?: boolean;
};

export const CAST: FxActor[] = [
  { ref: "p1", name: "Ana", avatar: -101 },
  { ref: "p2", name: "Bruno", avatar: -102 },
  { ref: "p3", name: "Carla", avatar: -103 },
];

const jl = (rows: unknown[]): string => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

export function writeRun(spec: FxSpec, dir?: string): string {
  const out = dir ?? mkdtempSync(join(tmpdir(), "pm-cine-"));
  mkdirSync(out, { recursive: true });
  const cast = spec.cast ?? CAST;
  const avatar = (ref: string): number => cast.find((c) => c.ref === ref)?.avatar ?? -999;
  const ms = (tS: number): number => T0 + Math.round(tS * 1000);

  // ---- events.jsonl
  const events: unknown[] = [];
  const ids: string[] = [];
  (spec.lines ?? []).forEach((l, i) => {
    const id = `evt_${i}`;
    ids.push(id);
    const intent = `intent_${i}`;
    if (l.motive) events.push({ type: "private_motive_summary", actorId: l.ref, sourceIntentId: intent, createdAt: ms(l.tS), payload: { summary: l.motive } });
    events.push({
      id,
      type: l.replyToIndex !== undefined ? "reply_sent" : "message_sent",
      actorId: l.ref,
      sourceIntentId: intent,
      createdAt: ms(l.tS),
      visibility: { visibilityReason: "channel" },
      payload: { content: l.text, senderName: cast.find((c) => c.ref === l.ref)?.name ?? l.ref, mode: "say", ...(l.replyToIndex !== undefined ? { replyToEventId: ids[l.replyToIndex] } : {}) },
    });
  });
  for (const m of spec.memories ?? []) events.push({ type: "memory_written", actorId: "p1", createdAt: ms(m.tS), payload: { memoryType: "relationship", summary: "x", emotionalTone: m.tone, intensity: m.intensity, unresolved: true } });
  writeFileSync(join(out, "events.jsonl"), jl(events));

  // ---- frames.jsonl
  if (!spec.noFrames) {
    const frames: unknown[] = [{ conn: 1, dir: "out", ts_ms: T0, frame: { t: "run_start", run: spec.run ?? 1 } }];
    for (const c of cast) {
      frames.push({ conn: 1, dir: "in", ts_ms: T0 + 10, frame: { t: "actor_spawn", ref: c.ref, name: c.name, cid: 1 } });
      frames.push({ conn: 1, dir: "out", ts_ms: T0 + 11, frame: { t: "actor_spawned", ref: c.ref, actor: c.avatar, x: 0, y: 8 } });
    }
    (spec.acts ?? []).forEach((a, i) => {
      const id = `a${i}`;
      const start = ms(a.tS);
      const outcome = a.outcome ?? "landed";
      frames.push({ dir: "out", ts_ms: start, frame: { t: "act_started", act_id: id, actor: avatar(a.actor), verb: a.verb, ...(a.target ? { with: avatar(a.target) } : {}), at: start, origin: "director" } });
      const owed = a.owed ?? (a.target ? 1 : 0);
      if (a.contact !== false) {
        frames.push({ dir: "out", ts_ms: start + 5, frame: { t: "act_beat", act_id: id, at: start + 5, beat: "contact", owed: Array.from({ length: owed }, (_, k) => ({ who: avatar(a.target ?? a.actor) - k, role: "target", due_at: start + 1500 })), witnesses: [] } });
      }
      for (let k = 0; k < (a.reactions ?? owed); k++) frames.push({ dir: "out", ts_ms: start + 400 + k, frame: { t: "act_reaction", act_id: id, who: avatar(a.target ?? a.actor), role: "target", reaction: "cmd:face" } });
      frames.push({ dir: "out", ts_ms: start + 3000, frame: { t: "act_done", act_id: id, actor: avatar(a.actor), verb: a.verb, outcome, owed_missed: Array.from({ length: a.missed ?? 0 }, () => ({ who: 1, role: "target" })) } });
    });
    for (const c of spec.cmds ?? []) frames.push({ dir: "in", ts_ms: ms(c.tS), frame: { t: "actor_cmd", actor: avatar(c.ref), cmd: c.cmd } });
    for (const a of spec.arrivals ?? []) frames.push({ dir: "out", ts_ms: ms(a.tS), frame: { t: "arrived", actor: avatar(a.ref), x: a.x, y: a.y, plan: `${a.ref}:go` } });
    for (const m of spec.moveRooms ?? []) frames.push({ dir: "out", ts_ms: ms(m.tS), frame: { t: "moved_room", actor: avatar(m.ref), from: 1, to: 2 } });
    frames.push({ dir: "out", ts_ms: ms(spec.durationS), frame: { t: "run_end" } });
    writeFileSync(join(out, "frames.jsonl"), jl(frames));
  }

  // ---- director-track.jsonl
  if (!spec.noTrack) {
    const track: unknown[] = [{ t: 0, k: "start", run: spec.run ?? 1, room: 1, lang: "en" }];
    for (const c of spec.cues ?? []) {
      const target = c.pairRefs ? { pair: c.pairRefs.map(avatar) } : c.ref ? { avatar: avatar(c.ref) } : { room: true };
      track.push({ t: c.tMs, k: "cue", room: c.room ?? 1, ui: { k: "camera", shot: c.shot, target, zoom: 1, ease_ms: c.easeMs ?? 300, hold_ms: c.holdMs ?? 3000 } });
    }
    for (let i = 0; i < (spec.otherCues ?? 0); i++) track.push({ t: 100 + i, k: "cue", room: 1, ui: { k: "caption", text: "x", ms: 1000 } });
    for (const l of spec.trackLines ?? []) track.push({ t: l.tMs, k: "line", room: l.room ?? 1, avatar: avatar(l.ref), mode: "say", text: "x", ms: l.ms });
    for (const c of spec.cuts ?? []) track.push({ t: c.tMs, k: "cut", room: c.room ?? 2, from: 1 });
    for (const d of spec.drops ?? []) track.push({ t: d.tMs, k: "drop", why: d.why, item: "walk" });
    track.push({ t: Math.round(spec.durationS * 1000), k: "end", reason: "stopped" });
    writeFileSync(join(out, "director-track.jsonl"), jl(track));
  }

  const models = spec.models ?? ["actor-model/a1"];
  writeFileSync(
    join(out, "replay.json"),
    JSON.stringify({ run: spec.run ?? 1, startedAt: T0, endedAt: ms(spec.durationS), llm: { picked_model: models[0], links: Object.fromEntries(models.map((m, i) => [`l${i}`, { model: m, tier: "recommended" }])) } }, null, 2),
  );
  return out;
}

// ---- two canned scenes: one that is cinema, one that is not ---------------------------------------------------------------

const FACES = ["smile", "neutral", "angry", "sad", "surprised"];

/** A 4-minute scene with the shape the revamp wants: an accusation early, a build, a reversal, a slap at 3:00, an aftermath, varied acts, faces and camera. */
export function goodScene(): FxSpec {
  const lines: FxLine[] = [
    { tS: 4, ref: "p1", text: "You forged her signature on the will, Bruno, and I saw you do it." },
    { tS: 11, ref: "p2", text: "Prove it. Show the table what you think you saw, Ana?" },
    { tS: 20, ref: "p1", text: "The ink was still wet when you left the study, the pen is in your coat." },
    { tS: 31, ref: "p3", text: "Stop. Both of you. Papa is not even cold yet." },
    { tS: 42, ref: "p2", text: "Then tell Carla about the loan, Ana. Tell her who paid the notary." },
    { tS: 55, ref: "p1", text: "I will tell everyone, or else you give the house back tonight." },
    { tS: 70, ref: "p3", text: "A loan? You said the money came from the sale of the boat." },
    { tS: 84, ref: "p2", text: "The boat sold for nothing. I paid the notary. I accept the deal if she signs." },
    { tS: 100, ref: "p1", text: "I will never sign a thing you wrote, you liar, you cheated all of us." },
    { tS: 118, ref: "p3", text: "Then who forged it? Say it plainly, somebody say it plainly." },
    { tS: 140, ref: "p2", text: "It was you who held the pen, Carla, I saw you in the study." },
    { tS: 160, ref: "p3", text: "You lied to us, Bruno. You lied to us all night." },
    { tS: 178, ref: "p1", text: "Enough. Enough—" },
    { tS: 190, ref: "p2", text: "Is that why you came, to watch me fall?" },
    { tS: 215, ref: "p1", text: "I came because he asked me to. He said you would burn it all." },
    { tS: 230, ref: "p3", text: "Then it is over. We go to the notary in the morning." },
  ];
  const acts: FxAct[] = [
    { tS: 12, verb: "glare", actor: "p2", target: "p1" },
    { tS: 45, verb: "insult", actor: "p2", target: "p1" },
    { tS: 58, verb: "recoil", actor: "p1" },
    { tS: 75, verb: "glare", actor: "p1", target: "p2" },
    { tS: 96, verb: "insult", actor: "p1", target: "p2" },
    { tS: 110, verb: "freeze_gasp", actor: "p3" },
    { tS: 150, verb: "shove", actor: "p2", target: "p1" },
    { tS: 165, verb: "insult", actor: "p3", target: "p2" },
    { tS: 180, verb: "slap", actor: "p1", target: "p2" },
    { tS: 186, verb: "recoil", actor: "p2" },
    { tS: 200, verb: "cry", actor: "p2" },
  ];
  const cmds: FxCmd[] = [];
  FACES.forEach((f, i) => cmds.push({ tS: 5 + i * 40, ref: "p1", cmd: { k: "expression", face: f } }));
  ["wave", "laugh", "sign"].forEach((a, i) => cmds.push({ tS: 15 + i * 50, ref: "p2", cmd: { k: "action", action: a } }));
  for (const [i, r] of ["p1", "p2", "p3"].entries()) cmds.push({ tS: 1 + i, ref: r, cmd: { k: "walk", plan: `${r}:enter`, x: 5, y: 5 } });
  for (let i = 0; i < 9; i++) cmds.push({ tS: 20 + i * 20, ref: ["p1", "p2", "p3"][i % 3]!, cmd: { k: "walk", plan: `p:${i}`, x: 3, y: 3 } });
  const arrivals: FxArrival[] = [
    { tS: 4, ref: "p1", x: 5, y: 5 },
    { tS: 5, ref: "p2", x: 6, y: 5 },
    { tS: 6, ref: "p3", x: 9, y: 9 },
    { tS: 60, ref: "p1", x: 3, y: 3 },
    { tS: 80, ref: "p2", x: 10, y: 3 },
    { tS: 120, ref: "p3", x: 4, y: 3 },
    { tS: 160, ref: "p2", x: 4, y: 4 },
    { tS: 200, ref: "p1", x: 8, y: 8 },
  ];
  const cues: FxCue[] = [];
  const shots = ["establishing", "tracking", "close_up", "two_shot", "reaction", "close_up", "two_shot", "reaction", "tracking", "close_up"];
  shots.forEach((s, i) => cues.push({ tMs: 2000 + i * 22000, shot: s, ref: ["p1", "p2", "p3"][i % 3]!, ...(s === "two_shot" ? { pairRefs: ["p1", "p2"] } : {}) }));
  const trackLines: FxTrackLine[] = lines.map((l) => ({ tMs: l.tS * 1000, ms: 4500, ref: l.ref }));
  // each speaking turn the camera is already on them: put a close_up on every speaker 1 s before their line
  const onSpeaker: FxCue[] = lines.map((l) => ({ tMs: l.tS * 1000 - 1000, shot: "close_up", ref: l.ref, easeMs: 300 }));
  return {
    run: 100,
    durationS: 250,
    lines,
    acts,
    cmds,
    arrivals,
    moveRooms: [{ tS: 215, ref: "p2" }],
    memories: [
      { tS: 10, intensity: 0.3, tone: "curious" },
      { tS: 30, intensity: 0.3, tone: "curious" },
      { tS: 200, intensity: 0.8, tone: "bitter" },
      { tS: 220, intensity: 0.9, tone: "grief" },
    ],
    cues: [...cues, ...onSpeaker],
    trackLines,
    otherCues: 10,
    drops: [{ tMs: 50_000, why: "stale" }],
  };
}

/** The opposite: eight lines of small talk, one glare at 4:40, one shot, nobody leaves, the camera loses a third of its cues. */
export function flatScene(): FxSpec {
  const lines: FxLine[] = Array.from({ length: 8 }, (_, i) => ({ tS: 20 + i * 45, ref: ["p1", "p2"][i % 2]!, text: "Nice weather today, is it not, the garden looks very nice indeed today." }));
  return {
    run: 101,
    durationS: 450,
    lines,
    acts: [{ tS: 280, verb: "glare", actor: "p1", target: "p2" }],
    cmds: [{ tS: 2, ref: "p1", cmd: { k: "expression", face: "neutral" } }],
    arrivals: [{ tS: 3, ref: "p1", x: 5, y: 5 }],
    cues: [
      { tMs: 3000, shot: "two_shot", pairRefs: ["p1", "p2"] },
      { tMs: 60_000, shot: "two_shot", pairRefs: ["p1", "p2"] },
      { tMs: 150_000, shot: "two_shot", pairRefs: ["p1", "p2"] },
    ],
    trackLines: lines.map((l) => ({ tMs: l.tS * 1000, ms: 4000, ref: l.ref })),
    otherCues: 3,
    drops: Array.from({ length: 2 }, (_, i) => ({ tMs: 70_000 + i, why: "stale" })),
  };
}
