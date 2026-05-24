export type DiscordPersonaBotConfig = {
  agentId: string;
  token: string;
};

export type DiscordSetupMode = "readonly_existing" | "manage_channels";

export type DiscordGatewayConfig = {
  guildId: string;
  managerBotToken?: string;
  personaBots: DiscordPersonaBotConfig[];
  setupMode: DiscordSetupMode;
};

export type RawDiscordGatewayConfig = {
  guildId?: string;
  managerBotTokenEnv?: string;
  personaBots?: Array<{ agentId?: string; tokenEnv?: string }>;
  setupMode?: string;
};

export function parseDiscordGatewayConfig(
  raw: RawDiscordGatewayConfig,
): DiscordGatewayConfig {
  if (!raw.guildId || typeof raw.guildId !== "string") {
    throw new Error("discord config: guildId is required");
  }

  if (!Array.isArray(raw.personaBots) || raw.personaBots.length === 0) {
    throw new Error("discord config: at least one personaBot is required");
  }

  const seenAgentIds = new Set<string>();
  const personaBots: DiscordPersonaBotConfig[] = raw.personaBots.map(
    (bot, i) => {
      if (!bot.agentId || typeof bot.agentId !== "string") {
        throw new Error(`discord config: personaBots[${i}].agentId is required`);
      }
      if (!bot.tokenEnv || typeof bot.tokenEnv !== "string") {
        throw new Error(
          `discord config: personaBots[${i}].tokenEnv is required`,
        );
      }
      if (seenAgentIds.has(bot.agentId)) {
        throw new Error(
          `discord config: duplicate agentId "${bot.agentId}"`,
        );
      }
      seenAgentIds.add(bot.agentId);

      const token = process.env[bot.tokenEnv];
      if (!token) {
        throw new Error(
          `discord config: env var "${bot.tokenEnv}" is not set`,
        );
      }
      return { agentId: bot.agentId, token };
    },
  );

  let managerBotToken: string | undefined;
  if (raw.managerBotTokenEnv) {
    managerBotToken = process.env[raw.managerBotTokenEnv];
    if (!managerBotToken) {
      throw new Error(
        `discord config: env var "${raw.managerBotTokenEnv}" is not set`,
      );
    }
  }

  const setupMode: DiscordSetupMode = managerBotToken
    ? "manage_channels"
    : "readonly_existing";

  return { guildId: raw.guildId, managerBotToken, personaBots, setupMode };
}

export function validateDiscordGatewayConfig(
  config: DiscordGatewayConfig,
): void {
  if (!config.guildId) {
    throw new Error("discord config: guildId is required");
  }
  if (config.personaBots.length === 0) {
    throw new Error("discord config: at least one personaBot is required");
  }
  const agentIds = new Set<string>();
  for (const bot of config.personaBots) {
    if (agentIds.has(bot.agentId)) {
      throw new Error(`discord config: duplicate agentId "${bot.agentId}"`);
    }
    agentIds.add(bot.agentId);
  }
  if (config.setupMode === "manage_channels" && !config.managerBotToken) {
    throw new Error(
      "discord config: managerBotToken required for manage_channels mode",
    );
  }
}
