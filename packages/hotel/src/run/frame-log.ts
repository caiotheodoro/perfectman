import type { BodyFrame, BodyFrameLog, RoomId } from "@perfectman/shared";
import type { Clock } from "../clock/clock.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";

const MAX_FRAMES = 20_000;
const MAX_SNAPSHOTS = 2_000;

/** The sidecar's side of the body frame log (embodiment.md 10): timestamped frames both ways plus periodic space snapshots, for the probes. */
export class FrameLogRecorder {
  readonly log: BodyFrameLog = { frames: [], snapshots: [] };

  constructor(private readonly clock: Clock) {}

  record = (dir: "in" | "out", room: RoomId | undefined, kind: string, data: Record<string, unknown>): void => {
    const frame: BodyFrame = { atMs: this.clock.now(), dir, kind, data, ...(room ? { room } : {}) };
    this.log.frames.push(frame);
    if (this.log.frames.length > MAX_FRAMES) this.log.frames.shift();
  };

  snapshot(mirror: HotelSpaceMirror): void {
    const at = this.clock.now();
    for (const room of mirror.model().rooms.values()) {
      this.log.snapshots.push({
        atMs: at,
        room: room.id,
        occupants: [...room.occupants.values()].map((p) => ({ ref: p.ref, tile: p.tile, dir: p.dir, state: p.state })),
      });
    }
    while (this.log.snapshots.length > MAX_SNAPSHOTS) this.log.snapshots.shift();
  }
}
