#!/usr/bin/env node
// Generates src/director/generated.ts from the vendored Tilehouse schema.
// `--check` regenerates in memory and exits 1 if the committed file differs.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { compile } from "json-schema-to-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(root, "schema/director.schema.json");
const outPath = resolve(root, "src/director/generated.ts");
const cuePath = resolve(root, "schema/cue-vocab.json");
const cueOutPath = resolve(root, "src/director/cue-vocab.generated.ts");
const vocabPath = resolve(root, "schema/verb-vocab.json");
const vocabOutPath = resolve(root, "src/director/verb-vocab.generated.ts");

const BANNER = `/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/director.schema.json (vendored from Tilehouse,
 * see schema/SOURCE.md). Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
`;

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
// The root object only bundles the definitions; naming it keeps the output stable.
const body = await compile(schema, "DirectorContract", {
  bannerComment: "",
  additionalProperties: false,
  unreachableDefinitions: true,
  strictIndexSignatures: true,
  style: { singleQuote: false, semi: true, printWidth: 100, trailingComma: "all" },
});
const out = BANNER + body.trimStart().replace(/\r\n/g, "\n");

// The cue vocabularies (camera-and-audio.md 8) as constants, so the planner and the checks share one list.
const cue = JSON.parse(await readFile(cuePath, "utf8"));
const lit = (v) => JSON.stringify(v, null, 2);
const cueOut = `/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/cue-vocab.json (vendored from Tilehouse,
 * see schema/SOURCE.md). Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
export const CUE_VOCAB_VERSION = ${cue.version} as const;

export const SFX_CANONICAL = ${lit(cue.sfx.canonical)} as const;

export const SFX_ALIASES: Readonly<Record<string, string>> = ${lit(cue.sfx.aliases)};

export const SFX_LOOPABLE: readonly string[] = ${lit(cue.sfx.loopable)};

export const EMOTION_CANONICAL = ${lit(cue.emotion.canonical)} as const;

export const EMOTION_ALIASES: Readonly<Record<string, string>> = ${lit(cue.emotion.aliases)};

export const FACE_STATE_EMOTIONS: Readonly<Record<string, string>> = ${lit(cue.emotion.face_states)};

export const FADE_RANGE = { min: ${cue.fade.to.min}, max: ${cue.fade.to.max} } as const;

export const CUT_FX_KINDS: readonly string[] = ${lit(cue.fade.cut_fx_kinds)};
`;

// The drama verb table (act-contract.md 5 and 10). TBL-1: every verb validates against the root of the embedded
// `table_schema` and every consent profile against `$defs.profile`; a table that does not is not generated from.
const vocabBytes = await readFile(vocabPath);
const vocab = JSON.parse(vocabBytes.toString("utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
const checkVerb = ajv.compile(vocab.table_schema);
const checkProfile = ajv.compile({ $ref: "#/$defs/profile", $defs: vocab.table_schema.$defs });
const tableErrors = [
  ...Object.entries(vocab.verbs).flatMap(([id, v]) => (checkVerb(v) ? [] : [`verbs.${id}: ${ajv.errorsText(checkVerb.errors)}`])),
  ...Object.entries(vocab.consent_profiles).flatMap(([id, p]) => (checkProfile(p) ? [] : [`consent_profiles.${id}: ${ajv.errorsText(checkProfile.errors)}`])),
];
if (tableErrors.length > 0) {
  console.error(`schema/verb-vocab.json fails its own table_schema (TBL-1):\n${tableErrors.join("\n")}`);
  process.exit(1);
}
const vocabOut = `/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/verb-vocab.json (the hotel's published verb table, see schema/SOURCE.md).
 * Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
export const VERB_VOCAB_VERSION = ${vocab.version} as const;

export const VERB_VOCAB_REV = ${vocab.rev} as const;

/** sha256 of the bytes of schema/verb-vocab.json: what \`hello_ack.sidecar.verb_vocab\` carries (NEG-7, VV-3). */
export const VERB_VOCAB_SHA256 = "${createHash("sha256").update(vocabBytes).digest("hex")}" as const;

export const VERB_IDS = ${lit(vocab.enums.verbs)} as const;

export const VOCAB_ENUMS = ${lit(vocab.enums)} as const;

export const VOCAB_CONSTANTS = ${lit(vocab.constants)} as const;
`;

const targets = [
  [outPath, out, "src/director/generated.ts"],
  [cueOutPath, cueOut, "src/director/cue-vocab.generated.ts"],
  [vocabOutPath, vocabOut, "src/director/verb-vocab.generated.ts"],
];

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [path, text, name] of targets) {
    let current = "";
    try {
      current = await readFile(path, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`${name} is stale: run \`pnpm --filter @perfectman/hotel gen:director\`.`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log("director generated.ts, cue-vocab.generated.ts and verb-vocab.generated.ts are up to date");
} else {
  for (const [path, text] of targets) {
    await writeFile(path, text);
    console.log(`wrote ${path}`);
  }
}
