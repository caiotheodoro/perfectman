import { describe, expect, it } from "vitest";
import type { BehavioralEvent } from "../probes/types.js";
import {
  latencyStats,
  lurkingRate,
  interruptionRate,
  silenceMisreadingRate,
  allianceRate,
  aiLeakRate,
  noOpMeaningfulness,
  emojiReactionRate,
  memoryWriteRate,
  privateChannelDensity,
  contentRepetitionRate,
  crossAgentEchoRate,
  echoSourcesByAgent,
  runAllProbes,
} from "../probes/index.js";
import { eventsToBehavioral } from "../probes/adapter.js";
import type { CommittedEvent } from "@perfectman/shared";

function ev(
  kind: BehavioralEvent["kind"],
  agentId: string,
  pulseIndex: number,
  content?: string,
  payload: Record<string, unknown> = {},
): BehavioralEvent {
  return {
    kind,
    agentId,
    channelId: "ch",
    pulseIndex,
    content,
    privateContent: typeof payload.privateMotiveSummary === "string" ? payload.privateMotiveSummary : undefined,
    payload,
  };
}

describe("probes", () => {
  it("latency stats from event gaps", () => {
    const events = [
      ev("post", "A", 1),
      ev("post", "A", 5),
      ev("post", "A", 9),
      ev("post", "B", 2),
    ];
    const { meanGap, p95Gap } = latencyStats(events, ["A", "B"]);
    expect(meanGap).toBe(4);
    expect(p95Gap).toBeLessThanOrEqual(8);
  });

  it("lurking rate counts silent rounds per agent", () => {
    const events = [ev("post", "A", 1), ev("post", "A", 2)];
    // A silent 2 of 4 rounds, B silent all 4 → 6 silent / (4 rounds × 2 agents)
    expect(lurkingRate(events, ["A", "B"], 4)).toBeCloseTo(0.75);
  });

  it("interruption detects adjacent cross-agent posts", () => {
    const events = [ev("post", "A", 1), ev("post", "B", 1), ev("post", "B", 5), ev("post", "A", 5)];
    const rate = interruptionRate(events);
    expect(rate).toBeGreaterThan(0);
    // collisions: B1-vs-A1 and A5-vs-B5 → 2 / 3 adjacent pairs
    expect(rate).toBeCloseTo(2 / 3);
  });

  it("silence misreading fires on confrontation right after silence", () => {
    const events = [
      ev("silence", "B", 3),
      ev("post", "A", 4, "você tá me ignorando?"),
    ];
    expect(silenceMisreadingRate(events)).toBe(1);
    const quiet = [ev("silence", "B", 3), ev("post", "A", 4, "que dia lindo")];
    expect(silenceMisreadingRate(quiet)).toBe(0);
  });

  it("alliance counts dyad private channels", () => {
    const events = [
      ev("private_channel", "A", 2, undefined, { memberAgentIds: ["a", "b"] }),
      ev("post", "A", 3),
    ];
    expect(allianceRate(events)).toBeGreaterThan(0);
    expect(allianceRate(events)).toBeLessThanOrEqual(0.5);
  });

  it("ai leak detection is case-insensitive", () => {
    const events = [ev("post", "A", 1, "As an AI, I can't say")];
    expect(aiLeakRate(events)).toBe(1);
    const clean = [ev("post", "A", 1, "kkk nem te conto")];
    expect(aiLeakRate(clean)).toBe(0);
  });

  it("no-op meaningfulness requires real motive text", () => {
    const good = ev("silence", "A", 1, undefined, { privateMotiveSummary: "I want him to chase me after he ignored me." });
    const bad = ev("silence", "A", 2, undefined, { privateMotiveSummary: "ok" });
    expect(noOpMeaningfulness([good, bad])).toBe(0.5);
  });

  it("aggregate probe run is bounded and complete", () => {
    const results = runAllProbes({ events: [], agentIds: ["a"], totalPulses: 10 });
    expect(results.length).toBeGreaterThanOrEqual(10);
    expect(results.every(r => typeof r.measured === "number")).toBe(true);
  });

  it("adapter maps committed events to kinds", () => {
    const base: CommittedEvent = {
      id: "e1",
      simulationId: "s",
      channelId: "ch",
      actorId: "a",
      type: "message_sent",
      payload: { content: "oi" },
      createdAt: 1,
      pulseIndex: 1,
      sourceEventIds: [],
      emotionalSalience: "low",
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "x" },
    };
    const mapped = eventsToBehavioral([{ ...base, type: "no_op_recorded", payload: { privateMotiveSummary: "x" } }]);
    expect(mapped[0]!.kind).toBe("silence");
    expect(mapped[0]!.privateContent).toBe("x");
  });

  it("emoji and memory rates are sane", () => {
    expect(emojiReactionRate([ev("react", "A", 1), ev("post", "A", 2)])).toBe(0.5);
    expect(memoryWriteRate([ev("memory", "A", 1), ev("post", "A", 2), ev("post", "A", 3)])).toBeCloseTo(1 / 3);
    expect(privateChannelDensity([ev("private_channel", "A", 1), ev("post", "A", 2)])).toBe(0.5);
  });

  describe("contentRepetitionRate (#27)", () => {
    it("detects a verbatim repeat by the same agent", () => {
      const events = [
        ev("post", "A", 1, "vou falar isso mesmo cara"),
        ev("post", "B", 2, "outro assunto totalmente diferente aqui"),
        ev("post", "A", 3, "Vou falar isso mesmo, cara!"),
      ];
      // A's third turn near-repeats its first; B's turn is distinct.
      expect(contentRepetitionRate(events)).toBeCloseTo(1 / 3);
    });

    it("scores fully distinct content as zero", () => {
      const events = [
        ev("post", "A", 1, "bom dia pessoal tudo certo"),
        ev("post", "A", 2, "ontem o jogo foi incrível"),
        ev("reply", "B", 3, "concordo plenamente contigo"),
      ];
      expect(contentRepetitionRate(events)).toBe(0);
    });

    it("does not count cross-agent similarity (per-agent scoping)", () => {
      const events = [
        ev("post", "A", 1, "esse time não ganha nunca"),
        ev("post", "B", 2, "esse time não ganha nunca"),
      ];
      expect(contentRepetitionRate(events)).toBe(0);
    });

    it("returns zero for empty or contentless transcripts", () => {
      expect(contentRepetitionRate([])).toBe(0);
      expect(contentRepetitionRate([ev("silence", "A", 1), ev("react", "A", 2)])).toBe(0);
    });

    it("detects a verbatim echo of another agent's earlier line", () => {
      const events = [
        ev("post", "A", 1, "esse time não ganha nunca"),
        ev("post", "B", 2, "Esse time não ganha nunca!"),
        ev("post", "C", 3, "assunto totalmente diferente"),
      ];
      expect(crossAgentEchoRate(events)).toBeCloseTo(1 / 3);
    });

    it("does not count an agent repeating ITSELF (per-agent probe's job)", () => {
      const events = [
        ev("post", "A", 1, "esse time não ganha nunca"),
        ev("post", "A", 2, "esse time não ganha nunca"),
      ];
      expect(crossAgentEchoRate(events)).toBe(0);
    });

    it("attributes echoes to their source agent", () => {
      const events = [
        ev("post", "A", 1, "o churrasco de sábado tá confirmado"),
        ev("post", "B", 2, "o churrasco de sábado tá confirmado mesmo"),
        ev("post", "C", 3, "ninguém falou do churrasco de sábado"),
      ];
      const sources = echoSourcesByAgent(events);
      expect(sources["B<-A"]).toBe(1);
      expect(sources).not.toHaveProperty("A<-A");
    });

    it("returns zero for empty or single-turn transcripts", () => {
      expect(crossAgentEchoRate([])).toBe(0);
      expect(echoSourcesByAgent([ev("post", "A", 1, "só eu aqui")])).toEqual({});
    });

    it("is wired into runAllProbes with a band", () => {
      const events = [
        ev("post", "A", 1, "fala sério que isso é real"),
        ev("post", "B", 2, "Fala sério que isso é real!"),
      ];
      const probe = runAllProbes({ events, agentIds: ["A", "B"], totalPulses: 2 })
        .find(r => r.probe === "cross-agent-echo");
      expect(probe).toBeDefined();
      expect(probe!.measured).toBeGreaterThan(0);
    });

    it("is wired into runAllProbes with a band", () => {
      const events = [
        ev("post", "A", 1, "repetindo a mesma linha de sempre"),
        ev("post", "A", 2, "repetindo a mesma linha de sempre"),
      ];
      const probe = runAllProbes({ events, agentIds: ["A"], totalPulses: 2 })
        .find(r => r.probe === "content-repetition");
      expect(probe).toBeDefined();
      expect(probe!.measured).toBeGreaterThan(0);
    });
  });
});
