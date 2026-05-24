import type {
  ActionIntent,
  SimulationSettings,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";

// Command types for operator/external control surface
export type SimulationCommand =
  | { kind: "start"; simulationId: string }
  | { kind: "pause"; simulationId: string }
  | { kind: "resume"; simulationId: string }
  | { kind: "stop"; simulationId: string }
  | { kind: "inject_intent"; simulationId: string; intent: ActionIntent }
  | { kind: "update_settings"; simulationId: string; settings: Partial<SimulationSettings> }
  | { kind: "channel_join"; simulationId: string; agentId: string; channelId: string }
  | { kind: "channel_leave"; simulationId: string; agentId: string; channelId: string };

export type CommandResult =
  | { ok: true; commandId: string }
  | { ok: false; commandId: string; reason: string };

export function makeCommandResult(ok: true): CommandResult & { ok: true };
export function makeCommandResult(ok: false, reason: string): CommandResult & { ok: false };
export function makeCommandResult(ok: boolean, reason?: string): CommandResult {
  const commandId = createId();
  if (ok) return { ok: true, commandId };
  return { ok: false, commandId, reason: reason ?? "unknown" };
}

export function buildJoinIntent(agentId: string, channelId: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "invite_agent",
    channelTarget: channelId,
    personTargets: [agentId],
    privateMotiveSummary: "operator-directed join",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

export function buildLeaveIntent(agentId: string, channelId: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "leave_channel",
    channelTarget: channelId,
    personTargets: [],
    privateMotiveSummary: "operator-directed leave",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}
