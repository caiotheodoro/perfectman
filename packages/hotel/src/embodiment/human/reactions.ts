import type { AgentState, BodyCommandBody, Direction8, Presence, RoomView, Tile } from "@perfectman/shared";
import { chebyshev, dirDiffDeg, sectorTo } from "../../space/geometry.js";
import { FACE_TOLERANCE_DEG, GESTURE_COOLDOWN_MS } from "../constants.js";
import { hbetween, hrand } from "./rng.js";
import { HT, chance, clamp } from "./tuning.js";
import type { HumanLine, HumanLogEntry, HumanProp } from "./types.js";

/** A person in the room the layer reasons about: an actor of ours (`own`, gets commands) or a human guest (only looked at). */
export type ReactPerson = { ref: string; presence: Presence; own: boolean; state?: AgentState };

/** Per actor cooldowns the scheduler keeps (run clock, ms). */
export type ReactMem = { lastBackchannelAt?: number; lastEmphasisAt?: number; lastSignAt?: number; lastReactAt?: number };

export type ReactCtx = {
  h: number;
  seed: number;
  line: HumanLine;
  /** The room at the moment the line reached the wire. */
  room: RoomView;
  people: ReadonlyMap<string, ReactPerson>;
  /** Earlier lines, oldest first, for what the exchange was just before this one. */
  history: readonly HumanLine[];
  props: readonly HumanProp[];
  memOf(ref: string): ReactMem;
  /** `AgentBody.dwell.lastGestureAt` per actor: a gesture kind in its 15 s cooldown is not repeated. */
  lastGestureAt(ref: string): Readonly<Record<string, number>>;
};

/** A command to send `atMs` after the line landed, for one actor. `keep` is its priority when the budget is short (higher stays). */
export type TimedCmd = { ref: string; atMs: number; cmd: BodyCommandBody; tag: string; keep: number; log: Omit<HumanLogEntry, "actor"> };

const FACE_KEEP = 2.5;
const GESTURE_KEEP = 2.2;
const SOFT_KEEP = 1.5;

const FACES = new Set(["smile", "angry", "sad", "surprised", "sleepy"]);

const ang = (self: Tile, to: Tile): Direction8 => sectorTo(self, to);
const offBy = (dir: Direction8, sectors: number): Direction8 => ((((dir + sectors) % 8) + 8) % 8) as Direction8;

function moodOf(p: ReactPerson | undefined): { arousal: number; valence: number; shame: number } {
  const m = p?.state?.coreMood;
  const s = p?.state?.socialEmotions;
  return { arousal: m?.arousal ?? 0.3, valence: m?.valence ?? 0, shame: Math.max(s?.shame ?? 0, s?.humiliation ?? 0) };
}

/** Who the exchange is a row between: both aroused past the threshold and a hostile word in this line or the one before. */
function confrontation(c: ReactCtx, a: ReactPerson, b: ReactPerson | undefined): boolean {
  if (!b) return false;
  const prev = c.history.at(-1);
  const hostile = c.line.hostile !== undefined || prev?.hostile !== undefined;
  const ma = moodOf(a);
  const mb = moodOf(b);
  return hostile && ma.arousal >= HT.gaze.confrontArousal && mb.arousal >= HT.gaze.confrontArousal;
}

/** A line is a sting for its addressee when it reads hostile (own words, not reported ones). */
const stings = (line: HumanLine): boolean => line.hostile !== undefined && (HT.gaze.stungKinds as readonly string[]).includes(line.hostile);

/**
 * What the people in a room do, body-wise, because of a line that was just said (cinematic revamp B5, plan items 2-4): gaze, gesture, expression, the
 * silent answers that stand in for "hm" and "tá" (a nod, a tilt, a raised brow), and a witness's small shock at a reveal. Pure: the same inputs
 * and seed give the same list. Every chance is `chance(max, h, strength)`, so at h = 0 the list is empty.
 */
