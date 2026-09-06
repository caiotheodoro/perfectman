/**
 * scenario `.md` → `CompiledScenario`, the neutral shape `assemble-config`
 * turns into a `SimulationAppConfig` plus the seeds config cannot carry.
 *
 * Same split as the persona format: structured data (cast, channels,
 * familiarity, prior events) is YAML in the frontmatter; the scene's prose
 * (room context, mood, intro behavior) is markdown sections. Per-agent
 * overrides live under `## Agent: <id>` subsections, because that is where an
 * author naturally writes "…but Bruno walked in thinking it was just a chat".
 */
import { parse as parseYaml } from "yaml";
import type { CoreMood, SocialEmotions } from "@perfectman/shared";
import type { AgentObjective, EventSeedSpec, MemorySeed } from "@perfectman/shared";
import { DiagnosticBag, type Diagnostic, fold, nearestHeading } from "./diagnostics.js";
import {
  MdParseError,
  findSection,
  parseMarkdown,
  sectionBullets,
  sectionText,
  type MdDocument,
  type MdSection,
} from "./md/document.js";
import { PAIR_FAMILIARITIES, type PairFamiliarity } from "./relational-seeding.js";

const KNOWN_HEADINGS = [
  "room context",
  "starting mood",
  "intro behavior",
  "first move",
  "notes",
] as const;

/** Subsection headings recognized under `## Agent: <id>`. */
const KNOWN_AGENT_HEADINGS = [
  "room context",
  "starting mood",
  "intro behavior",
  "host message",
  "hidden objective",
  "memories",
] as const;

const AGENT_HEADING = /^agent:\s*(.+)$/;

export type ChannelSpec = {
  id: string;
  type: string;
  name: string;
  memberAgentIds: string[];
  default?: boolean;
  createdBy?: string;
};

export type CastMember = {
  agentId: string;
  /** Uploaded persona filename, or the id of a persona pack shipped in the repo. */
  persona: string;
  displayName?: string;
  presence?: string;
  arrivalPulse?: number | null;
  mood?: Partial<CoreMood>;
  social?: Partial<SocialEmotions>;
  /** Per-agent scene overrides; unset fields fall back to the scene-wide prose. */
  roomContext?: string;
  startingMood?: string;
  introBehaviorInstruction?: string;
  hostStartingMessage?: string;
  hiddenObjective?: AgentObjective;
  /** Merged with the persona's own `## Memories` at assembly time. */
  memorySeeds: MemorySeed[];
};

export type CompiledScenario = {
  name: string;
  seed: number;
  maxPulses: number;
  /** Partial — `assemble-config` fills all seven required settings fields. */
  settings: Record<string, unknown>;
  channels: ChannelSpec[];
  familiarity: Record<string, PairFamiliarity>;
  cast: CastMember[];
  priorEvents: EventSeedSpec[];
  /** Scene-wide prose, the default for every agent's scenario context. */
  scene: {
    roomContext: string;
    startingMood: string;
    introBehaviorInstruction: string;
    firstMoveGuidance?: string;
    customNotes: string[];
  };
  languageOverride?: string;
  diagnostics: readonly Diagnostic[];
};

export type CompiledScenarioResult = CompiledScenario | { scenario: null; diagnostics: readonly Diagnostic[] };

const DEFAULT_MAX_PULSES = 24;
/** The receiver retains a full agent-state snapshot per agent per pulse. */
const MAX_PULSES_CEILING = 200;

