#!/usr/bin/env node
// Build the 12 human-grading clip packages from recorded Perfectman run dirs.
//
//   node scripts/grading/build-clips.mjs --runs <dir containing 55/ 56/ ...> [--out docs/eval/cinematic-grading]
//
// Each run dir needs events/frames/director-track/replay. Output:
//   clips.json   what the grading page embeds (blind: no automated scores, no run ids on screen)
//   meta.json    selection rationale + automated numbers for the calibration join (never shown to the grader)
//
// Privacy: only the bot actors spawned by the run (actor_spawned refs) are kept. Any other
// avatar that happened to share the room (run 62 had one in room 42) is dropped, as is the
// admin account that started the run.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
if (!args.runs) { console.error("usage: build-clips.mjs --runs <dir> [--out <dir>]"); process.exit(2); }
const RUNS = resolve(args.runs);
const OUT = resolve(args.out ?? "docs/eval/cinematic-grading");

// Presentation order is fixed and shuffled so run number and build order do not hint at quality.
// window = [startSec, endSec] of run time, null = whole run.
export const SPEC = [
  { id: "c01", run: 61, window: null, why: "Sobremesa, spine-fix build. Highest script-likeness of the baseline (96) but zero physical acts in 7:47: the 'good text, no body' anchor." },
  { id: "c02", run: 55, window: null, why: "Earliest and shortest run (1:35), crude scenario, 3 actors, 5 replies, no acts. Floor anchor." },
  { id: "c03", run: 62, window: [300, 600], why: "Sobremesa 45-minute soak, minutes 5-10. Holds the only shove of the baseline (6:30) plus glares, an insult and gasps: the best physical-escalation window available." },
  { id: "c04", run: 58, window: null, why: "Quarto 1214 with the first director acts (glare, insult). Short (2:18). Pair with c09 and c12." },
  { id: "c05", run: 63, window: null, why: "Sobremesa (Terraco), the run the plan calls out: 1 act (a glare) in 7:28, no unlock, no arc. Same scenario sha as run 62." },
  { id: "c06", run: 62, window: [0, 300], why: "Sobremesa soak opening, minutes 0-5. Same scene as c05 and c03; first glare at 0:56, insult at 3:10." },
  { id: "c07", run: 56, window: null, why: "Buceta Suja, second take, 3:25. Pair with c02: same scene one build later." },
  { id: "c08", run: 62, window: [2400, 2725], why: "Sobremesa soak tail, minutes 40-45. Late-run collapse after 40 minutes of repetition (novelty 0): the 'it never ends' anchor." },
  { id: "c09", run: 57, window: null, why: "Quarto 1214 before the director acts existed: dialogue and expressions only. Pair with c04 and c12." },
  { id: "c10", run: 62, window: [1140, 1440], why: "Sobremesa soak, minutes 19-24. Second flare-up after the 'meanwhile' cut-away: slap unlock, insults, gasps, glares in 90 seconds." },
  { id: "c11", run: 60, window: null, why: "Sobremesa (Terraco), 20 walks, 25 expressions, zero acts. Scripted 4-step spine, no unlock. Same scene family as c01." },
  { id: "c12", run: 59, window: null, why: "Quarto 1214 with glare, insult, two gasps and a recoil in 5:37. Most acts per scene outside the soak, and 6 grievances raised." },
];

