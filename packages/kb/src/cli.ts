#!/usr/bin/env node
import { parseSlimKb } from "@perfectman/shared";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBeats } from "./ingest/index.js";
import { makeEmbedder } from "./embed.js";
import { queryReferenceBeats, toPlanRefs } from "./query.js";
import { buildSlim } from "./slim/build.js";
import { Store } from "./store.js";
import { agreement, importTagLines, sampleIds, selectForTagging, splitHeldOut, writeTaggingBatches } from "./tags.js";
import type { Beat, TagRecord, TaggedBeat } from "./types.js";

/**
 * pm-kb <command>. Everything reads and writes under the package's `corpus/` and `index/` folders, both gitignored.
 *   build-beats                      corpus/<dir>/manifest.json -> index/beats.jsonl
 *   export-tags [--batch 40] [--action X] [--dialogue-fraction 0.25] [--dialogue-fraction-pt 0.5] [--heldout 0.1] [--only-ids file] [--out dir]
 *                                    index/beats.jsonl -> batch-NNNN.in.jsonl + PROMPT.md; --heldout writes heldout.ids.json and heldout/batch-NNNN.in.jsonl
 *                                    and leaves those beats out of the main batches
 *   import-tags <dir> [--by haiku]   index/tagging/*.out.jsonl -> index/tags.jsonl, errors to index/tag-errors.jsonl
 *   check-tags <files...>            validate tagger output, writes nothing
 *   sample [--fraction 0.1]          ids to re-tag with a second tagger -> index/verify-ids.json
 *   agreement <a.jsonl> <b.jsonl>
 *   embed [--embedder hash|transformers] [--model name]       tags + beats -> index/kb.sqlite
 *   query --tactic "to intimidate" --action KILLING --cast 3 [--limit 5] [--text] [--plan]
 *   export-slim [--out slim/kb-slim.json] [--built YYYY-MM-DD] [--index path]
 *                                    index/kb.sqlite -> the slim reference file production reads (open text only, whole-line excerpts, no model needed)
 *   stats
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const corpus = path.join(root, "corpus");
const idx = path.join(root, "index");

function args(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = true;
      else (flags[a.slice(2)] = next, i++);
    } else pos.push(a);
  }
  return { pos, flags };
}

const readJsonl = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const writeJsonl = (file: string, rows: unknown[]) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, rows.length ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : ""));

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = args(rest);
  switch (cmd) {
    case "build-beats": {
      const { beats, skipped, perSource } = buildBeats(corpus);
      writeJsonl(path.join(idx, "beats.jsonl"), beats);
      console.log(JSON.stringify({ beats: beats.length, sources: Object.keys(perSource).length, perSource, skipped }, null, 2));
      return;
    }
    case "export-tags": {
      let beats = readJsonl<Beat>(path.join(idx, "beats.jsonl"));
      if (typeof flags["action"] === "string") beats = beats.filter((b) => b.actionHint === flags["action"]);
      if (typeof flags["dialogue-fraction"] === "string") {
        // Keep every beat with a physical-action hint, and a deterministic share of the dialogue-only ones (Portuguese may take more).
        const fraction = Number(flags["dialogue-fraction"]);
        beats = selectForTagging(beats, { dialogueFraction: fraction, dialogueFractionPt: typeof flags["dialogue-fraction-pt"] === "string" ? Number(flags["dialogue-fraction-pt"]) : fraction });
      }
      if (typeof flags["only-ids"] === "string") {
        const ids = new Set(JSON.parse(readFileSync(flags["only-ids"], "utf8")) as string[]);
        beats = beats.filter((b) => ids.has(b.id));
      }
      const dir = typeof flags["out"] === "string" ? flags["out"] : path.join(idx, "tagging");
      let heldOut: Beat[] = [];
      if (typeof flags["heldout"] === "string") {
        ({ main: beats, heldOut } = splitHeldOut(beats, Number(flags["heldout"])));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "heldout.ids.json"), JSON.stringify(heldOut.map((b) => b.id)));
      }
      const files = writeTaggingBatches(beats, dir, Number(flags["batch"] ?? 40));
      const heldFiles = heldOut.length ? writeTaggingBatches(heldOut, path.join(dir, "heldout"), Number(flags["batch"] ?? 40)) : [];
      console.log(`${beats.length} beats in ${files.length} batches under ${dir}${heldOut.length ? `; ${heldOut.length} held out (heldout.ids.json, ${heldFiles.length} batches in heldout/)` : ""}`);
      return;
    }
    case "import-tags": {
      const dir = pos[0] ?? path.join(idx, "tagging");
      const beats = new Map(readJsonl<Beat>(path.join(idx, "beats.jsonl")).map((b) => [b.id, b]));
      const by = typeof flags["by"] === "string" ? flags["by"] : "haiku";
      const outFile = typeof flags["out"] === "string" ? flags["out"] : path.join(idx, "tags.jsonl");
      const tags: TagRecord[] = [];
      const errors: unknown[] = [];
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".out.jsonl")).sort()) {
        const r = importTagLines(readFileSync(path.join(dir, f), "utf8").split("\n"), beats, by);
        tags.push(...r.tags);
        errors.push(...r.errors.map((e) => ({ file: f, ...e })));
      }
      writeJsonl(outFile, tags);
      writeJsonl(path.join(idx, "tag-errors.jsonl"), errors);
      console.log(JSON.stringify({ tagged: tags.length, errors: errors.length, of: beats.size }));
      return;
    }
    case "check-tags": {
      // Validates tagger output files without writing anything. Exit code 1 when any line is rejected.
      const beats = new Map(readJsonl<Beat>(path.join(idx, "beats.jsonl")).map((b) => [b.id, b]));
      let bad = 0;
      for (const f of pos) {
        const lines = readFileSync(f, "utf8").split("\n");
        const r = importTagLines(lines, beats, "check");
        const inFile = f.replace(/\.out\.jsonl$/, ".in.jsonl");
        const expected = existsSync(inFile) ? readJsonl<{ id: string }>(inFile).map((x) => x.id) : [];
        const got = new Set(r.tags.map((t) => t.id));
        const missing = expected.filter((id) => !got.has(id));
        bad += r.errors.length + missing.length;
        console.log(`${path.basename(f)}: ${r.tags.length} valid, ${r.errors.length} rejected, ${missing.length} of ${expected.length} inputs missing`);
        for (const e of r.errors.slice(0, 8)) console.log(`  ${e.id}: ${e.errors.join("; ")}`);
        for (const id of missing.slice(0, 5)) console.log(`  missing: ${id}`);
      }
      process.exitCode = bad === 0 ? 0 : 1;
      return;
    }
    case "sample": {
      const ids = readJsonl<{ id: string }>(path.join(idx, "tags.jsonl")).map((t) => t.id);
      const pick = sampleIds(ids, Number(flags["fraction"] ?? 0.1));
      writeFileSync(path.join(idx, "verify-ids.json"), JSON.stringify(pick));
      console.log(`${pick.length} of ${ids.length} beats in the verification sample`);
      return;
    }
    case "agreement": {
      const [a, b] = pos;
      if (!a || !b) throw new Error("usage: agreement <a.jsonl> <b.jsonl>");
      console.log(JSON.stringify(agreement(readJsonl<TagRecord>(a), readJsonl<TagRecord>(b)), null, 2));
      return;
    }
    case "embed": {
      const kind = flags["embedder"] === "hash" ? "hash" : "transformers";
      const embedder = makeEmbedder(kind, typeof flags["model"] === "string" ? flags["model"] : undefined);
      const beats = new Map(readJsonl<Beat>(path.join(idx, "beats.jsonl")).map((b) => [b.id, b]));
      const tagged: TaggedBeat[] = readJsonl<TagRecord>(path.join(idx, "tags.jsonl")).flatMap((t) => {
        const b = beats.get(t.id);
        return b ? [{ ...b, tag: t }] : [];
      });
      const text = (b: TaggedBeat) => `${b.tag.tactic_verb}; ${b.tag.action_type}; ${b.tag.status_delta}; ${b.tag.emotion}. ${b.text}`.slice(0, 1800);
      const store = new Store(path.join(idx, "kb.sqlite"));
      const BATCH = 64;
      for (let i = 0; i < tagged.length; i += BATCH) {
        const chunk = tagged.slice(i, i + BATCH);
        const vecs = await embedder.embedDocuments(chunk.map(text));
        store.upsert(chunk.map((beat, k) => ({ beat, vec: vecs[k] as Float32Array, embedModel: embedder.id })));
        process.stdout.write(`\r${Math.min(i + BATCH, tagged.length)}/${tagged.length}`);
      }
      console.log(`\nindexed ${store.count()} beats with ${embedder.id}`);
      store.close();
      return;
    }
    case "query": {
      const kind = flags["embedder"] === "hash" ? "hash" : "transformers";
      const embedder = makeEmbedder(kind);
      const store = new Store(path.join(idx, "kb.sqlite"));
      const refs = await queryReferenceBeats(store, embedder, String(flags["tactic"] ?? ""), String(flags["action"] ?? "DIALOGUE_ONLY"), Number(flags["cast"] ?? 3), {
        limit: Number(flags["limit"] ?? 5),
        includeText: flags["text"] === true,
        ...(typeof flags["situation"] === "string" ? { situation: flags["situation"] } : {}),
        ...(typeof flags["language"] === "string" ? { language: flags["language"] } : {}),
      });
      console.log(JSON.stringify(flags["plan"] === true ? toPlanRefs(refs) : refs, null, 2));
      store.close();
      return;
    }
    case "export-slim": {
      const file = typeof flags["index"] === "string" ? path.resolve(flags["index"]) : path.join(idx, "kb.sqlite");
      if (!existsSync(file)) throw new Error("no index yet: run embed");
      const out = path.resolve(typeof flags["out"] === "string" ? flags["out"] : path.join(root, "slim", "kb-slim.json"));
      const store = new Store(file);
      const { json, stats } = buildSlim(store.candidates({}), typeof flags["built"] === "string" ? { built: flags["built"] } : {});
      store.close();
      // The file is read back through the reader production uses: a file it would refuse, or drop a beat from, is not written.
      const check = parseSlimKb(JSON.parse(json));
      if (!check.ok) throw new Error(`the slim file does not read back: ${check.error}`);
      if (check.dropped > 0) throw new Error(`the slim file does not read back whole: the reader would drop ${check.dropped} beats`);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, json);
      console.log(JSON.stringify({ out, bytes: Buffer.byteLength(json), ...stats }, null, 2));
      return;
    }
    case "stats": {
      const file = path.join(idx, "kb.sqlite");
      if (!existsSync(file)) throw new Error("no index yet: run embed");
      const store = new Store(file);
      console.log(JSON.stringify(store.stats(), null, 2));
      store.close();
      return;
    }
    default:
      console.error("commands: build-beats | export-tags | import-tags | sample | agreement | embed | query | export-slim | stats");
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
