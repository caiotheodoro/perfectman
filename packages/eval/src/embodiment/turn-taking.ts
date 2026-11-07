import { sampleLandingDelayMs } from "@perfectman/server";
import { createSeededRng, type AgentRuntimeInput, type CommittedEvent, type SeededRng } from "@perfectman/shared";
import { buildGridWorld, type GridWorld, type ModelPlan, type ScriptedModel } from "./grid-world.js";

/**
 * Scripted, labeled turn-taking probes (docs/embodiment.md 8.3, plan
 * "Turn-taking [scripted labeled probes + frame log]"). The room, the human,
 * the split scheduler, the arbiter, the resolver and the prompt are the real
 * ones; only the model is a seeded stand-in whose behaviour priors come from
 * the Phase 1 spike. These numbers show what the arbiter and the scheduler do
 * to a model that behaves like that. They are NOT real-model numbers (the
 * real-model probe is the one that counts, Tilehouse eval-plan.md section 10).
 */

export type TurnTakingScenario = "addressed" | "unaddressed" | "typing" | "quiet" | "latency";

export type TurnTakingOptions = {
  scenario: TurnTakingScenario;
  /** Human lines (trials). Default 200 for the dog-pile scenarios, 40 for the others. */
  lines?: number;
  /** false runs the ungoverned baseline. Default true. */
  arbiter?: boolean;
  seed?: number;
  /** Actors in the room. Default 8. */
  actors?: number;
};

export type TurnTakingMetrics = {
  scenario: TurnTakingScenario;
  arbiter: boolean;
  lines: number;
  /**
   * Unaddressed line: answered by two or more actors. Addressed line: an actor
   * who was not addressed spoke before the addressee did (or the addressee
   * never did).
   */
  dogPileRate: number;
  /** Lines answered by more actors than were addressed (ADR-0021 still allows up to 3 lines after the addressee). */
  extraAnswerRate: number;
  /**
   * Timing rule 2: human lines after which an actor line beyond the expected answers
   * (one, or one per addressee) landed inside the 10 s quiet window. Gestures and
   * expressions are not lines, so they do not count.
   */
  interjectionRate: number;
  /** Addressed lines whose addressee answered. */
  addresseeAnsweredRate: number;
  answersPerLine: number;
  /** Actor lines landing while a human typed (typing scenario). */
  botLinesWhileTyping: number;
  /** Actor lines in the 10 s after a human line that were not that line's one answer (quiet scenario). */
  ambientBeforeQuiet: number;
  /** Ambient lines that did land once the room had been quiet for 10 s. */
  ambientAfterQuiet: number;
  /** Lines the arbiter denied (each became a recorded silence). */
  arbiterDenials: number;
  /** `no_op_recorded` events committed (denied lines fall back to these). */
  fallbackCommitted: number;
  addressedLatencyMs: { n: number; p50: number; p95: number };
};

/** Spike profile A: median 2.5 s, p95 6 s, lognormal. */
export function fastLatencyMs(rng: SeededRng): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng.next());
  return Math.round(2500 * Math.exp(0.532 * z));
}

/** Spike priors: an addressee answers; an unaddressed observer speaks with 0.5, or 0.1 when an answer is already in view. */
export function spikeModel(): ScriptedModel {
  let n = 0;
  return ({ input, rng }): ModelPlan => {
    const plan = (speak: boolean): ModelPlan => ({
      latencyMs: fastLatencyMs(rng),
      packet: speak
        ? { intentType: "send_message", visibleContent: `resposta ${++n} de ${input.agentId}`, privateMotiveSummary: "quero responder", personTargets: [] }
        : { intentType: "no_op", privateMotiveSummary: "prefiro ouvir", personTargets: [] },
    });
    const events = input.perceptionPacket.visibleContextEvents;
    const lastHumanIdx = findLastIndex(events, isHuman);
    const trigger = input.perceptionPacket.triggeringEvent;
    const addressed = (trigger?.payload["mentionedAgentIds"] as string[] | undefined)?.includes(input.agentId) === true;
    if (addressed) return plan(true);
    const answerVisible = events.slice(lastHumanIdx + 1).some((e) => e.type === "message_sent" && !isHuman(e));
    return plan(rng.next() < (answerVisible ? 0.1 : 0.5));
  };
}

