/**
 * Probe contracts — normalized event stream + measurement results.
 */

export type BehavioralEventKind =
  | "post"          // message_sent
  | "reply"         // reply_sent
  | "react"         // reaction_sent
  | "silence"       // no_op_recorded — a chosen social act
  | "blocked_repeat" // repetition_blocked — the generator degenerating, never silence
  | "private_channel" // channel_created
  | "memory"        // memory_written
  | "join"          // agent_invited
  | "leave"         // agent_left
  | "typing"        // typing_started / cancelled
  | "other";

export type BehavioralEvent = {
  kind: BehavioralEventKind;
  agentId: string;
  channelId: string;
  pulseIndex: number;
  /** Visible text when present (message/reply content, motive summary...). */
  content?: string;
  /** What the model privately said about this event (motive summaries etc.). */
  privateContent?: string;
  /** True when `privateContent` was written by the engine (fallback/guard text), not the character. */
  engineAuthored?: boolean;
  payload: Record<string, unknown>;
};

export type ProbeBound = [number, number];

export type ProbeResult = {
  probe: string;
  label: string;
  measured: number;
  bound: ProbeBound;
  passed: boolean;
  note?: string;
};

export function checkProbe(
  probe: string,
  label: string,
  measured: number,
  bound: ProbeBound,
  note?: string,
): ProbeResult {
  return {
    probe,
    label,
    measured: round(measured),
    bound,
    passed: measured >= bound[0] && measured <= bound[1],
    note,
  };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Probe bands.
 *
 * Sources: substrate sim-probes research bands + perfectman mechanics
 * (multi-agent pulses -> higher lurking ceiling). CALIBRATION-PENDING:
 * v1 seed bands; Phase 2.4 replaces them with human-calibrated values
 * (research S1 lesson: bands are measurements, not axioms).
 */
export const PROBE_BANDS: Record<string, ProbeBound> = {
  "latency-mean": [0, 10],
  "latency-p95": [0, 20],
  "lurking": [0.1, 0.9],
  "interruption": [0, 0.25],
  "silence-misreading": [0, 0.15],
  "alliance": [0, 0.5],
  "private-channel-density": [0, 0.15],
  "noop-meaningfulness": [0.9, 1.0],
  "ai-leak": [0, 0.02],
  "emoji-reaction": [0.05, 0.5],
  "memory-write": [0, 0.12],
  "fallback-rate": [0, 0.05],
  "refusal-free": [0.9, 1.0],
  // Near-repeat share of content turns (Jaccard >= 0.7 vs the same agent's
  // earlier utterances). Seed band: any literal-ish repeat is a defect, but
  // legitimately similar in-character phrasing exists — calibration pending
  // like every band above.
  "content-repetition": [0, 0.1],
  // Cross-agent echo: same seed logic — any structural echo of someone
  // else's line is suspect, but calibration pending like every band.
  "cross-agent-echo": [0, 0.1],
  // Largest per-agent share of content turns. One agent above half the room
  // is the monopoly pattern observed live (32/32 pulses); seed band, tuned
  // with the rest.
  "act-share-max": [0, 0.5],
};

export type ProbeInput = {
  events: readonly BehavioralEvent[];
  agentIds: readonly string[];
  totalPulses: number;
  fallbackCount?: number;
  totalLLMCalls?: number;
};