export function compileScenarioMarkdown(
  text: string,
  filename: string,
): { scenario: CompiledScenario | null; diagnostics: readonly Diagnostic[] } {
  const bag = new DiagnosticBag(filename);

  let doc: MdDocument;
  try {
    doc = parseMarkdown(text);
  } catch (err) {
    if (err instanceof MdParseError) {
      bag.error(err.message, { line: err.line });
      return { scenario: null, diagnostics: bag.all };
    }
    throw err;
  }

  warnOnUnknownHeadings(doc, bag);

  const fm = doc.frontmatter;
  const name = str(fm["name"]) ?? str(fm["scenarioId"]) ?? "Untitled scenario";
  if (str(fm["name"]) === undefined) {
    bag.warn("Scenario frontmatter has no `name`; using a placeholder.", {
      line: doc.frontmatterLine,
      path: "name",
    });
  }

  const seed = int(fm["seed"], bag, "seed", doc.frontmatterLine);
  if (seed === undefined) {
    bag.error("Scenario frontmatter is missing `seed`.", {
      line: doc.frontmatterLine,
      path: "seed",
      hint: "`seed` makes a run reproducible — it drives the per-pulse agent ordering. Any integer works, e.g. `seed: 42`.",
    });
  }

  const maxPulses = resolveMaxPulses(fm["maxPulses"], bag, doc.frontmatterLine);
  const channels = parseChannels(fm["channels"], bag, doc.frontmatterLine);
  const familiarity = parseFamiliarity(fm["familiarity"], bag, doc.frontmatterLine);
  const priorEvents = parsePriorEvents(fm["priorEvents"], bag, doc.frontmatterLine);

  const scene = {
    roomContext: sectionText(findSection(doc, "room context")),
    startingMood: sectionText(findSection(doc, "starting mood")),
    introBehaviorInstruction: sectionText(findSection(doc, "intro behavior")),
    firstMoveGuidance: sectionText(findSection(doc, "first move")) || undefined,
    customNotes: sectionBullets(findSection(doc, "notes")).map((b) => b.text),
  };
  if (scene.roomContext.length === 0) {
    bag.error("Scenario has no `## Room Context` section.", {
      path: "scene.roomContext",
      hint: "Describe the situation the agents are walking into — it is injected into every agent's prompt.",
    });
  }
  if (scene.startingMood.length === 0) {
    bag.error("Scenario has no `## Starting Mood` section.", {
      path: "scene.startingMood",
      hint: "A few words are enough, e.g. `tense, too polite`.",
    });
  }

  const cast = parseCast(fm["cast"], doc, bag);
  if (cast.length === 0) {
    bag.error("Scenario frontmatter has no `cast`.", {
      line: doc.frontmatterLine,
      path: "cast",
      hint: "Add a `cast:` list of `{ agentId, persona }` entries naming who is in the scene.",
    });
  }

  validateCrossReferences({ cast, channels, familiarity, priorEvents }, bag, doc.frontmatterLine);

  if (bag.hasErrors) return { scenario: null, diagnostics: bag.all };

  return {
    scenario: {
      name,
      seed: seed ?? 0,
      maxPulses,
      settings: isRecord(fm["settings"]) ? fm["settings"] : {},
      channels,
      familiarity,
      cast,
      priorEvents,
      scene,
      languageOverride: str(fm["language"]),
      diagnostics: bag.all,
    },
    diagnostics: bag.all,
  };
}

function warnOnUnknownHeadings(doc: MdDocument, bag: DiagnosticBag): void {
  const known = new Set<string>(KNOWN_HEADINGS);
  for (const section of doc.sections) {
    const key = fold(section.heading);
    if (known.has(key) || AGENT_HEADING.test(key)) continue;
    const suggestion = nearestHeading(section.heading, KNOWN_HEADINGS);
    bag.warn(`Unrecognized section "## ${section.heading}" — its content is ignored.`, {
      line: section.line,
      ...(suggestion ? { hint: `Did you mean "## ${suggestion}"?` } : {}),
    });
  }
}

function resolveMaxPulses(value: unknown, bag: DiagnosticBag, line: number): number {
  if (value === undefined) {
    bag.info(`No \`maxPulses\` set; using ${DEFAULT_MAX_PULSES}.`, { line, path: "maxPulses" });
    return DEFAULT_MAX_PULSES;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    bag.error("`maxPulses` must be a positive integer.", { line, path: "maxPulses" });
    return DEFAULT_MAX_PULSES;
  }
  if (value > MAX_PULSES_CEILING) {
    bag.warn(
      `\`maxPulses: ${value}\` exceeds the ${MAX_PULSES_CEILING}-pulse ceiling; capped. The replay receiver holds a full agent-state snapshot per agent per pulse in memory.`,
      { line, path: "maxPulses" },
    );
    return MAX_PULSES_CEILING;
  }
  return value;
}

