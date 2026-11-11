import { hbetween, hnormal, hrand } from "./rng.js";
import { HT, chance, clamp, mix } from "./tuning.js";

/** How an actor feels as it takes a turn: picks the reaction latency. */
export type Feel = "heated" | "surprised" | "warm" | "neutral" | "sad" | "ashamed";

export type FeelInput = { arousal: number; valence: number; shame?: number; humiliation?: number; momentumArousal?: number };

export function feelOf(f: FeelInput): Feel {
  if ((f.shame ?? 0) >= 0.5 || (f.humiliation ?? 0) >= 0.5) return "ashamed";
  if (f.arousal >= 0.6 && f.valence < -0.1) return "heated";
  if ((f.momentumArousal ?? 0) >= 0.4) return "surprised";
  if (f.valence >= 0.35) return "warm";
  if (f.valence <= -0.3) return "sad";
  return "neutral";
}

const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2;

/** How much longer (or shorter) than a neutral actor this feeling takes to start answering. */
export function feelFactor(feel: Feel): number {
  return mid(HT.turn.latencyMs[feel]) / mid(HT.turn.latencyMs.neutral);
}

/**
 * The reaction latency (ms from the consult to the first key press) of an actor whose own pace is `base`: the pace is stretched or shortened by
 * how it feels, as far as the dial says. At h = 0 it is `base` exactly.
 */
export function reactionLatencyMs(base: number, feel: Feel, h: number): number {
  return Math.round(base * mix(1, feelFactor(feel), h));
}

export type TypingPlan = {
  /** Time from the consult to the first key press. */
  thinkMs: number;
  /** How long the bubble is up for a clean run of typing. */
  typingMs: number;
  /** A mid-line pause in the bubble (the bubble drops, then comes back), if any: when it starts after the first key press and how long it lasts. */
  hesitate?: { afterMs: number; forMs: number };
  /** thinkMs + typingMs + the pause, capped. */
  totalMs: number;
};

/**
 * Typing indicator for one line: proportional to its length with human jitter (a lognormal on the per-character pace, a chance of a hesitation), and
 * preceded by the reaction latency `thinkMs` (`reactionLatencyMs`). At h = 0 it is the gateway's own: `think + 55 ms * chars` capped at 4 s, no jitter, no pause.
 */
export function typingPlan(o: { chars: number; thinkMs: number; h: number; seed: number; actor: string; n: number }): TypingPlan {
  const { h } = o;
  const perChar = mix(HT.turn.perCharMs[0], HT.turn.perCharMs[1], h);
  const jitter = Math.exp(HT.turn.typingSigma * h * hnormal(o.seed, "typing", o.actor, o.n));
  const think = o.thinkMs;
  const typing = h === 0 ? o.chars * perChar : clamp(o.chars * perChar * jitter, HT.turn.typingMinMs, mix(HT.turn.capMs[0], HT.turn.capMs[1], h));
  const cap = mix(HT.turn.capMs[0], HT.turn.capMs[1], h);
  const hesitates = h > 0 && typing >= 2500 && hrand(o.seed, "hesitate", o.actor, o.n) < chance(HT.turn.hesitateChance, h);
  const pause = hesitates ? Math.round(hbetween(o.seed, HT.turn.hesitatePauseMs, "hesitate-ms", o.actor, o.n)) : 0;
  const total = Math.min(cap, think + typing + pause);
  return {
    thinkMs: Math.round(Math.min(think, total)),
    typingMs: Math.round(Math.max(0, total - Math.min(think, total) - pause)),
    ...(hesitates ? { hesitate: { afterMs: Math.round(typing * hbetween(o.seed, [0.35, 0.65], "hesitate-at", o.actor, o.n)), forMs: pause } } : {}),
    totalMs: Math.round(total),
  };
}

export type InterruptFacts = {
  h: number;
  seed: number;
  n: number;
  /** The line that would be cut, and the one that would cut it. */
  speaker: { actor: string; arousal: number; words: number };
  other: { actor: string; arousal: number };
  now: number;
  lastInterruptAt?: number;
};

