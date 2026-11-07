/**
 * The hotel mirror seen as a `CineWorld`: who is where, from the sidecar's own
 * copy of the hotel (no extra frames). Room names are player text (untrusted,
 * director-protocol.md 7.1); they only ever reach a card or a prompt after
 * `sanitizeText`, and the narrator prompt frames them as data.
 */
import type { AgentState } from "@perfectman/shared";
import type { HotelSpaceMirror } from "../../space/space-mirror.js";
import type { CineMood, CineWorld, Tile } from "./types.js";

export type CastInfo = { name: string; role?: string };

export function moodOfState(state: AgentState): CineMood {
  let affection = 0;
  for (const rel of state.relationalStates.values()) affection = Math.max(affection, rel.affection);
  return { valence: state.coreMood.valence, arousal: state.coreMood.arousal, affection };
}

export class MirrorCineWorld implements CineWorld {
  private readonly moods = new Map<string, CineMood>();

  constructor(
    private readonly mirror: HotelSpaceMirror,
    private readonly now: () => number,
    /** The run's own cast, by ref. Only they are filmed. */
    private readonly cast: ReadonlyMap<string, CastInfo>,
  ) {}

  noteMood(ref: string, mood: CineMood): void {
    this.moods.set(ref, mood);
  }

  avatarId(ref: string): number | undefined {
    return this.mirror.avatarId(ref);
  }
  nameOf(ref: string): string {
    return this.cast.get(ref)?.name ?? ref;
  }
  roleOf(ref: string): string | undefined {
    return this.cast.get(ref)?.role;
  }
  tileOf(ref: string): Tile | undefined {
    return this.mirror.view(ref, this.now())?.self?.tile;
  }
  roomOf(ref: string): number | undefined {
    const room = this.mirror.roomOfRef(ref);
    return room === undefined ? undefined : Number(room);
  }
  occupants(room: number): string[] {
    return this.mirror.peopleIn(String(room), this.now()).filter((p) => this.cast.has(p.ref)).map((p) => p.ref);
  }
  roomName(room: number): string {
    return this.mirror.model().rooms.get(String(room))?.name ?? `#${room}`;
  }
  moodOf(ref: string): CineMood | undefined {
    return this.moods.get(ref);
  }
}
