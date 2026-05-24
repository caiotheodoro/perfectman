import { describe, it, expect, beforeEach } from "vitest";
import { DiscordRoleManager } from "../role-manager.js";
import { ChannelMap } from "../channel-map.js";
import { FakeGuildPort } from "./fake-guild-port.js";

describe("DiscordRoleManager", () => {
  let guild: FakeGuildPort;
  let channelMap: ChannelMap;
  let botUserIdByAgentId: Map<string, string>;
  let mgr: DiscordRoleManager;

  beforeEach(() => {
    guild = new FakeGuildPort("everyone-role");
    channelMap = new ChannelMap();
    botUserIdByAgentId = new Map([
      ["alice", "user-alice"],
      ["bob", "user-bob"],
    ]);
    guild.addMemberRecord("user-alice");
    guild.addMemberRecord("user-bob");
    guild.addMemberRecord("user-manager");
    mgr = new DiscordRoleManager({
      guild,
      channelMap,
      botUserIdByAgentId,
      discordGuildId: "guild-1",
    });
  });

  describe("createPrivateChannel", () => {
    it("creates role + channel with correct overwrites", async () => {
      const dcId = await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice"],
        managerBotUserId: "user-manager",
      });

      const rec = guild.channels.get(dcId)!;
      expect(rec).toBeDefined();
      expect(rec.name).toBe("pm-sim-1-priv-secret");

      const overwrites = rec.overwrites;
      const everyoneDeny = overwrites.find((o) => o.id === "everyone-role");
      expect(everyoneDeny?.deny).toContain("ViewChannel");

      const roleOw = overwrites.find(
        (o) => o.id !== "everyone-role" && o.id !== "user-manager",
      );
      expect(roleOw?.allow).toContain("ViewChannel");
      expect(roleOw?.allow).toContain("SendMessages");
      expect(roleOw?.allow).toContain("ReadMessageHistory");

      const mgrOw = overwrites.find((o) => o.id === "user-manager");
      expect(mgrOw?.allow).toContain("ViewChannel");
      expect(mgrOw?.allow).toContain("SendMessages");
      expect(mgrOw?.allow).toContain("ManageChannels");
    });

    it("assigns role to member bots", async () => {
      await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice", "bob"],
      });

      const entry = channelMap.get("sim-1", "ch-priv")!;
      expect(guild.getMemberRoles("user-alice").has(entry.discordRoleId!)).toBe(true);
      expect(guild.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(true);
    });

    it("is idempotent — reuses existing channel", async () => {
      const id1 = await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice"],
      });
      const id2 = await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice"],
      });
      expect(id1).toBe(id2);
      expect(guild.roles.size).toBe(1);
    });
  });

  describe("addMember / removeMember", () => {
    it("adds and removes role", async () => {
      await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice"],
      });

      const entry = channelMap.get("sim-1", "ch-priv")!;
      expect(guild.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(false);

      await mgr.addMember("sim-1", "ch-priv", "bob");
      expect(guild.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(true);

      await mgr.removeMember("sim-1", "ch-priv", "bob");
      expect(guild.getMemberRoles("user-bob").has(entry.discordRoleId!)).toBe(false);
    });
  });

  describe("ensurePublicChannel", () => {
    it("creates channel and is idempotent", async () => {
      const id1 = await mgr.ensurePublicChannel({
        simulationId: "sim-1",
        channelId: "general",
        channelName: "general",
      });
      const id2 = await mgr.ensurePublicChannel({
        simulationId: "sim-1",
        channelId: "general",
        channelName: "general",
      });
      expect(id1).toBe(id2);
      expect(guild.channels.size).toBe(1);
    });
  });

  describe("lockAllChannels", () => {
    it("denies SendMessages for private channel roles", async () => {
      await mgr.createPrivateChannel({
        simulationId: "sim-1",
        channelId: "ch-priv",
        channelName: "secret",
        memberAgentIds: ["alice"],
      });

      const entry = channelMap.get("sim-1", "ch-priv")!;
      await mgr.lockAllChannels("sim-1");

      const overwrites = guild.getChannelOverwrites(entry.discordChannelId);
      const roleOw = overwrites.find((o) => o.id === entry.discordRoleId);
      expect(roleOw?.deny).toContain("SendMessages");
    });
  });
});
