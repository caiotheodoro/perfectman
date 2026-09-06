/**
 * `CompiledScenario` + `PersonaPack`s → `SimulationAppConfig` + `RunSeeds`.
 *
 * The one place the two authored documents are joined. Modelled directly on
 * `scenarioToConfig` (packages/eval/src/run/scenario-runner.ts:362), which is
 * the proven translator from an authored scene into a runnable config.
 *
 * Two things deliberately do *not* come out as config, because config cannot
 * carry them: seed memories (`parseAgents` drops `initialMemories`) and prior
 * events. They come back as `RunSeeds`, applied to the repositories after the
 * simulation is built.
 */
import type {
  CoreMood,
  EventSeedSpec,
  MemorySeed,
  PersonaPack,
  SocialEmotions,
} from "@perfectman/shared";
import { personaPackToProfile } from "../agent/persona-loader.js";
import { inflatePersonaConfig } from "../config/simulation-config.js";
import type { AgentConfig, ConfigPersona, SimulationAppConfig } from "../config/simulation-config.js";
import type { LLMConfig } from "../llm/llm-config.js";
import { DiagnosticBag, type Diagnostic } from "./diagnostics.js";
import type { CompiledPersona } from "./persona-md-compiler.js";
import type { CastMember, CompiledScenario } from "./scenario-md-compiler.js";
import { buildRelationalStates } from "./relational-seeding.js";

/** What the config schema cannot express, applied to repositories post-build. */
export type RunSeeds = {
  memoriesByAgent: Record<string, MemorySeed[]>;
  priorEvents: EventSeedSpec[];
};

export type AssembleInput = {
  scenario: CompiledScenario;
  /** Keyed by whatever the cast's `persona` field names — filename or pack id. */
  personas: Map<string, CompiledPersona>;
  /** Applied to every agent; the UI's provider picker owns this, not the markdown. */
  llm: LLMConfig;
  /** Fresh per run — never reuse `config/index.json`'s pinned `local-dev`. */
  simulationId: string;
};

export type AssembleResult = {
  config: SimulationAppConfig | null;
  seeds: RunSeeds;
  diagnostics: readonly Diagnostic[];
};

const DEFAULT_SETTINGS = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 30,
  llmCallBudgetPerMinute: 200,
  // Production pacing. This is the *simulated* clock the emotion math reads,
  // not how fast the server drives pulses — the run loop never sleeps on it.
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
} as const;

const PULSE_INTERVAL_MIN = 500;
const PULSE_INTERVAL_MAX = 10_000;

