import type { RoomId } from "@perfectman/shared";
import type { HotelFrame, PauseCause, RunState, SidecarEndReason, SidecarMsg } from "../director/index.js";
import type { RunStartParams } from "./run.js";

/** What the manager needs of a run, so a live run and a replay of a recorded one are handled alike. */
export interface RunLike {
  readonly id: number;
  readonly params: RunStartParams;
  readonly home: RoomId;
  state: RunState;
  pauseCause: PauseCause | undefined;
  readonly p95Drift: boolean;
  roomsInUse(): RoomId[];
  holdsActorIn(room: RoomId): boolean;
  handleFrame(frame: HotelFrame): void;
  handleHumanChat(frame: Extract<HotelFrame, { t: "human_chat" }>): Promise<void>;
  mirrorMoved(ref: string): void;
  mirrorLeft(ref: string): void;
  humanTyping(room: RoomId, typing: boolean, at: number): void;
  setLinkDown(down: boolean): void;
  pause(cause: PauseCause): void;
  resume(source: "admin" | "auto" | "breaker"): boolean;
  stop(reason: SidecarEndReason, summary?: string, opts?: { byHotel?: boolean }): Promise<void>;
  abandon(): Promise<void>;
  status(loopLagMs?: number): Extract<SidecarMsg, { t: "run_status" }>;
  statusText(): string;
  notice(code: string, kind: "info" | "warn" | "error", text?: string): void;
  steer(text: string, to?: string): Promise<boolean>;
  resolveWhisperTarget(args: string): { agentId: string; text: string } | undefined;
  wipeMemory(args: string): Promise<boolean>;
}
