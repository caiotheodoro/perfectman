import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type {
  AgentState,
  ChannelType,
  CoreMood,
  Memory,
  PersonaConfig,
  PresenceMode,
  RelationalState,
  SimulationSettings,
  SocialEmotions,
} from "@perfectman/shared";
import {
  ChannelTypeSchema,
  CoreMoodSchema,
  PresenceModeSchema,
  RelationalStateSchema,
  SimulationSettingsSchema,
  SocialEmotionsSchema,
  createId,
  getPersonaById,
} from "@perfectman/shared";
import {
  AgentConfigRegistry,
  type ConfiguredAgent,
} from "../agent/agent-config-registry.js";
import { AgentRuntime } from "../agent/agent-runtime.js";
import type { PersonaPromptProfile } from "../agent/persona-prompt-profile.js";
import type { LlmConfig } from "../llm/llm-config.js";
import { llmBudget } from "../llm/llm-budget.js";
import {
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
  InMemorySimulationRepository,
} from "../simulation/in-memory-stores.js";
import {
  closeDatabase,
  openDatabase,
  type DB,
} from "../persistence/sqlite/database.js";
import {
  SqliteAgentStateRepository,
  SqliteChannelRepository,
  SqliteEventRepository,
  SqliteSimulationRepository,
} from "../persistence/sqlite/index.js";
import {
  SimulationRuntime,
  type SimulationRuntimeRepositories,
} from "../simulation/simulation-runtime.js";
import type { IDeliveryGateway } from "../simulation/scheduler-contracts.js";
import type {
  AgentRuntime as SchedulerAgentRuntime,
  LlmBudget,
} from "../simulation/pulse-scheduler.js";
import {
  CompositeDeliveryGateway,
  MockDeliveryGateway,
  StdoutDeliveryGateway,
} from "../delivery/index.js";

export type SimulationAppConfig = {
  simulation: {
    id?: string;
    name: string;
    seed: number;
    settings: SimulationSettings;
  };
  persistence: PersistenceConfig;
  debug?: DebugConfig;
  deliveryGateways: DeliveryGatewayConfig[];
  channels: InitialChannelConfig[];
  agents: AgentConfig[];
  /** If set, a synthetic host message is injected into the default channel before pulse 0. */
  hostStartingMessage?: string;
};

export type PersistenceConfig =
  | { type: "memory" }
  | { type: "sqlite"; path: string };

export type DebugConfig = {
  operatorEvents?: boolean;
  pulseMetrics?: boolean;
  stdoutDelivery?: boolean;
};

export type DeliveryGatewayConfig =
  | { id: string; type: "mock" }
  | { id: string; type: "stdout"; debug?: boolean }
  | {
      id: string;
      type: "discord";
      guildId: string;
      personaBots: Array<{ agentId: string; tokenEnv: string }>;
      managerBotTokenEnv?: string;
      setupMode?: "readonly_existing" | "manage_channels";
    };

export type InitialChannelConfig = {
  id: string;
  type: ChannelType;
  name: string;
  memberAgentIds: string[];
  default?: boolean;
  createdBy?: string;
  spectatorVisible?: boolean;
  operatorVisible?: boolean;
  createdForMotives?: string[];
};

export type InitialMemory = Pick<Memory, "type" | "subjectAgentIds" | "summary" | "emotionalTone"> & {
  confidence?: number;
};

export type AgentConfig = {
  id: string;
  presence?: PresenceMode;
  persona: ConfigPersona;
  promptProfile: PersonaPromptProfile;
  llm: LlmConfig;
  initialCoreMood?: CoreMood;
  initialSocialEmotions?: SocialEmotions;
  relationalStates?: Record<string, RelationalState>;
  arrivalPulse?: number | null;
  initialMemories?: InitialMemory[];
};

export type ConfiguredSimulationHandle = {
  runtime: SimulationRuntime;
  simulationId: string;
  gateways: Record<string, IDeliveryGateway>;
  repositories: SimulationRuntimeRepositories;
  close(): Promise<void>;
};

export type BuildConfiguredSimulationOptions = {
  agentRuntimeFactory?: (
    registry: AgentConfigRegistry,
  ) => SchedulerAgentRuntime;
  llmBudget?: LlmBudget;
};

export type ConfigPersona = Pick<
  PersonaConfig,
  "id" | "name" | "archetype" | "writingStyle" | "styleExamples"
