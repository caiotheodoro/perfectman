import type {
  ChannelType,
  SpectatorEvent,
  OperatorEvent,
} from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";
import type { BotRegistry } from "./bot-registry.js";
import type { ChannelMap } from "./channel-map.js";
import type { DiscordRoleManager } from "./role-manager.js";
import type { DiscordRateLimiter } from "./discord-rate-limiter.js";
import type { DiscordGuildPort } from "./discord-guild-port.js";
import type { DiscordGatewayConfig } from "./discord-config.js";
import {
  formatDeliveryMessage,
  formatSpectatorEvent,
  formatOperatorEvent,
} from "./discord-formatter.js";

export type DiscordGatewayDeps = {
  simulationId: string;
  config: DiscordGatewayConfig;
  botRegistry: BotRegistry;
  managerGuildPort: DiscordGuildPort;
  guildPortByAgent: Map<string, DiscordGuildPort>;
  channelMap: ChannelMap;
  roleManager: DiscordRoleManager;
  rateLimiter: DiscordRateLimiter;
};

export class DiscordDeliveryGateway implements IDeliveryGateway {
  private readonly simulationId: string;
  private readonly botRegistry: BotRegistry;
  private readonly managerGuildPort: DiscordGuildPort;
  private readonly guildPortByAgent: Map<string, DiscordGuildPort>;
  private readonly channelMap: ChannelMap;
  private readonly roleManager: DiscordRoleManager;
  private readonly rateLimiter: DiscordRateLimiter;

  constructor(deps: DiscordGatewayDeps) {
    this.simulationId = deps.simulationId;
    this.botRegistry = deps.botRegistry;
    this.managerGuildPort = deps.managerGuildPort;
    this.guildPortByAgent = deps.guildPortByAgent;
    this.channelMap = deps.channelMap;
    this.roleManager = deps.roleManager;
    this.rateLimiter = deps.rateLimiter;
  }

  async sendAgentMessage(
    channelId: string,
    message: DeliveryMessage,
  ): Promise<void> {
    const entry = this.channelMap.get(this.simulationId, channelId);
    if (!entry) {
      throw new Error(
        `discord gateway: no channel mapping for ${this.simulationId}:${channelId}`,
      );
    }

    const formatted = formatDeliveryMessage(message);
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    this.rateLimiter.enqueue({
      id: msgId,
      agentId: message.agentId,
      discordChannelId: entry.discordChannelId,
      payload: formatted,
      salience: message.salience,
      attempts: 0,
      notBefore: 0,
      createdAt: Date.now(),
    });

    const key = `${message.agentId}:${entry.discordChannelId}`;
    const guildPort = this.guildPortByAgent.get(message.agentId);
    if (!guildPort) return;

    await this.rateLimiter.flush(
      key,
      async (discordChannelId, payload) => {
        const ch = await guildPort.fetchTextChannel(discordChannelId);
        if (!ch) throw new Error(`channel ${discordChannelId} not found`);
        return ch.send(payload);
      },
    );
  }

  async createChannel(
    channelId: string,
    type: ChannelType,
    memberAgentIds: string[],
  ): Promise<void> {
    switch (type) {
      case "private_channel": {
        let managerBotUserId: string | undefined;
        try {
          managerBotUserId = this.botRegistry.getManagerBot().userId;
        } catch {
          // no manager bot
        }
        await this.roleManager.createPrivateChannel({
          simulationId: this.simulationId,
          channelId,
          channelName: channelId,
          memberAgentIds,
          managerBotUserId,
        });
        break;
      }
      case "public_channel":
        await this.roleManager.ensurePublicChannel({
          simulationId: this.simulationId,
          channelId,
          channelName: channelId,
        });
        break;
      case "spectator_channel":
        await this.roleManager.ensureSpectatorChannel(this.simulationId);
        break;
      case "operator_channel":
        await this.roleManager.ensureOperatorChannel(this.simulationId);
        break;
    }
  }

  async addMember(channelId: string, agentId: string): Promise<void> {
    await this.roleManager.addMember(this.simulationId, channelId, agentId);
  }

  async removeMember(channelId: string, agentId: string): Promise<void> {
    await this.roleManager.removeMember(this.simulationId, channelId, agentId);
  }

  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    const discordChannelId = await this.roleManager.ensureSpectatorChannel(
      this.simulationId,
    );
    const formatted = formatSpectatorEvent(event);
    const ch = await this.managerGuildPort.fetchTextChannel(discordChannelId);
    if (ch) await ch.send(formatted);
  }

  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    const discordChannelId = await this.roleManager.ensureOperatorChannel(
      this.simulationId,
    );
    const formatted = formatOperatorEvent(event);
    const ch = await this.managerGuildPort.fetchTextChannel(discordChannelId);
    if (ch) await ch.send(formatted);
  }

  async onSimulationStopped(simulationId: string): Promise<void> {
    await this.roleManager.lockAllChannels(simulationId);
    this.rateLimiter.clear();

    const operatorChannelId = await this.roleManager.ensureOperatorChannel(
      simulationId,
    );
    const ch = await this.managerGuildPort.fetchTextChannel(operatorChannelId);
    if (ch) {
      await ch.send({
        content: `[operator:simulation_stopped] Simulation ${simulationId} has been stopped.`,
        allowedMentions: { parse: [] },
      });
    }
  }
}
