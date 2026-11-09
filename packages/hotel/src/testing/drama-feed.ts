import { isDramaFrame } from "../director/drama-frames.js";
import type { HotelFrame, HotelMsg } from "../director/index.js";
import { routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";

/**
 * Hands the drama frames among `frames` to `sink`, in order, the way the manager's router does; any other frame is ignored.
 * Frames built by `fake-drama.ts` have no `seq` (the connection stamps it); it is stamped here, in order.
 */
export function feedFrames(sink: DramaFrameSink, frames: readonly HotelMsg[]): void {
  frames.forEach((f, seq) => {
    const stamped: HotelFrame = { ...f, seq };
    if (isDramaFrame(stamped)) routeDramaFrame(stamped, sink);
  });
}
