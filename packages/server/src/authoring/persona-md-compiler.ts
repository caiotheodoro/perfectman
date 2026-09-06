/**
 * persona `.md` → `PersonaPack`.
 *
 * `PersonaPack` is the authored source of truth the repo already models
 * (packages/shared/src/persona/persona-pack.types.ts), and `personaPackToProfile`
 * already compiles it into the LLM-facing prompt profile. So the markdown only
 * has to reach the pack; everything downstream is existing, tested code.
 *
 * Structured data (memories, triggers, sampling, presence) is YAML — either in
 * frontmatter or a fenced ```yaml block under a known heading. Prose sections
 * carry free text only. That split is what keeps the format unambiguous: there
 * is no bespoke mini-grammar to guess at.
 */
import { parse as parseYaml } from "yaml";
import type {
  ChaosCap,
  EdgeProfile,
  MemorySeed,
  PendingIntention,
  PersonaPack,
  PresenceProfile,
} from "@perfectman/shared";
import { DiagnosticBag, type Diagnostic, fold, nearestHeading } from "./diagnostics.js";
import {
  MdParseError,
  findSection,
  parseMarkdown,
  sectionBullets,
  sectionText,
  splitKeyValue,
  type MdDocument,
  type MdSection,
} from "./md/document.js";
import { resolveLanguage, type LanguageDetection } from "./language-detect.js";

/** Every heading the persona format recognizes, folded. Anything else warns. */
const KNOWN_HEADINGS = [
  "identity",
  "voice",
  "style examples",
  "social theory",
  "relationships",
  "memories",
  "pending intentions",
  "triggers",
  "mask tells",
  "impulses",
  "private motives",
  "hard limits",
] as const;

const DEFAULT_PRESENCE: PresenceProfile = {
  responseDelayMs: [800, 4000],
  silenceTolerancePulses: 3,
  messageLength: "medium",
  punctuationTells: [],
};

const DEFAULT_SAMPLING: PersonaPack["sampling"] = {
  temperature: 0.85,
  repetitionPenalty: 1.1,
  topP: 0.9,
  maxTokens: 512,
};

const CHAOS_CAPS: readonly ChaosCap[] = ["low", "medium", "high"];
const MESSAGE_LENGTHS: readonly PresenceProfile["messageLength"][] = [
  "short",
  "medium",
  "long",
  "rapid_fire",
];

export type CompiledPersona = {
  /** null when the markdown could not be parsed at all; diagnostics say why. */
  pack: PersonaPack | null;
  /** `ConfigPersona.writingStyle` — the one config field the pack has no slot for. */
  writingStyle: string;
  /**
   * Canonical persona id to inherit the 19 engine calibration fields from.
   * Those fields are hard-rejected in config (`rejectSimulationCalibrationFields`),
   * so this is the only way to reach them from authored input.
   */
  calibrationFrom: string | undefined;
  language: LanguageDetection | null;
  diagnostics: readonly Diagnostic[];
};