export function reactToLine(c: ReactCtx): TimedCmd[] {
  if (c.h <= 0) return [];
  const out: TimedCmd[] = [];
  const { line, h, seed } = c;
  const speaker = c.people.get(line.speaker);
  const addressee = line.to ? c.people.get(line.to) : undefined;
  if (!speaker) return out;
  const push = (t: TimedCmd): void => void out.push(t);
  const draw = (tag: string, ref: string): number => hrand(seed, tag, ref, line.n);
  const lag = (range: readonly [number, number], tag: string, ref: string): number => Math.round(hbetween(seed, range, tag, ref, line.n));
  const idle = (p: ReactPerson): boolean => p.own && p.presence.state !== "walk" && p.presence.state !== "lay" && p.presence.fallen === undefined;
  const dist = (a: ReactPerson, b: ReactPerson): number => chebyshev(a.presence.tile, b.presence.tile);
  const faceCmd = (p: ReactPerson, target: Tile): BodyCommandBody | undefined =>
    dirDiffDeg(ang(p.presence.tile, target), p.presence.dir) > FACE_TOLERANCE_DEG ? { cmd: "face", targetTile: target } : undefined;

  // The mood the line came out of: the speaker's, and how the exchange stands.
  const sMood = moodOf(speaker);
  const row = confrontation(c, speaker, addressee);

  // ---- speaker: look at the person addressed; look away on a lie, a shame, or when stung; hold the look in a row ----
  if (idle(speaker) && addressee && dist(speaker, addressee) <= HT.gaze.maxTiles) {
    const prev = c.history.at(-1);
    const stungBefore = prev !== undefined && prev.speaker === line.to && prev.to === line.speaker && stings(prev) && line.n - prev.n <= 2;
    const wantsAway = line.lie === true || sMood.shame >= HT.gaze.shameLookAway || stungBefore;
    const away = !row && wantsAway && draw("avert", speaker.ref) < chance(HT.gaze.averseChance, h);
    const at = lag(HT.gaze.speakerLagMs, "slag", speaker.ref);
    if (away) {
      const dir = offBy(ang(speaker.presence.tile, addressee.presence.tile), draw("avert-side", speaker.ref) < 0.5 ? HT.gaze.averseSectors : -HT.gaze.averseSectors);
      const hold = lag(HT.gaze.averseHoldMs, "hold", speaker.ref);
      push({ ref: speaker.ref, atMs: at, cmd: { cmd: "face", dir }, tag: "gaze_avert", keep: FACE_KEEP, log: { kind: "gaze", rule: line.lie ? "avert:lie" : sMood.shame >= HT.gaze.shameLookAway ? "avert:shame" : "avert:stung", line: line.n, to: addressee.ref } });
      push({ ref: speaker.ref, atMs: at + hold, cmd: { cmd: "face", targetTile: addressee.presence.tile }, tag: "gaze_return", keep: FACE_KEEP, log: { kind: "gaze", rule: "return", line: line.n, to: addressee.ref } });
    } else if (draw("look", speaker.ref) < chance(0.92, h, 1)) {
      const cmd = faceCmd(speaker, addressee.presence.tile);
      if (cmd) push({ ref: speaker.ref, atMs: at, cmd, tag: "gaze_addressee", keep: FACE_KEEP, log: { kind: "gaze", rule: row ? "hold:row" : "face:addressee", line: line.n, to: addressee.ref } });
    }
  }

  // ---- addressee: turn to the speaker; sting shows; a sting is looked away from unless it is a row ----
  if (addressee && idle(addressee) && dist(speaker, addressee) <= HT.gaze.maxTiles) {
    const at = lag(HT.gaze.listenerLagMs, "llag", addressee.ref);
    const cmd = faceCmd(addressee, speaker.presence.tile);
    if (cmd) push({ ref: addressee.ref, atMs: at, cmd, tag: "gaze_speaker", keep: FACE_KEEP, log: { kind: "gaze", rule: "face:speaker", line: line.n, to: speaker.ref } });
    if (stings(line)) {
      const aMood = moodOf(addressee);
      if (!row && draw("stung-away", addressee.ref) < chance(HT.gaze.averseChance, h, 0.6)) {
        const dir = offBy(ang(addressee.presence.tile, speaker.presence.tile), draw("stung-side", addressee.ref) < 0.5 ? HT.gaze.averseSectors : -HT.gaze.averseSectors);
        const t0 = at + 450;
        push({ ref: addressee.ref, atMs: t0, cmd: { cmd: "face", dir }, tag: "gaze_stung", keep: FACE_KEEP, log: { kind: "gaze", rule: "avert:stung", line: line.n, to: speaker.ref } });
        push({ ref: addressee.ref, atMs: t0 + lag(HT.gaze.averseHoldMs, "stung-hold", addressee.ref), cmd: { cmd: "face", targetTile: speaker.presence.tile }, tag: "gaze_return", keep: FACE_KEEP, log: { kind: "gaze", rule: "return", line: line.n, to: speaker.ref } });
      }
      const face = aMood.arousal >= 0.55 ? "angry" : "sad";
      if (draw("stung-face", addressee.ref) < chance(0.7, h)) push(expressionThenNeutral(addressee.ref, face, at + 250, line.n, "face:stung"));
    }
  }

  // ---- speaker: emphasis gesture on a stressed line; the face of the feeling; laughter ----
  if (speaker.own && speaker.presence.state !== "walk" && speaker.presence.fallen === undefined) {
    const strength = clamp(HT.gesture.baseStrength + line.stress + (sMood.arousal - 0.4) * 0.8 + (line.hostile ? 0.3 : 0) + (line.question ? 0.15 : 0) + (line.words >= 12 ? 0.1 : 0), 0, 1);
    const mem = c.memOf(speaker.ref);
    const lastG = c.lastGestureAt(speaker.ref);
    const free = (a: string): boolean => lastG[a] === undefined || (c.line.atMs - lastG[a]!) >= GESTURE_COOLDOWN_MS;
    if (line.amusement && free("laugh") && draw("laugh", speaker.ref) < chance(HT.gesture.laughChance, h)) {
      push({ ref: speaker.ref, atMs: lag(HT.gesture.emphasisLagMs, "glag", speaker.ref), cmd: { cmd: "gesture", a: "laugh" }, tag: "gesture", keep: GESTURE_KEEP, log: { kind: "gesture", rule: "laugh", line: line.n } });
    } else if ((mem.lastEmphasisAt === undefined || c.line.atMs - mem.lastEmphasisAt >= HT.gesture.emphasisCooldownMs) && draw("emphasis", speaker.ref) < chance(HT.gesture.emphasisChance, h, strength)) {
      const heated = sMood.arousal >= 0.65 && sMood.valence < 0;
      const exclaim = heated && strength >= 0.8 && (mem.lastSignAt === undefined || c.line.atMs - mem.lastSignAt >= HT.gesture.signCooldownMs);
      const kind = exclaim ? { a: "sign", style: HT.gesture.signStyleExclaim } : sMood.valence < -0.1 || line.hostile ? { a: "wave" } : { a: "thumbs" };
      if (free(kind.a)) {
        push({ ref: speaker.ref, atMs: lag(HT.gesture.emphasisLagMs, "glag", speaker.ref), cmd: { cmd: "gesture", ...kind }, tag: exclaim ? "gesture_sign" : "gesture", keep: GESTURE_KEEP, log: { kind: "gesture", rule: exclaim ? "emphasis:exclaim" : kind.a === "wave" ? "emphasis:wave_off" : "emphasis:assert", line: line.n } });
      }
    }
    // The face follows the feeling and decays back to neutral.
    if (line.stress >= 0.3 || sMood.arousal >= 0.65) {
      const face = sMood.valence <= -0.2 ? (sMood.arousal >= 0.55 ? "angry" : "sad") : sMood.valence >= 0.35 ? "smile" : undefined;
      if (face && draw("face", speaker.ref) < chance(0.6, h)) push(expressionThenNeutral(speaker.ref, face, lag(HT.gaze.speakerLagMs, "flag", speaker.ref) + 150, line.n, "face:feeling"));
    }
  }

  // ---- listeners: a silent answer in place of a text filler, and a reaction to what was said ----
  const listeners = [...c.people.values()].filter((p) => p.own && p.ref !== speaker.ref && dist(p, speaker) <= HT.prox.earshotMax + 1 && p.presence.fallen === undefined && p.presence.state !== "walk");
  const targets = addressee && listeners.some((p) => p.ref === addressee.ref) ? [addressee] : listeners.filter((p) => !line.to).slice(0, 1);
  for (const p of targets) {
    const mem = c.memOf(p.ref);
    if (line.words < HT.turn.backchannelMinWords) continue;
    if (mem.lastBackchannelAt !== undefined && c.line.atMs - mem.lastBackchannelAt < HT.turn.backchannelCooldownMs) continue;
    if (mem.lastReactAt !== undefined && c.line.atMs - mem.lastReactAt < 2500) continue;
    const m = moodOf(p);
    const at = lag(HT.turn.backchannelLagMs, "bc", p.ref);
    if (line.amusement && draw("lreact", p.ref) < chance(HT.gesture.laughChance, h) && (c.lastGestureAt(p.ref)["laugh"] === undefined || c.line.atMs - c.lastGestureAt(p.ref)["laugh"]! >= GESTURE_COOLDOWN_MS)) {
      push({ ref: p.ref, atMs: at, cmd: { cmd: "gesture", a: "laugh" }, tag: "react", keep: SOFT_KEEP + 0.3, log: { kind: "react", rule: "laugh", line: line.n, to: speaker.ref } });
      continue;
    }
    if (draw("bc", p.ref) >= chance(HT.turn.backchannelChance, h)) continue;
    // Which silent answer: a raised brow at a shock, a tilt at a question or an accusation, a head-shake at a hostile line or a refusal, a nod and a half-smile otherwise.
    let form: "brow" | "tilt" | "shake" | "nod";
    if (line.reveal === true) form = "brow";
    else if (line.question || line.hostile === "accusation") form = "tilt";
    else if (line.hostile !== undefined || m.valence < -0.3) form = "shake";
    else form = "nod";
    if (form === "brow") push(expressionThenNeutral(p.ref, "surprised", at, line.n, "backchannel:brow", "backchannel"));
    else if (form === "nod") {
      const warm = m.valence >= 0.1 || (p.state?.socialEmotions.affection ?? 0) > 0.3;
      if (warm) push(expressionThenNeutral(p.ref, "smile", at, line.n, "backchannel:nod", "backchannel"));
      else push({ ref: p.ref, atMs: at, cmd: { cmd: "face", targetTile: speaker.presence.tile }, tag: "backchannel", keep: SOFT_KEEP, log: { kind: "backchannel", rule: "backchannel:nod", line: line.n, to: speaker.ref } });
    } else {
      const base = ang(p.presence.tile, speaker.presence.tile);
      const side = draw("bc-side", p.ref) < 0.5 ? HT.gesture.headTurnSectors : -HT.gesture.headTurnSectors;
      push({ ref: p.ref, atMs: at, cmd: { cmd: "face", dir: offBy(base, side) }, tag: "backchannel", keep: SOFT_KEEP, log: { kind: "backchannel", rule: `backchannel:${form}`, line: line.n, to: speaker.ref } });
      push({ ref: p.ref, atMs: at + lag(HT.gesture.headTurnBackMs, "bc-back", p.ref), cmd: { cmd: "face", targetTile: speaker.presence.tile }, tag: "backchannel", keep: SOFT_KEEP, log: { kind: "backchannel", rule: "backchannel:back", line: line.n, to: speaker.ref } });
    }
  }

  // ---- while listening to a long line, a glance away from the speaker (the room, a thing, a third person) and back ----
  if (line.words >= HT.idle.glanceAwayMinWords) {
    for (const p of c.people.values()) {
      if (!p.own || p.ref === speaker.ref || !idle(p) || dist(p, speaker) > HT.prox.earshotMax + 1) continue;
      const bystander = p.ref !== addressee?.ref;
      if (draw("glance-away", p.ref) >= chance(bystander ? HT.idle.glanceAwayBystander : HT.idle.glanceAwayChance, h)) continue;
      const base = ang(p.presence.tile, speaker.presence.tile);
      const side = draw("glance-side", p.ref) < 0.5 ? 2 : -2;
      const at = lag(HT.idle.glanceAwayLagMs, "gal", p.ref);
      push({ ref: p.ref, atMs: at, cmd: { cmd: "face", dir: offBy(base, side) }, tag: "glance", keep: SOFT_KEEP, log: { kind: "gaze", rule: "glance:away", line: line.n, to: speaker.ref } });
      push({ ref: p.ref, atMs: at + lag(HT.idle.glanceAwayHoldMs, "gah", p.ref), cmd: { cmd: "face", targetTile: speaker.presence.tile }, tag: "gaze_return", keep: SOFT_KEEP, log: { kind: "gaze", rule: "return", line: line.n, to: speaker.ref } });
    }
  }

  // ---- a third party who is being discussed, a prop that matters: glances ----
  const glanceAt = (who: ReactPerson, target: Tile, why: string, base: number, targetRef?: string): void => {
    if (!idle(who) || dirDiffDeg(ang(who.presence.tile, target), who.presence.dir) <= FACE_TOLERANCE_DEG) return;
    const hold = lag(HT.gaze.glanceHoldMs, `gh-${why}`, who.ref);
    push({ ref: who.ref, atMs: base, cmd: { cmd: "face", targetTile: target }, tag: "glance", keep: SOFT_KEEP + 0.4, log: { kind: "gaze", rule: `glance:${why}`, line: line.n, ...(targetRef ? { to: targetRef } : {}) } });
    const back = who.ref === speaker.ref ? addressee : speaker;
    if (back) push({ ref: who.ref, atMs: base + hold, cmd: { cmd: "face", targetTile: back.presence.tile }, tag: "gaze_return", keep: SOFT_KEEP + 0.4, log: { kind: "gaze", rule: "return", line: line.n } });
  };
  for (const ref of line.mentioned) {
    const third = c.people.get(ref);
    if (!third) continue;
    if (draw("third", speaker.ref) < chance(HT.gaze.thirdPartyChance, h)) glanceAt(speaker, third.presence.tile, "third_party", lag(HT.gaze.glanceLagMs, "g3", speaker.ref), third.ref);
    if (addressee && draw("third-l", addressee.ref) < chance(HT.gaze.thirdPartyChance * 0.7, h)) glanceAt(addressee, third.presence.tile, "third_party", lag(HT.gaze.glanceLagMs, "g3l", addressee.ref) + 200, third.ref);
    // The one being talked about looks at the one talking.
    if (third.own && idle(third) && draw("third-self", third.ref) < chance(0.7, h)) {
      const cmd = faceCmd(third, speaker.presence.tile);
      if (cmd) push({ ref: third.ref, atMs: lag(HT.gaze.glanceLagMs, "g3s", third.ref), cmd, tag: "glance", keep: SOFT_KEEP + 0.4, log: { kind: "gaze", rule: "glance:named", line: line.n, to: speaker.ref } });
    }
  }
  const lower = line.text.toLowerCase();
  const prop = c.props.find((pr) => pr.words.some((w) => w.length >= 3 && lower.includes(w.toLowerCase())));
  if (prop) {
    if (draw("prop", speaker.ref) < chance(HT.gaze.propChance, h)) glanceAt(speaker, prop.tile, `prop:${prop.id}`, lag(HT.gaze.glanceLagMs, "gp", speaker.ref));
    if (addressee && draw("prop-l", addressee.ref) < chance(HT.gaze.propChance, h, 0.8)) glanceAt(addressee, prop.tile, `prop:${prop.id}`, lag(HT.gaze.glanceLagMs, "gpl", addressee.ref) + 150);
  }

  // ---- a reveal or an accusation: the witnesses freeze, then look to the accused ----
  if (line.reveal === true) {
    const accused = addressee ?? (line.mentioned[0] ? c.people.get(line.mentioned[0]) : undefined);
    for (const w of c.people.values()) {
      if (!w.own || w.ref === speaker.ref || w.ref === addressee?.ref || !idle(w) || dist(w, speaker) > HT.prox.earshotMax + 1) continue;
      if (draw("witness", w.ref) >= chance(HT.gesture.witnessChance, h)) continue;
      const at = lag(HT.gesture.witnessLagMs, "wlag", w.ref);
      push({ ref: w.ref, atMs: at, cmd: { cmd: "expression", face: "surprised" }, tag: "witness", keep: FACE_KEEP, log: { kind: "react", rule: "witness:freeze", line: line.n } });
      push({ ref: w.ref, atMs: at + HT.gesture.witnessSurpriseMs, cmd: { cmd: "expression", face: "neutral" }, tag: "decay", keep: SOFT_KEEP, log: { kind: "expression", rule: "decay", line: line.n } });
      if (accused && accused.ref !== w.ref) {
        const cmd = faceCmd(w, accused.presence.tile);
        if (cmd) push({ ref: w.ref, atMs: at + lag(HT.gesture.witnessGlanceLagMs, "wg", w.ref), cmd, tag: "glance", keep: FACE_KEEP, log: { kind: "gaze", rule: "witness:look_to_accused", line: line.n, to: accused.ref } });
      }
    }
  }

  return out.sort((a, b) => a.atMs - b.atMs).filter((t) => t.cmd.cmd !== "expression" || FACES.has((t.cmd as { face: string }).face) || (t.cmd as { face: string }).face === "neutral");
}

/** A face that decays back to neutral after its hold time: two timed commands. The second carries the `decay` tag so a newer face can cancel it. */
function expressionThenNeutral(ref: string, face: string, atMs: number, line: number, rule: string, kind: HumanLogEntry["kind"] = "expression"): TimedCmd {
  return { ref, atMs, cmd: { cmd: "expression", face }, tag: `face:${face}`, keep: SOFT_KEEP + 0.6, log: { kind, rule, line, ms: (HT.gesture.faceHoldMs as Record<string, number>)[face] ?? 4000 } };
}
