import { describe, it, expect, beforeEach } from "vitest";
import { LLMBudgetTracker } from "../llm-budget.js";

describe("LLMBudgetTracker", () => {
  let budget: LLMBudgetTracker;

  beforeEach(() => {
    budget = new LLMBudgetTracker();
    budget.registerLimits("sim-test", {
      llmCallBudgetPerMinute: 10,
      tokenBudgetPerHour: 10000,
    });
  });

  it("should allow calls when budget is fresh", () => {
    const dec = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "high",
    });
    expect(dec.allowed).toBe(true);
  });

  it("should track and block calls exceeding llmCallBudgetPerMinute", () => {
    // Record 10 calls
    for (let i = 0; i < 10; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }

    // Next call should be blocked
    const dec = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "high",
    });
    expect(dec.allowed).toBe(false);
    expect(dec.reason).toContain("Call budget exhausted");
  });

  it("should track and block calls exceeding tokenBudgetPerHour", () => {
    // Limit is 10000. Let's record one massive usage of 10000 tokens
    budget.recordUsage({
      simulationId: "sim-test",
      agentId: "goulart",
      model: "mock-model",
      inputTokens: 5000,
      outputTokens: 5000,
      latencyMs: 100,
      callType: "cognition",
      pulseIndex: 1,
      createdAt: Date.now(),
    });

    // Next call should be blocked even if estimated tokens are low
    const dec = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "high",
      inputTokensEstimate: 50,
    });
    expect(dec.allowed).toBe(false);
    expect(dec.reason).toContain("Token budget exhausted");
  });

  it("should gate calls based on priority and usage thresholds", () => {
    // Call limit is 10. Let's record 8 calls (80% usage)
    for (let i = 0; i < 8; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }

    // Low priority should be blocked at 80%
    const lowDec = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "low",
    });
    expect(lowDec.allowed).toBe(false);
    expect(lowDec.reason).toContain("Low priority call blocked");

    // Normal priority should be allowed
    const normalDec = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "normal",
    });
    expect(normalDec.allowed).toBe(true);

    // Record one more call to reach 9 calls (90% usage)
    budget.recordUsage({
      simulationId: "sim-test",
      agentId: "goulart",
      model: "mock-model",
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      callType: "cognition",
      pulseIndex: 8,
      createdAt: Date.now(),
    });

    // We change the limit to 20 to test 95%
    budget.registerLimits("sim-test", {
      llmCallBudgetPerMinute: 20,
      tokenBudgetPerHour: 10000,
    });
    
    // Clear and record 19 calls (19/20 = 95%)
    budget.reset("sim-test");
    for (let i = 0; i < 19; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }

    // Normal priority should be blocked at >= 95%
    const normalDec95 = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "normal",
    });
    expect(normalDec95.allowed).toBe(false);
    expect(normalDec95.reason).toContain("Normal priority call blocked");

    // High priority should still be allowed
    const highDec95 = budget.canCall({
      simulationId: "sim-test",
      agentId: "goulart",
      priority: "high",
    });
    expect(highDec95.allowed).toBe(true);
  });

  it("should derive correct BudgetPriority from getPriority()", () => {
    // Fresh
    expect(budget.getPriority("sim-test", "goulart")).toBe("high");

    // Record 5 calls (50% usage)
    for (let i = 0; i < 5; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }
    expect(budget.getPriority("sim-test", "goulart")).toBe("normal");

    // Record 3 more calls to reach 8 calls (80% usage)
    for (let i = 5; i < 8; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }
    expect(budget.getPriority("sim-test", "goulart")).toBe("low");

    // Record 2 more calls to reach 10 calls (100% usage)
    for (let i = 8; i < 10; i++) {
      budget.recordUsage({
        simulationId: "sim-test",
        agentId: "goulart",
        model: "mock-model",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        callType: "cognition",
        pulseIndex: i,
        createdAt: Date.now(),
      });
    }
    expect(budget.getPriority("sim-test", "goulart")).toBe("blocked");
  });

  it("should get complete status", () => {
    budget.recordUsage({
      simulationId: "sim-test",
      agentId: "goulart",
      model: "mock-model",
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 100,
      callType: "cognition",
      pulseIndex: 1,
      createdAt: Date.now(),
    });

    budget.recordUsage({
      simulationId: "sim-test",
      agentId: "bruno",
      model: "mock-model",
      inputTokens: 50,
      outputTokens: 50,
      latencyMs: 100,
      callType: "cognition",
      pulseIndex: 1,
      createdAt: Date.now(),
    });

    const status = budget.getStatus("sim-test");
    expect(status.callsThisMinute).toBe(2);
    expect(status.tokensThisHour).toBe(400);
    expect(status.agentUsage.goulart!.calls).toBe(1);
    expect(status.agentUsage.goulart!.tokens).toBe(300);
    expect(status.agentUsage.bruno!.calls).toBe(1);
    expect(status.agentUsage.bruno!.tokens).toBe(100);
  });
});