export function assembleSimulationConfig(input: AssembleInput): AssembleResult {
  const { scenario, personas, llm, simulationId } = input;
  const bag = new DiagnosticBag("<assembled>");

  const castAgentIds = scenario.cast.map((c) => c.agentId);
  const castDisplayNames = Object.fromEntries(
    scenario.cast.map((c) => [
      c.agentId,
      c.displayName ?? personas.get(c.persona)?.pack?.displayName ?? c.agentId,
    ]),
  );

  const memoriesByAgent: Record<string, MemorySeed[]> = {};
  const agents: AgentConfig[] = [];

  for (const member of scenario.cast) {
    const compiled = personas.get(member.persona);
    if (!compiled?.pack) {
      bag.error(`Cast member "${member.agentId}" references persona "${member.persona}", which was not supplied.`, {
        path: `cast.${member.agentId}.persona`,
        hint: "Upload a persona file whose name matches, or name a persona pack shipped in the repo.",
      });
      continue;
    }
    const pack = compiled.pack;

    // Seed memories come from both documents: the persona carries the ones that
    // are true of it anywhere, the scene adds the ones that are true here.
    const seeded = [...pack.memorySeeds, ...member.memorySeeds];
    if (seeded.length > 0) memoriesByAgent[member.agentId] = seeded;

    const scenarioContext = {
      roomContext: member.roomContext ?? scenario.scene.roomContext,
      startingMood: member.startingMood ?? scenario.scene.startingMood,
      introBehaviorInstruction:
        member.introBehaviorInstruction ?? scenario.scene.introBehaviorInstruction,
      ...(scenario.scene.firstMoveGuidance ? { firstMoveGuidance: scenario.scene.firstMoveGuidance } : {}),
      ...(scenario.scene.customNotes.length > 0 ? { customNotes: scenario.scene.customNotes } : {}),
      ...(member.hostStartingMessage ? { hostStartingMessage: member.hostStartingMessage } : {}),
      displayName: castDisplayNames[member.agentId] ?? member.agentId,
      castMap: buildCastMap(pack, member, scenario.cast),
    };

    let promptProfile = personaPackToProfile(pack, {
      scenarioContext,
      castAgentIds,
      castDisplayNames,
      // The scene's memories are the ones in play; the pack's own unresolved
      // lines would describe a history this room never had.
      replacesMemories: seeded.length > 0,
    });
    const persona = configPersona(member, compiled, bag);
    // The validator requires `persona.id === promptProfile.personaId`; the
    // persona id is the calibration key, so the profile follows it rather than
    // the other way round.
    promptProfile = { ...promptProfile, personaId: persona.id, scenarioContext };
    if (member.hiddenObjective) {
      promptProfile = { ...promptProfile, hiddenObjective: member.hiddenObjective };
    }

    agents.push({
      id: member.agentId,
      presence: (member.presence ?? "active") as AgentConfig["presence"],
      persona,
      promptProfile,
      llm,
      initialCoreMood: fullMood(member.mood, persona),
      initialSocialEmotions: fullSocial(member.social),
      relationalStates: buildRelationalStates(member.agentId, castAgentIds, scenario.familiarity),
      arrivalPulse: member.arrivalPulse ?? null,
    });
  }

  if (bag.hasErrors) {
    return { config: null, seeds: { memoriesByAgent, priorEvents: scenario.priorEvents }, diagnostics: bag.all };
  }

  const config: SimulationAppConfig = {
    simulation: {
      id: simulationId,
      name: scenario.name,
      seed: scenario.seed,
      settings: resolveSettings(scenario.settings, bag),
    },
    persistence: { type: "memory" },
    // Operator events carry the thinking and per-pulse emotion the viewer is
    // built around; without this the stream is just a transcript.
    debug: { operatorEvents: true, pulseMetrics: true },
    // Empty by design: the web run injects its gateways as instances, since a
    // live SSE connection has no file representation.
    deliveryGateways: [],
    channels: scenario.channels.map((ch) => ({
      id: ch.id,
      type: ch.type as SimulationAppConfig["channels"][number]["type"],
      name: ch.name,
      memberAgentIds: ch.memberAgentIds,
      default: ch.default === true,
      ...(ch.createdBy ? { createdBy: ch.createdBy } : {}),
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
    })),
    agents,
  };

  return {
    config,
    seeds: { memoriesByAgent, priorEvents: scenario.priorEvents },
    diagnostics: bag.all,
  };
}

/**
 * `ConfigPersona.id` doubles as the calibration key: `inflatePersonaConfig`
 * looks it up against the canonical persona table, and falls back to
 * `DEFAULT_PERSONA_CALIBRATION` when it doesn't match. That lookup is the only
 * route from authored input to the 19 engine calibration fields, which config
 * hard-rejects if written directly.
 */
