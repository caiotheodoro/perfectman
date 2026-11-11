#!/usr/bin/env node
/**
 * run-metrics: a second, independent reading of a run's dialogue. Plain Node, no import from this repo's packages, so it can be run on a transcript
 * export anywhere and checks the benchmark (`packages/shared/src/script-likeness`) against code that shares none of it.
 *
 *   node scripts/run-metrics.mjs <transcript.jsonl | events.jsonl | run dir> [--actors "A,B,C"] [--json] [--no-cinematic]
 *
 * Input, one of:
 *  - a transcript export: one JSON per line, `{t: seconds since the run's start, name, kind, text}` (`kind` other than "say" is skipped, "act" is counted as an act);
 *  - a hotel run's `events.jsonl` (or the run directory holding it): `message_sent` / `reply_sent` are turns, `no_op_recorded` and the body events are counted.
 * `--actors` keeps only those speakers (case-insensitive): a transcript can hold the players' lines, which are not the actors'.
 *
 * What it prints (all over the turns kept):
 *  - words per turn over all turns (as the plays' figures are: median 7, p75 15, 12.6% over 25 words in Portuguese): median, p75, p90, share over 25 and over 40 words
 *    (a word is a run of letters or digits; stage directions in * *, ( ), [ ] and laughter do not count), and the same without the fillers;
 *  - fillers: a turn of at most 3 words that are all interjections (ué, hm, hmm, ah, tá, sei, é, né, uh, oh, ok ...), laughter alone included, and their share;
 *  - novelty against the 6 turns before: the share of a turn's words of 4 or more letters that none of them used; the mean over turns with such words, and
 *    over the turns with 7 or more of them ("judged": short lines share topic words with their neighbours). Fillers are left out of the turns and of the look-back;
 *  - demand loops: an actor's turns that carry a demand cue (a demand phrase, an imperative opening a sentence), clustered by Jaccard overlap of their
 *    4+ letter non-stop words (0.4 or more) or by one shared cue and one shared word of 5 letters or more; a loop is 3 or more turns of one cluster inside 90 s;
 *  - tics: per actor, the 5 words (4+ letters, not stop words or names) in the most of their turns, and the ones in 5 or more turns inside 24 room turns;
 *  - from events.jsonl: acts (a committed pair or act body action) with the first act's time, body moves (walks, sits, gestures, room changes), and the
 *    no-op : message ratio;
 *  - cinematic (a run directory with frames.jsonl and/or director-track.jsonl; `--no-cinematic` skips it): the acts of the wire log (frames.jsonl, not
 *    events.jsonl) per minute, their verbs, the first physical act and whether it came by 4:00, owed reactions delivered, the camera's shot kinds, cut rate,
 *    shot-on-speaker and dropped-cue rate. A second reader of what `packages/eval/src/cinematic` scores: it shares no code with it, and a test holds the two to the same figures.
 *
 * Deterministic. Exit 0 on success, 2 on bad usage.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- text ------------------------------------------------------------------------------------------------------------------

const DIRECTIONS = [/\*[^*\n]{1,80}\*/g, /\([^()\n]{1,200}\)/g, /\[[^\]\n]{1,300}\]/g, /<[^<>\n]{1,80}>/g];
const LAUGH = /^(?:k{2,}|(?:ha){2,}h?|(?:he){2,}h?|(?:hi){2,}h?|(?:rs)+|(?:ah){2,}h?|(?:ja){3,}|lol|lmao)$/;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const stripDirections = (text) => DIRECTIONS.reduce((t, re) => t.replace(re, " "), text);
const fold = (w) => w.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/['’]/gu, "").replace(/(\p{L})\1{2,}/gu, "$1");
const letters = (w) => w.replace(/[^\p{L}]/gu, "").length;

/** Words of a line: `{raw, key, start}`; directions and laughter dropped, `start` when the word opens a sentence. */
export function wordsOf(text) {
  const t = stripDirections(text);
  const out = [];
  for (const m of t.matchAll(WORD)) {
    const plain = m[0].toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/['’]/gu, "");
    if (plain === "" || LAUGH.test(plain)) continue;
    const before = t.slice(0, m.index).trimEnd();
    out.push({ raw: m[0], key: fold(m[0]), start: before === "" || /[.!?…:;—–"“(¿¡-]$/u.test(before) });
  }
  return out;
}

const STOP = new Set(
  ("a o as os um uma uns umas de do da dos das em no na nos nas ao aos que e eu tu voce voces vc ele ela eles elas me te se lhe nos meu minha meus minhas seu sua seus suas " +
    "teu tua pra para por com sem mas ou ja nao sim ne ta to tem ter foi ser sao vai vou vamos esta estou isso isto esse essa este aquele aquela la ai aqui ali so mim ti si comigo contigo " +
    "tambem mais muito bem assim entao como quando onde quem qual quanto sobre ate depois antes ainda ha era eram sera seja fui tinha tinham pode posso quer quero faz fazer " +
    "the to of in on at and or is it you your my i we he she they this that for with be do not are was have has had will would can could what who how when where why his her him them its our their " +
    "there here but if so no yes am were been being than then just very too also from by about into over such shall must may might one").split(" "),
);
const INTERJECTIONS = new Set("ue hm hmm hmmm mm mmm ah ahn ta sei e ne eh hum aham uhum uh oh ok okay huh right".split(" "));
const FORMS_OF_ADDRESS = new Set("senhor senhora dona doutor madam miss lord lady".split(" "));
const NUMBER_WORDS = new Set("dois duas tres quatro cinco seis sete oito nove dez onze doze vinte trinta quarenta cinquenta cem cento mil two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand".split(" "));
const isNumber = (k) => /\d/.test(k) || NUMBER_WORDS.has(k);

const DEMAND_PHRASES = [
  "cofre hoje", "abre", "abra", "abrir", "quero", "me da", "me de", "agora", "senao", "ou eu", "ou entao", "paga", "pague", "pagar", "diz", "diga", "fala", "fale", "entrega", "entregue", "devolve",
  "devolva", "responde", "responda", "me conta", "me diga", "me fala", "cala", "chega aqui", "exijo",
  "give me", "i want", "tell me", "right now", "or else", "or i", "open the", "pay me", "hand over", "answer me", "say it", "i demand", "you will", "now",
];
const IMPERATIVES = new Set(
  ("abre abra fala fale diz diga paga pague entrega entregue deixa vem vai olha escuta sai volta tira pega solta mostra responde conta cala chega baixa levanta senta " +
    "give open tell say pay hand answer stop come go look listen show bring take leave get let speak stay wait do dont").split(" "),
);

const MOTIF_WINDOW_MS = 90_000;
const DEMAND_WINDOW_TURNS = 7;
const TIC_MIN_TURNS = 5;
const TIC_WINDOW_TURNS = 24;
const NOVELTY_LOOKBACK = 6;
const NOVELTY_MIN_WORDS = 7;

/** At most 3 words, every one an interjection; laughter alone counts, an empty line or a bare direction does not. */
export function isFiller(text) {
  const plain = stripDirections(text).trim();
  if (plain === "" || !/\p{L}/u.test(plain)) return false;
  const words = wordsOf(plain);
  return words.length === 0 || (words.length <= 3 && words.every((w) => INTERJECTIONS.has(w.key)));
}

// ---- statistics --------------------------------------------------------------------------------------------------------------

/** Nearest-rank quantile (q in 0..1). */
export function quantile(values, q) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}
const mean = (v) => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return both / (a.size + b.size - both);
};

const properNoun = (w) => !w.start && /^\p{Lu}\p{Ll}/u.test(w.raw);

/**
 * All the metrics of a list of turns `{speaker, text, t?}` (t in seconds), in order. `events` is the optional `{acts, firstActAt, moves, noOps, messages}` of an events.jsonl.
 */
export function computeMetrics(turns, { actors, events } = {}) {
  const names = new Set();
  for (const who of actors ?? [...new Set(turns.map((t) => t.speaker))]) for (const piece of who.split(/[\s.]+/u)) if (letters(fold(piece)) >= 3) names.add(fold(piece));
  const rows = turns.map((t) => ({ ...t, words: wordsOf(t.text) }));
  const fillers = rows.filter((r) => isFiller(r.text));
  const content = rows.filter((r) => !isFiller(r.text));
  const stats = (list) => {
    const counts = list.map((r) => r.words.length);
    const over = (cap) => (counts.length === 0 ? 0 : counts.filter((c) => c > cap).length / counts.length);
    return { median: quantile(counts, 0.5), p75: quantile(counts, 0.75), p90: quantile(counts, 0.9), mean: round(mean(counts), 1), over25: round(over(25)), over40: round(over(40)) };
  };

  const fillerForms = {};
  for (const r of fillers) fillerForms[r.text.trim()] = (fillerForms[r.text.trim()] ?? 0) + 1;

  // novelty against the previous 6 content turns
  const sets = content.map((r) => new Set(r.words.filter((w) => letters(w.key) >= 4).map((w) => w.key)));
  const noveltyAll = [];
  const noveltyJudged = [];
  content.forEach((_, i) => {
    if (i === 0 || sets[i].size === 0) return;
    const seen = new Set();
    for (const s of sets.slice(Math.max(0, i - NOVELTY_LOOKBACK), i)) for (const k of s) seen.add(k);
    const v = [...sets[i]].filter((k) => !seen.has(k)).length / sets[i].size;
    noveltyAll.push(v);
    if (sets[i].size >= NOVELTY_MIN_WORDS) noveltyJudged.push(v);
  });

  const topic = (r) => new Set(r.words.filter((w) => letters(w.key) >= 4 && !STOP.has(w.key) && !names.has(w.key) && !isNumber(w.key) && !properNoun(w)).map((w) => w.key));

  // demand loops
  const timed = content.every((r) => typeof r.t === "number");
  const demandLoops = [];
  const bySpeaker = new Map();
  content.forEach((r, index) => {
    const joined = ` ${r.words.map((w) => w.key).join(" ")} `;
    const cues = new Set(DEMAND_PHRASES.filter((p) => joined.includes(` ${p} `)));
    const imperative = r.words.some((w) => w.start && IMPERATIVES.has(w.key));
    if (cues.size === 0 && !imperative) return;
    const who = r.speaker.toLowerCase();
    bySpeaker.set(who, [...(bySpeaker.get(who) ?? []), { index, t: r.t, topic: topic(r), cues }]);
  });
  for (const [speaker, list] of bySpeaker) {
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const same = (a, b) => jaccard(a.topic, b.topic) >= 0.4 || ([...a.cues].some((c) => b.cues.has(c)) && [...a.topic].some((k) => letters(k) >= 5 && b.topic.has(k)));
    for (let j = 1; j < list.length; j++) for (let i = 0; i < j; i++) if (same(list[i], list[j])) parent[find(j)] = find(i);
    const clusters = new Map();
    list.forEach((m, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), m]));
    for (const members of clusters.values()) {
      if (members.length < 3) continue;
      const hit = new Set();
      for (let j = 0; j + 3 <= members.length; j++) {
        const [a, b] = [members[j], members[j + 2]];
        if (timed ? (b.t - a.t) * 1000 <= MOTIF_WINDOW_MS : b.index - a.index < DEMAND_WINDOW_TURNS) for (let k = j; k < j + 3; k++) hit.add(members[k]);
      }
      if (hit.size === 0) continue;
      const mem = [...hit];
      demandLoops.push({
        speaker,
        turns: mem.length,
        from: mem[0].t,
        to: mem[mem.length - 1].t,
        shared: [...mem[0].topic].filter((k) => mem.every((m) => m.topic.has(k))),
      });
    }
  }

  // tics: words per actor
  const perActor = new Map();
  const lowered = new Set();
  for (const r of content) for (const w of r.words) if (!/^\p{Lu}/u.test(w.raw)) lowered.add(w.key);
  content.forEach((r, index) => {
    const who = r.speaker;
    const entry = perActor.get(who) ?? { turns: 0, words: new Map() };
    entry.turns++;
    for (const k of topic(r)) {
      if (FORMS_OF_ADDRESS.has(k) || !lowered.has(k)) continue;
      const at = entry.words.get(k) ?? [];
      at.push(index);
      entry.words.set(k, at);
    }
    perActor.set(who, entry);
  });
  const tics = [];
  const topWords = {};
  for (const [who, entry] of perActor) {
    const ranked = [...entry.words].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    topWords[who] = ranked.slice(0, 5).map(([word, at]) => ({ word, turns: at.length, share: round(at.length / entry.turns, 2) }));
    for (const [word, at] of ranked) {
      for (let j = 0; j + TIC_MIN_TURNS <= at.length; j++) {
        if (at[j + TIC_MIN_TURNS - 1] - at[j] < TIC_WINDOW_TURNS) {
          tics.push({ speaker: who, word, turns: at.length });
          break;
        }
      }
    }
  }

  return {
    turns: rows.length,
    contentTurns: content.length,
    speakers: [...new Set(rows.map((r) => r.speaker))],
    words: stats(rows),
    wordsContent: stats(content),
    fillers: { count: fillers.length, share: round(rows.length === 0 ? 0 : fillers.length / rows.length), forms: fillerForms },
    novelty: { mean: round(mean(noveltyAll)), judgedTurns: noveltyJudged.length, judgedMean: round(mean(noveltyJudged)), judgedP10: round(quantile(noveltyJudged, 0.1)) },
    demandLoops,
    tics,
    topWords,
    ...(events
      ? {
          events: {
            acts: events.acts,
            firstActAt: events.firstActAt ?? null,
            bodyMoves: events.moves,
            noOps: events.noOps,
            messages: events.messages,
            noOpPerMessage: round(events.messages === 0 ? 0 : events.noOps / events.messages, 2),
          },
        }
      : {}),
  };
}

// ---- input -------------------------------------------------------------------------------------------------------------------

function readJsonLines(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        const v = JSON.parse(l);
        return v !== null && typeof v === "object" ? [v] : [];
      } catch {
        return [];
      }
    });
}

