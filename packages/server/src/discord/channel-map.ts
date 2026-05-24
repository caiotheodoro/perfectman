import type { ChannelType } from "@perfectman/shared";

export type DiscordChannelMapEntry = {
  simulationId: string;
  channelId: string;
  channelType: ChannelType;
  discordGuildId: string;
  discordChannelId: string;
  discordRoleId?: string;
  lastSyncedAt: number;
};

export class ChannelMap {
  private readonly entries = new Map<string, DiscordChannelMapEntry>();

  private key(simulationId: string, channelId: string): string {
    return `${simulationId}:${channelId}`;
  }

  get(simulationId: string, channelId: string): DiscordChannelMapEntry | null {
    return this.entries.get(this.key(simulationId, channelId)) ?? null;
  }

  upsert(entry: DiscordChannelMapEntry): void {
    this.entries.set(this.key(entry.simulationId, entry.channelId), entry);
  }

  getByDiscordChannelId(discordChannelId: string): DiscordChannelMapEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.discordChannelId === discordChannelId) return entry;
    }
    return null;
  }

  allForSimulation(simulationId: string): DiscordChannelMapEntry[] {
    const result: DiscordChannelMapEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.simulationId === simulationId) result.push(entry);
    }
    return result;
  }

  remove(simulationId: string, channelId: string): boolean {
    return this.entries.delete(this.key(simulationId, channelId));
  }
}
