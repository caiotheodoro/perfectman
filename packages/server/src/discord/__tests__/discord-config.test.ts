import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseDiscordGatewayConfig,
  validateDiscordGatewayConfig,
  type DiscordGatewayConfig,
} from "../discord-config.js";

describe("parseDiscordGatewayConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ALICE_TOKEN = process.env.ALICE_TOKEN;
    savedEnv.BOB_TOKEN = process.env.BOB_TOKEN;
    savedEnv.MANAGER_TOKEN = process.env.MANAGER_TOKEN;
    process.env.ALICE_TOKEN = "tok-alice-secret";
    process.env.BOB_TOKEN = "tok-bob-secret";
    process.env.MANAGER_TOKEN = "tok-manager-secret";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("parses valid config", () => {
    const result = parseDiscordGatewayConfig({
      guildId: "123456",
      personaBots: [
        { agentId: "alice", tokenEnv: "ALICE_TOKEN" },
        { agentId: "bob", tokenEnv: "BOB_TOKEN" },
      ],
    });

    expect(result.guildId).toBe("123456");
    expect(result.personaBots).toHaveLength(2);
    expect(result.personaBots[0].token).toBe("tok-alice-secret");
    expect(result.setupMode).toBe("readonly_existing");
  });

  it("derives manage_channels when manager token present", () => {
    const result = parseDiscordGatewayConfig({
      guildId: "123456",
      managerBotTokenEnv: "MANAGER_TOKEN",
      personaBots: [{ agentId: "alice", tokenEnv: "ALICE_TOKEN" }],
    });

    expect(result.setupMode).toBe("manage_channels");
    expect(result.managerBotToken).toBe("tok-manager-secret");
  });

  it("throws on missing guildId", () => {
    expect(() =>
      parseDiscordGatewayConfig({
        personaBots: [{ agentId: "alice", tokenEnv: "ALICE_TOKEN" }],
      }),
    ).toThrow("guildId is required");
  });

  it("throws on empty personaBots", () => {
    expect(() =>
      parseDiscordGatewayConfig({ guildId: "123", personaBots: [] }),
    ).toThrow("at least one personaBot");
  });

  it("throws on missing tokenEnv value", () => {
    expect(() =>
      parseDiscordGatewayConfig({
        guildId: "123",
        personaBots: [{ agentId: "alice", tokenEnv: "NONEXISTENT_VAR" }],
      }),
    ).toThrow('"NONEXISTENT_VAR" is not set');
  });

  it("error message names env var, not token value", () => {
    try {
      parseDiscordGatewayConfig({
        guildId: "123",
        personaBots: [{ agentId: "alice", tokenEnv: "NONEXISTENT_VAR" }],
      });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("NONEXISTENT_VAR");
      expect(msg).not.toContain("tok-alice-secret");
      expect(msg).not.toContain("tok-bob-secret");
    }
  });

  it("throws on duplicate agentIds", () => {
    expect(() =>
      parseDiscordGatewayConfig({
        guildId: "123",
        personaBots: [
          { agentId: "alice", tokenEnv: "ALICE_TOKEN" },
          { agentId: "alice", tokenEnv: "BOB_TOKEN" },
        ],
      }),
    ).toThrow('duplicate agentId "alice"');
  });
});

describe("validateDiscordGatewayConfig", () => {
  const validConfig: DiscordGatewayConfig = {
    guildId: "123",
    personaBots: [{ agentId: "alice", token: "secret" }],
    setupMode: "readonly_existing",
  };

  it("accepts valid config", () => {
    expect(() => validateDiscordGatewayConfig(validConfig)).not.toThrow();
  });

  it("rejects manage_channels without manager token", () => {
    expect(() =>
      validateDiscordGatewayConfig({ ...validConfig, setupMode: "manage_channels" }),
    ).toThrow("managerBotToken required");
  });

  it("rejects duplicate agentIds", () => {
    expect(() =>
      validateDiscordGatewayConfig({
        ...validConfig,
        personaBots: [
          { agentId: "alice", token: "a" },
          { agentId: "alice", token: "b" },
        ],
      }),
    ).toThrow('duplicate agentId "alice"');
  });
});