/** Whether `other` talks over `speaker`'s line: a heated line from both, long enough to be cut, on a cooldown, and a draw that is the same on every run. */
export function interrupts(f: InterruptFacts): boolean {
  if (f.h <= 0) return false;
  if (f.speaker.words < HT.turn.interruptMinWords) return false;
  if (Math.min(f.speaker.arousal, f.other.arousal) < HT.turn.interruptArousal) return false;
  if (f.lastInterruptAt !== undefined && f.now - f.lastInterruptAt < HT.turn.interruptCooldownMs) return false;
  const heat = clamp((Math.min(f.speaker.arousal, f.other.arousal) - HT.turn.interruptArousal) / (1 - HT.turn.interruptArousal) + 0.5, 0, 1);
  return hrand(f.seed, "interrupt", f.speaker.actor, f.other.actor, f.n) < chance(HT.turn.interruptChance, f.h, heat);
}

/** The gap (ms) between the cut line and the interrupter's, the overlap the viewer sees. */
export function overlapGapMs(seed: number, actor: string, n: number): number {
  return Math.round(hbetween(seed, HT.turn.overlapGapMs, "overlap", actor, n));
}

/**
 * A line cut off by an interruption: the first part of its words, ending in an em-dash (the script-likeness norm for a cut turn, interruptShare in the
 * cinema norms). Undefined when the line is too short to cut. The full text stays in the event log; this is what the room sees.
 */
export function cutLine(text: string, seed: number, actor: string, n: number): string | undefined {
  const words = text.trim().split(/\s+/);
  if (words.length < HT.turn.interruptMinWords) return undefined;
  const keep = Math.max(HT.turn.cutMinWords, Math.round(words.length * hbetween(seed, HT.turn.cutKeep, "cut", actor, n)));
  if (keep >= words.length - 1) return undefined;
  const head = words.slice(0, keep).join(" ").replace(/[\s,;:.!?…—–-]+$/u, "");
  return head.length > 0 ? `${head}—` : undefined;
}


export type CineLead = { leadMs: number; hesitate?: { afterMs: number; forMs: number } };

/**
 * The typing bubble before a line plays in a film (the cinematic director's `typingLeadMs`, 500 ms): proportional to the line with human jitter and
 * a chance of a hesitation. At h = 0 it is `baseMs` exactly; at h = 1 it is `45 ms * chars` (jittered, 0.7 to 5.2 s).
 */
export function cineLead(o: { chars: number; baseMs: number; h: number; seed: number; actor: string; n: number }): CineLead {
  if (o.h <= 0) return { leadMs: o.baseMs };
  const jitter = Math.exp(HT.turn.typingSigma * o.h * hnormal(o.seed, "cine-typing", o.actor, o.n));
  const proportional = clamp(o.chars * HT.turn.cinePerCharMs * jitter, HT.turn.cineLeadMinMs, HT.turn.cineLeadMaxMs);
  const leadMs = Math.round(mix(o.baseMs, proportional, o.h));
  const hesitates = leadMs >= 2500 && hrand(o.seed, "cine-hesitate", o.actor, o.n) < chance(HT.turn.hesitateChance, o.h);
  return {
    leadMs,
    ...(hesitates ? { hesitate: { afterMs: Math.round(leadMs * hbetween(o.seed, [0.35, 0.65], "cine-hesitate-at", o.actor, o.n)), forMs: Math.round(hbetween(o.seed, HT.turn.hesitatePauseMs, "cine-hesitate-ms", o.actor, o.n)) } } : {}),
  };
}

/** The pause between the line before landing and this actor's first key press, by how it feels: a draw from the feeling's band, scaled by the dial (0 at h = 0). */
export function cineThinkMs(o: { feel: Feel; h: number; seed: number; actor: string; n: number }): number {
  if (o.h <= 0) return 0;
  return Math.round(o.h * hbetween(o.seed, HT.turn.latencyMs[o.feel], "cine-think", o.actor, o.n));
}
