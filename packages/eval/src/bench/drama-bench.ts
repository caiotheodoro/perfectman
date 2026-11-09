import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { seedState } from "../embodiment/sim-states.js";
import type { SeedRelations } from "../embodiment/sim-states.js";
import type { ScenarioBeat } from "@perfectman/hotel/drama";
import type { ActStartedEvent, DramaEvent } from "../drama/index.js";
import type { SocialEmotions, CoreMood } from "@perfectman/shared";

/**
 * The drama bench: the scenarios the act contract makes checkable, each run offline on the fake grid hotel with the mock model and the real
 * drama director and planner, and judged by rule (the drama probes over the frames, plus what the scenario itself promises). Deterministic: no
 * model, no network, the same frames every run. A scenario passes when every probe passes and every check of its own holds, so a regression in the
 * ladder, the budgets, the reaction obligations, death, consent or calm turns the bench gate red (`scripts/ci/check-bench-gate.mjs`).
 */

export type DramaCheck = { name: string; ok: boolean; detail?: string };
export type DramaScenario = { id: string; name: string; build: () => SimConfig | Promise<SimConfig>; check: (r: SimResult) => DramaCheck[] };

export type DramaBenchEntry = { id: string; name: string; passed: boolean; checks: DramaCheck[]; probesFailed: string[]; acts: number; failed?: string };
export type DramaBenchReport = { scenariosRun: number; scenariosFailed: number; passRate: number; checksRun: number; checksFailed: number; perScenario: DramaBenchEntry[] };

// ---- building blocks ----------------------------------------------------------------------------------------

const REFS = ["ana", "bia", "caio", "duda"] as const;
const NAMES: Record<string, string> = { ana: "Ana", bia: "Bia", caio: "Caio", duda: "Duda" };
const START = 1_000_000;

/** A cold start: nobody feels anything the director reads. */
const CALM = (refs: readonly string[] = REFS) => new Map(refs.map((r) => [r, seedState(r, { others: refs })]));

type Hot = { mood?: Partial<CoreMood>; social?: Partial<SocialEmotions>; relations?: SeedRelations };
/**
 * Anger at its seat: the aggressor of a ladder (dominance past the punch threshold, a grievance toward the victim, a negative event a minute ago). Contempt and
 * resentment stay under the planner's `turn_back` threshold (0.6): a sulk is a de-escalation (LAD-7) and would send the ladder back down.
 */
const AGGRESSOR: Hot = {
  mood: { valence: -0.5, arousal: 0.92, stability: 0.3, energy: 0.92 },
  social: { desireForStatus: 0.95, pride: 0.9, resentment: 0.5, contempt: 0.45, humiliation: 0.5, jealousy: 0.5 },
};

function states(over: Record<string, Hot>, refs: readonly string[] = REFS) {
  return new Map(refs.map((r) => [r, seedState(r, { others: refs, ...(over[r] ?? {}) })]));
}

const grievance = (to: string): SeedRelations => ({ [to]: { resentment: 0.7, lastNegativeAt: START - 60_000 } });

const base = (title: string, over: Partial<SimConfig> & Pick<SimConfig, "states">): SimConfig => ({
  title,
  seed: 1,
  durationMs: 120_000,
  actors: REFS.map((ref) => ({ ref, name: NAMES[ref]! })),
  ...over,
});

