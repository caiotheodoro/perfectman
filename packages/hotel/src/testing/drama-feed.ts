import { isDramaFrame } from "../director/drama-frames.js";
import type { HotelFrame } from "../director/index.js";
import { routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";

/** Hands the drama frames among `frames` to `sink`, in order, the way the manager's router does; any other frame is ignored. */
export function feedFrames(sink: DramaFrameSink, frames: readonly HotelFrame[]): void {
  for (const f of frames) if (isDramaFrame(f)) routeDramaFrame(f, sink);
}