const BODY_MOVES = new Set(["body_arrived", "moved_room", "agent_left"]);

/** Turns (and events counts when the file is an events.jsonl) of a transcript export, an events.jsonl or a run directory. */
export function loadInput(input, actors) {
  if (!existsSync(input)) throw new Error(`no such file or directory: ${input}`);
  const file = statSync(input).isDirectory() ? path.join(input, "events.jsonl") : input;
  if (!existsSync(file)) throw new Error(`no events.jsonl in ${input}`);
  const rows = readJsonLines(file);
  const keep = actors ? new Set(actors.map((a) => a.trim().toLowerCase())) : undefined;
  if (rows.length > 0 && rows.every((r) => typeof r.text === "string" && typeof r.name === "string")) {
    const turns = [];
    let acts = 0;
    let firstActAt;
    for (const r of rows) {
      if (keep && !keep.has(r.name.trim().toLowerCase())) continue;
      if (r.kind === "act") {
        acts++;
        firstActAt ??= r.t;
        continue;
      }
      if ((r.kind !== undefined && r.kind !== "say") || r.text.trim() === "") continue;
      turns.push({ speaker: r.name, text: r.text, ...(typeof r.t === "number" ? { t: r.t } : {}) });
    }
    turns.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    return { turns, source: `transcript ${input}`, events: acts > 0 ? { acts, firstActAt, moves: 0, noOps: 0, messages: turns.length } : undefined };
  }
  const t0 = rows.map((r) => r.createdAt).filter((v) => typeof v === "number").sort((a, b) => a - b)[0] ?? 0;
  const turns = [];
  const ev = { acts: 0, firstActAt: undefined, moves: 0, noOps: 0, messages: 0 };
  for (const e of rows) {
    const at = typeof e.createdAt === "number" ? (e.createdAt - t0) / 1000 : undefined;
    const p = e.payload ?? {};
    if (e.type === "message_sent" || e.type === "reply_sent") {
      if (e.actorId === "host" || e.visibility?.visibilityReason === "admin_whisper" || typeof p.content !== "string" || p.content.trim() === "") continue;
      const speaker = typeof p.senderName === "string" && p.senderName !== "" ? p.senderName : e.actorId;
      if (keep && !keep.has(String(speaker).trim().toLowerCase())) continue;
      ev.messages++;
      turns.push({ speaker, text: p.content, ...(at !== undefined ? { t: at } : {}) });
    } else if (e.type === "no_op_recorded") {
      if (!keep || keep.has(String(e.actorId).trim().toLowerCase())) ev.noOps++;
    } else if (e.type === "body_action_committed") {
      const commands = Array.isArray(p.commands) ? p.commands : [];
      if (commands.includes("pair") || commands.includes("act")) {
        ev.acts++;
        if (ev.firstActAt === undefined && at !== undefined) ev.firstActAt = at;
      } else ev.moves++;
    } else if (BODY_MOVES.has(e.type)) ev.moves++;
  }
  return { turns, source: `events ${file}`, events: ev };
}