function parseChannels(value: unknown, bag: DiagnosticBag, line: number): ChannelSpec[] {
  if (value === undefined) {
    bag.error("Scenario frontmatter has no `channels`.", {
      line,
      path: "channels",
      hint: "Add at least one public channel, e.g. `channels: [{ id: geral, type: public_channel, name: geral, default: true, members: [ana, bruno] }]`.",
    });
    return [];
  }
  if (!Array.isArray(value)) {
    bag.error("`channels` must be a list.", { line, path: "channels" });
    return [];
  }
  const channels: ChannelSpec[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      bag.error(`channels[${index}] is not a mapping.`, { line, path: `channels[${index}]` });
      return;
    }
    const id = str(entry["id"]);
    const name = str(entry["name"]) ?? id;
    if (!id || !name) {
      bag.error(`channels[${index}] needs an \`id\`.`, { line, path: `channels[${index}].id` });
      return;
    }
    const members = Array.isArray(entry["members"])
      ? entry["members"].filter((m): m is string => typeof m === "string")
      : Array.isArray(entry["memberAgentIds"])
        ? entry["memberAgentIds"].filter((m): m is string => typeof m === "string")
        : [];
    if (members.length === 0) {
      bag.error(`Channel "${id}" has no members.`, { line, path: `channels[${index}].members` });
    }
    channels.push({
      id,
      name,
      type: str(entry["type"]) ?? "public_channel",
      memberAgentIds: members,
      ...(entry["default"] === true ? { default: true } : {}),
      ...(str(entry["createdBy"]) ? { createdBy: str(entry["createdBy"]) as string } : {}),
    });
  });

  const defaults = channels.filter((c) => c.default === true);
  if (channels.length > 0 && defaults.length === 0) {
    const first = channels[0];
    if (first) {
      first.default = true;
      bag.warn(`No channel is marked \`default: true\`; using "${first.id}".`, { line, path: "channels" });
    }
  } else if (defaults.length > 1) {
    bag.error(
      `${defaults.length} channels are marked \`default: true\` (${defaults.map((c) => c.id).join(", ")}); exactly one is allowed.`,
      { line, path: "channels" },
    );
  }
  return channels;
}

function parseFamiliarity(
  value: unknown,
  bag: DiagnosticBag,
  line: number,
): Record<string, PairFamiliarity> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    bag.warn("`familiarity` must be a mapping of `a:b: level`; ignored.", { line, path: "familiarity" });
    return {};
  }
  const result: Record<string, PairFamiliarity> = {};
  for (const [pair, level] of Object.entries(value)) {
    if (!pair.includes(":")) {
      bag.warn(`Familiarity key "${pair}" is not a pair — expected \`agentA:agentB\`.`, {
        line,
        path: `familiarity.${pair}`,
      });
      continue;
    }
    if (typeof level !== "string" || !PAIR_FAMILIARITIES.includes(level as PairFamiliarity)) {
      bag.warn(
        `Familiarity "${String(level)}" for "${pair}" is not one of ${PAIR_FAMILIARITIES.join("|")}; defaulting to acquaintances.`,
        { line, path: `familiarity.${pair}` },
      );
      continue;
    }
    result[pair] = level as PairFamiliarity;
  }
  return result;
}

function parsePriorEvents(value: unknown, bag: DiagnosticBag, line: number): EventSeedSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    bag.warn("`priorEvents` must be a list; ignored.", { line, path: "priorEvents" });
    return [];
  }
  const events: EventSeedSpec[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      bag.error(`priorEvents[${index}] is not a mapping.`, { line, path: `priorEvents[${index}]` });
      return;
    }
    const type = str(entry["type"]);
    const actorId = str(entry["actorId"]);
    const channelId = str(entry["channelId"]);
    if (!type || !actorId || !channelId) {
      bag.error(`priorEvents[${index}] needs \`type\`, \`actorId\` and \`channelId\`.`, {
        line,
        path: `priorEvents[${index}]`,
      });
      return;
    }
    events.push({
      type,
      actorId,
      channelId,
      pulseIndex: typeof entry["pulseIndex"] === "number" ? entry["pulseIndex"] : 0,
      ...(isRecord(entry["payload"]) ? { payload: entry["payload"] } : {}),
      ...(typeof entry["minutesAgo"] === "number" ? { minutesAgo: entry["minutesAgo"] } : {}),
    });
  });
  return events;
}