const started = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const of = <K extends DramaEvent["kind"]>(r: SimResult, kind: K): Extract<DramaEvent, { kind: K }>[] => r.events.filter((e): e is Extract<DramaEvent, { kind: K }> => e.kind === kind);
const vetoes = (r: SimResult, reason: string, detail?: string) => r.proposals.filter((p) => /veto$/.test(p.decision) && p.reason === reason && (detail === undefined || p.detail === detail));
const ok = (name: string, value: boolean, detail?: string): DramaCheck => ({ name, ok: value, ...(detail !== undefined ? { detail } : {}) });
const pairVerbs = (r: SimResult, actor: string, target: string): string[] => started(r).filter((a) => a.actor === actor && a.with === target).map((a) => a.verb);
const isSubsequence = (want: readonly string[], got: readonly string[]): boolean => {
  let i = 0;
  for (const g of got) if (g === want[i]) i += 1;
  return i === want.length;
};
/** One line of a script as a scenario author thinks of it (ms into the run, `skip` for the authored skip); `script` numbers them as the compiled body does. */
type BenchBeat = { atMs: number; kind: "act"; actor: string; verb: ScenarioBeat extends infer B ? (B extends { verb: infer V } ? V : never) : never; with?: string; skip?: boolean } | { atMs: number; kind: "cut"; reason: string };
const script = (beats: readonly BenchBeat[]): ScenarioBeat[] =>
  beats.map((b, i): ScenarioBeat => (b.kind === "cut" ? { id: `b${i + 1}`, at_ms: b.atMs, kind: "cut", reason: b.reason } : { id: `b${i + 1}`, at_ms: b.atMs, kind: "act", actor: b.actor, verb: b.verb, ...(b.with ? { with: b.with } : {}), ...(b.skip ? { authored_skip: true as const } : {}) }));
const block = (max_rung: number, may_target: Array<[string, string]> = [], may_die: string[] = []) => ({ max_rung, may_target, may_die, permadeath: false });

// ---- the scenarios --------------------------------------------------------------------------------------------

