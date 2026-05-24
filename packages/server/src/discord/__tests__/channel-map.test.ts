import { describe, it, expect } from "vitest";
import { ChannelMap } from "../channel-map.js";

describe("ChannelMap", () => {
  function entry(overrides: Partial<Parameters<ChannelMap["upsert"]>[0]> = {}) {
    return {
      simulationId: "sim-1",
      channelId: "ch-1",
      channelType: "public_channel" as const,
      discordGuildId: "guild-1",
      discordChannelId: "dc-1",
      lastSyncedAt: 1000,
      ...overrides,
    };
  }

  it("set and get roundtrip", () => {
    const map = new ChannelMap();
    const e = entry();
    map.upsert(e);
    expect(map.get("sim-1", "ch-1")).toEqual(e);
  });

  it("returns null for missing entry", () => {
    const map = new ChannelMap();
    expect(map.get("sim-1", "nope")).toBeNull();
  });

  it("upsert overwrites (idempotent)", () => {
    const map = new ChannelMap();
    map.upsert(entry({ discordChannelId: "dc-old" }));
    map.upsert(entry({ discordChannelId: "dc-new" }));
    expect(map.get("sim-1", "ch-1")!.discordChannelId).toBe("dc-new");
  });

  it("allForSimulation filters by simulationId", () => {
    const map = new ChannelMap();
    map.upsert(entry({ simulationId: "sim-1", channelId: "ch-1" }));
    map.upsert(entry({ simulationId: "sim-1", channelId: "ch-2", discordChannelId: "dc-2" }));
    map.upsert(entry({ simulationId: "sim-2", channelId: "ch-3", discordChannelId: "dc-3" }));
    expect(map.allForSimulation("sim-1")).toHaveLength(2);
    expect(map.allForSimulation("sim-2")).toHaveLength(1);
  });

  it("reverse lookup by discord channel id", () => {
    const map = new ChannelMap();
    map.upsert(entry({ discordChannelId: "dc-42" }));
    expect(map.getByDiscordChannelId("dc-42")?.channelId).toBe("ch-1");
    expect(map.getByDiscordChannelId("dc-99")).toBeNull();
  });

  it("remove deletes entry", () => {
    const map = new ChannelMap();
    map.upsert(entry());
    expect(map.remove("sim-1", "ch-1")).toBe(true);
    expect(map.get("sim-1", "ch-1")).toBeNull();
    expect(map.remove("sim-1", "ch-1")).toBe(false);
  });
});