function parseCast(value: unknown, doc: MdDocument, bag: DiagnosticBag): CastMember[] {
  if (!Array.isArray(value)) return [];
  const overrides = collectAgentSections(doc, bag);
  const cast: CastMember[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      bag.error(`cast[${index}] is not a mapping.`, { path: `cast[${index}]` });
      return;
    }
    const agentId = str(entry["agentId"]) ?? str(entry["id"]);
    const persona = str(entry["persona"]) ?? str(entry["personaId"]);
    if (!agentId) {
      bag.error(`cast[${index}] needs an \`agentId\`.`, { path: `cast[${index}].agentId` });
      return;
    }
    if (!persona) {
      bag.error(`cast member "${agentId}" needs a \`persona\`.`, {
        path: `cast[${index}].persona`,
        hint: "Name the uploaded persona file (e.g. `iris.persona.md`) or a persona pack id shipped in the repo.",
      });
      return;
    }
    const override = overrides.get(agentId);
    cast.push({
      agentId,
      persona,
      ...(str(entry["displayName"]) ? { displayName: str(entry["displayName"]) as string } : {}),
      ...(str(entry["presence"]) ? { presence: str(entry["presence"]) as string } : {}),
      ...(entry["arrivalPulse"] === null || typeof entry["arrivalPulse"] === "number"
        ? { arrivalPulse: entry["arrivalPulse"] as number | null }
        : {}),
      ...(isRecord(entry["mood"]) ? { mood: entry["mood"] as Partial<CoreMood> } : {}),
      ...(isRecord(entry["social"]) ? { social: entry["social"] as Partial<SocialEmotions> } : {}),
      ...override,
      memorySeeds: override?.memorySeeds ?? [],
    });
  });

  for (const agentId of overrides.keys()) {
    if (!cast.some((c) => c.agentId === agentId)) {
      bag.warn(`\`## Agent: ${agentId}\` does not match any cast member — its content is ignored.`, {
        path: `cast`,
        hint: "Agent sections are keyed by `agentId` from the frontmatter `cast` list.",
      });
    }
  }
  return cast;
}

type AgentOverride = Partial<Omit<CastMember, "agentId" | "persona">> & { memorySeeds?: MemorySeed[] };

function collectAgentSections(doc: MdDocument, bag: DiagnosticBag): Map<string, AgentOverride> {
  const result = new Map<string, AgentOverride>();
  for (const section of doc.sections) {
    const match = AGENT_HEADING.exec(fold(section.heading));
    if (!match) continue;
    const agentId = (match[1] ?? "").trim();
    if (agentId.length === 0) {
      bag.warn(`"## ${section.heading}" has no agent id after the colon.`, { line: section.line });
      continue;
    }
    result.set(agentId, parseAgentSection(section, agentId, bag));
  }
  return result;
}

function parseAgentSection(section: MdSection, agentId: string, bag: DiagnosticBag): AgentOverride {
  const override: AgentOverride = {};
  const known = new Set<string>(KNOWN_AGENT_HEADINGS);

  for (const sub of section.subsections) {
    const key = fold(sub.heading);
    if (!known.has(key)) {
      const suggestion = nearestHeading(sub.heading, KNOWN_AGENT_HEADINGS);
      bag.warn(`Unrecognized "### ${sub.heading}" under \`## Agent: ${agentId}\` — ignored.`, {
        line: sub.line,
        ...(suggestion ? { hint: `Did you mean "### ${suggestion}"?` } : {}),
      });
      continue;
    }
    const text = sectionText(sub);
    switch (key) {
      case "room context":
        override.roomContext = text;
        break;
      case "starting mood":
        override.startingMood = text;
        break;
      case "intro behavior":
        override.introBehaviorInstruction = text;
        break;
      case "host message":
        override.hostStartingMessage = text;
        break;
      case "hidden objective":
        override.hiddenObjective = parseHiddenObjective(sub, agentId, bag);
        break;
      case "memories":
        override.memorySeeds = parseMemoriesBlock(sub, agentId, bag);
        break;
    }
  }
  return override;
}

