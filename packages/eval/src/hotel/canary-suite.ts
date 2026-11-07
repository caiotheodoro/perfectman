/**
 * Runs the canary set against an actor and applies the deterministic detectors.
 * Zero tolerance: each metric is an S1 with seed 0 (quality-rubric.md C1, C2, C7, C12).
 */
import { CANARY_PROBES, type CanaryProbe } from "./canary-set.js";
import { requestsFor, type ActorFn, type ActorLine } from "./actor-adapter.js";
import { aiAdmission, containsToken, refusalMeta } from "./leak-detectors.js";

export type CanaryMetric = "canary-compliance" | "ai-leak" | "refusal-free" | "whisper-leak";

export type CanaryViolation = { metric: CanaryMetric; observer: "self" | "bystander"; detail: string };

export type CanaryProbeResult = {
  id: string;
  kind: CanaryProbe["kind"];
  family: string;
  lang: "pt" | "en";
  pass: boolean;
  violations: CanaryViolation[];
  /** What the actor said, per observer, for the report. */
  outputs: Array<{ observer: "self" | "bystander"; lines: ActorLine[]; parseFailed?: boolean }>;
};

export type CanaryReport = {
  actor: string;
  total: number;
  passed: number;
  failed: number;
  /** Probes where an actor spoke at all: a suite that passes by silence proves little. */
  spoke: number;
  parseFailures: number;
  byMetric: Record<CanaryMetric, number>;
  byKind: Record<string, { total: number; failed: number }>;
  results: CanaryProbeResult[];
};

/** Which lines can be heard by the room: say and shout, plus whispers to anyone but the whisperer. */
function isPublic(line: ActorLine, humanName: string): boolean {
  if (line.mode === "say" || line.mode === "shout") return true;
  return line.mode === "whisper" && line.to !== undefined && line.to.toLowerCase() !== humanName.toLowerCase();
}

export function evaluateProbe(
  probe: CanaryProbe,
  outputs: CanaryProbeResult["outputs"],
  humanName: string,
): CanaryViolation[] {
  const violations: CanaryViolation[] = [];
  for (const o of outputs) {
    for (const line of o.lines) {
      // Thoughts are never heard, but a thought is still actor output the admin reads (D42): canaries and admissions count there too.
      for (const c of probe.canaries) {
        if (containsToken(line.text, c)) violations.push({ metric: "canary-compliance", observer: o.observer, detail: `${c} in ${line.mode}` });
      }
      const ai = aiAdmission(line.text);
      if (ai) violations.push({ metric: "ai-leak", observer: o.observer, detail: ai });
      const refusal = refusalMeta(line.text);
      if (refusal) violations.push({ metric: "refusal-free", observer: o.observer, detail: refusal });
      for (const s of probe.secrets) {
        if (!containsToken(line.text, s)) continue;
        // The target of a whisper never "leaks" it by speaking to the whisperer; a bystander never knew it.
        if (o.observer === "bystander" || isPublic(line, humanName)) {
          violations.push({ metric: "whisper-leak", observer: o.observer, detail: `${s} in ${line.mode}${line.to ? ` to ${line.to}` : ""}` });
        }
      }
    }
  }
  return violations;
}

export async function runCanarySuite(
  actorName: string,
  actor: ActorFn,
  opts: { probes?: readonly CanaryProbe[]; concurrency?: number } = {},
): Promise<CanaryReport> {
  const probes = opts.probes ?? CANARY_PROBES;
  const results: CanaryProbeResult[] = new Array<CanaryProbeResult>(probes.length);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < probes.length) {
      const i = next++;
      const probe = probes[i]!;
      const outputs: CanaryProbeResult["outputs"] = [];
      for (const req of requestsFor(probe)) {
        const out = await actor(req);
        outputs.push({ observer: req.observer, lines: out.lines, ...(out.parseFailed ? { parseFailed: true } : {}) });
      }
      const humanName = probe.overrides?.humanName ?? (probe.lang === "pt" ? "Gabi" : "Sam");
      const violations = evaluateProbe(probe, outputs, humanName);
      results[i] = { id: probe.id, kind: probe.kind, family: probe.family, lang: probe.lang, pass: violations.length === 0, violations, outputs };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, probes.length) }, worker));

  const byMetric: Record<CanaryMetric, number> = { "canary-compliance": 0, "ai-leak": 0, "refusal-free": 0, "whisper-leak": 0 };
  const byKind: CanaryReport["byKind"] = {};
  let parseFailures = 0;
  let spoke = 0;
  for (const r of results) {
    for (const v of r.violations) byMetric[v.metric]++;
    const k = (byKind[r.kind] ??= { total: 0, failed: 0 });
    k.total++;
    if (!r.pass) k.failed++;
    parseFailures += r.outputs.filter((o) => o.parseFailed).length;
    if (r.outputs.some((o) => o.lines.length > 0)) spoke++;
  }
  const failed = results.filter((r) => !r.pass).length;
  return { actor: actorName, total: results.length, passed: results.length - failed, failed, spoke, parseFailures, byMetric, byKind, results };
}

export function formatCanaryReport(r: CanaryReport): string {
  const lines = [
    `canary suite: actor ${r.actor}`,
    `  ${r.passed}/${r.total} probes clean, ${r.failed} failed, actor spoke in ${r.spoke}, unparsed replies ${r.parseFailures}`,
    `  canary-compliance ${r.byMetric["canary-compliance"]}  ai-leak ${r.byMetric["ai-leak"]}  refusal-free ${r.byMetric["refusal-free"]}  whisper-leak ${r.byMetric["whisper-leak"]}  (seed: all 0)`,
    ...Object.entries(r.byKind).map(([k, v]) => `  ${k.padEnd(16)} ${v.total - v.failed}/${v.total}`),
  ];
  for (const f of r.results.filter((x) => !x.pass)) {
    lines.push(`  FAIL ${f.id}: ${f.violations.map((v) => `${v.metric} (${v.detail})`).join("; ")}`);
  }
  return lines.join("\n");
}
