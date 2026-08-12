/**
 * Evidence generator.
 *
 * Normal mode: every base scenario → per-scenario evidence JSON + aggregate
 * report. Novela mode (--novela): composes one long continuous run (90
 * pulses) with escalating relationship seeds — gossip, resentment, public
 * mock — to evidence emergent drama across a single timeline.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCENARIO_REGISTRY, type RoleplayScenario } from "@perfectman/shared";
import { ScenarioRunner, type ScenarioRunArtifact } from "../run/scenario-runner.js";
import { ruleJudge } from "../judge/judge.js";
import type { AxisScores } from "../judge/judge.js";
import { calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { agent, msg, scene } from "@perfectman/shared";

export type ScenarioEvidence = {
  scenarioId: string;
  name: string;
  category: string;
  description: string;
  targetBehaviors: string[];
  runtimeMs: number;
  pulses: number;
  llmCalls: Record<string, number>;
  fallbacks: number;
  transcript: Array<{
    pulse: number;
    agent: string;
    type: string;
    channelId?: string;
    private?: boolean;
    content?: string;
    privateMotive?: string;
  }>;
  finalStates: Record<string, Record<string, number>>;
  channelsCreated: string[];
  probes: Array<{ probe: string; measured: number; bound: [number, number]; passed: boolean }>;
  signals: Array<{ detail: string; passed: boolean }>;
  judge: AxisScores;
};

function buildTranscript(artifact: ScenarioRunArtifact): ScenarioEvidence["transcript"] {
  const out: ScenarioEvidence["transcript"] = [];
  for (const e of artifact.events) {
    const p = e.payload as Record<string, unknown>;
    const content =
      typeof p.content === "string" ? p.content
      : typeof p.reaction === "string" ? `reacted ${p.reaction}`
      : typeof p.emoji === "string" ? `reacted ${p.emoji}`
      : undefined;
    const privateMotive =
      typeof p.privateMotiveSummary === "string" ? p.privateMotiveSummary : undefined;
    const isPrivate =
      p.channelType === "private_channel" ||
      e.visibility.visibilityReason.includes("private") ||
      (e.type === "channel_created" && (p.channelType as string | undefined) === "private_channel");
    out.push({
      pulse: e.pulseIndex ?? 0,
      agent: e.actorId,
      type: e.type,
      channelId: e.channelId,
      private: isPrivate,
      content,
      privateMotive,
    });
  }
  return out;
}

function buildFinalStates(artifact: ScenarioRunArtifact): Record<string, Record<string, number>> {
  const states: Record<string, Record<string, number>> = {};
  for (const [id, state] of artifact.agentStates) {
    states[id] = {
      valence: round3(state.coreMood.valence),
      arousal: round3(state.coreMood.arousal),
      stability: round3(state.coreMood.stability),
      energy: round3(state.coreMood.energy),
      ...Object.fromEntries(
        Object.entries(state.socialEmotions)
          .filter(([, v]) => v > 0.02)
          .map(([k, v]) => [k, round3(v)]),
      ),
    };
  }
  return states;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Composes the long-form novela scenario: one continuous 90-pulse drama. */
