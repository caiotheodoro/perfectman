/**
 * Voiced hold (ADR-0017): when a delay-favoring inhibition holds an agent
 * back while something salient just happened, the model is consulted once so
 * the silence carries the character's own reason instead of the engine's
 * seed. One consult per agent per HOLD_VOICE_REFRACTORY_PULSES keeps the
 * call count from creeping back toward one-call-per-pulse. Provisional;
 * owner: the hidden-objective refinement reads (docs/eval/hoc-experiment-protocol.md).
 */
export const HOLD_VOICE_REFRACTORY_PULSES = 4;
