import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { VideoStory } from "./types.js";
import { normalizeEvidence } from "./evidence.js";
import { isRecord, pointerKey } from "./source-utils.js";
import { readTextSource } from "./source-file.js";

const narrationSchema = z.object({
  title: z.string().min(1), recap: z.string(), hiddenShift: z.string(),
}).passthrough();
const narrationsSchema = z.object({
  version: z.literal("narrations-v1"), narrations: z.record(narrationSchema),
}).passthrough();

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** A summary is an epilogue to its saved transcript, never a replacement for it. */
export async function readNarrationSource(
  input: string, value: unknown, sourceSha256: string, scenario?: string,
): Promise<VideoStory> {
  const bundle = narrationsSchema.parse(value);
  const ids = Object.keys(bundle.narrations);
  const selected = scenario ?? (ids.length === 1 ? ids[0] : undefined);
  if (!selected) {
    throw new Error(`Select a narration with --scenario <id>. Available IDs: ${ids.join(", ") || "none"}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(selected)) throw new Error("Unsafe narration scenario ID");
  if (!Object.hasOwn(bundle.narrations, selected)) {
    throw new Error(`No narration for ${selected}. Available IDs: ${ids.join(", ")}`);
  }
  const artifactDir = await realpath(dirname(resolve(input)));
  const candidates = [join("scenarios", `${selected}.json`), "novela-run.json"];
  for (const local of candidates) {
    const candidate = join(artifactDir, local);
    let canonical: string;
    try { canonical = await realpath(candidate); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!inside(artifactDir, canonical)) throw new Error(`Narration companion must stay inside its artifact directory: ${local}`);
    const companion = await readTextSource(canonical);
    const evidence: unknown = JSON.parse(companion.text);
    if (!isRecord(evidence) || evidence.scenarioId !== selected) {
      throw new Error(`Narration companion ${local} has a mismatched scenarioId; expected ${selected}`);
    }
    const story = normalizeEvidence(evidence, selected);
    const narration = bundle.narrations[selected]!;
    const narratorFile = basename(input);
    const companionFile = local.split(sep).join("/");
    const reference = `${narratorFile}#/narrations/${pointerKey(selected)}`;
    return {
      ...story, title: narration.title,
      steps: [
        ...story.steps.map(step => ({ ...step, sourceRefs: step.sourceRefs.map(ref => `${companionFile}#${ref}`) })),
        {
          id: "narrator-recap", phase: "Narrator summary", kind: "narration", action: "narrator recap",
          text: narration.recap, visibility: "operator", sourceRefs: [`${reference}/recap`], raw: narration.recap,
        },
        {
          id: "narrator-hidden-shift", phase: "Narrator summary", kind: "narration", action: "narrator hidden shift",
          text: narration.hiddenShift, visibility: "private", sourceRefs: [`${reference}/hiddenShift`], raw: narration.hiddenShift,
        },
      ],
      sources: [
        { file: resolve(input), sha256: sourceSha256 },
        { file: candidate, sha256: companion.sha256 },
      ],
      notices: [...story.notices,
        "Narrator recap and hidden shift are existing narrator summaries appended after the saved run. They supply no missing emotion trajectory.",
        "Compound source references use artifact-relative-file#JSON-pointer; sources records the exact bytes of both files."],
    };
  }
  throw new Error(`Missing transcript for ${selected}. Place the matching scenarios/${selected}.json or novela-run.json next to ${basename(input)}.`);
}