function configPersona(
  member: CastMember,
  compiled: CompiledPersona,
  bag: DiagnosticBag,
): ConfigPersona {
  const pack = compiled.pack as PersonaPack;
  // Falls back to the pack's own id, not the agent id: a pack re-skinned onto
  // a differently-named character keeps its persona identity.
  const id = compiled.calibrationFrom ?? pack.personaId;
  if (compiled.calibrationFrom) {
    const inflated = inflatePersonaConfig({
      id,
      name: pack.displayName,
      archetype: pack.archetype,
      writingStyle: compiled.writingStyle,
      styleExamples: pack.styleExamples,
    });
    // inflatePersonaConfig silently falls back; say which source was used so an
    // author isn't left believing a typo'd id inherited a temperament.
    const matched = inflated.baselineValence !== 0 || inflated.emotionalReactivity !== 1;
    bag.info(
      matched
        ? `"${member.agentId}" inherits engine calibration from the canonical persona "${compiled.calibrationFrom}".`
        : `"${member.agentId}" declares \`calibrationFrom: ${compiled.calibrationFrom}\`, which is not a canonical persona; default calibration is used.`,
      { path: `cast.${member.agentId}.calibrationFrom` },
    );
  }
  return {
    id,
    name: pack.displayName,
    archetype: pack.archetype,
    writingStyle: compiled.writingStyle,
    styleExamples: pack.styleExamples,
  };
}

/**
 * A pack's relationship biases are written about its own friends. When a pack
 * is re-skinned onto a different cast, peers that map onto someone present
 * survive under the cast's id; the rest are dropped rather than rendered as
 * phantom people the room never contained.
 */
function buildCastMap(
  pack: PersonaPack,
  member: CastMember,
  cast: readonly CastMember[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const peer of Object.keys(pack.relationshipBiases)) {
    if (peer === member.agentId) continue;
    const present = cast.find((c) => c.agentId === peer || c.persona === peer);
    if (present) map[peer] = present.agentId;
  }
  return map;
}

/**
 * `CoreMoodSchema` is strict, so a partial authored mood has to be completed.
 * Unspecified fields come from the persona's calibrated baselines rather than
 * a flat neutral, so naming one field doesn't silently reset the others.
 */
function fullMood(partial: Partial<CoreMood> | undefined, persona: ConfigPersona): CoreMood {
  const inflated = inflatePersonaConfig(persona);
  const valence = partial?.valence ?? inflated.baselineValence;
  const arousal = partial?.arousal ?? inflated.baselineArousal;
  return {
    valence,
    arousal,
    stability: partial?.stability ?? inflated.baselineStability,
    energy: partial?.energy ?? inflated.baselineEnergy,
    circumplexAngle: partial?.circumplexAngle ?? 0,
    circumplexRadius: partial?.circumplexRadius ?? Math.min(1, Math.abs(valence) + arousal / 2),
    momentumValence: partial?.momentumValence ?? 0,
    momentumArousal: partial?.momentumArousal ?? 0,
  };
}

/** `SocialEmotionsSchema` is strict; every dimension starts at rest. */
const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0,
  neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0,
  desireForIntimacy: 0,
};

function fullSocial(partial: Partial<SocialEmotions> | undefined): SocialEmotions {
  return { ...ZERO_SOCIAL, ...(partial ?? {}) };
}

function resolveSettings(
  authored: Record<string, unknown>,
  bag: DiagnosticBag,
): SimulationAppConfig["simulation"]["settings"] {
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(authored)) {
    if (!(key in settings)) {
      bag.warn(`Unknown setting \`${key}\` — ignored.`, { path: `settings.${key}` });
      continue;
    }
    if (typeof value !== (typeof settings[key as keyof typeof settings])) {
      bag.warn(`Setting \`${key}\` has the wrong type — using the default.`, { path: `settings.${key}` });
      continue;
    }
    (settings as Record<string, unknown>)[key] = value;
  }
  if (settings.pulseIntervalMs < PULSE_INTERVAL_MIN || settings.pulseIntervalMs > PULSE_INTERVAL_MAX) {
    bag.warn(
      `\`pulseIntervalMs\` must be between ${PULSE_INTERVAL_MIN} and ${PULSE_INTERVAL_MAX}; using ${DEFAULT_SETTINGS.pulseIntervalMs}.`,
      { path: "settings.pulseIntervalMs" },
    );
    settings.pulseIntervalMs = DEFAULT_SETTINGS.pulseIntervalMs;
  }
  return settings;
}
