import { describe, it, expect, beforeEach } from "vitest";
import { DiscordDeliveryGateway } from "../discord-gateway.js";
import { ChannelMap } from "../channel-map.js";
import { DiscordRoleManager } from "../role-manager.js";
import { DiscordRateLimiter } from "../discord-rate-limiter.js";
import { FakeGuildPort } from "./fake-guild-port.js";
import type { BotRegistry } from "../bot-registry.js";
import type { DiscordGatewayConfig } from "../discord-config.js";
import type { DeliveryMessage } from "../../simulation/scheduler-contracts.js";
import type { SpectatorEvent, OperatorEvent } from "@perfectman/shared";

function createFakeBotRegistry(): BotRegistry {
  const hasManager = true;
  return {
    get(agentId: string) {
      return { agentId, userId: `user-${agentId}`, client: {} as never, guild: {} as never };
    },
    getManagerBot() {
      if (!hasManager) throw new Error("no manager");
      return { agentId: "__manager__", userId: "user-manager", client: {} as never, guild: {} as never };
    },
    has(agentId: string) { return agentId === "alice" || agentId === "bob"; },
    getUserId(agentId: string) { return `user-${agentId}`; },
    allAgentIds() { return ["alice", "bob"]; },
    async shutdown() {},
    async startPersonaBot() { return {} as never; },
    async startManagerBot() { return {} as never; },
  } as BotRegistry;
}

