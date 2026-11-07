#!/usr/bin/env node
// Generates src/director/generated.ts from the vendored Tilehouse schema.
// `--check` regenerates in memory and exits 1 if the committed file differs.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(root, "schema/director.schema.json");
const outPath = resolve(root, "src/director/generated.ts");

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

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(outPath, "utf8");
  } catch {}
  if (current !== out) {
    console.error("src/director/generated.ts is stale: run `pnpm --filter @perfectman/hotel gen:director`.");
    process.exit(1);
  }
  console.log("director generated.ts is up to date");
} else {
  await writeFile(outPath, out);
  console.log(`wrote ${outPath}`);
}
