/**
 * Latency spike harness (Phase 1 lane C). THROWAWAY.
 * Variant "seq"  = the real, unmodified PulseScheduler (today).
 * Variant "split"/"split_early" = spike/split-scheduler.ts (ADR-0020 fork) + focused pulse driver.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AgentState, Simulation, SimulationSettings, PersonaConfig, ActionIntent, EngineSnapshot, EngineStepResult } from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { runEngineStep } from "@perfectman/engine";
import { PulseScheduler, type AgentContext, type AgentRuntime, type LLMBudget } from "../packages/server/src/simulation/pulse-scheduler.js";
import { SplitPulseScheduler } from "./split-scheduler.js";
import { InMemoryEventRepository, InMemoryAgentStateRepository, InMemoryChannelRepository } from "../packages/server/src/simulation/in-memory-stores.js";
import { ChannelRegistry } from "../packages/server/src/simulation/channel-registry.js";
import { RateLimitGate } from "../packages/server/src/simulation/rate-limit-gate.js";
import { IntentResolver } from "../packages/server/src/simulation/intent-resolver.js";
import { EngineSnapshotProjection } from "../packages/server/src/simulation/projections/engine-snapshot-projection.js";
import { DeliveryProjection } from "../packages/server/src/simulation/projections/delivery-projection.js";
import { SpectatorProjection } from "../packages/server/src/simulation/projections/spectator-projection.js";
import { OperatorProjection } from "../packages/server/src/simulation/projections/operator-projection.js";
import { EngineEventBuilder } from "../packages/server/src/simulation/engine-event-builder.js";
import { MockDeliveryGateway } from "../packages/server/src/delivery/mock-delivery-gateway.js";
import { VirtualClock, RealClock, type Clock } from "./clock.js";

export type Variant = "seq" | "split" | "split_early" | "split_par" | "split_stream";
export type ArbiterMode = "none" | "one" | "adr" | "claim";
export type Cfg = {
  variant: Variant;
  llm: { name: string; median: number; p95: number };
  concurrency: number; // split only
  debounceMs: number; // split only; trailing debounce on focused pulse (0 = fire immediately)
  baseIntervalMs: number;
  deadlineMs: number;
  lineKind: "addressed" | "unaddressed";
  nLines: number;
  meanGapMs: number;
  arbiter: ArbiterMode;
  consultsPerPulse: number; // mean ambient consults per base pulse (of 12 agents)
  qSee: number; // P(unaddressed line triggers a consult for an in-band agent)
  pFresh: number; // P(speaks | consulted, no answer visible in snapshot)
  pAnswered: number; // P(speaks | consulted, an answer already visible)
  agents: number;
  seed: number;
  real: boolean; // real clock (validation run) vs virtual
  realStep: boolean; // run the real runEngineStep for CPU realism
  persona: { delayMs: [number, number]; charsMedian: number };
};

export const DEFAULT: Cfg = {
  variant: "seq",
  llm: { name: "A", median: 2500, p95: 6000 },
  concurrency: 4,
  debounceMs: 1500,
  baseIntervalMs: 5000,
  deadlineMs: 20_000,
  lineKind: "addressed",
  nLines: 200,
  meanGapMs: 14000,
  arbiter: "one",
  consultsPerPulse: 3,
  qSee: 0.35,
  pFresh: 0.5,
  pAnswered: 0.1,
  agents: 12,
  seed: 1,
  real: false,
  realStep: true,
  persona: { delayMs: [500, 2000], charsMedian: 45 },
};

// ---------- rng / distributions ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const Z95 = 1.6448536269514722;
function lognormal(r: () => number, median: number, p95: number): number {
  return Math.exp(Math.log(median) + (Math.log(p95 / median) / Z95) * normal(r));
}
export function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

// ---------- fixtures ----------
const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false, allowPrivateChannels: true, maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 60, llmCallBudgetPerMinute: 10_000, pulseIntervalMs: 5000, tokenBudgetPerHour: 1e9,
};
function mkState(agentId: string): AgentState {
  return {
    agentId, simulationId: "sim_spike", personaId: `persona_${agentId}`, presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
    relationalStates: new Map(), memories: [], initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null,
    lastRuminationPulse: null, arrivalPulse: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
function mkPersona(agentId: string): PersonaConfig {
  return {
    id: `persona_${agentId}`, name: `Agent ${agentId}`, archetype: "test", writingStyle: "casual", styleExamples: [],
    baselineValence: 0, baselineArousal: 0.5, baselineStability: 0.8, baselineEnergy: 0.6, emotionalReactivity: 0.5,
    moodInertia: 0.5, maxMoodRotation: 0.5, energyRegen: 0.05, exclusionSensitivity: 0.5, praiseSensitivity: 0.5,
    conflictSensitivity: 0.5, boredomSensitivity: 0.5, intimacySensitivity: 0.5, socialSensitivities: {},
  };
}

// ---------- world model ----------
type Answer = { agent: string; consultAt: number; commitAt: number; rawLandingAt: number; landingAt: number };
type Line = {
  claimedBy?: string;
  id: number; t: number; addressed: string | null; expiresAt: number;
  seen: Set<string>; answers: Answer[]; consultAt?: number; // addressed: consult start of the addressee
  busyAtArrival: boolean; focusedQueued?: boolean;
};
type Meta = { agent: string; line: Line | null; consultAt: number; chars: number; sawAnswer: boolean };

export type Result = {
  cfg: Cfg;
  virtualMs: number;
  lines: number;
  latency: { p50: number; p95: number; p99: number; mean: number; max: number } | null;
  withinTarget: { p50ok: boolean; p95ok: boolean } | null;
  breakdown: { waitToConsultP50: number; waitToConsultP95: number; genP50: number; typingExtraP50: number; spacingP50: number; spacingP95: number; noSpacingP50: number; noSpacingP95: number } | null;
  busyAtArrivalPct: number;
  waitedForInflightPct: number; // consult started >1 s after arrival
  unanswered: number;
  dogpile: { rate: number; multi: number; lines: number; meanAnswers: number; blockedByArbiter: number; wastedCalls: number } | null;
  consults: { total: number; perBasePulse: number; perMin: number };
  basePulses: number;
  eventLoop: { busyP50: number; busyP99: number; busyMax: number; eldP99: number; eldMax: number; eldMean: number };
  wallSeconds: number;
  rawLat: number[];
  rawAnswers: number[];
};

export async function runExperiment(cfg: Cfg): Promise<Result> {
  const wall0 = performance.now();
  const rnd = mulberry32(cfg.seed * 7919 + 13);
  const rLLM = mulberry32(cfg.seed * 104729 + 7);
  const rWorld = mulberry32(cfg.seed * 1299709 + 3);
  const vclock = cfg.real ? null : new VirtualClock();
  const clock: Clock = cfg.real ? new RealClock() : vclock!;
  const realDateNow = Date.now;
  const DATE0 = 1_800_000_000_000;
  if (!cfg.real) Date.now = () => DATE0 + clock.now();

  try {
    const agentIds = Array.from({ length: cfg.agents }, (_, i) => `agent_${i + 1}`);
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
    await channelRepo.create({
      id: "ch_public", simulationId: "sim_spike", type: "public_channel", name: "room", createdBy: "system",
      memberAgentIds: agentIds, spectatorVisible: true, operatorVisible: true, createdForMotives: [],
      status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    });
    for (const id of agentIds) {
      await channelRepo.addMembership({ channelId: "ch_public", agentId: id, joinedAt: Date.now() });
      await agentStateRepo.upsert(mkState(id));
    }
    const sim: Simulation = {
      id: "sim_spike", name: "spike", status: "running", agentIds, channelIds: ["ch_public"], settings: SETTINGS,
      seed: 42, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const agents: AgentContext[] = agentIds.map((id) => ({ id, state: mkState(id), persona: mkPersona(id) }));

    // ----- world state -----
    const lines: Line[] = [];
    const metas = new Map<string, Meta>();
    let metaSeq = 0;
    const intentMeta = new Map<string, Meta>();
    const lastEvalAt = new Map<string, number>();
    let lastHumanLineAt = -1e9;
    let actorLinesSinceHuman = 0;
    let lastLandingAt = -1e9;
    let totalConsults = 0;
    let basePulses = 0;
    let blockedByArbiter = 0;
    let wastedCalls = 0; // llm calls whose line was then blocked by the gate
    let stopped = false;
    const consultAtByAgent = new Map<string, number>();
    const pAmbient = Math.min(0.95, cfg.consultsPerPulse / cfg.agents);
    const Q_SEE = cfg.qSee;
    const P_SPEAK_FRESH = cfg.pFresh;
    const P_SPEAK_ANSWERED = cfg.pAnswered;
    const P_AMBIENT_SPEAK = 0.5;
    const LINE_TTL = 30_000;

    // pending addressed set for the reserved slot / priority
    const metaOf = (reason: string | undefined): Meta | undefined => (reason?.startsWith("spike:") ? metas.get(reason) : undefined);
    const isAddressed = (sr: EngineStepResult) => {
      const m = metaOf(sr.attentionResults.triggeringReason);
      return !!m && m.line !== null && m.line.addressed === m.agent;
    };

    const stepResolver = (snap: EngineSnapshot): EngineStepResult => {
      const agentId = snap.agentState.agentId;
      const now = clock.now();
      let meta: Meta | null = null;
      let need = false;
      for (const line of lines) {
        if (line.t > now || line.seen.has(agentId)) continue;
        if (now > line.expiresAt && line.addressed !== agentId) continue; // an addressed line never expires for its addressee
        line.seen.add(agentId);
        if (line.addressed === agentId) {
          need = true; meta = { agent: agentId, line, consultAt: 0, chars: 0, sawAnswer: false }; break;
        }
        if (line.addressed === null) {
          if ((cfg.arbiter === "one" || cfg.arbiter === "claim") && line.answers.length > 0) continue; // arbiter.preview
          if (cfg.arbiter === "claim" && line.claimedBy !== undefined) { line.seen.delete(agentId); continue; } // an in-flight consult holds the line; look again next pulse
          if (rWorld() < Q_SEE) {
            if (cfg.arbiter === "claim") line.claimedBy = agentId;
            need = true;
            meta = { agent: agentId, line, consultAt: 0, chars: 0, sawAnswer: line.answers.length > 0 };
            break;
          }
        }
      }
      const prevEval = lastEvalAt.get(agentId) ?? -1e9;
      if (!need && now - prevEval >= 0.8 * cfg.baseIntervalMs && rWorld() < pAmbient) {
        need = true;
        meta = { agent: agentId, line: null, consultAt: 0, chars: 0, sawAnswer: false };
      }
      lastEvalAt.set(agentId, now);
      const metaId = need && meta ? `spike:${++metaSeq}` : "spike:none";
      if (need && meta) metas.set(metaId, meta);

      const base = cfg.realStep ? runEngineStep(snap) : cannedStep(agentId);
      return {
        ...base,
        attentionResults: { ...base.attentionResults, triggeringReason: metaId },
        decision: { outcome: need ? "act" : "no_op", needsLLM: need, initiativeProceed: false, ...(need ? {} : { noOpReason: "spike" }) } as EngineStepResult["decision"],
        noOpRecord: need ? null : base.noOpRecord,
        availableActions: [{ intentType: "send_message", channelTargets: ["ch_public"], personTargets: [], blocked: false }] as EngineStepResult["availableActions"],
      };
    };

    // ----- mock LLM provider with injected latency -----
    const agentRuntime: AgentRuntime = {
      async generateIntent(input) {
        const agentId = input.agentId;
        const consultAt = clock.now();
        consultAtByAgent.set(agentId, consultAt);
        totalConsults += 1;
        const meta = metaOf(input.triggeringReason) ?? { agent: agentId, line: null, consultAt, chars: 0, sawAnswer: false };
        meta.consultAt = consultAt;
        if (meta.line && meta.line.addressed === agentId && meta.line.consultAt === undefined) meta.line.consultAt = consultAt;
        const lat = lognormal(rLLM, cfg.llm.median, cfg.llm.p95);
        await clock.sleep(lat);
        if (cfg.variant !== "seq" && lat > cfg.deadlineMs) {
          // scheduler abandons this call (llm_failure); the line stays unhandled and the agent re-evaluates it later
          if (meta.line) { meta.line.seen.delete(agentId); if (meta.line.claimedBy === agentId) meta.line.claimedBy = undefined; }
        }
        let speak: boolean;
        if (meta.line && meta.line.addressed === agentId) speak = true;
        else if (meta.line) speak = rWorld() < (meta.sawAnswer ? P_SPEAK_ANSWERED : P_SPEAK_FRESH);
        else speak = rWorld() < P_AMBIENT_SPEAK;
        const chars = Math.max(8, Math.min(200, Math.round(lognormal(rWorld, cfg.persona.charsMedian, cfg.persona.charsMedian * 2.4))));
        meta.chars = chars;
        const intent: ActionIntent = speak
          ? { id: createId(), actorId: agentId, intentType: "send_message", channelTarget: "ch_public", personTargets: [], visibleContent: "x".repeat(chars), privateMotiveSummary: "spike", emotionDrivers: [], motivationDrivers: [], memoryWrites: [], fallbackIfBlocked: "no_op" }
          : { id: createId(), actorId: agentId, intentType: "no_op", personTargets: [], privateMotiveSummary: "spike", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] };
        intentMeta.set(intent.id, meta);
        if (!speak && meta.line && meta.line.claimedBy === agentId) meta.line.claimedBy = undefined; // silent claimer releases the line
        return { intent, llmUsage: null, latencyMs: lat, fallbackApplied: false, operatorEvents: [] } as never;
      },
    };
    const llmBudget: LLMBudget = { getPriority: () => "normal" };

    // ----- arbiter (wraps the real resolver; a denial becomes no_op = fallback_committed) -----
    const rateGate = new RateLimitGate(SETTINGS);
    const realResolver = new IntentResolver(rateGate, channelRegistry);
    const arbitedResolver = {
      resolve: async (intent: ActionIntent, ctx: Parameters<IntentResolver["resolve"]>[1]) => {
        const meta = intentMeta.get(intent.id);
        let use = intent;
        if (intent.intentType === "send_message" && meta && cfg.arbiter !== "none") {
          const now = clock.now();
          const line = meta.line;
          const addressedToMe = !!line && line.addressed === meta.agent;
          let block = false;
          if (!addressedToMe) {
            if (line === null && now - lastHumanLineAt < 10_000) block = true; // ambient_too_soon
            if (line && line.addressed === null) {
              if ((cfg.arbiter === "one" || cfg.arbiter === "claim") && line.answers.length >= 1) block = true; // one answer per human line
              if (cfg.arbiter === "adr" && actorLinesSinceHuman >= 3) block = true; // line_budget max(3, addressees)
            }
          }
          if (block) {
            blockedByArbiter += 1;
            if (line) wastedCalls += 1;
            use = { ...intent, intentType: "no_op", visibleContent: undefined, channelTarget: undefined };
          }
        }
        const res = await realResolver.resolve(use, ctx);
        const sent = res.committedEvents.some((e) => e.type === "message_sent" || e.type === "reply_sent");
        if (sent && meta) {
          const commitAt = clock.now();
          const typing = Math.min(4000, cfg.persona.delayMs[0] + rWorld() * (cfg.persona.delayMs[1] - cfg.persona.delayMs[0]) + 55 * meta.chars);
          const raw = Math.max(commitAt, meta.consultAt + typing); // max(LLM done / commit, typing from onConsult)
          const landingAt = Math.max(raw, lastLandingAt + 2500); // gateway per-room spacing (rule 3)
          lastLandingAt = landingAt;
          actorLinesSinceHuman += 1;
          if (meta.line) meta.line.answers.push({ agent: meta.agent, consultAt: meta.consultAt, commitAt, rawLandingAt: raw, landingAt });
        }
        return res;
      },
    } as unknown as IntentResolver;

    // ----- scheduler -----
    const common = {
      simulation: sim, agents, defaultPublicChannelId: "ch_public", eventRepo, agentStateRepo, channelRegistry,
      rateLimitGate: rateGate, intentResolver: arbitedResolver,
      engineSnapshotProjection: new EngineSnapshotProjection(), deliveryProjection: new DeliveryProjection(new MockDeliveryGateway()),
      spectatorProjection: new SpectatorProjection(new MockDeliveryGateway()), operatorProjection: new OperatorProjection(new MockDeliveryGateway()),
      engineEventBuilder: new EngineEventBuilder(), agentRuntime, llmBudget, pulseIntervalMs: cfg.baseIntervalMs, stepResolver,
    };
    const seqSched = cfg.variant === "seq" ? new PulseScheduler(common) : null;
    const splitSched = cfg.variant !== "seq"
      ? new SplitPulseScheduler({
          ...common, generateConcurrency: cfg.concurrency, generateDeadlineMs: cfg.deadlineMs, clock,
          isAddressed, earlyCommitAddressed: cfg.variant === "split_early" || cfg.variant === "split_par", parallelFocused: cfg.variant === "split_par" || cfg.variant === "split_stream", commitAsComplete: cfg.variant === "split_stream",
        })
      : null;
    const busy = () => (seqSched ? false : splitSched!.isBusy());
    // the real PulseScheduler has no isBusy; track by wrapping runPulse
    let seqInFlight = false;
    const seqRun = async () => { seqInFlight = true; try { await seqSched!.runPulse(); } finally { seqInFlight = false; } };

    // ----- drivers -----
    const eld = monitorEventLoopDelay({ resolution: 5 });
    eld.enable();

    const baseLoop = async () => {
      if (cfg.variant === "seq") {
        // = SimulationRuntime.start(): setTimeout(interval) after each pulse completes
        while (!stopped) {
          await clock.sleep(cfg.baseIntervalMs);
          if (stopped) break;
          basePulses += 1;
          await seqRun();
        }
      } else {
        // = WallClockPulseLoop: fixed cadence, overrun skips missed beats
        let next = clock.now() + cfg.baseIntervalMs;
        while (!stopped) {
          await clock.sleep(Math.max(0, next - clock.now()));
          if (stopped) break;
          basePulses += 1;
          await splitSched!.runPulse({ reason: "base" });
          next += cfg.baseIntervalMs;
          while (next <= clock.now()) next += cfg.baseIntervalMs;
        }
      }
    };

    const focusPending = new Set<string>();
    let debounceToken = 0;
    const requestFocused = (agentId: string, line: Line) => {
      focusPending.add(agentId);
      const fire = () => {
        const ids = [...focusPending];
        focusPending.clear();
        if (splitSched!.isBusy()) line.focusedQueued = true;
        void splitSched!.runPulse({ reason: "human_chat", focusAgentIds: ids });
      };
      if (cfg.debounceMs <= 0) return fire();
      const tok = ++debounceToken;
      void clock.sleep(cfg.debounceMs).then(() => { if (tok === debounceToken && !stopped) fire(); });
    };

    let lineId = 0;
    const injector = async () => {
      await clock.sleep(20_000);
      for (let i = 0; i < cfg.nLines && !stopped; i++) {
        await clock.sleep(-Math.log(Math.max(rnd(), 1e-9)) * cfg.meanGapMs);
        const now = clock.now();
        const addressee = cfg.lineKind === "addressed" ? agentIds[Math.floor(rnd() * agentIds.length)]! : null;
        const line: Line = {
          id: lineId++, t: now, addressed: addressee, expiresAt: now + LINE_TTL, seen: new Set(), answers: [],
          busyAtArrival: cfg.variant === "seq" ? seqInFlight : busy(),
        };
        lastHumanLineAt = now;
        actorLinesSinceHuman = 0;
        lines.push(line);
        if (cfg.variant !== "seq" && addressee) requestFocused(addressee, line);
      }
      await clock.sleep(LINE_TTL + 40_000);
      stopped = true;
    };

    void baseLoop();
    void injector();
    if (vclock) await vclock.runUntil(() => stopped);
    else await new Promise<void>((r) => { const h = setInterval(() => { if (stopped) { clearInterval(h); r(); } }, 200); });
    eld.disable();

    // ----- metrics -----
    const res: Result = {
      cfg, virtualMs: clock.now(), lines: lines.length, latency: null, withinTarget: null, breakdown: null,
      busyAtArrivalPct: 0, waitedForInflightPct: 0, unanswered: 0, dogpile: null,
      consults: { total: totalConsults, perBasePulse: totalConsults / Math.max(1, basePulses), perMin: totalConsults / (clock.now() / 60000) },
      basePulses,
      eventLoop: { busyP50: 0, busyP99: 0, busyMax: 0, eldP99: eld.percentile(99) / 1e6, eldMax: eld.max / 1e6, eldMean: eld.mean / 1e6 },
      wallSeconds: 0, rawLat: [], rawAnswers: [],
    };
    if (vclock) {
      res.eventLoop.busyP50 = pct(vclock.busyMs, 50);
      res.eventLoop.busyP99 = pct(vclock.busyMs, 99);
      res.eventLoop.busyMax = Math.max(...vclock.busyMs);
    }
    if (cfg.lineKind === "addressed") {
      const lat: number[] = [], wait: number[] = [], gen: number[] = [], tex: number[] = [], spc: number[] = [], nsp: number[] = [];
      let busyN = 0, waited = 0;
      for (const l of lines) {
        const a = l.answers[0];
        if (l.busyAtArrival) busyN++;
        if (!a) { res.unanswered++; lat.push(120_000); continue; }
        lat.push(a.landingAt - l.t);
        wait.push(a.consultAt - l.t);
        gen.push(a.commitAt - a.consultAt);
        tex.push(a.rawLandingAt - a.commitAt);
        spc.push(a.landingAt - a.rawLandingAt);
        nsp.push(a.rawLandingAt - l.t);
        if (a.consultAt - l.t > 1000) waited++;
      }
      res.rawLat = lat;
      const n = lines.length;
      res.latency = { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), mean: lat.reduce((s, x) => s + x, 0) / n, max: Math.max(...lat) };
      res.withinTarget = { p50ok: res.latency.p50 <= 5000, p95ok: res.latency.p95 <= 10000 };
      res.breakdown = { waitToConsultP50: pct(wait, 50), waitToConsultP95: pct(wait, 95), genP50: pct(gen, 50), typingExtraP50: pct(tex, 50), spacingP50: pct(spc, 50), spacingP95: pct(spc, 95), noSpacingP50: pct(nsp, 50), noSpacingP95: pct(nsp, 95) };
      res.busyAtArrivalPct = (100 * busyN) / n;
      res.waitedForInflightPct = (100 * waited) / n;
    } else {
      res.rawAnswers = lines.map((l) => l.answers.length);
      const multi = lines.filter((l) => l.answers.length >= 2).length;
      res.dogpile = {
        rate: multi / lines.length, multi, lines: lines.length,
        meanAnswers: lines.reduce((s, l) => s + l.answers.length, 0) / lines.length,
        blockedByArbiter, wastedCalls,
      };
      res.busyAtArrivalPct = (100 * lines.filter((l) => l.busyAtArrival).length) / lines.length;
    }
    res.wallSeconds = (performance.now() - wall0) / 1000;
    return res;
  } finally {
    Date.now = realDateNow;
  }
}

function cannedStep(agentId: string): EngineStepResult {
  const ZERO = { defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0 };
  return {
    visibleEvents: [], newEvents: [],
    attentionResults: { noticed: false, dueScore: 0, reasons: [], needsLLM: false, triggeringReason: "spike" },
    perceptionPacket: { agentId, triggeringEvent: null, visibleContextEvents: [], eventHandles: {}, ownRecentUtterances: [], involvedPeople: [], relevantChannels: [], relevantMemories: [], translatedEmotionalState: { summary: "", emotions: [] }, availableActions: [] },
    interpretations: [], emotionDelta: { coreMoodDelta: {}, socialEmotionDeltas: {}, relationalDeltas: new Map(), ruminationApplied: false },
    updatedAgentState: mkState(agentId), motivations: [], pressures: [], inhibitions: [], actionEmotions: ZERO,
    decision: { outcome: "no_op", needsLLM: false, initiativeProceed: false, noOpReason: "spike", privateMotiveSeed: "x" },
    availableActions: [], initiativeCandidates: [], memoryProposals: [], noOpRecord: null,
    operatorMetrics: { pulseIndex: 0, pulseDurationMs: 1, agentsCalled: 0, eventsCommitted: 0, llmCallsMade: 0, budgetUsedPercent: 0 },
  } as unknown as EngineStepResult;
}
