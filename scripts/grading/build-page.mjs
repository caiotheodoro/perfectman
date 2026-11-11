#!/usr/bin/env node
// Inline clips.json + meta.json (run ids, for export only) into page.template.html.
//   node scripts/grading/build-page.mjs [--dir docs/eval/cinematic-grading] [--out grading.html]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const dir = resolve(args.dir ?? "docs/eval/cinematic-grading");
const out = resolve(args.out ?? join(dir, "grading.html"));
const here = dirname(fileURLToPath(import.meta.url));
const { clips } = JSON.parse(readFileSync(join(dir, "clips.json"), "utf8"));
const meta = new Map(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).clips.map(m => [m.id, m]));
const data = { clips: clips.map(c => ({ ...c, src: { run: meta.get(c.id).run, window_s: meta.get(c.id).window_s } })) };
// escape "<" so no clip text can close the script element
const json = JSON.stringify(data).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join(" ").split(String.fromCharCode(0x2029)).join(" ");
const tpl = readFileSync(join(here, "page.template.html"), "utf8");
if (!tpl.includes("/*__DATA__*/null")) throw new Error("template marker missing");
writeFileSync(out, tpl.replace("/*__DATA__*/null", () => json));
console.log("wrote", out, Math.round(json.length / 1024) + " KB of data");