const read = (run, f) => { const p = join(RUNS, String(run), f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const jl = (run, f) => (read(run, f) ?? "").split("\n").filter(Boolean).map(l => JSON.parse(l));

function build(spec, order) {
  const { run } = spec;
  const replay = JSON.parse(read(run, "replay.json"));
  const s0 = replay.startedAt;
  const frames = jl(run, "frames.jsonl");
  const track = jl(run, "director-track.jsonl");
  const body = JSON.parse(read(run, "body-frames.json"));
  const mainRoom = replay.home;

  // avatar id <-> ref, from the spawn handshake; this is the only set of avatars we ever keep.
  const refOf = new Map(); const names = new Map(); const figures = new Map();
  for (const { frame: F } of frames) {
    if (F.t === "actor_spawn") { names.set(F.ref, F.name); figures.set(F.ref, F.figure); }
    if (F.t === "actor_spawned") refOf.set(F.actor, F.ref);
  }
  const refs = [...names.keys()].sort();
  const idx = new Map(refs.map((r, i) => [r, i]));
  const t = ms => ms - s0;
  const winStart = spec.window ? spec.window[0] * 1000 : 0;
  const winEnd = spec.window ? spec.window[1] * 1000 : replay.endedAt - s0;
  const inWin = ms => ms >= winStart && ms <= winEnd;

  const ev = [];
  // dialogue as the viewer saw it (director-track `line`), plus on-screen cards and camera.
  for (const d of track) {
    const u = d.ui;
    if (d.k === "line") ev.push({ t: d.t, k: "line", who: idx.get(d.ref), text: d.text, mode: d.mode, ms: d.ms });
    else if (d.k === "drop") ev.push({ t: d.t, k: "drop", item: d.item, why: d.why });
    else if (d.k === "cut") ev.push({ t: d.t, k: "cut", room: d.room });
    else if (d.k === "cue" && u) {
      if (u.k === "camera") {
        const tg = u.target ?? {};
        const target = tg.room ? "room" : tg.pair ? tg.pair.map(a => idx.get(refOf.get(a))) : tg.avatar != null ? [idx.get(refOf.get(tg.avatar))] : "?";
        ev.push({ t: d.t, k: "cam", shot: u.shot, target, zoom: u.zoom, hold: u.hold_ms });
      } else if (u.k === "card") ev.push({ t: d.t, k: "card", text: u.title, sub: u.subtitle });
      else if (u.k === "caption") ev.push({ t: d.t, k: "caption", text: u.text });
      else if (u.k === "sfx" && !u.stop) ev.push({ t: d.t, k: "sfx", cue: u.cue });
      else if (u.k === "cue") ev.push({ t: d.t, k: "emo", who: idx.get(refOf.get(u.id)), emotion: u.emotion });
      else if (u.k === "cut_fx") ev.push({ t: d.t, k: "cutfx", label: u.label });
    }
  }
  // body commands, acts, positions
  const poss = [];
  const actById = new Map();
  for (const { frame: F, ts_ms } of frames) {
    if (F.t === "actor_cmd") {
      const c = F.cmd; const who = idx.get(refOf.get(F.actor));
      if (who == null) continue;
      if (c.k === "expression") ev.push({ t: t(ts_ms), k: "expr", who, face: c.face });
      else if (c.k === "action") ev.push({ t: t(ts_ms), k: "gest", who, name: c.action, style: c.style });
      else if (c.k === "walk") ev.push({ t: t(ts_ms), k: "walk", who, x: c.x, y: c.y });
      else if (c.k === "sit") ev.push({ t: t(ts_ms), k: "sit", who });
      else if (c.k === "move_room") ev.push({ t: t(ts_ms), k: "room", who, room: c.room });
    } else if (F.t === "act_started") {
      const e = { t: t(F.at), k: "act", verb: F.verb, who: idx.get(refOf.get(F.actor)), to: F.with != null ? idx.get(refOf.get(F.with)) : null, power: F.intensity, origin: F.origin };
      actById.set(F.act_id, e); ev.push(e);
    } else if (F.t === "act_done") {
      const e = actById.get(F.act_id); if (e) e.outcome = F.outcome;
    } else if (F.t === "delta" && F.msg.t === "moves") {
      for (const m of F.msg.moves) {
        const who = idx.get(refOf.get(m.id));
        if (who != null) poss.push([t(ts_ms), who, m.x, m.y, m.state, m.dir, Number(F.room)]);
      }
    }
  }
  for (const s of body.snapshots ?? []) for (const o of s.occupants) {
    const who = idx.get(o.ref);
    if (who != null) poss.push([t(s.atMs), who, o.tile[0], o.tile[1], o.state, o.dir, Number(s.room)]);
  }
  poss.sort((a, b) => a[0] - b[0]);

  // clip to window, carry the last known position of each actor in at the window start
  const events = ev.filter(e => e.t >= winStart && e.t <= winEnd).sort((a, b) => a.t - b.t);
  const carry = new Map(); const pos = [];
  let last = new Map();
  for (const p of poss) {
    const key = p[1];
    const prev = last.get(key);
    if (prev && prev[2] === p[2] && prev[3] === p[3] && prev[4] === p[4] && prev[5] === p[5] && prev[6] === p[6]) continue;
    last.set(key, p);
    if (p[0] < winStart) carry.set(key, p); else if (p[0] <= winEnd) pos.push(p);
  }
  const startPos = [...carry.values()].map(p => [winStart, ...p.slice(1)]);
  const allPos = [...startPos, ...pos];
  const room46 = allPos.filter(p => p[6] === mainRoom);
  const xs = room46.map(p => p[2]); const ys = room46.map(p => p[3]);
  const title = (track.find(d => d.ui?.k === "card")?.ui.title ?? "").replace(/^[A-Z0-9]{8,}:\s*/, "");
  const scenarioRoomStart = mainRoom;

  const clip = {
    id: spec.id, order, scenario: title, lang: "pt-BR",
    start_ms: winStart, end_ms: winEnd, partial: !!spec.window,
    actors: refs.map(r => ({ ref: r, name: names.get(r) })),
    main_room: scenarioRoomStart,
    bounds: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
    events, pos: allPos,
  };
  const sl = replay.script_likeness;
  const meta = {
    id: spec.id, run, window_s: spec.window, why: spec.why, scenario: title, scenario_sha: replay.scenarioSha256.slice(0, 12),
    run_duration_s: Math.round((replay.endedAt - s0) / 1000),
    lines_in_clip: events.filter(e => e.k === "line").length,
    acts_in_clip: events.filter(e => e.k === "act").length,
    script_likeness: sl?.score ?? null,
    spine_step: replay.scene_spine?.step ?? null,
  };
  return { clip, meta };
}

mkdirSync(OUT, { recursive: true });
const built = SPEC.map((s, i) => build(s, i + 1));
writeFileSync(join(OUT, "clips.json"), JSON.stringify({ version: 1, clips: built.map(b => b.clip) }));
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ version: 1, note: "Not shown to the grader. Join key for calibration: id -> run (+window).", clips: built.map(b => b.meta) }, null, 2) + "\n");
for (const b of built) console.log(b.clip.id, "run", b.meta.run, b.meta.window_s ?? "full", b.clip.scenario, "lines", b.meta.lines_in_clip, "acts", b.meta.acts_in_clip, "events", b.clip.events.length, "pos", b.clip.pos.length);
