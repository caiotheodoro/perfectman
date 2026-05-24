import type { RateLimitStatus, IntentType, SimulationSettings } from "@perfectman/shared";

type AgentRateLimitRecord = {
  messagesThisMinute: number;
  privateChannelsCreated: number;
  lastActionAt: number | null;
  windowStartMs: number;
};

export class RateLimitGate {
  private readonly records = new Map<string, AgentRateLimitRecord>();

  constructor(private readonly settings: SimulationSettings) {}

  private getRecord(agentId: string): AgentRateLimitRecord {
    if (!this.records.has(agentId)) {
      this.records.set(agentId, {
        messagesThisMinute: 0,
        privateChannelsCreated: 0,
        lastActionAt: null,
        windowStartMs: Date.now(),
      });
    }
    const rec = this.records.get(agentId)!;
    // reset minute window
    if (Date.now() - rec.windowStartMs >= 60_000) {
      rec.messagesThisMinute = 0;
      rec.windowStartMs = Date.now();
    }
    return rec;
  }

  getStatus(agentId: string): RateLimitStatus {
    const rec = this.getRecord(agentId);
    const blocked = rec.messagesThisMinute >= this.settings.maxMessagesPerMinutePerAgent;
    return {
      agentId,
      messagesThisMinute: rec.messagesThisMinute,
      privateChannelsCreated: rec.privateChannelsCreated,
      lastActionAt: rec.lastActionAt,
      blocked,
      blockReason: blocked ? "messages_per_minute_exceeded" : undefined,
    };
  }

  allowAction(agentId: string, intentType: IntentType): boolean {
    const rec = this.getRecord(agentId);
    if (intentType === "send_message" || intentType === "reply_to_message") {
      return rec.messagesThisMinute < this.settings.maxMessagesPerMinutePerAgent;
    }
    return true;
  }

  recordAction(agentId: string, intentType: IntentType): void {
    const rec = this.getRecord(agentId);
    if (intentType === "send_message" || intentType === "reply_to_message") {
      rec.messagesThisMinute += 1;
    }
    if (intentType === "create_channel") {
      rec.privateChannelsCreated += 1;
    }
    rec.lastActionAt = Date.now();
  }
}