export const DRAMA_SCENARIOS: readonly DramaScenario[] = [
  {
    id: "drama_ladder_full",
    name: "The full ladder: glare, insult, shove, slap, punch, each one rung after the last",
    build: () => base("ladder-full", { durationMs: 220_000, states: states({ ana: { ...AGGRESSOR, relations: grievance("bia") } }), drama: block(5, [["ana", "bia"]]) }),
    check: (r) => {
      const verbs = pairVerbs(r, "ana", "bia");
      const physical = started(r).filter((a) => ["shove", "slap", "punch", "kill"].includes(a.verb)).map((a) => a.atMs);
      return [
        ok("ana walks the whole ladder toward bia, in order", isSubsequence(["glare", "insult", "shove", "slap", "punch"], verbs), verbs.join(" ")),
        ok("no rung is started two steps over the last (the ladder probe sees no skip)", !r.probes.find((p) => p.probe === "ladder-compliance")?.codes.includes("D3")),
        ok("physical beats are at least 20 s apart", physical.every((t, i) => i === 0 || t - physical[i - 1]! >= 20_000), physical.join(", ")),
        ok("every act that started also ended, once", of(r, "act_done").length === started(r).length),
      ];
    },
  },
  {
    id: "drama_veto_skipped_rung",
    name: "A veto: a model that jumps from glare to slap is refused, and the ladder goes on from where it was",
    build: () => base("veto-skipped-rung", { durationMs: 160_000, states: states({ ana: { ...AGGRESSOR, relations: grievance("bia") } }), drama: block(5, [["ana", "bia"]]), mock: { skip: true } }),
    check: (r) => {
      const refused = vetoes(r, "ladder", "rung").find((p) => p.verb === "slap");
      const slap = started(r).find((a) => a.verb === "slap");
      const shove = started(r).find((a) => a.verb === "shove");
      return [
        ok("the slap after a glare is vetoed as a skipped rung (LAD-1)", refused !== undefined, JSON.stringify(refused)),
        ok("the refused slap never became an act before a shove had", slap === undefined || (shove !== undefined && shove.atMs < slap.atMs)),
        ok("the ladder still climbs afterwards: the step the slap skipped, the shove, starts after the veto", started(r).some((a) => a.verb === "shove" && a.atMs > (refused?.atMs ?? Infinity))),
        ok("no skip reached the hotel", !r.probes.find((p) => p.probe === "ladder-compliance")?.codes.includes("D3")),
      ];
    },
  },
  {
    id: "drama_budget_spacing",
    name: "Budget spacing: a model that proposes a blow every consult gets one physical beat per 20 s",
    build: () => base("budget-spacing", { durationMs: 200_000, states: states({ ana: { ...AGGRESSOR, relations: grievance("bia") } }), drama: block(5, [["ana", "bia"]]), mock: { gap: 1 } }),
    check: (r) => {
      const physical = started(r).filter((a) => ["shove", "slap", "punch", "kill"].includes(a.verb)).map((a) => a.atMs);
      return [
        ok("a blow proposed too soon is vetoed as budget (physical)", vetoes(r, "budget", "physical").length > 0, String(vetoes(r, "budget", "physical").length)),
        ok("two physical beats are never closer than 20 s", physical.length >= 2 && physical.every((t, i) => i === 0 || t - physical[i - 1]! >= 20_000), physical.join(", ")),
        ok("the ladder probe sees no budget breach", !r.probes.find((p) => p.probe === "ladder-compliance")?.codes.includes("D6")),
      ];
    },
  },
  {
    id: "drama_kill_once_per_scene",
    name: "One kill per scene: a second is refused, and a scene cut gives the next one back",
    build: () =>
      base("kill-once", {
        durationMs: 110_000,
        states: CALM(),
        drama: block(6, [["ana", "bia"], ["ana", "caio"]], ["bia", "caio"]),
        beats: script([
          { atMs: 20_000, kind: "act", actor: "ana", verb: "kill", with: "bia", skip: true },
          { atMs: 50_000, kind: "act", actor: "ana", verb: "kill", with: "caio", skip: true },
          { atMs: 62_000, kind: "cut", reason: "next scene" },
          { atMs: 90_000, kind: "act", actor: "ana", verb: "kill", with: "caio", skip: true },
        ]),
      }),
    check: (r) => {
      const deaths = of(r, "actor_death");
      const kills = started(r).filter((a) => a.verb === "kill");
      return [
        ok("the second kill in the scene is refused as budget (kill): by the director's gate, or by the beat player before it asks", vetoes(r, "budget", "kill").length + r.proposals.filter((p) => p.decision.startsWith("authored:") && ((p.reason === "budget" && p.detail === "kill") || p.reason === "kill_budget")).length > 0, JSON.stringify(r.proposals.filter((p) => p.decision.includes("authored")))),
        ok("two kills landed in all, one in each scene", kills.length === 2 && deaths.length === 2 && deaths[0]!.scene !== deaths[1]!.scene, `${kills.length} kills, ${deaths.map((d) => d.scene).join(", ")}`),
        ok("the scene cut revived the first victim", of(r, "actor_revive").some((v) => v.actor === "bia")),
        ok("the death probes are clean (scene-cut-revive, kill-victim-die-reaction)", r.probes.filter((p) => ["scene-cut-revive", "kill-victim-die-reaction", "ladder-compliance"].includes(p.probe)).every((p) => p.passed)),
      ];
    },
  },
  {
    id: "drama_reaction_obligations",
    name: "Reaction obligations: the target and every witness the hotel says owes one reacts inside its window",
    build: () =>
      base("reaction-obligations", {
        durationMs: 60_000,
        states: CALM(),
        actors: [{ ref: "ana", name: "Ana", tile: [4, 4] }, { ref: "bia", name: "Bia", tile: [5, 4] }, { ref: "caio", name: "Caio", tile: [4, 5] }, { ref: "duda", name: "Duda", tile: [6, 5] }],
        drama: block(4, [["ana", "bia"]]),
        beats: script([{ atMs: 15_000, kind: "act", actor: "ana", verb: "slap", with: "bia", skip: true }]),
      }),
    check: (r) => {
      const beat = of(r, "act_beat")[0];
      const target = r.probes.find((p) => p.probe === "reaction-latency-p90-target");
      const witness = r.probes.find((p) => p.probe === "reaction-latency-p90-witness");
      return [
        ok("the slap made contact with two witnesses owing a reaction and the target owing one", beat !== undefined && beat.owed.filter((o) => o.role === "witness").length >= 2 && beat.owed.some((o) => o.role === "target"), JSON.stringify(beat?.owed)),
        ok("the target reacted within 1500 ms of contact", (target?.measured ?? Infinity) <= 1500, String(target?.measured)),
        ok("the witnesses reacted within 3000 ms of contact", (witness?.measured ?? Infinity) <= 3000, String(witness?.measured)),
        ok("every owed witness reacted (witness-coverage 1) and nothing was left owed", r.probes.find((p) => p.probe === "witness-coverage")?.measured === 1 && r.probes.find((p) => p.probe === "owed-missed-empty")?.measured === 0),
      ];
    },
  },
  {
    id: "drama_dead_silent_until_revive",
    name: "A dead actor stays silent and still until the scene cut revives it, and speaks again after",
    build: () =>
      base("dead-silent", {
        durationMs: 110_000,
        states: states({ bia: { social: { contempt: 0.6, resentment: 0.5 }, relations: grievance("ana") } }),
        drama: block(6, [["ana", "bia"]], ["bia"]),
        beats: script([
          { atMs: 18_000, kind: "act", actor: "ana", verb: "kill", with: "bia", skip: true },
          { atMs: 60_000, kind: "cut", reason: "next scene" },
        ]),
      }),
    check: (r) => {
      const death = of(r, "actor_death").find((d) => d.actor === "bia");
      const revive = of(r, "actor_revive").find((v) => v.actor === "bia");
      const speech = r.events.filter((e) => e.kind === "speech" && e.actor === "bia");
      return [
        ok("bia died and was revived by the cut", death !== undefined && revive !== undefined && revive.atMs > death.atMs, `${death?.atMs} -> ${revive?.atMs}`),
        ok("bia said nothing between her death and her revive (dead-speech 0)", speech.every((s) => death === undefined || revive === undefined || s.atMs <= death.atMs || s.atMs >= revive.atMs) && r.probes.find((p) => p.probe === "dead-speech")?.measured === 0),
        ok("bia gave no body command while dead", !started(r).some((a) => a.actor === "bia" && death !== undefined && revive !== undefined && a.atMs > death.atMs && a.atMs < revive.atMs)),
        ok("bia is a speaker again after the revive", revive !== undefined && speech.some((s) => s.atMs > revive.atMs)),
      ];
    },
  },
  {
    id: "drama_consent_human_target",
    name: "Consent: a human who did not opt in is not struck; one who did answers a chip, and a dodge touches nobody",
    build: () =>
      base("consent-human", {
        durationMs: 110_000,
        states: CALM(["ana", "bia"]),
        actors: [{ ref: "ana", name: "Ana", tile: [4, 4] }, { ref: "bia", name: "Bia", tile: [2, 2] }],
        humans: [
          { id: 9, name: "Visitante", tile: [5, 4], optIn: true, answer: (q) => (q.verb === "slap" ? "take" : "dodge") },
          { id: 10, name: "Outro", tile: [4, 5], optIn: false },
        ],
        drama: block(4, [["ana", "@human"]]),
        beats: script([
          { atMs: 10_000, kind: "act", actor: "ana", verb: "shove", with: "h:10", skip: true },
          { atMs: 30_000, kind: "act", actor: "ana", verb: "slap", with: "h:9", skip: true },
          { atMs: 70_000, kind: "act", actor: "ana", verb: "shove", with: "h:9", skip: true },
        ]),
      }),
    check: (r) => {
      const toOut = started(r).filter((a) => a.with === "h:10");
      const chips = of(r, "consent_chip");
      const done = (verb: string) => of(r, "act_done").find((d) => d.verb === verb && d.with === "h:9");
      return [
        ok("the shove at the human who did not opt in is vetoed (consent_off) and nothing started", vetoes(r, "consent_off").length + r.proposals.filter((p) => p.reason === "consent_off").length > 0 && toOut.length === 0),
        ok("the slap at the human who opted in waited for a chip and landed on a take", done("slap")?.outcome === "landed" && chips.some((c) => c.phase === "answered" && c.rawAnswer === "take")),
        ok("the shove the human dodged touched nobody", done("shove")?.outcome === "dodged" || r.proposals.some((p) => p.verb === "shove" && p.with === "h:9" && p.decision.includes("veto"))),
        ok("no violent act landed on a human without a take", ["consent-violation", "human-untouched-without-take", "chip-timeout-dodge"].every((n) => r.probes.find((p) => p.probe === n)?.passed === true)),
      ];
    },
  },
  {
    id: "drama_calm_room",
    name: "A calm room: contact verbs are refused while it is on, and the kill switch stops everything",
    build: () =>
      base("calm-room", {
        durationMs: 130_000,
        states: CALM(["ana", "bia"]),
        actors: [{ ref: "ana", name: "Ana", tile: [4, 4] }, { ref: "bia", name: "Bia", tile: [5, 4] }],
        drama: block(4, [["ana", "bia"]]),
        controls: [{ atMs: 30_000, calm: true }, { atMs: 60_000, calm: false }, { atMs: 95_000, enabled: false }],
        beats: script([
          { atMs: 10_000, kind: "act", actor: "ana", verb: "slap", with: "bia", skip: true },
          { atMs: 45_000, kind: "act", actor: "ana", verb: "shove", with: "bia", skip: true },
          { atMs: 80_000, kind: "act", actor: "ana", verb: "glare", with: "bia" },
          { atMs: 100_000, kind: "act", actor: "ana", verb: "glare", with: "bia" },
        ]),
      }),
    check: (r) => {
      const authored = (verb: string) => r.proposals.find((p) => p.decision.startsWith("authored:") && p.verb === verb && p.atMs > 40_000);
      return [
        ok("the slap before calm landed", of(r, "act_done").some((d) => d.verb === "slap" && d.outcome === "landed")),
        ok("the shove while calm was on is refused (calm_room) and never started", r.proposals.some((p) => p.verb === "shove" && p.reason === "calm_room") && !started(r).some((a) => a.verb === "shove")),
        ok("a glare, which calm does not block, goes through once calm is off", started(r).some((a) => a.verb === "glare" && a.atMs > 60_000 && a.atMs < 95_000)),
        ok("with the kill switch off even a glare is refused (kill_switch)", authored("glare")?.atMs !== undefined && r.proposals.some((p) => p.verb === "glare" && p.reason === "kill_switch")),
      ];
    },
  },
  {
    id: "drama_off_unchanged",
    name: "Drama off: the same scene starts no act, sends no act command, and the planner plans what it always planned",
    build: () => presetSimConfig("tapa-na-cara", { dramaOn: false, durationMs: 120_000 }),
    check: (r) => {
      const actCmds = r.lines.filter((l) => l.dir === "in" && (l.frame["cmd"] as { k?: string } | undefined)?.k === "act");
      const dramaFrames = r.lines.filter((l) => l.dir === "out" && ["act_started", "act_beat", "act_reaction", "act_done", "drama_consent", "actor_death", "actor_revive", "human_down", "human_up", "scene_cut", "drama_state"].includes(String(l.frame["t"])));
      return [
        ok("no act command was sent", actCmds.length === 0, String(actCmds.length)),
        ok("the hotel sent no drama frame", dramaFrames.length === 0, String(dramaFrames.length)),
        ok("the planner's commands equal the plain planner's on every consult (offDeviations 0)", r.offDeviations === 0, String(r.offDeviations)),
        ok("nothing was proposed to a director (there is none)", r.proposals.every((p) => p.decision === "proposed")),
      ];
    },
  },
];

