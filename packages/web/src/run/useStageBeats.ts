/**
 * The folded replay, as a list of beats.
 *
 * `useRunStream` already keeps live and stored runs in one shape, so this works
 * the same either way: a `ViewerPulse` is structurally a `LivePulseFrame`, and
 * seeded history arrives as pulse −1 with messages and no thinking, which turns
 * into ordinary beats without a special case.
 */
import { useMemo } from "react";
import { pulseToBeats, type StageBeat, type ViewerReplay } from "@perfectman/shared";

export function useStageBeats(replay: ViewerReplay | null): StageBeat[] {
  return useMemo(() => {
    if (!replay) return [];
    const defaultChannelId = replay.channels[0]?.id ?? "";
    return replay.pulses.flatMap((pulse) =>
      pulseToBeats(pulse, { channels: replay.channels, defaultChannelId }),
    );
  }, [replay]);
}