export function compilePersonaMarkdown(
  text: string,
  filename: string,
  options: { languageOverride?: string } = {},
): CompiledPersona {
  const bag = new DiagnosticBag(filename);

  let doc: MdDocument;
  try {
    doc = parseMarkdown(text);
  } catch (err) {
    if (err instanceof MdParseError) {
      bag.error(err.message, { line: err.line });
      return { pack: null, writingStyle: "", calibrationFrom: undefined, language: null, diagnostics: bag.all };
    }
    throw err;
  }

  warnOnUnknownHeadings(doc, bag);

  const fm = doc.frontmatter;
  const personaId = requiredString(fm["personaId"] ?? fm["id"], "personaId", bag, doc);
  const displayName = requiredString(fm["displayName"] ?? fm["name"], "displayName", bag, doc);
  const archetype = requiredString(fm["archetype"], "archetype", bag, doc);

  const identity = findSection(doc, "identity");
  const identityFrame = sectionText(identity);
  if (identityFrame.length === 0) {
    bag.error("Persona has no `## Identity` section.", {
      path: "identityFrame",
      hint: "Add a `## Identity` section written in the first person — it becomes the persona's identity frame in the prompt.",
    });
  }

  const voiceGuidelines = sectionBullets(findSection(doc, "voice")).map((b) => b.text);
  if (voiceGuidelines.length === 0) {
    bag.error("Persona has no `## Voice` bullets.", {
      path: "voiceGuidelines",
      hint: "Add `## Voice` with one bullet per guideline describing how this persona speaks.",
    });
  }

  const styleExamples = sectionBullets(findSection(doc, "style examples")).map((b) => b.text);
  if (styleExamples.length < 3) {
    bag.error(`Persona has ${styleExamples.length} style example(s); at least 3 are needed.`, {
      path: "styleExamples",
      line: findSection(doc, "style examples")?.line,
      hint: "Add `## Style Examples` bullets — actual lines this persona would send. They anchor the voice far more than adjectives do.",
    });
  }

  const language = resolveLanguage({
    explicit: typeof fm["language"] === "string" ? fm["language"] : undefined,
    override: options.languageOverride,
    proseForDetection: [identityFrame, ...voiceGuidelines, ...styleExamples].join("\n"),
  });
  if (language.invalidExplicit !== undefined) {
    bag.warn(
      `\`language: ${language.invalidExplicit}\` is not a supported value; detected \`${language.language}\` instead.`,
      { path: "language", hint: 'Supported values are "pt-BR" and "en".' },
    );
  }

  const relationshipBiases = parseRelationships(findSection(doc, "relationships"), bag);
  const memorySeeds = parseYamlSection<MemorySeed>(doc, "memories", bag, validateMemorySeed);
  const pendingIntentions = parseYamlSection<PendingIntention>(
    doc,
    "pending intentions",
    bag,
    validatePendingIntention,
  );
  const edgeProfile = parseEdgeProfile(doc, fm, bag);

  const pack: PersonaPack = {
    personaId,
    displayName,
    archetype,
    identityFrame,
    voiceGuidelines,
    styleExamples,
    relationshipBiases,
    language: language.language,
    memorySeeds,
    pendingIntentions,
    socialTheory: sectionBullets(findSection(doc, "social theory")).map((b) => b.text),
    edgeProfile,
    presenceProfile: parsePresence(fm, bag),
    sampling: parseSampling(fm, bag),
  };

  // Authored but not consumed by personaPackToProfile — say so rather than let
  // an author tune a knob that is wired to nothing.
  if (pack.pendingIntentions.length > 0) {
    bag.info("`## Pending Intentions` is recorded on the pack but is not yet read by the prompt compiler.", {
      path: "pendingIntentions",
    });
  }

  const writingStyle =
    optionalString(fm["writingStyle"]) ?? voiceGuidelines[0] ?? `${archetype} voice`;

  return {
    pack,
    writingStyle,
    calibrationFrom: optionalString(fm["calibrationFrom"]),
    language,
    diagnostics: bag.all,
  };
}

function warnOnUnknownHeadings(doc: MdDocument, bag: DiagnosticBag): void {
  const known = new Set<string>(KNOWN_HEADINGS);
  for (const section of doc.sections) {
    const key = fold(section.heading);
    if (known.has(key)) continue;
    const suggestion = nearestHeading(section.heading, KNOWN_HEADINGS);
    bag.warn(`Unrecognized section "## ${section.heading}" — its content is ignored.`, {
      line: section.line,
      ...(suggestion ? { hint: `Did you mean "## ${suggestion}"?` } : {}),
    });
  }
}

function parseRelationships(section: MdSection | undefined, bag: DiagnosticBag): Record<string, string> {
  const result: Record<string, string> = {};
  for (const bullet of sectionBullets(section)) {
    const pair = splitKeyValue(bullet.text, "first");
    if (!pair) {
      bag.warn(`Relationship bullet is not \`agentId: description\` — ignored.`, {
        line: bullet.line,
        path: "relationshipBiases",
        hint: "Write e.g. `- bruno: thinks he performs for the room`.",
      });
      continue;
    }
    result[pair.key] = pair.value;
  }
  return result;
}

