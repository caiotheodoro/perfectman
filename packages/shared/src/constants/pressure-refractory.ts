/**
 * Pressure discharge (ADR-0016): acting on an urge spends it. Both values are
 * provisional and owned by the #129 conversation-quality rerun with the
 * eval sweeps as the harness.
 *
 * PRESSURE_DISCHARGE is subtracted from the raw urge on the pulse after the
 * act and refills linearly over PRESSURE_REFRACTORY_PULSES. One intensity
 * band is 0.25 wide, so 0.40 drops a `high` urge to `low` for a beat; six
 * pulses matches the re-announcement period observed in the monopoly
 * capture, so the fix is measurable against that baseline.
 */
export const PRESSURE_DISCHARGE = 0.4;
export const PRESSURE_REFRACTORY_PULSES = 6;
