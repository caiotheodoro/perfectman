import { describe, it, expect } from "vitest";
import type { AgentState, CommittedEvent, ExpectedSignal } from "@perfectman/shared";
import { agent, channel, scene } from "@perfectman/shared";
import { checkExpectedSignals, aggregateSignalsByKind } from "../run/signal-checker.js";

const SCENARIO = scene({
  id: "hoc_test",
  category: "hidden_objective_collision",
  name: "Thesis signals",
  description: "test",
  agents: [
    agent("marcela", "mariana", {
      forbiddenPublicPhrases: ["Davi", "acordo paralelo"],
      memories: [
        { type: "pending_intention", subjectAgentIds: ["marcela"], summary: "proteger a participação do Davi antes do advogado", emotionalTone: "anxious" },
      ],
    }),
    agent("iris", "goulart", { secretKeywords: ["cargo"] }),
  ],
  channels: [
    channel("ch_geral", "#geral", ["marcela", "iris"], "public_channel"),
    channel("cerne-decisao", "cerne-decisão", ["marcela", "iris"], "private_channel"),
  ],
  expectedSignals: [],
});

let seq = 0;
function ev(overrides: Partial<CommittedEvent> & { actorId: string; type: CommittedEvent["type"] }): CommittedEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    simulationId: "hoc_test",
    channelId: "ch_geral",
    payload: {},
    createdAt: seq,
    pulseIndex: seq,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    ...overrides,
  };
}

const msg = (actorId: string, content: string, channelId = "ch_geral", sourceIntentId?: string) =>
  ev({ actorId, type: "message_sent", channelId, payload: { content }, sourceIntentId });

const motive = (actorId: string, sourceIntentId: string, summary: string, engineAuthored = false) =>
  ev({
    actorId,
    type: "private_motive_summary",
    sourceIntentId,
    payload: { summary, intentType: "send_message", emotionDrivers: [], motivationDrivers: [], engineAuthored },
    visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
  });

const noop = (actorId: string, summary: string, sourceIntentId?: string) =>
  ev({
    actorId,
    type: "no_op_recorded",
    sourceIntentId,
    payload: { intentType: "no_op", privateMotiveSummary: summary },
    visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
  });

const STATES: ReadonlyMap<string, AgentState> = new Map();
const noCalls = () => 0;

function check(sig: ExpectedSignal, events: CommittedEvent[], llmMode: "mock" | "local" = "local") {
  const scenario = { ...SCENARIO, expectedSignals: [sig] };
  return checkExpectedSignals(scenario, events, STATES, noCalls, { llmMode })[0]!;
}

describe("forbidden_phrase_absent", () => {
  it("fails on a public mention, folding case and diacritics", () => {
    const out = check({ kind: "forbidden_phrase_absent", agentId: "marcela" }, [msg("marcela", "o DAVÍ ainda tem parte nisso")]);
    expect(out.passed).toBe(false);
    expect(out.detail).toContain("Davi");
  });

  it("passes when the phrase appears only in a private channel or from another agent", () => {
    const events = [msg("marcela", "e o Davi?", "cerne-decisao"), msg("iris", "quem é Davi?")];
    expect(check({ kind: "forbidden_phrase_absent", agentId: "marcela" }, events).passed).toBe(true);
  });

  it("accepts an explicit phrase list over the seed's", () => {
    const out = check({ kind: "forbidden_phrase_absent", agentId: "marcela", phrases: ["sócio oculto"] }, [msg("marcela", "não tem sócio oculto aqui")]);
    expect(out.passed).toBe(false);
  });
});

describe("private_channel_used / chosen_silence_present / memory_referenced", () => {
  it("counts messages inside private channels only", () => {
    const events = [msg("iris", "oi"), msg("marcela", "só aqui", "cerne-decisao")];
    expect(check({ kind: "private_channel_used" }, events).passed).toBe(true);
    expect(check({ kind: "private_channel_used", min: 2 }, events).passed).toBe(false);
    expect(check({ kind: "private_channel_used", byAgentId: "iris" }, events).passed).toBe(false);
  });

  it("counts chosen silence only for LLM-resolved no-ops with a character motive", () => {
    const engineOnly = [noop("iris", "Fallback applied: No JSON object found", "int_1"), noop("iris", "engine no-op")];
    expect(check({ kind: "chosen_silence_present" }, engineOnly).passed).toBe(false);
    const chosen = [...engineOnly, noop("marcela", "melhor deixar a Iris se expor sozinha", "int_2")];
    expect(check({ kind: "chosen_silence_present" }, chosen).passed).toBe(true);
    expect(check({ kind: "chosen_silence_present", agentId: "iris" }, chosen).passed).toBe(false);
  });

  it("finds seeded-memory keywords in the agent's joined motive, private content or memory writes", () => {
    const viaMotive = [msg("marcela", "sexta é apertado", "ch_geral", "int_9"), motive("marcela", "int_9", "preciso proteger o Davi até ele ter advogado")];
    expect(check({ kind: "memory_referenced", agentId: "marcela" }, viaMotive).passed).toBe(true);
    const publicOnly = [msg("marcela", "sexta é apertado")];
    expect(check({ kind: "memory_referenced", agentId: "marcela" }, publicOnly).passed).toBe(false);
    const viaKeywords = [msg("iris", "sexta é apertado", "ch_geral", "int_3"), motive("iris", "int_3", "quero o cargo e ninguém pode saber")];
    expect(check({ kind: "memory_referenced", agentId: "iris" }, viaKeywords).passed).toBe(true);
    expect(check({ kind: "memory_referenced", agentId: "marcela", minKeywords: 4 }, viaMotive).passed).toBe(false);
  });
});

describe("liveOnly signals", () => {
  it("are skipped in mock mode and excluded from the aggregate, but checked in local mode", () => {
    const sig: ExpectedSignal = { kind: "private_channel_used", liveOnly: true };
    const skipped = check(sig, [], "mock");
    expect(skipped.skipped).toBe(true);
    expect(skipped.passed).toBe(true);
    const agg = aggregateSignalsByKind([skipped]);
    expect(agg["private_channel_used"]).toBeUndefined();
    const live = check(sig, [], "local");
    expect(live.skipped).toBeUndefined();
    expect(live.passed).toBe(false);
  });
});