/** Reads a fenced ```yaml block from a section and validates each entry. */
function parseYamlSection<T>(
  doc: MdDocument,
  heading: string,
  bag: DiagnosticBag,
  validate: (value: unknown, index: number, bag: DiagnosticBag, line: number) => T | undefined,
): T[] {
  const section = findSection(doc, heading);
  if (!section) return [];
  const body = section.body.join("\n");
  const fence = /```(?:ya?ml)?\s*\n([\s\S]*?)```/.exec(body);
  if (!fence) {
    if (body.trim().length > 0) {
      bag.warn(`\`## ${section.heading}\` has no \`\`\`yaml block — its content is ignored.`, {
        line: section.line,
        hint: "Structured entries must be written as a fenced yaml list so they parse unambiguously.",
      });
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(fence[1] ?? "");
  } catch (err) {
    bag.error(`\`## ${section.heading}\` contains invalid YAML: ${(err as Error).message}`, {
      line: section.line,
    });
    return [];
  }
  if (!Array.isArray(parsed)) {
    bag.error(`\`## ${section.heading}\` must be a YAML list.`, { line: section.line });
    return [];
  }
  const out: T[] = [];
  parsed.forEach((entry, index) => {
    const value = validate(entry, index, bag, section.line);
    if (value !== undefined) out.push(value);
  });
  return out;
}

function validateMemorySeed(
  value: unknown,
  index: number,
  bag: DiagnosticBag,
  line: number,
): MemorySeed | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    bag.error(`Memory #${index + 1} is not a mapping.`, { line, path: `memorySeeds[${index}]` });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const summary = optionalString(raw["summary"]);
  if (!summary) {
    bag.error(`Memory #${index + 1} has no \`summary\`.`, { line, path: `memorySeeds[${index}].summary` });
    return undefined;
  }
  const type = optionalString(raw["type"]);
  if (!type) {
    bag.error(`Memory #${index + 1} has no \`type\`.`, {
      line,
      path: `memorySeeds[${index}].type`,
      hint: "e.g. `type: episodic` or `type: relationship`.",
    });
    return undefined;
  }
  const subjects = Array.isArray(raw["subjectAgentIds"])
    ? raw["subjectAgentIds"].filter((s): s is string => typeof s === "string")
    : [];
  const confidence = clamped(raw["confidence"], 0.8, `memorySeeds[${index}].confidence`, bag, line);
  const intensity =
    raw["intensity"] === undefined
      ? undefined
      : clamped(raw["intensity"], 0, `memorySeeds[${index}].intensity`, bag, line);

  return {
    type: type as MemorySeed["type"],
    subjectAgentIds: subjects,
    summary,
    emotionalTone: optionalString(raw["emotionalTone"]) ?? "neutral",
    confidence,
    ...(intensity === undefined ? {} : { intensity }),
    unresolved: raw["unresolved"] === true,
  };
}

function validatePendingIntention(
  value: unknown,
  index: number,
  bag: DiagnosticBag,
  line: number,
): PendingIntention | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    bag.error(`Pending intention #${index + 1} is not a mapping.`, { line });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const summary = optionalString(raw["summary"]);
  if (!summary) {
    bag.error(`Pending intention #${index + 1} has no \`summary\`.`, { line });
    return undefined;
  }
  const urgency = optionalString(raw["urgency"]) ?? "medium";
  if (urgency !== "low" && urgency !== "medium" && urgency !== "high") {
    bag.warn(`Pending intention #${index + 1} has urgency "${urgency}"; using "medium".`, { line });
  }
  return {
    summary,
    urgency: urgency === "low" || urgency === "high" ? urgency : "medium",
    source: optionalString(raw["source"]) ?? "authored",
  };
}

function parseEdgeProfile(
  doc: MdDocument,
  fm: Record<string, unknown>,
  bag: DiagnosticBag,
): EdgeProfile {
  const chaosCapRaw = optionalString(fm["chaosCap"]);
  let chaosCap: ChaosCap = "medium";
  if (chaosCapRaw !== undefined) {
    if (CHAOS_CAPS.includes(chaosCapRaw as ChaosCap)) {
      chaosCap = chaosCapRaw as ChaosCap;
    } else {
      bag.warn(`\`chaosCap: ${chaosCapRaw}\` is not one of low|medium|high; using "medium".`, {
        path: "edgeProfile.chaosCap",
      });
    }
  }

  const triggers = parseYamlSection<EdgeProfile["triggers"][number]>(doc, "triggers", bag, (value, index, b, line) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      b.error(`Trigger #${index + 1} is not a mapping.`, { line });
      return undefined;
    }
    const raw = value as Record<string, unknown>;
    const trigger = optionalString(raw["trigger"]);
    const behavior = optionalString(raw["behavior"]);
    if (!trigger || !behavior) {
      b.error(`Trigger #${index + 1} needs both \`trigger\` and \`behavior\`.`, { line });
      return undefined;
    }
    return {
      trigger,
      behavior,
      pressure: optionalString(raw["pressure"]) ?? "unspecified",
      // Not a [0,1] value: the shipped packs use 1.4–2.8 as pressure multipliers.
      sensitivity: positive(raw["sensitivity"], 1, `edgeProfile.triggers[${index}].sensitivity`, b, line),
    };
  });

  return {
    chaosCap,
    impulseBehaviors: sectionBullets(findSection(doc, "impulses")).map((b) => b.text),
    triggers,
    maskTells: sectionBullets(findSection(doc, "mask tells")).map((b) => b.text),
    privateMotiveLexicon: sectionBullets(findSection(doc, "private motives")).map((b) => b.text),
    hardLimits: sectionBullets(findSection(doc, "hard limits")).map((b) => b.text),
  };
}