>;

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0,
  envy: 0,
  humiliation: 0,
  pride: 0,
  shame: 0,
  affection: 0,
  resentment: 0,
  suspicion: 0,
  admiration: 0,
  contempt: 0,
  neediness: 0,
  socialAnxiety: 0,
  fearOfExclusion: 0,
  desireForStatus: 0,
  desireForIntimacy: 0,
};

const DEFAULT_SOCIAL_SENSITIVITY = 1;

// To be reviewed
const DEFAULT_PERSONA_CALIBRATION: Omit<PersonaConfig, keyof ConfigPersona> = {
  baselineValence: 0,
  baselineArousal: 0.3,
  baselineStability: 0.7,
  baselineEnergy: 0.6,
  emotionalReactivity: 1,
  moodInertia: 0.5,
  maxMoodRotation: 0.4,
  energyRegen: 0.04,
  exclusionSensitivity: 1,
  praiseSensitivity: 1,
  conflictSensitivity: 1,
  boredomSensitivity: 1,
  intimacySensitivity: 1,
  socialSensitivities: {
    jealousy: DEFAULT_SOCIAL_SENSITIVITY,
    envy: DEFAULT_SOCIAL_SENSITIVITY,
    humiliation: DEFAULT_SOCIAL_SENSITIVITY,
    pride: DEFAULT_SOCIAL_SENSITIVITY,
    shame: DEFAULT_SOCIAL_SENSITIVITY,
    affection: DEFAULT_SOCIAL_SENSITIVITY,
    resentment: DEFAULT_SOCIAL_SENSITIVITY,
    suspicion: DEFAULT_SOCIAL_SENSITIVITY,
    admiration: DEFAULT_SOCIAL_SENSITIVITY,
    contempt: DEFAULT_SOCIAL_SENSITIVITY,
    neediness: DEFAULT_SOCIAL_SENSITIVITY,
    socialAnxiety: DEFAULT_SOCIAL_SENSITIVITY,
    fearOfExclusion: 2.6,
    desireForStatus: DEFAULT_SOCIAL_SENSITIVITY,
    desireForIntimacy: DEFAULT_SOCIAL_SENSITIVITY,
  },
};

export const DEFAULT_SIMULATION_CONFIG_FILENAME = "config/index.json";

export function findDefaultSimulationConfigPath(
  startDir = process.cwd(),
): string {
  let current = startDir;
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, DEFAULT_SIMULATION_CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (current === root) break;
    current = dirname(current);
  }

  throw new Error(
    `Default simulation config not found: ${DEFAULT_SIMULATION_CONFIG_FILENAME}`,
  );
}

