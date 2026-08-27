#!/usr/bin/env node
/**
 * Docs tree hygiene lint — checks L1..L5 (issue #98; decisions D-39, D-43).
 * Dependency-free plain-node, mirroring scripts/audit-tests.mjs (walk + regex
 * heuristics, `--check` gate, informational allowlist, generated inventory MD+JSON).
 * Heuristics are findings, not verdicts — re-verified manually (trust-nothing).
 *
 * Usage:
 *   node scripts/docs-lint.mjs            regenerate docs/docs-lint-inventory.{md,json}
 *   node scripts/docs-lint.mjs --check    run self-test (D-43), then scan; exit 1 on violation
 *   node scripts/docs-lint.mjs --self-test   run the inline fixtures only
 *
 * Checks (D-39):
 *   L1 dead relative markdown links (link + image targets, fence-aware,
 *      repo-root-resolution, skip http(s)/mailto:/data:/#anchor and any target
 *      whose resolved path is `.claude/`-prefixed — the 4 staging rows,
 *      source-map.md:82-85 — counted as informational under L2).
 *   L2 `.claude/` archived-path refs — zero-tolerance scope is `.claude/_output/pipeline/`
 *      link targets only (literal target text starts with that path); all other
 *      `.claude/` lines are informational, counted line-keyed (a multi-mention line
 *      counts once, so the inventory and the gate's count can never disagree).
 *   L3 orphan concept pages — docs/concepts/*.md not linked from concept-map.md,
 *      and concept-map catalog rows pointing at missing concept files.
 *   L4 line-final bare venue tokens — token is the last non-whitespace text on the
 *      line. Deliberately NO paragraph-final clause: mid-paragraph line-final tokens
 *      (design-conversation-history.md:106/107 shape) must be caught.
 *   L5 stale source-map fetch dates — the source-map.md files under docs/research/ only,
 *      a "Fetch Date" column >90 days old. Rolling horizon: dates age into violation
 *      without any doc change; remediation is re-fetch, not waiver.
 *
 * The generated docs/docs-lint-inventory.{md,json} files are excluded from the scan
 * so the lint does not flag its own output.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const OUT_MD = join(DOCS, "docs-lint-inventory.md");
const OUT_JSON = join(DOCS, "docs-lint-inventory.json");

const SKIP_TARGET = /^(?:https?:|mailto:|data:|#)/;
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
const PIPELINE_PATH = ".claude/_output/pipeline/";
const VENUE_RE = /(?:ScienceDirect|arxivUpenn|Nature|PubMed|nih|ResearchGate|Springer)$/;
const FRESHNESS_DAYS = 90;

// D-39 allowlist: the repo's full set of committed `.claude/` mention lines, counted
// line-keyed. `--check` fails if the live set drifts from this list either way; a doc
// that legitimately needs an exception updates this list (and the research log).
const INFORMATIONAL_EXCEPTIONS = [
  "docs/adr/0008-world-goal-layer.md:50",   // prose: archiving-survival rule
  "docs/research/goal-layer/README.md:15",  // prose: staging-copies note
  "docs/research/goal-layer/notes.md:56",   // prose: historical dead-link note
  "docs/research/goal-layer/notes.md:60",   // prose: staging-only rule (two mentions, one line)
  "docs/research/goal-layer/source-map.md:82", // link target: staging source R1
  "docs/research/goal-layer/source-map.md:83", // link target: staging source R2
  "docs/research/goal-layer/source-map.md:84", // link target: staging source R3
  "docs/research/goal-layer/source-map.md:85", // link target: staging source R4
];

const relPosix = (p) => relative(ROOT, p).split(sep).join("/");

function walkDocsMd() {
  const out = new Map();
  const stack = [DOCS];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === "docs-lint-inventory.md") continue; // self-exclusion
      else if (e.name.endsWith(".md")) out.set(relPosix(p), readFileSync(p, "utf8"));
    }
  }
  return out;
}

const realExists = (rel) => existsSync(join(ROOT, rel.split("/").join(sep)));

function checkL1(files, exists) {
  const findings = [];
  for (const [rel, src] of files) {
    const lines = src.split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(line)) !== null) {
        const target = m[1];
        if (SKIP_TARGET.test(target)) continue;
        const hash = target.indexOf("#");
        const resolved = posix.normalize(posix.join(posix.dirname(rel), hash >= 0 ? target.slice(0, hash) : target));
        if (resolved.startsWith(".claude/") || resolved === "." || resolved === "..") continue;
        if (!exists(resolved)) findings.push({ file: rel, line: i + 1, target, resolved });
      }
    }
  }
  return findings;
}

function checkL2(files) {
  const violations = [];
  const informational = new Set();
  for (const [rel, src] of files) {
    const lines = src.split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      let isViolation = false;
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(line)) !== null) {
        if (m[1].startsWith(PIPELINE_PATH)) {
          violations.push({ file: rel, line: i + 1, target: m[1] });
          isViolation = true;
        }
      }
      if (!isViolation && line.includes(".claude/")) informational.add(`${rel}:${i + 1}`);
    }
  }
  return { violations, informational };
}

function checkL3(files) {
  const findings = [];
  const catalog = "docs/concepts/concept-map.md";
  const catalogSrc = files.get(catalog);
  if (catalogSrc === undefined) return findings;
  const linked = new Set();
  const lines = catalogSrc.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(lines[i])) !== null) {
      const target = m[1];
      if (SKIP_TARGET.test(target)) continue;
      const resolved = posix.normalize(posix.join("docs/concepts", target));
      if (resolved.startsWith(".claude/")) continue;
      if (resolved.startsWith("docs/concepts/")) {
        linked.add(posix.basename(resolved));
        if (!files.has(resolved)) findings.push({ file: catalog, line: i + 1, target, what: "catalog row -> missing concept file" });
      }
    }
  }
  for (const rel of [...files.keys()].filter((k) => k.startsWith("docs/concepts/") && k !== catalog && k.endsWith(".md"))) {
    if (!linked.has(posix.basename(rel))) findings.push({ file: rel, what: "orphan concept page: not linked from concept-map.md" });
  }
  return findings;
}

function checkL4(files) {
  const findings = [];
  for (const [rel, src] of files) {
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = VENUE_RE.exec(lines[i].replace(/\s+$/, ""));
      if (m) findings.push({ file: rel, line: i + 1, token: m[0] });
    }
  }
  return findings;
}

function dateDiffDays(from, to) {
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((f - t) / 86400000);
}

function checkL5(files, today) {
  const findings = [];
  const dateRe = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  for (const [rel, src] of files) {
    if (!/^docs\/research\/.*\/source-map\.md$/.test(rel)) continue;
    const lines = src.split(/\r?\n/);
    let headerIdx = -1;
    let dateCol = -1;
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split("|").map((c) => c.trim());
      const j = cells.findIndex((c) => /fetch\s+date/i.test(c));
      if (j >= 0) {
        headerIdx = i;
        dateCol = j;
        break;
      }
    }
    if (dateCol < 0) continue;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith("|")) break;
      if (/^\s*\|?[-:| ]+\|?\s*$/.test(line)) continue;
      const cell = line.split("|")[dateCol] ?? "";
      const dm = dateRe.exec(cell.trim());
      if (!dm) continue;
      const d = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3]));
      const days = dateDiffDays(today, d);
      if (days > FRESHNESS_DAYS) findings.push({ file: rel, line: i + 1, date: `${dm[1]}-${dm[2]}-${dm[3]}`, days });
    }
  }
  return findings;
}

// ---- self-test fixtures (D-43): inline, one positive + one negative per check ----
const m = (obj) => new Map(Object.entries(obj));
const inMap = (map) => (p) => map.has(p);
const FIXED_TODAY = new Date("2026-08-27T12:00:00Z");

const FIXTURES = [
  // L1
  { name: "L1 positive: dead relative link", run: () => checkL1(m({ "notes/a.md": "[x](missing/b.md)\n" }), inMap(m({ "notes/a.md": "" }))).length, expect: 1 },
  { name: "L1 positive: dead relative image", run: () => checkL1(m({ "a.md": "![alt](chart.png)\n" }), inMap(m({ "a.md": "" }))).length, expect: 1 },
  { name: "L1 negative: resolving link", run: () => checkL1(m({ "a.md": "[x](b.md)\n", "b.md": "# b\n" }), inMap(m({ "a.md": "", "b.md": "" }))).length, expect: 0 },
  { name: "L1 negative: file+anchor target resolves to the file", run: () => checkL1(m({ "a.md": "[x](b.md#section)\n", "b.md": "# b\n" }), inMap(m({ "a.md": "", "b.md": "" }))).length, expect: 0 },
  { name: "L1 positive: dead file+anchor target still flags", run: () => checkL1(m({ "a.md": "[x](missing.md#anything)\n" }), inMap(m({ "a.md": "" }))).length, expect: 1 },
  {
    name: "L1 negative: http/mailto/anchor/code-fence/claude-skip forms",
    run: () => {
      const files = m({
        "t.md": "[x](https://example.com/a) [y](http://example.com/b)\n[z](mailto:a@b.com)\n[s](#section)\n",
        "docs/research/goal-layer/source-map.md": "| [.claude/_output/research/R5-x.md](../../../.claude/_output/research/R5-x.md) | staging |\n",
        "docs/code.md": "```md\n[dead](nope.md)\n```\n",
      });
      return checkL1(files, inMap(files)).length;
    },
    expect: 0,
  },

  // L2
  { name: "L2 positive: .claude/_output/pipeline/ link target", run: () => checkL2(m({ "adr/x.md": "[log](.claude/_output/pipeline/decision-log.md)\n" })).violations.length, expect: 1 },
  { name: "L2 negative: pipeline literal inside a code fence is skipped", run: () => checkL2(m({ "docs/conventions.md": "```md\n[log](.claude/_output/pipeline/decision-log.md)\n```\n" })).violations.length, expect: 0 },
  {
    name: "L2 negative: notes.md:56 prose mention (not a link target)",
    run: () =>
      checkL2(m({
        "notes.md": "**dead in two places.** ... (The third dead link \u2014 ADRs pointing at the pipeline's `.claude/_output/pipeline/decision-log.md` \u2014 was repaired on 2026-08-26) ...\n",
      })).violations.length,
    expect: 0,
  },
  {
    name: "L2 negative: source-map staging rows (4 link rows, .claude/_output/research)",
    run: () => {
      const rows = ["R1-goal-closure-psych.md", "R2-self-vs-world-judgment.md", "R3-emergent-autotelic-goals.md", "R4-docs-structure-audit.md"]
        .map((r) => `| [.claude/_output/research/${r}](../../../.claude/_output/research/${r}) | verified as staging source |\n`)
        .join("");
      return checkL2(m({ "docs/research/goal-layer/source-map.md": rows })).violations.length;
    },
    expect: 0,
  },
  {
    name: "L2 informational pin: 8 line-keyed in 4+4 split, two-mention line counts once",
    run: () => {
      const sources = m({
        // 4 staging link-target rows
        "docs/research/goal-layer/source-map.md":
          ["R1-goal-closure-psych.md", "R2-self-vs-world-judgment.md", "R3-emergent-autotelic-goals.md", "R4-docs-structure-audit.md"]
            .map((r) => `| [.claude/_output/research/${r}](../../../.claude/_output/research/${r}) | verified as staging source |\n`)
            .join(""),
        // 4 prose lines on the pinned file:line
        "docs/research/goal-layer/README.md": Array.from({ length: 14 }, () => "pad\n").join("") +
          "The research notes in `.claude/_output/research/` are the staging copies; this pack is the durable home (R4).\n",
        "docs/research/goal-layer/notes.md":
          Array.from({ length: 55 }, () => "pad\n").join("") +
          "**The repo's external-source trail is dead in two places.** ... (ADRs pointing at the pipeline's `.claude/_output/pipeline/decision-log.md` was repaired on 2026-08-26) ...\n" +
          "pad\npad\npad\n" +
          "**Repairs adopted by this run.** ... (never a pointer to `.claude/_output` as the rationale home) ... `.claude/_output/research/` is staging only.\n",
        "docs/adr/0008-world-goal-layer.md": Array.from({ length: 49 }, () => "pad\n").join("") +
          "- ... rationale and rejected alternatives survive `.claude/_output` archiving by construction.\n",
        // must NOT count: domain suffix (no slash after .claude)
        "docs/architecture/prompt-structure-and-layers.md": "Anthropic's guidance (docs.claude.com): XML-style tags make complex prompts unambiguous\n",
      });
      const r = checkL2(sources);
      const has = (k) => r.informational.has(k);
      return {
        violations: r.violations.length,
        size: r.informational.size,
        notes60: has("docs/research/goal-layer/notes.md:60"),
        domainExcluded: !has("docs/architecture/prompt-structure-and-layers.md:1"),
      };
    },
    expect: { violations: 0, size: 8, notes60: true, domainExcluded: true },
  },

  // L3
  {
    name: "L3 positive: orphan concept page",
    run: () => {
      const files = m({
        "docs/concepts/concept-map.md": "# Map\n\n- [goal-layer.md](goal-layer.md)\n- [experiment-brief.md](experiment-brief.md)\n",
        "docs/concepts/goal-layer.md": "# G\n",
        "docs/concepts/experiment-brief.md": "# E\n",
        "docs/concepts/orphan.md": "# O\n",
      });
      return checkL3(files).length;
    },
    expect: 1,
  },
  {
    name: "L3 positive: catalog row -> missing concept file",
    run: () => {
      const files = m({
        "docs/concepts/concept-map.md": "# Map\n\n- [ghost.md](ghost.md)\n- [goal-layer.md](goal-layer.md)\n",
        "docs/concepts/goal-layer.md": "# G\n",
      });
      return checkL3(files).length;
    },
    expect: 1,
  },
  {
    name: "L3 negative: all concept pages linked",
    run: () => {
      const files = m({
        "docs/concepts/concept-map.md": "# Map\n\n- [goal-layer.md](goal-layer.md)\n- [experiment-brief.md](experiment-brief.md)\n",
        "docs/concepts/goal-layer.md": "# G\n",
        "docs/concepts/experiment-brief.md": "# E\n",
      });
      return checkL3(files).length;
    },
    expect: 0,
  },

  // L4
  {
    name: "L4 positive: 4 line-final tokens in an unbroken paragraph (:106/:107/:108/:111 shape)",
    run: () => {
      const para = [
        "The model ... as arousal drops. ScienceDirect",
        "The ultradian baseline ... the orchestrator just computes it. nih",
        "The social contagion ... paranoia spreads faster than calm. This is intentional. arxivUpenn",
        "Two critical components ... to coexist with competing memories. Nature",
      ];
      return checkL4(m({ "docs/notes/design-conversation-history.md": para.join("\n") + "\n" })).length;
    },
    expect: 4,
  },
  { name: "L4 boundary: trailing whitespace after token still line-final", run: () => checkL4(m({ "a.md": "published in Nature   \n" })).length, expect: 1 },
  {
    name: "L4 negative: mid-line mention (notes.md:56 shape)",
    run: () => checkL4(m({ "notes.md": 'Bare-vendor citations ("ScienceDirect", "arxivUpenn") in docs/notes are unrecoverable;\n' })).length,
    expect: 0,
  },
  { name: "L4 negative: token with trailing punctuation", run: () => checkL4(m({ "a.md": "published in *Nature*.\n" })).length, expect: 0 },

  // L5
  {
    name: "L5 positive: source-map fetch date >90 days",
    run: () => {
      const files = m({
        "docs/research/goal-layer/source-map.md": "# S\n\n| Topic | Type | Fetch Date | Note |\n| --- | --- | --- | --- |\n| alpha | paper | 2026-01-01 | old |\n",
      });
      return checkL5(files, FIXED_TODAY).length;
    },
    expect: 1,
  },
  {
    name: "L5 negative: fresh fetch date (and non-date cell skipped)",
    run: () => {
      const files = m({
        "docs/research/goal-layer/source-map.md": "# S\n\n| Topic | Type | Fetch Date | Note |\n| --- | --- | --- | --- |\n| alpha | paper | 2026-08-25 | fresh |\n| beta | book | n/a | no cell |\n",
      });
      return checkL5(files, FIXED_TODAY).length;
    },
    expect: 0,
  },
  {
    name: "L5 boundary: 90-day-old date clean, 91-day-old flagged (date-only arithmetic)",
    run: () => {
      const mk = (date) => m({
        "docs/research/goal-layer/source-map.md": `# S\n\n| Topic | Type | Fetch Date | Note |\n| --- | --- | --- | --- |\n| alpha | paper | ${date} | x |\n`,
      });
      return { at90: checkL5(mk("2026-05-29"), FIXED_TODAY).length, at91: checkL5(mk("2026-05-28"), FIXED_TODAY).length };
    },
    expect: { at90: 0, at91: 1 },
  },
  { name: "L5 out of scope: non-source-map under docs/research ignored", run: () => checkL5(m({ "docs/research/goal-layer/notes.md": "| Fetch Date |\n| 2020-01-01 |\n" }), FIXED_TODAY).length, expect: 0 },
];

function runSelfTest() {
  let failed = 0;
  for (const c of FIXTURES) {
    const got = c.run();
    let ok;
    if (typeof c.expect === "object" && c.expect !== null) {
      ok = Object.entries(c.expect).every(([k, v]) => got[k] === v);
    } else {
      ok = got === c.expect;
    }
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}${ok ? "" : ` (got ${JSON.stringify(got)}, expected ${JSON.stringify(c.expect)})`}`);
    if (!ok) failed++;
  }
  console.log(`[docs-lint] self-test: ${FIXTURES.length - failed}/${FIXTURES.length} fixture cases passing${failed ? " — FAILURE" : ""}`);
  return failed;
}

const loc = (f) => (f.line === undefined ? f.file : `${f.file}:${f.line}`);

function writeInventory(l1, l2, l3, l4, l5, info, docsCount) {
  const md = [];
  md.push("# Docs Lint Inventory & Hygiene Snapshot");
  md.push("");
  md.push("Generated: " + new Date().toISOString() + " \u2014 scanned " + docsCount + " docs files with checks L1\u2013L5.");
  md.push("");
  md.push("Violations fail the `--check` gate; L2 `.claude/` mention lines beyond zero-tolerance are informational, counted line-keyed (one per file:line, allowlisted in-script — D-39).");
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push("| Check | Violations | Informational");
  md.push("|---|---|---|");
  md.push(`| L1 dead relative links | ${l1.length} | \u2014 |`);
  md.push(`| L2 archived-path refs | ${l2.violations.length} | ${info.length} |`);
  md.push(`| L3 orphan concept pages | ${l3.length} | \u2014 |`);
  md.push(`| L4 line-final venue tokens | ${l4.length} | \u2014 |`);
  md.push(`| L5 stale source-map fetch dates | ${l5.length} | \u2014 |`);
  md.push("");
  md.push(`**Total: ${l1.length + l2.violations.length + l3.length + l4.length + l5.length} violations; informational ${info.length} (line-keyed).**`);
  md.push("");
  md.push("## Informational (allowlisted `.claude/` lines)");
  md.push("");
  md.push("| file:line |");
  md.push("|---|---|");
  for (const k of info) md.push(`| ${k} |`);
  md.push("");
  md.push("## Findings by check");
  md.push("");
  const section = (name, findings) => {
    md.push(`### ${name}`);
    md.push("");
    if (!findings.length) {
      md.push("(none)");
      md.push("");
      return;
    }
    md.push("| file:line | detail |");
    md.push("|---|---|");
    for (const f of findings) md.push(`| ${loc(f)} | ${f.what ?? f.token ?? f.resolved ?? f.date ?? f.target} |`);
    md.push("");
  };
  section("L1 \u2014 dead relative links", l1);
  section("L2 \u2014 zero-tolerance violations", l2.violations);
  section("L3 \u2014 orphan concept pages", l3);
  section("L4 \u2014 line-final bare venue tokens", l4);
  section("L5 \u2014 stale fetch dates", l5);

  mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(OUT_MD, md.join("\n"));
  writeFileSync(OUT_JSON, JSON.stringify({
    generatedAt: new Date().toISOString(),
    files: docsCount,
    checks: { L1: l1, L2: { violations: l2.violations, informational: info }, L3: l3, L4: l4, L5: l5 },
    totals: { violations: l1.length + l2.violations.length + l3.length + l4.length + l5.length, informational: info.length },
  }, null, 2));
  console.log(`[docs-lint] wrote ${OUT_MD} + inventory JSON (${docsCount} files, ${l1.length + l2.violations.length + l3.length + l4.length + l5.length} violations, ${info.length} informational)`);
}

function run() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log(`Docs lint — checks L1..L5 (D-39).\n\n  --self-test   run inline fixtures\n  --check       self-test, then scan; exit 1 on violation or informational drift\n  (no args)     regenerate docs/docs-lint-inventory.{md,json}`);
    return 0;
  }
  if (args.has("--self-test")) {
    const f = runSelfTest();
    return f ? 1 : 0;
  }
  if (args.has("--check")) {
    if (runSelfTest() > 0) {
      console.error("[docs-lint] GATE FAILED — self-test fixtures failing; refusing to scan.");
      return 1;
    }
    const files = walkDocsMd();
    const l1 = checkL1(files, realExists);
    const l2 = checkL2(files);
    const l3 = checkL3(files);
    const l4 = checkL4(files);
    const l5 = checkL5(files, new Date());
    const info = [...l2.informational].sort();
    const total = l1.length + l2.violations.length + l3.length + l4.length + l5.length;
    writeInventory(l1, l2, l3, l4, l5, info, files.size);

    const pinned = [...INFORMATIONAL_EXCEPTIONS].sort();
    const added = info.filter((k) => !pinned.includes(k));
    const removed = pinned.filter((k) => !info.includes(k));
    let failed = false;
    if (total > 0) {
      failed = true;
      console.error("[docs-lint] GATE FAILED — zero-tolerance violations:");
      for (const f of [...l2.violations, ...l3, ...l4, ...l5]) console.error(`  ${loc(f)} — ${f.what ?? f.token ?? f.resolved ?? f.date ?? f.target}`);
      for (const f of l1) console.error(`  ${loc(f)} — dead link target ${f.target}`);
    }
    if (added.length || removed.length) {
      failed = true;
      console.error("[docs-lint] GATE FAILED — L2 informational set drifted from the D-39 allowlist:");
      for (const k of added) console.error(`  + ${k} (update INFORMATIONAL_EXCEPTIONS if intentional)`);
      for (const k of removed) console.error(`  - ${k} (removed — update INFORMATIONAL_EXCEPTIONS)`);
    }
    if (failed) return 1;
    console.log(`[docs-lint] PASS — ${files.size} docs files, violations L1=${l1.length} L2=${l2.violations.length} L3=${l3.length} L4=${l4.length} L5=${l5.length}, informational ${info.length} (line-keyed).`);
    return 0;
  }
  const files = walkDocsMd();
  const l2 = checkL2(files);
  writeInventory(
    checkL1(files, realExists),
    l2,
    checkL3(files),
    checkL4(files),
    checkL5(files, new Date()),
    [...l2.informational].sort(),
    files.size,
  );
  return 0;
}

process.exit(run());