// ---- running them ------------------------------------------------------------------------------------------

/** Every probe passes except the ones a scenario is built to trip. The scenarios here trip none. */
export async function runDramaScenario(s: DramaScenario): Promise<DramaBenchEntry> {
  try {
    const result = runDramaSim(await s.build());
    const checks = s.check(result);
    const probesFailed = s.id === "drama_off_unchanged" ? [] : result.probes.filter((p) => !p.passed).map((p) => `${p.probe}=${p.measured}`);
    return { id: s.id, name: s.name, passed: checks.every((c) => c.ok) && probesFailed.length === 0, checks, probesFailed, acts: result.stats.started };
  } catch (err) {
    return { id: s.id, name: s.name, passed: false, checks: [], probesFailed: [], acts: 0, failed: err instanceof Error ? err.message : String(err) };
  }
}

export async function runDramaBench(only?: readonly string[]): Promise<DramaBenchReport> {
  const chosen = DRAMA_SCENARIOS.filter((s) => only === undefined || only.includes(s.id));
  const perScenario: DramaBenchEntry[] = [];
  for (const s of chosen) perScenario.push(await runDramaScenario(s));
  const checks = perScenario.flatMap((e) => e.checks);
  const failed = perScenario.filter((e) => !e.passed).length;
  return {
    scenariosRun: perScenario.length,
    scenariosFailed: failed,
    passRate: perScenario.length === 0 ? 0 : (perScenario.length - failed) / perScenario.length,
    checksRun: checks.length,
    checksFailed: checks.filter((c) => !c.ok).length,
    perScenario,
  };
}
