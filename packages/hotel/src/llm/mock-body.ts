import type { LLMProvider } from "@perfectman/server/hotel";
import { hashString } from "../util/stats.js";

/**
 * The sidecar's mock model with a body. The server's `MockLLMProvider` only talks; with it a hotel
 * run on `PERFECTMAN_LLM_PROVIDER=mock` never exercises posture, gestures or faces, so the local demo
 * could not show an actor sit. This wraps it and adds a small, deterministic `body` block (embodiment.md
 * 6.1) to some consults: half the cast asks to sit from its third consult on and stands again on its
 * twelfth, everyone smiles now and then, the other half waves. The sit is asked for on every consult in
 * between, not once: the counter runs per provider call, not per committed intent, and an actor can be
 * consulted before it has walked in, so a one-shot request lands on a call whose result is discarded or on
 * an actor still at the door, out of reach of any seat, and is silently dropped. Asking again is a no-op
 * once seated (the planner skips a sit for an actor who already sits). Only the mock provider is wrapped; a real model
 * writes its own body block.
 */
/** `consults` counts per agent across calls: the runtime builds a provider per call, so the counter belongs to the run. */
export function withMockBody(inner: LLMProvider, consults: Map<string, number>): LLMProvider {
  return {
    async generateIntent(input, context, prompt) {
      const result = await inner.generateIntent(input, context, prompt);
      const n = (consults.get(input.agentId) ?? 0) + 1;
      consults.set(input.agentId, n);
      const body = mockBody(input.agentId, n);
      if (!body) return result;
      try {
        const intent = JSON.parse(result.content) as Record<string, unknown>;
        return { ...result, content: JSON.stringify({ ...intent, body }) };
      } catch {
        return result;
      }
    },
  };
}

export function mockBody(agentId: string, n: number): Record<string, unknown> | undefined {
  const sitter = hashString(agentId) % 2 === 0;
  if (sitter && n >= 3 && n < 12) return { posture: { pose: "sit" } };
  if (sitter && n === 12) return { posture: { pose: "stand" } };
  if (!sitter && n % 9 === 0) return { gesture: { kind: "wave" } };
  if (n % 7 === 0) return { expression: "smile" };
  return undefined;
}
