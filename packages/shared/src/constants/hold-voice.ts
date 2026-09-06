/**
 * Voiced hold (ADR-0017): when a delay-favoring inhibition holds an agent
 * back while something salient just happened, the model is consulted once so
 * the silence carries the character's own reason instead of the engine's
 * seed. One consult per agent per HOLD_VOICE_REFRACTORY_PULSES keeps the
 * call count from creeping back toward one-call-per-pulse. Widened from 4
 * with D-62 (the salient-event gate is gone, so the refractory carries the
 * whole cost bound). Provisional;
 * owner: the hidden-objective refinement reads (docs/eval/hoc-experiment-protocol.md).
 */
export const HOLD_VOICE_REFRACTORY_PULSES = 3;