const isHuman = (e: CommittedEvent): boolean => e.actorId.startsWith("h:");

function findLastIndex<T>(items: readonly T[], pred: (x: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i]!)) return i;
  return -1;
}

const percentile = (sorted: readonly number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

const NAMES = ["Duda", "Rafa", "Gabi", "Leo", "Nina", "Caio", "Bia", "Theo", "Lia", "Ravi", "Maya", "Davi"];
const DELAY: [number, number] = [800, 4000];
/** The arbiter's quiet window at the default scenario energy (10 s). */
const QUIET_WINDOW_MS = 10_000;

async function buildRoom(options: TurnTakingOptions): Promise<{ world: GridWorld; actorIds: string[]; human: string; rng: SeededRng }> {
  const count = options.actors ?? 8;
  const seed = options.seed ?? 7;
  const actors = Array.from({ length: count }, (_, i) => ({
    id: NAMES[i]!.toLowerCase(),
    name: NAMES[i]!,
    responseDelayMs: DELAY,
    tile: [1 + (i % 8), 6 + (i >= 8 ? -1 : 0)] as [number, number],
  }));
  const world = await buildGridWorld({
    actors,
    model: spikeModel(),
    seed,
    arbiter: options.arbiter === false ? false : {},
    baseLane: options.scenario === "latency",
  });
  world.grid.advance(300);
  const human = world.grid.humanEnter("u1", "Visitante", "lounge", [5, 3]);
  await world.flush();
  return { world, actorIds: actors.map((a) => a.id), human, rng: createSeededRng(seed * 31 + 5) };
}

/** Who notices a line and consults: each actor with probability q, never nobody. */
function observers(ids: readonly string[], q: number, rng: SeededRng, always: readonly string[] = []): string[] {
  const picked = ids.filter((id) => always.includes(id) || rng.next() < q);
  return picked.length > 0 ? picked : [ids[rng.nextInt(ids.length)]!];
}

export async function runTurnTakingProbe(options: TurnTakingOptions): Promise<TurnTakingMetrics> {
  const arbiterOn = options.arbiter !== false;
  const { world, actorIds, human, rng } = await buildRoom(options);
  const lines = options.lines ?? (options.scenario === "addressed" || options.scenario === "unaddressed" ? 200 : 40);
  const metrics: TurnTakingMetrics = {
    scenario: options.scenario,
    arbiter: arbiterOn,
    lines,
    dogPileRate: 0,
    extraAnswerRate: 0,
    interjectionRate: 0,
    addresseeAnsweredRate: 0,
    answersPerLine: 0,
    botLinesWhileTyping: 0,
    ambientBeforeQuiet: 0,
    ambientAfterQuiet: 0,
    arbiterDenials: 0,
    fallbackCommitted: 0,
    addressedLatencyMs: { n: 0, p50: 0, p95: 0 },
  };
  let dogPiled = 0;
  let extra = 0;
  let interjected = 0;
  let answeredByAddressee = 0;
  let addressedLines = 0;
  let answers = 0;
  const latencies: number[] = [];

  for (let i = 0; i < lines; i++) {
    const addressee = actorIds[rng.nextInt(actorIds.length)]!;
    const label = options.scenario === "addressed" || options.scenario === "latency";
    const text = label ? `${world.names[addressee]}, o que voce acha disso?` : "alguem sabe onde fica o banheiro?";
    const lineAt = world.grid.now();
    const from = world.spoken.length;
    const callsFrom = world.calls.length;

    const said = await world.humanSay(human, text);
    if (options.scenario === "typing") {
      // The human is already typing the next line: the room must hold its tongue for 6 s.
      world.humanType(human, true);
      world.loop.requestFocused(observers(actorIds, 0.6, rng));
      await world.runFor(6_000);
      metrics.botLinesWhileTyping += world.spoken.slice(from).filter((s) => s.at >= lineAt && s.at < lineAt + 6_000).length;
      world.humanType(human, false);
      await world.runUntilQuiet(40_000);
      await world.runFor(12_000);
      continue;
    }
    world.loop.requestFocused(
      options.scenario === "unaddressed" || options.scenario === "quiet" ? observers(actorIds, 0.35, rng) : observers(actorIds, 0.35, rng, said.addressedIds),
    );

    if (options.scenario === "quiet") {
      await world.runFor(4_000);
      world.loop.requestFocused(observers(actorIds, 0.5, rng));
      await world.runFor(6_500); // 10.5 s after the line
      world.loop.requestFocused(observers(actorIds, 0.5, rng));
      await world.runFor(8_000);
      const after = world.spoken.slice(from);
      const answerOnly = after.filter((s) => s.at < lineAt + 10_000);
      metrics.ambientBeforeQuiet += Math.max(0, answerOnly.length - 1);
      metrics.ambientAfterQuiet += after.filter((s) => s.at >= lineAt + 10_000).length;
      await world.runFor(15_000);
      continue;
    }

    await world.runUntilQuiet(40_000);
    const after = world.spoken.slice(from).filter((s) => s.at >= lineAt);
    answers += after.length;
    if (after.length > Math.max(1, said.addressedIds.length)) extra += 1;
    if (after.filter((s) => s.at < lineAt + QUIET_WINDOW_MS).length > Math.max(1, said.addressedIds.length)) interjected += 1;
    if (said.addressedIds.length === 0) {
      if (after.length >= 2) dogPiled += 1;
    } else {
      addressedLines += 1;
      const firstOwn = after.findIndex((s) => said.addressedIds.includes(s.agentId));
      if (firstOwn !== -1) answeredByAddressee += 1;
      if (after.some((s, idx) => !said.addressedIds.includes(s.agentId) && (firstOwn === -1 || idx < firstOwn))) dogPiled += 1;
    }

    if (options.scenario === "latency" && said.addressedIds[0]) {
      const target = said.addressedIds[0];
      const reply = after.find((s) => s.agentId === target);
      const call = world.calls.slice(callsFrom).find((c) => c.agentId === target);
      if (reply && call) {
        const range = world.runtime.getResponseDelayMs(world.simulationId, target);
        const landsAt = Math.max(reply.at, call.at + sampleLandingDelayMs(range, reply.content.length, () => rng.next()));
        latencies.push(landsAt - lineAt);
      }
    }
    await world.runFor(options.scenario === "latency" ? 4_000 + rng.nextInt(12_000) : 12_000);
  }

  const log = await world.runtime.getEventLog().getCommittedThrough(world.simulationId, Number.MAX_SAFE_INTEGER);
  metrics.arbiterDenials = log.filter(
    (e) => e.type === "intent_blocked" && JSON.stringify(e.payload["violations"] ?? []).includes("room_speech:"),
  ).length;
  // A denial is `policy_blocked`, so the resolver commits the engine's no_op fallback right behind it.
  metrics.fallbackCommitted = log.filter(
    (e, i) =>
      e.type === "intent_blocked" &&
      JSON.stringify(e.payload["violations"] ?? []).includes("room_speech:") &&
      log[i + 1]?.type === "no_op_recorded" &&
      log[i + 1]?.actorId === e.actorId,
  ).length;
  const labelled = lines > 0 ? lines : 1;
  metrics.dogPileRate = dogPiled / labelled;
  metrics.extraAnswerRate = extra / labelled;
  metrics.interjectionRate = interjected / labelled;
  metrics.addresseeAnsweredRate = addressedLines === 0 ? 0 : answeredByAddressee / addressedLines;
  metrics.answersPerLine = answers / labelled;
  latencies.sort((a, b) => a - b);
  metrics.addressedLatencyMs = { n: latencies.length, p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) };
  return metrics;
}