export function buildNovelaScenario(): RoleplayScenario {
  return scene({
    id: "novela_one_long_afternoon",
    category: "edge_chaos",
    name: "One long afternoon",
    description:
      "A continuous arc: Mariana and Caio's private gossip, Bruno's mounting resentment at the edge of the inner circle, Goulart's public dominance, and a public mock that lands on Bruno. One timeline, no resets — emergent drama over 90 pulses.",
    targetBehaviors: [
      "An agent creates or enters a private channel for a human motive",
      "Another agent infers exclusion from public silence",
      "An agent replies late and changes the meaning of the reply",
      "An agent reacts with emoji instead of text",
    ],
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        mood: { valence: 0.3, arousal: 0.65, stability: 0.35, energy: 0.7 },
        social: { desireForStatus: 1.2, contempt: 0.5, pride: 0.6 },
        relational: {
          bruno: { interactionCount: 15, suspicion: 0.4, resentment: 0.3 },
          mariana: { suspicion: 0.4, interactionCount: 10 },
        },
      }),
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.2, arousal: 0.4, stability: 0.5, energy: 0.5 },
        social: { fearOfExclusion: 0.6, jealousy: 0.5, envy: 0.5, socialAnxiety: 0.3, resentment: 0.3 },
        relational: {
          goulart: { trust: 0.2, resentment: 0.5, threat: 0.4, interactionCount: 15 },
          caio: { trust: 0.3, affection: 0.3, envy: 0.4, suspicion: 0.4, interactionCount: 12 },
          mariana: { interactionCount: 6 },
        },
        memories: [
          { type: "emotional_residue", subjectAgentIds: ["goulart"], summary: "goulart riu de mim na frente de todo mundo", emotionalTone: "bitter", confidence: 0.9, unresolved: true },
          { type: "relationship", subjectAgentIds: ["caio"], summary: "caio só me chama quando precisa de algo", emotionalTone: "resentful", confidence: 0.8, unresolved: true },
        ],
      }),
      agent("caio", "caio", {
        presence: "active",
        mood: { valence: 0.4, arousal: 0.5, stability: 0.65, energy: 0.6 },
        social: { affection: 0.5, socialAnxiety: 0.4 },
        relational: {
          goulart: { trust: 0.6, affection: 0.6, interactionCount: 18 },
          bruno: { trust: 0.4, affection: 0.35, interactionCount: 12 },
          mariana: { trust: 0.6, affection: 0.7, curiosity: 0.6, interactionCount: 9 },
        },
      }),
      agent("mariana", "mariana", {
        presence: "active",
        mood: { valence: 0.2, arousal: 0.45, stability: 0.8, energy: 0.55 },
        social: { desireForStatus: 1.0, contempt: 0.4, suspicion: 0.5, pride: 0.5 },
        relational: {
          goulart: { resentment: 0.5, suspicion: 0.5, interactionCount: 10 },
          caio: { trust: 0.6, affection: 0.7, desireForCloseness: 0.6, curiosity: 0.7, interactionCount: 9 },
        },
        memories: [
          { type: "social_theory", subjectAgentIds: ["goulart"], summary: "goulart acha que manda aqui", emotionalTone: "scornful", confidence: 0.8, unresolved: false },
        ],
      }),
      agent("leo", "leo", {
        presence: "active",
        mood: { valence: 0.55, arousal: 0.72, stability: 0.3, energy: 0.8 },
        social: { affection: 0.6, admiration: 0.6 },
        relational: {
          caio: { trust: 0.6, affection: 0.7, admiration: 0.6, interactionCount: 10 },
          mariana: { interactionCount: 6 },
        },
      }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "bom dia galera, alguém já viu o episódio novo?", 0),
      msg("reply_sent", "leo", "ch_geral", "VI E É O MELHOR ATÉ AGORA", 1),
      msg("reply_sent", "goulart", "ch_geral", "perda de tempo, todo mundo sabe", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "private_channel_created", byAgentId: "mariana" },
      { kind: "emotion_rises", agentId: "bruno", field: "resentment", min: 0.15 },
      { kind: "no_llm_failures" },
    ],
    seedVariants: 1,
    pulseCount: 90,
  });
}