// ---- output ------------------------------------------------------------------------------------------------------------------

// ---- cinematic: acts from the wire log, camera from the director track ----------------------------------------------------------------------------

const PHYSICAL = new Set(["shove", "slap", "punch", "kill", "die", "faint", "restrain", "hug", "kiss"]);
const ACT_WEIGHT = { glare: 1, insult: 2, shove: 3, slap: 4, punch: 5, kill: 6, die: 6, faint: 4, restrain: 3, hug: 2, kiss: 2, cry: 2, storm_off: 3, tableau: 2, turn_back: 1, tend_fallen: 2, recoil: 0.5, freeze_gasp: 0.5 };
const NOT_PLAYED = new Set(["aborted", "declined", "timeout"]);
const CLIMAX_DEADLINE_S = 240;

/** Cinematic figures of a run directory, or undefined when it has neither frames.jsonl nor director-track.jsonl. */
export function computeCinematic(dir) {
  const framesFile = path.join(dir, "frames.jsonl");
  const trackFile = path.join(dir, "director-track.jsonl");
  const hasFrames = existsSync(framesFile);
  const hasTrack = existsSync(trackFile);
  if (!hasFrames && !hasTrack) return undefined;
  const out = {};

  let t0;
  let durationS = 0;
  if (hasFrames) {
    const rows = readJsonLines(framesFile);
    const stamps = rows.map((r) => r.ts_ms).filter((v) => typeof v === "number");
    let started;
    const replayFile = path.join(dir, "replay.json");
    if (existsSync(replayFile)) {
      try {
        started = JSON.parse(readFileSync(replayFile, "utf8")).startedAt;
      } catch {
        started = undefined;
      }
    }
    t0 = typeof started === "number" ? started : rows.find((r) => r.frame?.t === "run_start")?.ts_ms ?? Math.min(...stamps);
    durationS = stamps.length === 0 ? 0 : (Math.max(...stamps) - t0) / 1000;

    const acts = new Map();
    for (const r of rows) {
      const f = r.frame;
      if (!f || typeof f.act_id !== "string") continue;
      const a = acts.get(f.act_id) ?? { reactions: 0, owed: 0, missed: 0 };
      if (f.t === "act_started") Object.assign(a, { verb: f.verb, at: ((typeof f.at === "number" ? f.at : r.ts_ms) - t0) / 1000 });
      else if (f.t === "act_beat") a.owed = Array.isArray(f.owed) ? f.owed.length : 0;
      else if (f.t === "act_reaction") a.reactions++;
      else if (f.t === "act_done") Object.assign(a, { outcome: f.outcome, missed: Array.isArray(f.owed_missed) ? f.owed_missed.length : 0 });
      acts.set(f.act_id, a);
    }
    const played = [...acts.values()].filter((a) => a.verb !== undefined && !NOT_PLAYED.has(a.outcome)).sort((x, y) => x.at - y.at);
    const verbs = {};
    for (const a of played) verbs[a.verb] = (verbs[a.verb] ?? 0) + 1;
    const physical = played.filter((a) => PHYSICAL.has(a.verb));
    const top = Math.max(0, ...physical.map((a) => ACT_WEIGHT[a.verb] ?? 1));
    const climax = physical.find((a) => (ACT_WEIGHT[a.verb] ?? 1) >= 0.8 * top);
    const owed = played.reduce((n, a) => n + a.owed, 0);
    const missed = played.reduce((n, a) => n + a.missed, 0);
    out.acts = {
      played: played.length,
      perMin: round(played.length / Math.max(1 / 6, durationS / 60), 2),
      firstAt: played.length === 0 ? null : round(played[0].at, 1),
      verbs,
      owedReactions: owed,
      owedMissed: missed,
      climax: climax ? { verb: climax.verb, at: round(climax.at, 1), byDeadline: climax.at <= CLIMAX_DEADLINE_S } : null,
    };
    out.durationS = round(durationS, 1);
  }

  if (hasTrack) {
    const track = readJsonLines(trackFile).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const cues = track.filter((e) => e.k === "cue");
    const cams = cues.filter((e) => e.ui?.k === "camera");
    const lostDrops = track.filter((e) => e.k === "drop" && (e.why === "stale" || e.why === "unstageable")).length;
    const trackEnd = track.reduce((m, e) => Math.max(m, e.t ?? 0), 0);
    const minutes = Math.max(1 / 6, trackEnd / 60000);
    const kinds = {};
    for (const c of cams) kinds[c.ui.shot] = (kinds[c.ui.shot] ?? 0) + 1;
    // shot on the speaker: the line's avatar (or a pair holding it) framed by a camera cue that finished easing, same room, no cut since
    let active;
    let lines = 0;
    let onSpeaker = 0;
    for (const e of track) {
      if (e.k === "cut") active = undefined;
      else if (e.k === "cue" && e.ui?.k === "camera") active = e;
      else if (e.k === "line") {
        lines++;
        if (!active || e.avatar == null) continue;
        const ui = active.ui;
        if (ui.shot === "establishing" || ui.shot === "insert" || ui.shot === "transition") continue;
        if (active.room !== undefined && e.room !== undefined && active.room !== e.room) continue;
        const covers = ui.target?.avatar === e.avatar || (Array.isArray(ui.target?.pair) && ui.target.pair.includes(e.avatar));
        if (covers && active.t + (ui.ease_ms ?? 0) <= e.t) onSpeaker++;
      }
    }
    out.camera = {
      cameraCues: cams.length,
      shotKinds: kinds,
      distinctShots: Object.keys(kinds).length,
      shotsPerMin: round(cams.length / minutes, 2),
      roomCuts: track.filter((e) => e.k === "cut").length,
      shotOnSpeaker: lines === 0 ? null : round(onSpeaker / lines, 3),
      cuesShown: cues.length,
      cuesLost: lostDrops,
      lostRate: cues.length + lostDrops === 0 ? null : round(lostDrops / (cues.length + lostDrops), 3),
    };
  }
  return out;
}