function parsePresence(fm: Record<string, unknown>, bag: DiagnosticBag): PresenceProfile {
  const raw = fm["presence"];
  if (raw === undefined) return { ...DEFAULT_PRESENCE };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bag.warn("`presence` is not a mapping; using defaults.", { path: "presenceProfile" });
    return { ...DEFAULT_PRESENCE };
  }
  const value = raw as Record<string, unknown>;
  const delay = value["responseDelayMs"];
  let responseDelayMs = DEFAULT_PRESENCE.responseDelayMs;
  if (Array.isArray(delay) && delay.length === 2 && delay.every((n) => typeof n === "number")) {
    responseDelayMs = [delay[0] as number, delay[1] as number];
  } else if (delay !== undefined) {
    bag.warn("`presence.responseDelayMs` must be a `[min, max]` pair; using the default.", {
      path: "presenceProfile.responseDelayMs",
    });
  }

  const messageLengthRaw = optionalString(value["messageLength"]);
  let messageLength = DEFAULT_PRESENCE.messageLength;
  if (messageLengthRaw !== undefined) {
    if (MESSAGE_LENGTHS.includes(messageLengthRaw as PresenceProfile["messageLength"])) {
      messageLength = messageLengthRaw as PresenceProfile["messageLength"];
    } else {
      bag.warn(
        `\`presence.messageLength: ${messageLengthRaw}\` is not one of ${MESSAGE_LENGTHS.join("|")}; using "${messageLength}".`,
        { path: "presenceProfile.messageLength" },
      );
    }
  }

  return {
    responseDelayMs,
    silenceTolerancePulses:
      typeof value["silenceTolerancePulses"] === "number"
        ? value["silenceTolerancePulses"]
        : DEFAULT_PRESENCE.silenceTolerancePulses,
    messageLength,
    punctuationTells: Array.isArray(value["punctuationTells"])
      ? value["punctuationTells"].filter((t): t is string => typeof t === "string")
      : [],
  };
}

function parseSampling(fm: Record<string, unknown>, bag: DiagnosticBag): PersonaPack["sampling"] {
  const raw = fm["sampling"];
  if (raw === undefined) return { ...DEFAULT_SAMPLING };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bag.warn("`sampling` is not a mapping; using defaults.", { path: "sampling" });
    return { ...DEFAULT_SAMPLING };
  }
  const value = raw as Record<string, unknown>;
  const num = (key: keyof PersonaPack["sampling"]): number =>
    typeof value[key] === "number" ? (value[key] as number) : DEFAULT_SAMPLING[key];
  return {
    temperature: num("temperature"),
    repetitionPenalty: num("repetitionPenalty"),
    topP: num("topP"),
    maxTokens: num("maxTokens"),
  };
}

function requiredString(
  value: unknown,
  field: string,
  bag: DiagnosticBag,
  doc: MdDocument,
): string {
  const text = optionalString(value);
  if (text !== undefined) return text;
  bag.error(`Frontmatter is missing \`${field}\`.`, {
    line: doc.frontmatterLine,
    path: field,
    hint: `Add \`${field}: <value>\` to the \`---\` block at the top of the file.`,
  });
  return "";
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/** A positive multiplier (trigger sensitivity), which is not bounded by 1. */
function positive(
  value: unknown,
  fallback: number,
  path: string,
  bag: DiagnosticBag,
  line: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  if (value < 0) {
    bag.warn(`\`${path}\` is ${value}; a sensitivity cannot be negative, using ${fallback}.`, { line, path });
    return fallback;
  }
  return value;
}

/** Numbers outside [0,1] are a mistake worth naming, not worth failing over. */
function clamped(
  value: unknown,
  fallback: number,
  path: string,
  bag: DiagnosticBag,
  line: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  if (value < 0 || value > 1) {
    bag.warn(`\`${path}\` is ${value}; clamped into [0, 1].`, { line, path });
    return Math.min(1, Math.max(0, value));
  }
  return value;
}