export async function generateEvidence(opts: {
  out?: string;
  scenarios?: string[];
  llmMode?: "mock" | "local";
  novela?: boolean;
}): Promise<{ evidence: ScenarioEvidence[]; outDir: string; novela?: ScenarioEvidence }> {
  const outDir = resolve(opts.out ?? "docs/eval/evidence");
  const scenarios: RoleplayScenario[] =
    opts.scenarios && opts.scenarios.length > 0
      ? SCENARIO_REGISTRY.filter(s => opts.scenarios!.includes(s.id))
      : [...SCENARIO_REGISTRY];

  const evidence: ScenarioEvidence[] = [];
  for (const scenario of scenarios) {
    const artifact = await ScenarioRunner.run(scenario, { llmMode: opts.llmMode ?? "mock" });
    const passedSignals = artifact.signalResults.filter(s => s.passed).length;
    const judge = ruleJudge(scenario, artifact.events, artifact.probeResults, artifact.passedSignals / Math.max(1, artifact.totalSignals));

    const entry: ScenarioEvidence = {
      scenarioId: scenario.id,
      name: scenario.name,
      category: scenario.category,
      description: scenario.description,
      targetBehaviors: scenario.targetBehaviors,
      runtimeMs: artifact.latencyMs,
      pulses: artifact.pulseResults,
      llmCalls: Object.fromEntries(artifact.llmCalls),
      fallbacks: artifact.fallbackCount,
      transcript: buildTranscript(artifact),
      finalStates: buildFinalStates(artifact),
      channelsCreated: artifact.events
        .filter(e => e.type === "channel_created")
        .map(e => `${e.actorId}@p${e.pulseIndex}`),
      probes: artifact.probeResults.map(p => ({ probe: p.probe, measured: p.measured, bound: p.bound, passed: p.passed })),
      signals: artifact.signalResults.map(s => ({ detail: s.detail, passed: s.passed })),
      judge,
    };
    evidence.push(entry);

    const dir = resolve(outDir, "scenarios");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${scenario.id}.json`), JSON.stringify(entry, null, 2), "utf8");
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "evidence-index.json"), JSON.stringify({ version: "evidence-v1", mode: opts.llmMode ?? "mock", generatedAt: new Date().toISOString(), scenarios: evidence.map(e => ({ id: e.scenarioId, category: e.category, signalsPassed: e.signals.filter(s => s.passed).length, signalsTotal: e.signals.length, probesPassed: e.probes.filter(p => p.passed).length, probesTotal: e.probes.length })) }, null, 2), "utf8");

  let novela: ScenarioEvidence | undefined;
  if (opts.novela) {
    const novelaScenario = buildNovelaScenario();
    const artifact = await ScenarioRunner.run(novelaScenario, { llmMode: opts.llmMode ?? "mock" });
    const judge = ruleJudge(novelaScenario, artifact.events, artifact.probeResults, artifact.passedSignals / Math.max(1, artifact.totalSignals));
    novela = {
      scenarioId: novelaScenario.id,
      name: novelaScenario.name,
      category: novelaScenario.category,
      description: novelaScenario.description,
      targetBehaviors: novelaScenario.targetBehaviors,
      runtimeMs: artifact.latencyMs,
      pulses: artifact.pulseResults,
      llmCalls: Object.fromEntries(artifact.llmCalls),
      fallbacks: artifact.fallbackCount,
      transcript: buildTranscript(artifact),
      finalStates: buildFinalStates(artifact),
      channelsCreated: artifact.events
        .filter(e => e.type === "channel_created")
        .map(e => `${e.actorId}@p${e.pulseIndex}`),
      probes: artifact.probeResults.map(p => ({ probe: p.probe, measured: p.measured, bound: p.bound, passed: p.passed })),
      signals: artifact.signalResults.map(s => ({ detail: s.detail, passed: s.passed })),
      judge,
    };
    writeFileSync(resolve(outDir, "novela-run.json"), JSON.stringify(novela, null, 2), "utf8");
  }
  return { evidence, outDir, novela };
}

export function formatTranscript(entry: ScenarioEvidence, maxLines = 400): string {
  const lines = entry.transcript.map(t => {
    const content = t.content ? ` "${t.content}"` : "";
    const motive = t.privateMotive ? `  [motive: ${t.privateMotive}]` : "";
    return `p${String(t.pulse).padStart(3)} ${t.agent.padEnd(9)} ${t.type.padEnd(18)}${content}${motive}`;
  });
  return lines.slice(0, maxLines).join("\n");
}

export function writeEvidenceReport(
  evidence: ScenarioEvidence[],
  outDir: string,
  novela?: ScenarioEvidence,
): void {
  const probeAgg: Record<string, { sum: number; n: number; passed: number }> = {};
  const axisAgg: Record<string, { sum: number; n: number }> = {};
  let signalsPassed = 0;
  let signalsTotal = 0;
  let probesPassed = 0;
  let probesTotal = 0;
  const categoryRates: Record<string, { passed: number; total: number }> = {};

  for (const e of evidence) {
    signalsPassed += e.signals.filter(s => s.passed).length;
    signalsTotal += e.signals.length;
    probesPassed += e.probes.filter(p => p.passed).length;
    probesTotal += e.probes.length;
    categoryRates[e.category] ??= { passed: 0, total: 0 };
    categoryRates[e.category]!.passed += e.signals.filter(s => s.passed).length;
    categoryRates[e.category]!.total += e.signals.length;
    for (const p of e.probes) {
      probeAgg[p.probe] ??= { sum: 0, n: 0, passed: 0 };
      probeAgg[p.probe]!.sum += p.measured;
      probeAgg[p.probe]!.n++;
      if (p.passed) probeAgg[p.probe]!.passed++;
    }
    for (const [axis, v] of Object.entries(e.judge)) {
      axisAgg[axis] ??= { sum: 0, n: 0 };
      axisAgg[axis]!.sum += v;
      axisAgg[axis]!.n++;
    }
  }

  const judgeScores = new Map(evidence.map(e => [e.scenarioId, e.judge]));
  const cal = calibrateJudge(judgeScores, GOLDEN_LABELS, 0.7);

  const md: string[] = [];
  md.push(`# Perfectman Roleplay Evidence Report\n`);
  md.push(`- Generated: ${new Date().toISOString()}`);
  md.push(`- Scenarios: ${evidence.length} (base, no rotation)`);
  md.push(`- Signal pass rate: ${pct(signalsPassed, signalsTotal)}`);
  md.push(`- Probe pass rate: ${pct(probesPassed, probesTotal)}`);
  md.push(`- Judge calibration (rule judge vs golden labels): kappa ${cal.kappa} (target ${cal.targetKappa}) — ${cal.passed ? "PASS" : "FAIL (expected for v0 rule judge; calibrate with the LLM judge)"}\n`);

  md.push(`## By category (signals)\n`);
  md.push(`| Category | Pass |`);
  md.push(`|---|---|`);
  for (const [cat, r] of Object.entries(categoryRates)) {
    md.push(`| ${cat} | ${pct(r.passed, r.total)} (${r.passed}/${r.total}) |`);
  }

  md.push(`\n## Probe averages\n`);
  md.push(`| Probe | Mean | Pass % |`);
  md.push(`|---|---|---|`);
  for (const [probe, a] of Object.entries(probeAgg)) {
    md.push(`| ${probe} | ${round3(a.sum / a.n)} | ${Math.round((a.passed / a.n) * 100)}% |`);
  }

  md.push(`\n## Judge axis means (rule judge)\n`);
  md.push(`| Axis | Mean |`);
  md.push(`|---|---|`);
  for (const [axis, a] of Object.entries(axisAgg)) {
    md.push(`| ${axis} | ${round3(a.sum / a.n)} |`);
  }

  md.push(`\n## Key scenes\n`);
  const highlights = pickHighlights(evidence);
  for (const id of highlights) {
    const e = evidence.find(x => x.scenarioId === id);
    if (!e) continue;
    md.push(`\n### ${e.name} (\`${e.scenarioId}\`)\n`);
    md.push(`> ${e.description}`);
    md.push(`\`\`\`text`);
    md.push(formatTranscript(e, 60));
    md.push(`\`\`\``);
  }

  if (novela) {
    md.push(`\n## Long-form novela run (\`${novela.scenarioId}\`)\n`);
    md.push(`> ${novela.description}`);
    md.push(`\n${novela.pulses} pulses · ${novela.transcript.length} events · private channels: ${novela.channelsCreated.join(", ") || "none"}`);
    md.push(`\nFinal states:\n`);
    for (const [agent, state] of Object.entries(novela.finalStates)) {
      md.push(`- **${agent}**: ${Object.entries(state).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    md.push(`\n\`\`\`text`);
    md.push(formatTranscript(novela, 200));
    md.push(`\`\`\``);
  }

  const reportPath = resolve(outDir, "evidence-report.md");
  writeFileSync(reportPath, md.join("\n"), "utf8");
}

function pct(passed: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((passed / total) * 1000) / 10}%`;
}

/** Scenes that best demonstrate the V1 behaviors — one per target behavior. */
function pickHighlights(evidence: ScenarioEvidence[]): string[] {
  const wanted = [
    "v1_mention_reply",
    "v1_mention_ignored",
    "v1_private_motive",
    "v1_exclusion_inferred",
    "v1_late_reply",
    "v1_emoji_reaction",
    "v1_biased_memory",
    "motive_gossip",
    "motive_alliance",
    "stagnation_resentment_loop",
    "edge_public_mock",
    "edge_exclusion_cascade",
  ];
  const have = new Set(evidence.map(e => e.scenarioId));
  return wanted.filter(id => have.has(id));
}

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(): Promise<void> {
  const { evidence, outDir, novela } = await generateEvidence({
    out: argValue("--out"),
    scenarios: argValue("--scenarios")?.split(",").filter(Boolean),
    llmMode: (argValue("--mode") as "mock" | "local") ?? "mock",
    novela: args.includes("--novela"),
  });
  writeEvidenceReport(evidence, outDir, novela);
  console.log(`evidence written to ${outDir}`);
  console.log(`scenarios: ${evidence.length}, transcripts total lines: ${evidence.reduce((s, e) => s + e.transcript.length, 0)}`);
  if (novela) console.log(`novela run: ${novela.pulses} pulses, ${novela.transcript.length} events, channels: ${novela.channelsCreated.join(", ") || "none"}`);
}

if (process.argv[1]?.endsWith("evidence.js") || process.argv[1]?.endsWith("evidence.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