describe("DiscordDeliveryGateway", () => {
  let guildPort: FakeGuildPort;
  let channelMap: ChannelMap;
  let roleManager: DiscordRoleManager;
  let rateLimiter: DiscordRateLimiter;
  let gateway: DiscordDeliveryGateway;

  const config: DiscordGatewayConfig = {
    guildId: "guild-1",
    personaBots: [
      { agentId: "alice", token: "tok" },
      { agentId: "bob", token: "tok" },
    ],
    setupMode: "manage_channels",
    managerBotToken: "mgr-tok",
  };

  beforeEach(() => {
    guildPort = new FakeGuildPort("everyone-role");
    guildPort.addMemberRecord("user-alice");
    guildPort.addMemberRecord("user-bob");
    guildPort.addMemberRecord("user-manager");
    channelMap = new ChannelMap();
    const botUserIdByAgentId = new Map([
      ["alice", "user-alice"],
      ["bob", "user-bob"],
    ]);
    roleManager = new DiscordRoleManager({
      guild: guildPort,
      channelMap,
      botUserIdByAgentId,
      discordGuildId: "guild-1",
    });
    rateLimiter = new DiscordRateLimiter();

    const guildPortByAgent = new Map([
      ["alice", guildPort as import("../discord-guild-port.js").DiscordGuildPort],
      ["bob", guildPort as import("../discord-guild-port.js").DiscordGuildPort],
    ]);

    gateway = new DiscordDeliveryGateway({
      simulationId: "sim-1",
      config,
      botRegistry: createFakeBotRegistry(),
      managerGuildPort: guildPort,
      guildPortByAgent,
      channelMap,
      roleManager,
      rateLimiter,
    });
  });

  it("sendAgentMessage on public channel delivers with allowedMentions", async () => {
    await gateway.createChannel("general", "public_channel", []);
    const entry = channelMap.get("sim-1", "general")!;

    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "hello @everyone",
      salience: "medium",
    };
    await gateway.sendAgentMessage("general", msg);

    const sent = guildPort.getSentMessages(entry.discordChannelId);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].allowedMentions).toEqual({ parse: [] });
  });

  it("createChannel private creates role + channel with deny @everyone", async () => {
    await gateway.createChannel("secret", "private_channel", ["alice", "bob"]);
    const entry = channelMap.get("sim-1", "secret")!;
    expect(entry.discordRoleId).toBeDefined();

    const overwrites = guildPort.getChannelOverwrites(entry.discordChannelId);
    const everyoneDeny = overwrites.find((o) => o.id === "everyone-role");
    expect(everyoneDeny?.deny).toContain("ViewChannel");
  });

  it("createChannel public creates channel without role", async () => {
    await gateway.createChannel("lobby", "public_channel", []);
    const entry = channelMap.get("sim-1", "lobby")!;
    expect(entry.discordRoleId).toBeUndefined();
    expect(entry.discordChannelId).toBeDefined();
    // Public channel must actually exist in the guild port (no role, but a real channel)
    expect(guildPort.channels.has(entry.discordChannelId)).toBe(true);
  });

  it("createChannel spectator creates named channel", async () => {
    await gateway.createChannel("__spectator", "spectator_channel", []);
    const entry = channelMap.get("sim-1", "__spectator")!;
    const rec = guildPort.channels.get(entry.discordChannelId)!;
    expect(rec.name).toContain("spectator");
  });

  it("addMember assigns role", async () => {
    await gateway.createChannel("secret", "private_channel", ["alice"]);
    await gateway.addMember("secret", "bob");
    const entry = channelMap.get("sim-1", "secret")!;
    expect(guildPort.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(true);
  });

  it("removeMember removes role", async () => {
    await gateway.createChannel("secret", "private_channel", ["alice", "bob"]);
    await gateway.removeMember("secret", "bob");
    const entry = channelMap.get("sim-1", "secret")!;
    expect(guildPort.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(false);
  });

  it("sendSpectatorEvent delivers formatted message", async () => {
    await gateway.createChannel("__spectator", "spectator_channel", []);
    const event: SpectatorEvent = {
      type: "recap",
      simulationId: "sim-1",
      summary: "things happened",
      createdAt: 1000,
      pulseIndex: 1,
    };
    await gateway.sendSpectatorEvent(event);

    const entry = channelMap.get("sim-1", "__spectator")!;
    const sent = guildPort.getSentMessages(entry.discordChannelId);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.at(-1)!.content).toMatch(/\[recap\]/);
  });

  it("sendOperatorEvent delivers formatted message", async () => {
    await gateway.createChannel("__operator", "operator_channel", []);
    const event: OperatorEvent = {
      type: "llm_failure",
      simulationId: "sim-1",
      pulseIndex: 1,
      detail: "timeout",
      createdAt: 1000,
    };
    await gateway.sendOperatorEvent(event);

    const entry = channelMap.get("sim-1", "__operator")!;
    const sent = guildPort.getSentMessages(entry.discordChannelId);
    expect(sent.at(-1)!.content).toContain("[operator:llm_failure]");
  });

  it("onSimulationStopped locks channels and sends final message", async () => {
    await gateway.createChannel("secret", "private_channel", ["alice"]);
    await gateway.createChannel("__operator", "operator_channel", []);

    await gateway.onSimulationStopped("sim-1");

    const privEntry = channelMap.get("sim-1", "secret")!;
    const overwrites = guildPort.getChannelOverwrites(privEntry.discordChannelId);
    const roleOw = overwrites.find((o) => o.id === privEntry.discordRoleId);
    expect(roleOw?.deny).toContain("SendMessages");

    const opEntry = channelMap.get("sim-1", "__operator")!;
    const opSent = guildPort.getSentMessages(opEntry.discordChannelId);
    expect(opSent.at(-1)!.content).toContain("simulation_stopped");
  });

  it("missing channel map throws descriptive error", async () => {
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "hello",
      salience: "medium",
    };
    await expect(gateway.sendAgentMessage("nonexistent", msg)).rejects.toThrow(
      "no channel mapping",
    );
  });

  it("sendAgentMessage throws when agent has no persona bot", async () => {
    await gateway.createChannel("general", "public_channel", []);
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "charlie",
      content: "hello",
      salience: "medium",
    };
    await expect(gateway.sendAgentMessage("general", msg)).rejects.toThrow(
      'no persona bot configured for agent "charlie"',
    );
  });

  it("operator channel denies @everyone ViewChannel", async () => {
    await gateway.createChannel("__operator", "operator_channel", []);
    const entry = channelMap.get("sim-1", "__operator")!;
    const overwrites = guildPort.getChannelOverwrites(entry.discordChannelId);
    const everyoneDeny = overwrites.find((o) => o.id === "everyone-role");
    expect(everyoneDeny?.deny).toContain("ViewChannel");
  });

  it("operator channel grants manager bot access", async () => {
    await gateway.createChannel("__operator", "operator_channel", []);
    const entry = channelMap.get("sim-1", "__operator")!;
    const overwrites = guildPort.getChannelOverwrites(entry.discordChannelId);
    const mgrOw = overwrites.find((o) => o.id === "user-manager");
    expect(mgrOw?.allow).toContain("ViewChannel");
    expect(mgrOw?.allow).toContain("SendMessages");
  });
});
