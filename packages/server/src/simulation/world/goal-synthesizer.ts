import type {
  GoalSynthesisResult,
  GoalSynthesizerInput,
  SynthesizerMode,
} from "@perfectman/shared";

/**
 * Goal-synthesis seam (LLMProvider pattern): one synchronous method, no I/O
 * inside. The LLM implementation wraps the provider call in the server layer
 * — this interface is the reversible seam for that slice.
 */
export interface GoalSynthesizer {
  synthesize(input: GoalSynthesizerInput): GoalSynthesisResult[];
}

/**
 * Deterministic V1: verbatim passthrough — the crystallized proposal is the
 * framing. The agent-context digest is carried but not consumed; exercising
 * the contract now keeps the LLM slice growing into a proven shape.
 */
export class DeterministicGoalSynthesizer implements GoalSynthesizer {
  synthesize(input: GoalSynthesizerInput): GoalSynthesisResult[] {
    return input.candidates.map((candidate) => ({
      proposal: candidate,
      narrativeFraming: candidate.targetState.description,
      confidence: 1,
      synthesizer: "deterministic",
    }));
  }
}

export function createGoalSynthesizer(mode: SynthesizerMode): GoalSynthesizer {
  switch (mode) {
    case "deterministic":
      return new DeterministicGoalSynthesizer();
    case "llm":
      throw new Error(
        `synthesizer.mode "llm" is not wired in this slice; lands with the LLM synthesizer slice`,
      );
  }
}