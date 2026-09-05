import { describe, it, expect } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import { agent, channel, scene } from "@perfectman/shared";
import {
  buildMotiveIndex,
  motiveForEvent,
  buildTranscriptView,
  renderTranscript,
  renderTranscriptLine,
} from "../render-transcript.js";

const SCENARIO = scene({
  id: "s1",
  category: "hidden_objective_collision",
  name: "Test Scene",
  description: "A room.",
  agents: [
    agent("marcela", "mariana", {
      hiddenObjective: {
        description: "kill the sale",
        scarceResourceId: "deal",
        constraint: "mention Davi",
        breakingPoint: "someone asks about a hidden partner",
      },
      memories: [
        { type: "pending_intention", subjectAgentIds: ["marcela"], summary: "protect Davi's 15%", emotionalTone: "anxious" },
      ],
    }),
    agent("iris", "goulart", {}),
  ],
  channels: [
    channel("ch_geral", "#geral", ["marcela", "iris"], "public_channel"),
    channel("cerne-decisao", "cerne-decisão", ["marcela", "iris"], "private_channel"),
  ],
  expectedSignals: [],
});

function event(overrides: Partial<CommittedEvent>): CommittedEvent {
  return {
    id: "e1",
    simulationId: "s1",
    channelId: "ch_geral",
    actorId: "marcela",
    type: "message_sent",
    payload: { content: "sexta é apertado" },
    createdAt: 1,
    pulseIndex: 3,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    ...overrides,
  } as CommittedEvent;
}

function motiveEvent(sourceIntentId: string, summary: string, engineAuthored = false): CommittedEvent {
  return event({
    id: `m_${sourceIntentId}`,
    type: "private_motive_summary",
    sourceIntentId,
    payload: { summary, intentType: "send_message", emotionDrivers: [], motivationDrivers: [], engineAuthored },
    visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
  });
}

describe("motive index", () => {
  it("joins a private_motive_summary to its act by sourceIntentId", () => {
    const act = event({ sourceIntentId: "int_1" });
    const idx = buildMotiveIndex([act, motiveEvent("int_1", "quero travar a venda")]);
    expect(motiveForEvent(act, idx)).toEqual({ text: "quero travar a venda", engineAuthored: false });
  });

  it("falls back to a legacy payload motive and derives engineAuthored from the prefix", () => {
    const noop = event({ type: "no_op_recorded", payload: { intentType: "no_op", privateMotiveSummary: "Fallback applied: No JSON object found" } });
    expect(motiveForEvent(noop, buildMotiveIndex([noop]))).toEqual({
      text: "Fallback applied: No JSON object found",
      engineAuthored: true,
    });
    expect(motiveForEvent(event({}), buildMotiveIndex([]))).toBeUndefined();
  });
});

describe("renderTranscriptLine", () => {
  it("renders the canonical line with channel, privacy marker, quoted content and motive", () => {
    const act = event({ channelId: "cerne-decisao", type: "reply_sent", sourceIntentId: "int_1" });
    const idx = buildMotiveIndex([act, motiveEvent("int_1", "ganhar tempo")]);
    expect(renderTranscriptLine(act, SCENARIO, idx, { seeds: "none", motives: "model" })).toBe(
      '[p3] marcela (reply_sent) #cerne-decisao 🔒 "sexta é apertado" [internally: ganhar tempo]',
    );
  });

  it("hides an engine-authored motive under model, shows it under all, drops it under none", () => {
    const act = event({ sourceIntentId: "int_2" });
    const idx = buildMotiveIndex([act, motiveEvent("int_2", "Fallback applied: parse error", true)]);
    expect(renderTranscriptLine(act, SCENARIO, idx, { seeds: "none", motives: "model" })).toBe(
      '[p3] marcela (message_sent) #ch_geral "sexta é apertado" [engine-fallback]',
    );
    expect(renderTranscriptLine(act, SCENARIO, idx, { seeds: "none", motives: "all" })).toContain(
      "[internally: Fallback applied: parse error]",
    );
    expect(renderTranscriptLine(act, SCENARIO, idx, { seeds: "none", motives: "none" })).toBe(
      '[p3] marcela (message_sent) #ch_geral "sexta é apertado"',
    );
  });

  it("renders a reaction as its emoji", () => {
    const react = event({ type: "reaction_sent", payload: { emoji: "👍", targetEventId: "e0" } });
    expect(renderTranscriptLine(react, SCENARIO, buildMotiveIndex([]), { seeds: "none", motives: "none" })).toBe(
      "[p3] marcela (reaction_sent) #ch_geral 👍",
    );
  });
});

describe("buildTranscriptView / renderTranscript", () => {
  const act = event({ sourceIntentId: "int_1" });
  const events = [act, motiveEvent("int_1", "ganhar tempo")];

  it("never renders the motive event as its own line", () => {
    const view = buildTranscriptView(SCENARIO, events, { seeds: "none", motives: "model" });
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toContain("[internally: ganhar tempo]");
  });

  it("lists cast and channels, and seeds only when asked", () => {
    const withSeeds = buildTranscriptView(SCENARIO, events, { seeds: "full", motives: "model" });
    expect(withSeeds.cast).toEqual(["marcela → Mariana (mariana)", "iris → Goulart (goulart)"]);
    expect(withSeeds.channels).toEqual(["#ch_geral (public)", "#cerne-decisao (private 🔒)"]);
    expect(withSeeds.seeds.join("\n")).toContain("marcela objective: kill the sale");
    expect(withSeeds.seeds.join("\n")).toContain("constraint: mention Davi");
    expect(withSeeds.seeds.join("\n")).toContain("breaking point: someone asks about a hidden partner");
    expect(withSeeds.seeds.join("\n")).toContain("marcela memory (pending_intention): protect Davi's 15%");
    expect(withSeeds.seeds.some(s => s.startsWith("iris"))).toBe(false);

    const noSeeds = buildTranscriptView(SCENARIO, events, { seeds: "none", motives: "model" });
    expect(noSeeds.seeds).toEqual([]);
  });

  it("renders sections in order and caps lines", () => {
    const many = Array.from({ length: 5 }, (_, i) => event({ id: `e${i}`, pulseIndex: i }));
    const text = renderTranscript(buildTranscriptView(SCENARIO, many, { seeds: "full", motives: "none", maxLines: 2 }));
    expect(text.indexOf("<cast>")).toBeLessThan(text.indexOf("<channels>"));
    expect(text.indexOf("<channels>")).toBeLessThan(text.indexOf("<seeds>"));
    expect(text.indexOf("<seeds>")).toBeLessThan(text.indexOf("<events>"));
    expect((text.match(/\[p\d+\]/g) ?? []).length).toBe(2);
  });
});