function formatCinematic(c) {
  const out = ["  cinematic (frames.jsonl + director-track.jsonl):"];
  if (c.acts) {
    const verbs = Object.entries(c.acts.verbs).map(([k, v]) => `${k} x${v}`).join(", ");
    out.push(`    acts on screen: ${c.acts.played} (${c.acts.perMin}/min)${verbs ? `: ${verbs}` : ""}; first at ${c.acts.firstAt === null ? "-" : `${c.acts.firstAt}s`}; reactions owed ${c.acts.owedReactions}, missed ${c.acts.owedMissed}`);
    out.push(`    physical climax by ${CLIMAX_DEADLINE_S}s: ${c.acts.climax ? `${c.acts.climax.byDeadline ? "PASS" : "FAIL"} (${c.acts.climax.verb} at ${c.acts.climax.at}s)` : "FAIL (no physical act)"}`);
  }
  if (c.camera) {
    out.push(`    camera: ${c.camera.cameraCues} cues, ${c.camera.distinctShots} kinds (${Object.entries(c.camera.shotKinds).map(([k, v]) => `${k} ${v}`).join(", ")}), ${c.camera.shotsPerMin}/min, ${c.camera.roomCuts} room cuts, on speaker ${c.camera.shotOnSpeaker === null ? "-" : pct(c.camera.shotOnSpeaker)}, ${c.camera.cuesLost} cues lost of ${c.camera.cuesShown + c.camera.cuesLost} queued${c.camera.lostRate === null ? "" : ` (${pct(c.camera.lostRate)})`}`);
  }
  return out.join("\n");
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export function formatReport(m, source) {
  const out = [];
  out.push(`${source}: ${m.turns} turns (${m.contentTurns} content), speakers ${m.speakers.join(", ")}`);
  out.push(`  words per turn: median ${m.words.median}, p75 ${m.words.p75}, p90 ${m.words.p90}, mean ${m.words.mean}; over 25 words ${pct(m.words.over25)}, over 40 ${pct(m.words.over40)}`);
  if (m.fillers.count > 0) out.push(`  without the fillers: median ${m.wordsContent.median}, p75 ${m.wordsContent.p75}, p90 ${m.wordsContent.p90}; over 25 words ${pct(m.wordsContent.over25)}, over 40 ${pct(m.wordsContent.over40)}`);
  const forms = Object.entries(m.fillers.forms).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`).join(", ");
  out.push(`  fillers: ${m.fillers.count} of ${m.turns} (${pct(m.fillers.share)})${forms ? `: ${forms}` : ""}`);
  out.push(`  novelty vs the previous ${NOVELTY_LOOKBACK} turns: mean ${m.novelty.mean}; turns with ${NOVELTY_MIN_WORDS}+ words of 4+ letters: ${m.novelty.judgedTurns}, mean ${m.novelty.judgedMean}, p10 ${m.novelty.judgedP10}`);
  if (m.demandLoops.length === 0) out.push("  demand loops: none");
  for (const d of m.demandLoops) out.push(`  demand loop: ${d.speaker} in ${d.turns} turns${d.from !== undefined ? ` (${Math.round(d.from)}s to ${Math.round(d.to)}s)` : ""}${d.shared.length > 0 ? `, shared: ${d.shared.join(", ")}` : ""}`);
  for (const [who, words] of Object.entries(m.topWords)) out.push(`  words ${who}: ${words.map((w) => `${w.word} ${w.turns}`).join(", ")}`);
  out.push(`  tics (a word in ${TIC_MIN_TURNS}+ of one actor's turns inside ${TIC_WINDOW_TURNS} room turns): ${m.tics.length === 0 ? "none" : m.tics.map((t) => `${t.speaker}: ${t.word} x${t.turns}`).join("; ")}`);
  if (m.events) out.push(`  events: ${m.events.acts} acts${m.events.firstActAt === null ? "" : `, first at ${Math.round(m.events.firstActAt)}s`}; ${m.events.bodyMoves} body moves; no-op:message ${m.events.noOps}:${m.events.messages} (${m.events.noOpPerMessage})`);
  return out.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--actors");
  if (!input) {
    console.error('usage: node scripts/run-metrics.mjs <transcript.jsonl | events.jsonl | run dir> [--actors "A,B,C"] [--json] [--no-cinematic]');
    process.exit(2);
  }
  const actors = flag("--actors")?.split(",").map((a) => a.trim()).filter((a) => a !== "");
  let loaded;
  try {
    loaded = loadInput(input, actors);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const metrics = computeMetrics(loaded.turns, { actors, events: loaded.events });
  const cinematic = !args.includes("--no-cinematic") && existsSync(input) && statSync(input).isDirectory() ? computeCinematic(input) : undefined;
  if (args.includes("--json")) console.log(JSON.stringify({ source: loaded.source, ...metrics, ...(cinematic ? { cinematic } : {}) }, null, 2));
  else console.log(formatReport(metrics, loaded.source) + (cinematic ? `\n${formatCinematic(cinematic)}` : ""));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv);
