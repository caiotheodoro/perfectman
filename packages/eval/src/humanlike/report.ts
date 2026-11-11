import { BANDS } from "./score.js";
import type { HumanlikeScore } from "./score.js";
import type { HumanlikeMetrics } from "./metrics.js";

export type HumanlikeRow = { metrics: HumanlikeMetrics; score: HumanlikeScore };

const f = (n: number | null | undefined, d = 2): string => (n === null || n === undefined ? "n/a" : Number.isInteger(n) ? String(n) : n.toFixed(d));
const pct = (n: number | null | undefined): string => (n === null || n === undefined ? "n/a" : `${Math.round(n * 100)}%`);

/** One run in words: the headline, the five group scores and every metric the plan asks for. */
export function renderRow(row: HumanlikeRow): string {
  const { metrics: m, score: s } = row;
  const g = s.groups;
  const out: string[] = [];
  out.push(`${m.source === "sim" ? "sim " : "run "}${m.run}${m.arm ? ` [${m.arm}]` : ""}  human-likeness ${s.score}/100  (proxemics ${f(g.proxemics, 0)}, gaze ${f(g.gaze, 0)}, turns ${f(g.turns, 0)}, gesture ${f(g.gesture, 0)}, idle ${f(g.idle, 0)}; ${s.scored}/${s.total} bands scored)`);
  out.push(`  ${m.cast} actors, ${m.lines} lines (${m.addressedLines} addressed), ${m.durationS} s`);
  const d = m.distance;
  out.push(`  distance at a line: median ${f(d.median)}, p90 ${f(d.p90)}; intimate ${pct(d.bandShare?.intimate)}, personal ${pct(d.bandShare?.personal)}, social ${pct(d.bandShare?.social)}, public ${pct(d.bandShare?.public)}; within earshot ${pct(d.inEarshotShare)}; same tile ${d.sameTile}`);
  out.push(`  stacking: ${m.stacking.events} events, ${(m.stacking.ms / 1000).toFixed(0)} s, ${f(m.stacking.perActorHour)} per actor-hour`);
  out.push(`  gaze (${m.gaze.n} lines): speaker faces addressee ${pct(m.gaze.speakerRate)}, listener faces speaker ${pct(m.gaze.listenerRate)}, mutual ${pct(m.gaze.mutualRate)}, break-and-return ${pct(m.gaze.breakReturnRate)}`);
  const l = m.latency;
  out.push(`  reaction latency to first key (n ${l.startTyping.n}): p25 ${f(l.startTyping.p25, 0)} / p50 ${f(l.startTyping.p50, 0)} / p75 ${f(l.startTyping.p75, 0)} ms; line to line p50 ${f(l.lineToLine.p50, 0)} ms (n ${l.lineToLine.n}); typing started before the line it answers ${l.overlapStarts}`);
  out.push(`  overlap ${pct(m.overlap.rate)} (${m.overlap.n}), interruption by dash ${pct(m.interruption.rate)} (${m.interruption.n})`);
  out.push(`  typing: median ${f(m.typing.medianMs, 0)} ms (${f(m.typing.medianMsPer100Chars, 0)} ms per 100 chars), length correlation ${f(m.typing.lengthCorrelation)}, ${f(m.typing.togglesPerLine)} off-toggles per line`);
  out.push(`  gesture: ${pct(m.gesture.perLine)} of lines, ${f(m.gesture.perActorMin)} per actor-minute (${Object.entries(m.gesture.byKind).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}); non-verbal backchannel ${pct(m.backchannel.rate)} of ${m.backchannel.n} heard lines`);
  out.push(`  idle motion ${f(m.idle.motionPerActorMin)} per actor-minute, frozen windows ${pct(m.idle.frozenShare)}, walks ${f(m.walks.perActorMin)} per actor-minute (${m.walks.total}), reversals ${f(m.idle.reversalsPerActorHour)} per actor-hour, face changes ${f(m.expression.changesPerActorMin)} per actor-minute`);
  return out.join("\n");
}

/** `docs/eval/humanlike-baseline.md`: the rows, then every band with where it comes from. */
export function renderBaselineMarkdown(title: string, rows: readonly HumanlikeRow[], note: string): string {
  const out: string[] = [];
  out.push(`# ${title}`, "", note, "");
  out.push("## Scores", "");
  out.push("| run | actors | lines | seconds | score | proxemics | gaze | turns | gesture | idle |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const { metrics: m, score: s } of rows) {
    out.push(`| ${m.run}${m.arm ? ` ${m.arm}` : ""} | ${m.cast} | ${m.lines} | ${Math.round(m.durationS)} | **${s.score}** | ${f(s.groups.proxemics, 0)} | ${f(s.groups.gaze, 0)} | ${f(s.groups.turns, 0)} | ${f(s.groups.gesture, 0)} | ${f(s.groups.idle, 0)} |`);
  }
  out.push("", "## Measures", "");
  out.push("| run | median dist | in earshot | same-tile lines | stacked events | speaker gaze | listener gaze | latency p50 ms | overlap | dash-cut | typing r | gesture/line | backchannel | walks/actor-min | idle/actor-min | frozen |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { metrics: m } of rows) {
    out.push(
      `| ${m.run}${m.arm ? ` ${m.arm}` : ""} | ${f(m.distance.median)} | ${pct(m.distance.inEarshotShare)} | ${m.distance.sameTile} | ${m.stacking.events} | ${pct(m.gaze.speakerRate)} | ${pct(m.gaze.listenerRate)} | ${f(m.latency.startTyping.p50, 0)} | ${pct(m.overlap.rate)} | ${pct(m.interruption.rate)} | ${f(m.typing.lengthCorrelation)} | ${pct(m.gesture.perLine)} | ${pct(m.backchannel.rate)} | ${f(m.walks.perActorMin)} | ${f(m.idle.motionPerActorMin)} | ${pct(m.idle.frozenShare)} |`,
    );
  }
  out.push("", "## Bands and where they come from", "");
  out.push("Every band is a prior unless the source column says otherwise: **prior** = literature or judgement, not measured on this hotel; **corpus** = read off the cinema-norms corpus (agent E1); **runs** = measured on runs 55-63.", "");
  out.push("| band | group | lo | hi | weight | source | basis |", "|---|---|---|---|---|---|---|");
  for (const b of BANDS) out.push(`| ${b.label} (\`${b.key}\`) | ${b.group} | ${b.lo} | ${b.hi} | ${b.weight} | ${b.src} | ${b.note} |`);
  out.push("");
  return out.join("\n");
}
