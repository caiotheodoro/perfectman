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
  | "move"          // body: walk started (embodiment probes, docs/embodiment.md 10)
  | "gesture"       // body: gesture or expression
  | "arrive"        // body_arrived
  | "face"          // body: turned toward someone
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
  // Embodiment probes over a BodyFrameLog (docs/embodiment.md section 10).
  // Seeds like every band above: calibrate after the first real runs.
  "teleport-rate": [0, 0],
  "earshot-violation": [0, 0.02],
  "impossible-action-rate": [0, 0.03],
  "jitter-index": [0, 2],
  "facing-rate": [0.85, 1],
  "furniture-use": [1, 1e9],
  "spread-index": [0, 0.6],
  "gesture-diversity": [0, 0.4],
  "stale-command-rate": [0, 0],
  "plan-abandon-rate": [0, 0.25],
  "slowdown-count": [0, 0],
  "prompt-identity-lint": [0, 0],
  // Drama probes over DramaEvent[] (probes/drama.ts). Same calibration-pending
  // seeds. body-act-rate and verb-diversity are informational (nothing can fail
  // them): the first is read before/after against the baseline aggregate.
  "body-act-rate": [0, 1e9],
  // Spam guard (D6): at most 3 acts started per scene-minute, judged on the busiest scene.
  "act-rate": [0, 3],
  // p90 ms from act_beat (contact) to the first reaction of the owed target, then of the owed witnesses.
  "reaction-latency-p90-target": [0, 1500],
  "reaction-latency-p90-witness": [0, 3000],
  "witness-coverage": [0.8, 1],
  "verb-diversity": [0, 1],
  // Escalation ladder and violence budget: every act complies, or the scene is a D3/D6 case.
  "ladder-compliance": [1, 1],
  "dead-speech": [0, 0],
  "consent-violation": [0, 0],
  // Act contract rev 2 probes (probes/drama-contract.ts). All are rules the hotel promises outright, so the
  // band is the promise: nothing owed missed (REA-10), every reason in the enum, every timed-out chip resolved
  // as CHIP-3 says (a share, 1 = all), no human touched without a take, no scene-cut breach, no down window off.
  "owed-missed-empty": [0, 0],
  "blocked-reason-audit": [0, 0],
  "chip-timeout-dodge": [1, 1],
  "human-untouched-without-take": [0, 0],
  "scene-cut-revive": [0, 0],
  "down-window-exact": [0, 0],
  // TBL-3 (contact 150 ms after a take) and SAFE-4 (at most N landed violent acts on humans per room per window).
  "take-contact-windup": [0, 0],
  "harm-window": [0, 0],
  // FRM-1 (one act_done per act) and DEATH-1 (a kill's victim is shown dying): promises, so the band is zero.
  "single-act-done": [0, 0],
  "kill-victim-die-reaction": [0, 0],
  // Beat sheet probes (probes/sheet.ts, Contract A). Promises of the sheet, so the bands are the promises: the climax by 4:00 (240 000 ms), a physical verb, nothing the
  // sheet did not write, no skip beyond its own, the sheet throws the climax at most once (0 when the improvised arc had already thrown it), silence kept, not all talk (3 or more blocking, prop or camera beats), nearly every quiet beat played.
  "sheet-climax-by-240s": [0, 240_000],
  "sheet-climax-physical": [1, 1],
  "sheet-no-stray-scenario-acts": [0, 0],
  "sheet-skip-only-peak": [0, 0],
  "sheet-one-climax": [0, 1],
  "sheet-silence-kept": [0, 0],
  "sheet-not-all-talk": [3, 1e9],
  "sheet-beats-played": [0.9, 1],
  "sheet-improv-held": [0, 0],
};

export type ProbeInput = {
  events: readonly BehavioralEvent[];
  agentIds: readonly string[];
  totalPulses: number;
  fallbackCount?: number;
  totalLLMCalls?: number;
};
