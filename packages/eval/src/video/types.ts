/** Lossless source order is separate from editorial video timing. */
/** Shared with the web stage, which resolves faces from the same reading. */
import type { RecordedEmotion } from "@perfectman/shared";
export type { RecordedEmotion };
export type VideoAgent = { id: string; name: string };
/** A directory, not a time-indexed record of who attended a channel. */
export type VideoChannel = {
  id: string;
  name: string;
  kind: "public" | "private" | "operator";
  memberIds?: string[];
};
export type VideoStageAction = {
  kind: "arrive" | "leave" | "invite";
  agentIds: string[];
};
export type VideoStep = {
  id: string;
  phase: string;
  kind: "message" | "private" | "event" | "state" | "narration";
  text: string;
  action?: string;
  actorId?: string;
  channel?: string;
  /** Explicit directed targets; channel audience is a separate fact. */
  recipientIds?: string[];
  /** Explicit recorded audience. Absence means unknown/channel-scoped. */
  audienceIds?: string[];
  /** Leave/invite applies to this step's channel, not the whole simulation. */
  stageAction?: VideoStageAction;
  presence?: string;
  visibility: "public" | "private" | "operator";
  pulse?: number;
  emotion?: RecordedEmotion;
  /** Authored reading hold; the planner may extend it to fit all text. */
  duration?: number;
  /** JSON pointers into the input, including folded motive events. */
  sourceRefs: string[];
  raw: unknown;
};
export type VideoStory = {
  title: string;
  sourceKind: "evidence" | "transcript" | "events" | "replay" | "script";
  agents: VideoAgent[];
  channels?: VideoChannel[];
  /** Authored setting only; never inferred from message text or scenario names. */
  place?: string;
  steps: VideoStep[];
  notices: string[];
  sources?: Array<{ file: string; sha256: string }>;
};
export type VideoBeat = Omit<VideoStep, "raw"> & {
  stepIndex: number;
  pageIndex: number;
  pageCount: number;
  start: number;
  duration: number;
};
export type VideoStoryboard = Omit<VideoStory, "steps"> & {
  version: "perfectman-storyboard-v1";
  sourceFile: string;
  sourceSha256: string;
  steps: VideoStep[];
  beats: VideoBeat[];
  duration: number;
  outroDuration?: number;
  fps: 30;
};