export async function loadSimulationConfig(
  path: string,
): Promise<SimulationAppConfig> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid simulation config JSON at ${path}: ${errorMessage(err)}`,
    );
  }
  const hydrated = await hydrateAgentPersonaFiles(parsed, path);
  return parseSimulationConfig(hydrated);
}

async function hydrateAgentPersonaFiles(
  input: unknown,
  configPath: string,
): Promise<unknown> {
  const root = asRecord(input, "config");
  const agents = root["agents"];
  if (!Array.isArray(agents)) return input;

  const configDir = dirname(configPath);
  const hydratedAgents = await Promise.all(
    agents.map(async (value, index) => {
      const agent = asRecord(value, `agents[${index}]`);
      const personaFile = optionalString(
        agent["personaFile"],
        `agents[${index}].personaFile`,
      );
      if (!personaFile) return value;
      if (agent["persona"] !== undefined || agent["promptProfile"] !== undefined) {
        throw new Error(
          `agents[${index}] cannot define personaFile together with inline persona or promptProfile`,
        );
      }

      const personaPath = isAbsolute(personaFile)
        ? personaFile
        : resolve(configDir, personaFile);
      let rawPersona: string;
      try {
        rawPersona = await readFile(personaPath, "utf8");
      } catch (err) {
        throw new Error(
          `Unable to read agents[${index}].personaFile at ${personaPath}: ${errorMessage(err)}`,
        );
      }

      let parsedPersona: unknown;
      try {
        parsedPersona = JSON.parse(rawPersona);
      } catch (err) {
        throw new Error(
          `Invalid personaFile JSON at ${personaPath}: ${errorMessage(err)}`,
        );
      }

      const localPersona = asRecord(parsedPersona, `agents[${index}].personaFile`);
      return {
        ...localPersona,
        ...agent,
        persona: localPersona["persona"],
        promptProfile: localPersona["promptProfile"],
      };
    }),
  );

  return {
    ...root,
    agents: hydratedAgents,
  };
}

export function parseSimulationConfig(input: unknown): SimulationAppConfig {
  const root = asRecord(input, "config");
  const simulation = asRecord(root["simulation"], "simulation");
  const settings = parseWithSchema<SimulationSettings>(
    SimulationSettingsSchema,
    simulation["settings"],
    "simulation.settings",
  );

  const config: SimulationAppConfig = {
    simulation: {
      id: optionalString(simulation["id"], "simulation.id"),
      name: requiredString(simulation["name"], "simulation.name"),
      seed: requiredInteger(simulation["seed"], "simulation.seed"),
      settings,
    },
    persistence: parsePersistence(root["persistence"]),
    debug: parseDebug(root["debug"]),
    deliveryGateways: parseGateways(root["deliveryGateways"]),
    channels: parseChannels(root["channels"]),
    agents: parseAgents(root["agents"]),
  };

  validateCrossReferences(config);
  return config;
}

export async function buildConfiguredSimulation(
  config: SimulationAppConfig,
  options: BuildConfiguredSimulationOptions = {},
): Promise<ConfiguredSimulationHandle> {
  const simulationId = config.simulation.id ?? createId();
  const persistence = createRepositories(config.persistence);
  const gateways = await createGateways(config);
  const delivery = new CompositeDeliveryGateway(Object.values(gateways));
  const configuredAgents = config.agents.map<ConfiguredAgent>((agent) => ({
    id: agent.id,
    persona: inflatePersonaConfig(agent.persona),
    promptProfile: agent.promptProfile,
    llm: agent.llm,
  }));
  const registry = new AgentConfigRegistry(configuredAgents);
  const budget = options.llmBudget ?? llmBudget;
  if (!options.llmBudget) {
    llmBudget.registerLimits(simulationId, config.simulation.settings);
  }

  const runtime = new SimulationRuntime({
    delivery,
    agentRuntime:
      options.agentRuntimeFactory?.(registry) ??
      new AgentRuntime(undefined, registry),
    llmBudget: budget,
    repositories: persistence.repositories,
  });

  const agentContexts = config.agents.map((agent) => ({
    id: agent.id,
    state: makeAgentState(agent, simulationId),
    persona: registry.getPersona(agent.id),
  }));

  const simulation = await runtime.createSimulation({
    id: simulationId,
    name: config.simulation.name,
    seed: config.simulation.seed,
    settings: config.simulation.settings,
    agentContexts,
    channels: config.channels,
  });

  return {
    runtime,
    simulationId: simulation.id,
    gateways,
    repositories: persistence.repositories,
    async close(): Promise<void> {
      if (persistence.db) closeDatabase(persistence.db);
    },
  };
}

function createRepositories(config: PersistenceConfig): {
  repositories: SimulationRuntimeRepositories;
  db?: DB;
} {
  if (config.type === "sqlite") {
    if (config.path !== ":memory:") {
      mkdirSync(dirname(config.path), { recursive: true });
    }
    const db = openDatabase(config.path);
    return {
      db,
      repositories: {
        eventRepo: new SqliteEventRepository(db),
        agentStateRepo: new SqliteAgentStateRepository(db),
        simRepo: new SqliteSimulationRepository(db),
        channelRepo: new SqliteChannelRepository(db),
      },
    };
  }

  return {
    repositories: {
      eventRepo: new InMemoryEventRepository(),
      agentStateRepo: new InMemoryAgentStateRepository(),
      simRepo: new InMemorySimulationRepository(),
      channelRepo: new InMemoryChannelRepository(),
    },
  };
}

type GatewayFactory = (
  cfg: DeliveryGatewayConfig,
  debug: DebugConfig | undefined,
) => IDeliveryGateway | Promise<IDeliveryGateway>;

const GATEWAY_FACTORIES: Record<DeliveryGatewayConfig["type"], GatewayFactory> =
  {
    mock: () => new MockDeliveryGateway(),
    stdout: (cfg, debug) =>
      new StdoutDeliveryGateway(
        (cfg as Extract<DeliveryGatewayConfig, { type: "stdout" }>).debug ??
          debug?.operatorEvents ??
          false,
      ),
    discord: async (cfg) => {
      const discordCfg = cfg as Extract<DeliveryGatewayConfig, { type: "discord" }>;
      const { parseDiscordGatewayConfig, validateDiscordGatewayConfig } = await import(
        "../discord/discord-config.js"
      );
      const parsed = parseDiscordGatewayConfig({
        guildId: discordCfg.guildId,
        managerBotTokenEnv: discordCfg.managerBotTokenEnv,
        personaBots: discordCfg.personaBots,
        setupMode: discordCfg.setupMode,
      });
      validateDiscordGatewayConfig(parsed);

      const { BotRegistry } = await import("../discord/bot-registry.js");
      const { DiscordJsGuildAdapter } = await import("../discord/discord-guild-adapter.js");
      const { ChannelMap } = await import("../discord/channel-map.js");
      const { DiscordRoleManager } = await import("../discord/role-manager.js");
      const { DiscordRateLimiter } = await import("../discord/discord-rate-limiter.js");
      const { DiscordDeliveryGateway } = await import("../discord/discord-gateway.js");

      const registry = new BotRegistry(parsed.guildId);
      for (const bot of parsed.personaBots) {
        await registry.startPersonaBot(bot.agentId, bot.token);
      }
      if (parsed.managerBotToken) {
        await registry.startManagerBot(parsed.managerBotToken);
      }

      const managerOrFirst = (() => {
        try { return registry.getManagerBot(); }
        catch { return registry.get(parsed.personaBots[0]!.agentId); }
      })();

      const managerGuildPort = new DiscordJsGuildAdapter(managerOrFirst.guild);
      const guildPortByAgent = new Map(
        registry.allAgentIds().map((id) => [
          id,
          new DiscordJsGuildAdapter(registry.get(id).guild),
        ]),
      );

      const channelMap = new ChannelMap();
      const botUserIdByAgentId = new Map(
        registry.allAgentIds().map((id) => [id, registry.getUserId(id)]),
      );
      const roleManager = new DiscordRoleManager({
        guild: managerGuildPort,
        channelMap,
        botUserIdByAgentId,
        discordGuildId: parsed.guildId,
      });

      return new DiscordDeliveryGateway({
        simulationId: discordCfg.id,
        config: parsed,
        botRegistry: registry,
        managerGuildPort,
        guildPortByAgent,
        channelMap,
        roleManager,
        rateLimiter: new DiscordRateLimiter(),
      });
    },
  };

async function createGateways(
  config: SimulationAppConfig,
): Promise<Record<string, IDeliveryGateway>> {
  const result: Record<string, IDeliveryGateway> = {};
  for (const gateway of config.deliveryGateways) {
    result[gateway.id] = await GATEWAY_FACTORIES[gateway.type](gateway, config.debug);
  }
  if (
    config.debug?.stdoutDelivery &&
    !config.deliveryGateways.some((g) => g.type === "stdout")
  ) {
    result["stdout-debug"] = new StdoutDeliveryGateway(
      config.debug.operatorEvents ?? false,
    );
  }
  return result;
}

function makeAgentState(agent: AgentConfig, simulationId: string): AgentState {
  const now = Date.now();
  const persona = inflatePersonaConfig(agent.persona);
  return {
    agentId: agent.id,
    simulationId,
    personaId: persona.id,
    presence: agent.presence ?? "active",
    coreMood: agent.initialCoreMood ?? {
      valence: persona.baselineValence,
      arousal: persona.baselineArousal,
      stability: persona.baselineStability,
      energy: persona.baselineEnergy,
      circumplexAngle: 0,
      circumplexRadius: Math.min(
        1,
        Math.abs(persona.baselineValence) + persona.baselineArousal / 2,
      ),
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: agent.initialSocialEmotions ?? { ...ZERO_SOCIAL },
    relationalStates: new Map(Object.entries(agent.relationalStates ?? {})),
    memories: (agent.initialMemories ?? []).map((m): Memory => ({
      id: createId(),
      agentId: agent.id,
      simulationId,
      type: m.type,
      subjectAgentIds: m.subjectAgentIds,
      sourceEventIds: [],
      summary: m.summary,
      emotionalTone: m.emotionalTone,
      confidence: m.confidence ?? 0.8,
      unresolved: false,
      createdAt: now - 1,
      lastReinforcedAt: now - 1,
    })),
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: agent.arrivalPulse ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function parsePersistence(input: unknown): PersistenceConfig {
  const persistence = asRecord(input ?? { type: "memory" }, "persistence");
  const type = requiredString(persistence["type"], "persistence.type");
  if (type === "memory") return { type };
  if (type === "sqlite") {
    return {
      type,
      path: requiredString(persistence["path"], "persistence.path"),
    };
  }
  throw new Error(`Unsupported persistence.type: ${type}`);
}

function parseDebug(input: unknown): DebugConfig | undefined {
  if (input === undefined) return undefined;
  const debug = asRecord(input, "debug");
  return {
    operatorEvents: optionalBoolean(
      debug["operatorEvents"],
      "debug.operatorEvents",
    ),
    pulseMetrics: optionalBoolean(debug["pulseMetrics"], "debug.pulseMetrics"),
    stdoutDelivery: optionalBoolean(
      debug["stdoutDelivery"],
      "debug.stdoutDelivery",
    ),
  };
}

function parseGateways(input: unknown): DeliveryGatewayConfig[] {
  const gateways = asArray(input, "deliveryGateways");
  return gateways.map((value, index) => {
    const gateway = asRecord(value, `deliveryGateways[${index}]`);
    const id = requiredString(gateway["id"], `deliveryGateways[${index}].id`);
    const type = requiredString(
      gateway["type"],
      `deliveryGateways[${index}].type`,
    );
    if (type === "mock") return { id, type };
    if (type === "stdout") {
      return {
        id,
        type,
        debug: optionalBoolean(
          gateway["debug"],
          `deliveryGateways[${index}].debug`,
        ),
      };
    }
    if (type === "discord") {
      const guildId = requiredString(
        gateway["guildId"],
        `deliveryGateways[${index}].guildId`,
      );
      const personaBots = asArray(
        gateway["personaBots"],
        `deliveryGateways[${index}].personaBots`,
      ).map((bot, bi) => {
        const b = asRecord(bot, `deliveryGateways[${index}].personaBots[${bi}]`);
        return {
          agentId: requiredString(b["agentId"], `deliveryGateways[${index}].personaBots[${bi}].agentId`),
          tokenEnv: requiredString(b["tokenEnv"], `deliveryGateways[${index}].personaBots[${bi}].tokenEnv`),
        };
      });
      const setupModeRaw = optionalString(
        gateway["setupMode"],
        `deliveryGateways[${index}].setupMode`,
      );
      const setupMode =
        setupModeRaw === "readonly_existing" || setupModeRaw === "manage_channels"
          ? setupModeRaw
          : undefined;
      if (setupModeRaw !== undefined && setupMode === undefined) {
        throw new Error(
          `deliveryGateways[${index}].setupMode must be "readonly_existing" or "manage_channels"`,
        );
      }
      return {
        id,
        type,
        guildId,
        personaBots,
        managerBotTokenEnv: optionalString(
          gateway["managerBotTokenEnv"],
          `deliveryGateways[${index}].managerBotTokenEnv`,
        ),
        setupMode,
      };
    }
    throw new Error(`Unsupported deliveryGateways[${index}].type: ${type}`);
  });
}

function parseChannels(input: unknown): InitialChannelConfig[] {
  return asArray(input, "channels").map((value, index) => {
    const channel = asRecord(value, `channels[${index}]`);
    const type = parseWithSchema<ChannelType>(
      ChannelTypeSchema,
      channel["type"],
      `channels[${index}].type`,
    );
    return {
      id: requiredString(channel["id"], `channels[${index}].id`),
      type,
      name: requiredString(channel["name"], `channels[${index}].name`),
      memberAgentIds: asStringArray(
        channel["memberAgentIds"],
        `channels[${index}].memberAgentIds`,
      ),
      default: optionalBoolean(
        channel["default"],
        `channels[${index}].default`,
      ),
      createdBy: optionalString(
        channel["createdBy"],
        `channels[${index}].createdBy`,
      ),
      spectatorVisible: optionalBoolean(
        channel["spectatorVisible"],
        `channels[${index}].spectatorVisible`,
      ),
      operatorVisible: optionalBoolean(
        channel["operatorVisible"],
        `channels[${index}].operatorVisible`,
      ),
      createdForMotives:
        channel["createdForMotives"] === undefined
          ? undefined
          : asStringArray(
              channel["createdForMotives"],
              `channels[${index}].createdForMotives`,
            ),
    };
  });
}

function parseAgents(input: unknown): AgentConfig[] {
  return asArray(input, "agents").map((value, index) => {
    const agent = asRecord(value, `agents[${index}]`);
    return {
      id: requiredString(agent["id"], `agents[${index}].id`),
      presence:
        agent["presence"] === undefined
          ? undefined
          : parseWithSchema<PresenceMode>(
              PresenceModeSchema,
              agent["presence"],
              `agents[${index}].presence`,
            ),
      persona: parseConfigPersona(agent["persona"], `agents[${index}].persona`),
      promptProfile: parsePromptProfile(
        agent["promptProfile"],
        `agents[${index}].promptProfile`,
      ),
      llm: parseLlmConfig(agent["llm"], `agents[${index}].llm`),
      initialCoreMood:
        agent["initialCoreMood"] === undefined
          ? undefined
          : parseWithSchema<CoreMood>(
              CoreMoodSchema,
              agent["initialCoreMood"],
              `agents[${index}].initialCoreMood`,
            ),
      initialSocialEmotions:
        agent["initialSocialEmotions"] === undefined
          ? undefined
          : parseWithSchema<SocialEmotions>(
              SocialEmotionsSchema,
              agent["initialSocialEmotions"],
              `agents[${index}].initialSocialEmotions`,
            ),
      relationalStates: parseRelationalStates(
        agent["relationalStates"],
        `agents[${index}].relationalStates`,
      ),
      arrivalPulse: optionalNullableInteger(
        agent["arrivalPulse"],
        `agents[${index}].arrivalPulse`,
      ),
    };
  });
}

export function inflatePersonaConfig(persona: ConfigPersona): PersonaConfig {
  // Canonical personas carry their calibration in constants/personas.ts —
  // resolve it by id so config files stay lean AND the persona thresholds
  // actually reach the engine (persona-as-thresholds, not persona-as-cosmetics).
  const canonical = getPersonaById(persona.id);
  if (canonical) {
    return {
      ...persona,
      baselineValence: canonical.baselineValence,
      baselineArousal: canonical.baselineArousal,
      baselineStability: canonical.baselineStability,
      baselineEnergy: canonical.baselineEnergy,
      emotionalReactivity: canonical.emotionalReactivity,
      moodInertia: canonical.moodInertia,
      maxMoodRotation: canonical.maxMoodRotation,
      energyRegen: canonical.energyRegen,
      exclusionSensitivity: canonical.exclusionSensitivity,
      praiseSensitivity: canonical.praiseSensitivity,
      conflictSensitivity: canonical.conflictSensitivity,
      boredomSensitivity: canonical.boredomSensitivity,
      intimacySensitivity: canonical.intimacySensitivity,
      styleExamples: [...persona.styleExamples],
      socialSensitivities: { ...canonical.socialSensitivities },
    };
  }
  return {
    ...persona,
    ...DEFAULT_PERSONA_CALIBRATION,
    styleExamples: [...persona.styleExamples],
    socialSensitivities: { ...DEFAULT_PERSONA_CALIBRATION.socialSensitivities },
  };
}

function parseConfigPersona(input: unknown, path: string): ConfigPersona {
  const persona = asRecord(input, path);
  rejectSimulationCalibrationFields(persona, path);
  return {
    id: requiredString(persona["id"], `${path}.id`),
    name: requiredString(persona["name"], `${path}.name`),
    archetype: requiredString(persona["archetype"], `${path}.archetype`),
    writingStyle: requiredString(
      persona["writingStyle"],
      `${path}.writingStyle`,
    ),
    styleExamples: asStringArray(
      persona["styleExamples"],
      `${path}.styleExamples`,
    ),
  };
}

function rejectSimulationCalibrationFields(
  persona: Record<string, unknown>,
  path: string,
): void {
  const forbidden = [
    "baselineValence",
    "baselineArousal",
    "baselineStability",
    "baselineEnergy",
    "emotionalReactivity",
    "moodInertia",
    "maxMoodRotation",
    "energyRegen",
    "exclusionSensitivity",
    "praiseSensitivity",
    "conflictSensitivity",
    "boredomSensitivity",
    "intimacySensitivity",
    "socialSensitivities",
  ];
  for (const field of forbidden) {
    if (field in persona) {
      throw new Error(
        `${path}.${field} is simulation calibration and must not be defined in persona config`,
      );
    }
  }
}

function parsePromptProfile(
  input: unknown,
  path: string,
): PersonaPromptProfile {
  const profile = asRecord(input, path);
  const language = requiredString(profile["language"], `${path}.language`);
  if (language !== "pt-BR" && language !== "en") {
    throw new Error(`${path}.language must be pt-BR or en`);
  }

  return {
    personaId: requiredString(profile["personaId"], `${path}.personaId`),
    displayName: requiredString(profile["displayName"], `${path}.displayName`),
    language,
    identityFrame: requiredString(
      profile["identityFrame"],
      `${path}.identityFrame`,
    ),
    coreTraits: optionalStringArray(profile["coreTraits"], `${path}.coreTraits`),
    valuesAndMotivations: optionalStringArray(
      profile["valuesAndMotivations"],
      `${path}.valuesAndMotivations`,
    ),
    socialPresence: optionalStringArray(
      profile["socialPresence"],
      `${path}.socialPresence`,
    ),
    cognitiveStyle: optionalStringArray(
      profile["cognitiveStyle"],
      `${path}.cognitiveStyle`,
    ),
    emotionalPatterns: optionalStringArray(
      profile["emotionalPatterns"],
      `${path}.emotionalPatterns`,
    ),
    conflictStyle: optionalStringArray(
      profile["conflictStyle"],
      `${path}.conflictStyle`,
    ),
    affectionStyle: optionalStringArray(
      profile["affectionStyle"],
      `${path}.affectionStyle`,
    ),
    publicPrivateDelta: optionalStringArray(
      profile["publicPrivateDelta"],
      `${path}.publicPrivateDelta`,
    ),
    voiceGuidelines: asStringArray(
      profile["voiceGuidelines"],
      `${path}.voiceGuidelines`,
    ),
    styleExamples: parsePromptStyleExamples(
      profile["styleExamples"],
      `${path}.styleExamples`,
    ),
    privateMotivePatterns: optionalStringArray(
      profile["privateMotivePatterns"],
      `${path}.privateMotivePatterns`,
    ),
    hardAvoids: optionalStringArray(profile["hardAvoids"], `${path}.hardAvoids`),
    relationshipBiases: parsePromptRelationshipBiases(
      profile["relationshipBiases"] ?? {},
      `${path}.relationshipBiases`,
    ),
    sourceRefs: parsePromptSourceRefs(
      profile["sourceRefs"] ?? { assessmentIds: [], lastCompiledAt: "manual-config" },
      `${path}.sourceRefs`,
    ),
  };
}

function optionalStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  return asStringArray(value, path);
}

function parsePromptStyleExamples(
  value: unknown,
  path: string,
): PersonaPromptProfile["styleExamples"] {
  if (Array.isArray(value)) {
    return {
      default: asStringArray(value, path),
      animated: [],
      dryOrLowEnergy: [],
      conflict: [],
    };
  }

  const examples = asRecord(value, path);
  return {
    default: optionalStringArray(examples["default"], `${path}.default`),
    animated: optionalStringArray(examples["animated"], `${path}.animated`),
    dryOrLowEnergy: optionalStringArray(
      examples["dryOrLowEnergy"],
      `${path}.dryOrLowEnergy`,
    ),
    conflict: optionalStringArray(examples["conflict"], `${path}.conflict`),
  };
}

function parsePromptRelationshipBiases(
  value: unknown,
  path: string,
): PersonaPromptProfile["relationshipBiases"] {
  const record = asRecord(value, path);
  const result: PersonaPromptProfile["relationshipBiases"] = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      result[key] = {
        view: item,
        warmth: "medium",
        trust: "medium",
        likelyBehaviors: [],
        triggers: [],
      };
      continue;
    }

    const bias = asRecord(item, `${path}.${key}`);
    const warmth = requiredString(bias["warmth"], `${path}.${key}.warmth`);
    const trust = requiredString(bias["trust"], `${path}.${key}.trust`);
    if (warmth !== "low" && warmth !== "medium" && warmth !== "high") {
      throw new Error(`${path}.${key}.warmth must be low, medium, or high`);
    }
    if (trust !== "low" && trust !== "medium" && trust !== "high") {
      throw new Error(`${path}.${key}.trust must be low, medium, or high`);
    }

    result[key] = {
      view: requiredString(bias["view"], `${path}.${key}.view`),
      warmth,
      trust,
      likelyBehaviors: optionalStringArray(
        bias["likelyBehaviors"],
        `${path}.${key}.likelyBehaviors`,
      ),
      triggers: optionalStringArray(bias["triggers"], `${path}.${key}.triggers`),
    };
  }
  return result;
}

function parsePromptSourceRefs(
  value: unknown,
  path: string,
): PersonaPromptProfile["sourceRefs"] {
  const refs = asRecord(value, path);
  return {
    assessmentIds: optionalStringArray(refs["assessmentIds"], `${path}.assessmentIds`),
    notesPath: optionalString(refs["notesPath"], `${path}.notesPath`),
    lastCompiledAt: requiredString(refs["lastCompiledAt"], `${path}.lastCompiledAt`),
  };
}

function parseLlmConfig(input: unknown, path: string): LlmConfig {
  const llm = asRecord(input, path);
  const providerType = requiredString(
    llm["providerType"],
    `${path}.providerType`,
  );
  if (
    providerType !== "mock" &&
    providerType !== "qwen3_8b" &&
    providerType !== "ollama" &&
    providerType !== "freellmapi"
  ) {
    throw new Error(`${path}.providerType is unsupported: ${providerType}`);
  }
  if ("apiKey" in llm || "token" in llm || "botToken" in llm) {
    throw new Error(
      `${path} must reference secrets through env field names only`,
    );
  }
  return {
    providerType,
    baseUrl: optionalString(llm["baseUrl"], `${path}.baseUrl`),
    apiKeyEnv: optionalString(llm["apiKeyEnv"], `${path}.apiKeyEnv`),
    modelName: requiredString(llm["modelName"], `${path}.modelName`),
    maxInputTokens: requiredInteger(
      llm["maxInputTokens"],
      `${path}.maxInputTokens`,
    ),
    maxOutputTokens: requiredInteger(
      llm["maxOutputTokens"],
      `${path}.maxOutputTokens`,
    ),
    temperature: requiredNumber(llm["temperature"], `${path}.temperature`),
    timeoutMs: requiredInteger(llm["timeoutMs"], `${path}.timeoutMs`),
    retryCount: requiredInteger(llm["retryCount"], `${path}.retryCount`),
    responseFormatJson: optionalBoolean(
      llm["responseFormatJson"],
      `${path}.responseFormatJson`,
    ),
    extraBody:
      llm["extraBody"] === undefined
        ? undefined
        : asRecord(llm["extraBody"], `${path}.extraBody`),
  };
}

function parseRelationalStates(
  input: unknown,
  path: string,
): Record<string, RelationalState> | undefined {
  if (input === undefined) return undefined;
  const raw = asRecord(input, path);
  const result: Record<string, RelationalState> = {};
  for (const [agentId, value] of Object.entries(raw)) {
    result[agentId] = parseWithSchema<RelationalState>(
      RelationalStateSchema,
      value,
      `${path}.${agentId}`,
    );
  }
  return result;
}

function validateCrossReferences(config: SimulationAppConfig): void {
  const agentIds = new Set<string>();
  for (const agent of config.agents) {
    if (agentIds.has(agent.id))
      throw new Error(`Duplicate agent id: ${agent.id}`);
    agentIds.add(agent.id);
    if (agent.persona.id !== agent.promptProfile.personaId) {
      throw new Error(
        `Agent ${agent.id} persona.id must match promptProfile.personaId`,
      );
    }
  }

  const channelIds = new Set<string>();
  let defaultChannels = 0;
  for (const channel of config.channels) {
    if (channelIds.has(channel.id))
      throw new Error(`Duplicate channel id: ${channel.id}`);
    channelIds.add(channel.id);
    if (channel.default) defaultChannels += 1;
    for (const agentId of channel.memberAgentIds) {
      if (!agentIds.has(agentId))
        throw new Error(
          `Channel ${channel.id} references unknown agent: ${agentId}`,
        );
    }
  }
  if (defaultChannels > 1)
    throw new Error("Only one channel can be marked default");
  if (config.channels.length === 0)
    throw new Error("At least one channel is required");

  const gatewayIds = new Set<string>();
  for (const gateway of config.deliveryGateways) {
    if (gatewayIds.has(gateway.id))
      throw new Error(`Duplicate delivery gateway id: ${gateway.id}`);
    gatewayIds.add(gateway.id);
  }
  if (config.deliveryGateways.length === 0 && !config.debug?.stdoutDelivery) {
    throw new Error("At least one delivery gateway is required");
  }
}

function parseWithSchema<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { message: string } };
  },
  value: unknown,
  path: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
  return parsed.data;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  const values = asArray(value, path);
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== "string")
      throw new Error(`${path} must contain only strings`);
    result.push(item);
  }
  return result;
}

function asStringRecord(value: unknown, path: string): Record<string, string> {
  const record = asRecord(value, path);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string")
      throw new Error(`${path}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be a finite number`);
  return value;
}

function requiredInteger(value: unknown, path: string): number {
  const number = requiredNumber(value, path);
  if (!Number.isInteger(number)) throw new Error(`${path} must be an integer`);
  return number;
}

function optionalNullableInteger(
  value: unknown,
  path: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requiredInteger(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
