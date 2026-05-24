import { describe, it, expect, beforeEach } from "vitest";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";

const SIM_ID = "sim_test";

describe("ChannelRegistry", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry(new InMemoryChannelRepository());
  });

  it("creates a public channel with initial members", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1", "agent_2"],
      spectatorVisible: true,
    });
    expect(ch.id).toBeTruthy();
    expect(ch.memberAgentIds).toEqual(["agent_1", "agent_2"]);
    expect(ch.type).toBe("public_channel");
  });

  it("isMember returns true for a member", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1"],
      spectatorVisible: true,
    });
    expect(await registry.isMember("agent_1", ch.id)).toBe(true);
  });

  it("isMember returns false for non-member", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1"],
      spectatorVisible: true,
    });
    expect(await registry.isMember("agent_99", ch.id)).toBe(false);
  });

  it("addMember makes agent a member", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [],
      spectatorVisible: true,
    });
    await registry.addMember(ch.id, "agent_2");
    expect(await registry.isMember("agent_2", ch.id)).toBe(true);
  });

  it("removeMember makes agent no longer a member", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1"],
      spectatorVisible: true,
    });
    await registry.removeMember(ch.id, "agent_1");
    expect(await registry.isMember("agent_1", ch.id)).toBe(false);
  });

  it("getChannels returns channels for simulation", async () => {
    await registry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [],
      spectatorVisible: true,
    });
    const channels = await registry.getChannels(SIM_ID);
    expect(channels).toHaveLength(1);
  });

  it("creates private channel with spectatorVisible false", async () => {
    const ch = await registry.createChannel({
      simulationId: SIM_ID,
      type: "private_channel",
      name: "secret",
      createdBy: "agent_1",
      memberAgentIds: ["agent_1", "agent_2"],
      spectatorVisible: false,
    });
    expect(ch.type).toBe("private_channel");
    expect(ch.spectatorVisible).toBe(false);
  });
});