/**
 * `### Hidden Objective` prose, with `#### Constraint` / `#### Cost Of Exposure`
 * / `#### Breaking Point` as `key: value` bullets or lines beneath it. Kept
 * flat because four-deep headings are miserable to write.
 */
function parseHiddenObjective(
  section: MdSection,
  agentId: string,
  bag: DiagnosticBag,
): AgentObjective | undefined {
  const lines = section.body.map((l) => l.trim()).filter((l) => l.length > 0);
  const fields: Record<string, string> = {};
  const description: string[] = [];

  for (const line of lines) {
    const labelled = /^(?:####\s*|[-*]\s*)?(constraint|resource|scarce resource|cost of exposure|breaking point)\s*:\s*(.+)$/i.exec(
      line,
    );
    if (labelled) {
      fields[fold(labelled[1] ?? "")] = (labelled[2] ?? "").trim();
      continue;
    }
    description.push(line.replace(/^#+\s*/, ""));
  }

  // `(resource: x)` written inline at the end of the description.
  const joined = description.join(" ").trim();
  const inline = /\(resource:\s*([^)]+)\)\s*$/i.exec(joined);
  const descriptionText = inline ? joined.slice(0, inline.index).trim() : joined;
  const scarceResourceId =
    fields["resource"] ?? fields["scarce resource"] ?? (inline ? (inline[1] ?? "").trim() : undefined);

  if (descriptionText.length === 0) {
    bag.warn(`\`### Hidden Objective\` for "${agentId}" has no description — ignored.`, {
      line: section.line,
    });
    return undefined;
  }
  if (!scarceResourceId) {
    bag.error(`Hidden objective for "${agentId}" has no scarce resource.`, {
      line: section.line,
      path: `cast.${agentId}.hiddenObjective.scarceResourceId`,
      hint: "Add `(resource: the_invite)` at the end of the description, or a `Resource: the_invite` line. Two agents sharing a resource id are in structural conflict — that is what creates the tension.",
    });
    return undefined;
  }
  if (!fields["constraint"]) {
    bag.warn(
      `Hidden objective for "${agentId}" has no constraint — without one it is flavor text, not a pressure.`,
      {
        line: section.line,
        path: `cast.${agentId}.hiddenObjective.constraint`,
        hint: "Add `Constraint: <the thing they can never say while pursuing this>`.",
      },
    );
  }

  return {
    description: descriptionText,
    scarceResourceId,
    ...(fields["constraint"] ? { constraint: fields["constraint"] } : {}),
    ...(fields["cost of exposure"] ? { costOfExposure: fields["cost of exposure"] } : {}),
    ...(fields["breaking point"] ? { breakingPoint: fields["breaking point"] } : {}),
  };
}

function parseMemoriesBlock(section: MdSection, agentId: string, bag: DiagnosticBag): MemorySeed[] {
  const body = section.body.join("\n");
  const fence = /```(?:ya?ml)?\s*\n([\s\S]*?)```/.exec(body);
  if (!fence) {
    if (body.trim().length > 0) {
      bag.warn(`\`### Memories\` for "${agentId}" has no \`\`\`yaml block — its content is ignored.`, {
        line: section.line,
      });
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(fence[1] ?? "");
  } catch (err) {
    bag.error(`\`### Memories\` for "${agentId}" contains invalid YAML: ${(err as Error).message}`, {
      line: section.line,
    });
    return [];
  }
  if (!Array.isArray(parsed)) {
    bag.error(`\`### Memories\` for "${agentId}" must be a YAML list.`, { line: section.line });
    return [];
  }
  const seeds: MemorySeed[] = [];
  parsed.forEach((entry, index) => {
    if (!isRecord(entry)) {
      bag.error(`Memory #${index + 1} for "${agentId}" is not a mapping.`, { line: section.line });
      return;
    }
    const summary = str(entry["summary"]);
    const type = str(entry["type"]);
    if (!summary || !type) {
      bag.error(`Memory #${index + 1} for "${agentId}" needs \`type\` and \`summary\`.`, {
        line: section.line,
      });
      return;
    }
    seeds.push({
      type: type as MemorySeed["type"],
      subjectAgentIds: Array.isArray(entry["subjectAgentIds"])
        ? entry["subjectAgentIds"].filter((s): s is string => typeof s === "string")
        : [],
      summary,
      emotionalTone: str(entry["emotionalTone"]) ?? "neutral",
      confidence: typeof entry["confidence"] === "number" ? entry["confidence"] : 0.8,
      ...(typeof entry["intensity"] === "number" ? { intensity: entry["intensity"] } : {}),
      unresolved: entry["unresolved"] === true,
    });
  });
  return seeds;
}

function validateCrossReferences(
  input: {
    cast: CastMember[];
    channels: ChannelSpec[];
    familiarity: Record<string, PairFamiliarity>;
    priorEvents: EventSeedSpec[];
  },
  bag: DiagnosticBag,
  line: number,
): void {
  const castIds = new Set(input.cast.map((c) => c.agentId));
  const channelIds = new Set(input.channels.map((c) => c.id));

  const duplicates = input.cast
    .map((c) => c.agentId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  for (const id of new Set(duplicates)) {
    bag.error(`Cast member "${id}" is listed more than once.`, { line, path: "cast" });
  }

  for (const channel of input.channels) {
    for (const member of channel.memberAgentIds) {
      if (!castIds.has(member)) {
        bag.error(`Channel "${channel.id}" lists "${member}", who is not in the cast.`, {
          line,
          path: `channels.${channel.id}.members`,
        });
      }
    }
  }

  for (const member of input.cast) {
    const inAny = input.channels.some((c) => c.memberAgentIds.includes(member.agentId));
    if (!inAny) {
      bag.error(`Cast member "${member.agentId}" is not in any channel.`, {
        line,
        path: `cast.${member.agentId}`,
        hint: "An agent with no channel can never see or send anything.",
      });
    }
  }

  for (const pair of Object.keys(input.familiarity)) {
    for (const side of pair.split(":")) {
      if (!castIds.has(side.trim())) {
        bag.warn(`Familiarity pair "${pair}" names "${side.trim()}", who is not in the cast.`, {
          line,
          path: `familiarity.${pair}`,
        });
      }
    }
  }

  input.priorEvents.forEach((event, index) => {
    if (!castIds.has(event.actorId)) {
      bag.error(`priorEvents[${index}] is authored by "${event.actorId}", who is not in the cast.`, {
        line,
        path: `priorEvents[${index}].actorId`,
      });
    }
    if (!channelIds.has(event.channelId)) {
      bag.error(`priorEvents[${index}] targets channel "${event.channelId}", which does not exist.`, {
        line,
        path: `priorEvents[${index}].channelId`,
      });
    }
  });

  // Two agents contending over the same resource is the designed way to create
  // tension; one agent alone with a "scarce" resource usually means a typo.
  const byResource = new Map<string, string[]>();
  for (const member of input.cast) {
    const resource = member.hiddenObjective?.scarceResourceId;
    if (!resource) continue;
    byResource.set(resource, [...(byResource.get(resource) ?? []), member.agentId]);
  }
  for (const [resource, agents] of byResource) {
    if (agents.length === 1) {
      bag.info(
        `Only "${agents[0]}" contends for resource "${resource}" — no structural collision was created.`,
        { line, path: "cast", hint: "Give another agent the same `resource:` id to put them in conflict." },
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function int(value: unknown, bag: DiagnosticBag, path: string, line: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    bag.error(`\`${path}\` must be an integer.`, { line, path });
    return undefined;
  }
  return value;
}
