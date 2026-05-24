import type { AgentRuntimeInput } from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LlmProvider, LlmProviderResult } from "./llm-provider.js";

export class MockLlmProvider implements LlmProvider {
  /**
   * Deterministic fixture-based responses mimicking Goulart or other characters based on the input context.
   */
  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LlmProviderResult> {
    const startTime = Date.now();
    const actorId = input.agentId;

    // Default intent details
    let intentType: string = "no_op";
    let channelTarget: string | undefined = undefined;
    let personTargets: string[] = [];
    let visibleContent: string | undefined = undefined;
    let privateMotiveSummary: string = "No active urges detected, choosing silence.";
    let emotionDrivers: string[] = [];
    let motivationDrivers: string[] = [];

    // Resolve channel target if available
    const sendMsgAction = input.availableActions.find(a => a.intentType === "send_message");
    const replyMsgAction = input.availableActions.find(a => a.intentType === "reply_to_message");
    const createChannelAction = input.availableActions.find(a => a.intentType === "create_channel");

    // Case 1: High Inhibition or Blocked
    const hasHighInhibition = input.activeInhibitions.some(inh => inh.strength === "high");
    if (hasHighInhibition) {
      intentType = "no_op";
      privateMotiveSummary = "I want to speak but my internal hesitations are holding me back completely.";
      emotionDrivers = ["shame"];
      motivationDrivers = ["avoidance"];
    }
    // Case 2: Mention or direct reply trigger — skipped when social anxiety makes agent prefer private channel
    else if (
      input.triggeringReason === "attention_event" &&
      !input.activeInhibitions.some(i => i.type === "social_anxiety_block")
    ) {
      const triggeringEvent = input.perceptionPacket.triggeringEvent;
      const triggerActor = triggeringEvent?.actorId || "agent-bruno";

      if (replyMsgAction && !replyMsgAction.blocked) {
        intentType = "reply_to_message";
        channelTarget = replyMsgAction.channelTargets[0];
        personTargets = [triggerActor];
        emotionDrivers = ["warmth"];
        motivationDrivers = ["affinity"];

        if (actorId.toLowerCase() === "goulart") {
          visibleContent = triggerActor.includes("bruno")
            ? "calmae fi tava treinando blz"
            : "bora ver esse bagulho aí po";
          privateMotiveSummary = `Replying to ${triggerActor} casually to acknowledge them without sounding too eager.`;
        } else {
          visibleContent = `oi tudo bem`;
          privateMotiveSummary = `Responding to direct mention by ${triggerActor}.`;
        }
      } else if (sendMsgAction && !sendMsgAction.blocked) {
        intentType = "send_message";
        channelTarget = sendMsgAction.channelTargets[0];
        emotionDrivers = ["warmth"];
        motivationDrivers = ["affinity"];

        if (actorId.toLowerCase() === "goulart") {
          visibleContent = "kkkkkk não acredito";
          privateMotiveSummary = "casually react to the comment in channel";
        } else {
          visibleContent = "olá";
          privateMotiveSummary = "casually reply";
        }
      }
    }
    // Case 3: Private-channel motive — fires when create_channel is available and attention reply was skipped
    // (either no attention event, or social anxiety made the agent prefer privacy over public reply)
    else if (createChannelAction && !createChannelAction.blocked && createChannelAction.personTargets.length > 0) {
      intentType = "create_channel";
      personTargets = [createChannelAction.personTargets[0] || "agent-caio"];
      emotionDrivers = ["warmth"];
      motivationDrivers = ["gossip"];

      if (actorId.toLowerCase() === "goulart") {
        privateMotiveSummary = "Start a private side channel with Caio to chat about Chelsea matches and avoid main group noise.";
      } else {
        privateMotiveSummary = `Start a private channel to form an alliance.`;
      }
    }
    // Case 4: Boredom / Cold Start / Initiative
    else if (sendMsgAction && !sendMsgAction.blocked) {
      intentType = "send_message";
      channelTarget = sendMsgAction.channelTargets[0];
      emotionDrivers = ["warmth"];
      motivationDrivers = ["boredom"];

      if (actorId.toLowerCase() === "goulart") {
        visibleContent = "bicho o Chelsea essa temporada vem fortão confia po kkk";
        privateMotiveSummary = "The chat went quiet. Post a hot take on Chelsea to stir up a conversation.";
      } else {
        visibleContent = "pois é";
        privateMotiveSummary = "Bored, send a casual conversational opener.";
      }
    }

    const mockResponseIntent = {
      id: createId(),
      actorId,
      intentType,
      channelTarget,
      personTargets,
      visibleContent,
      privateMotiveSummary,
      emotionDrivers,
      motivationDrivers,
      preferredDelay: 0,
      fallbackIfBlocked: "no_op",
      memoryWrites: [],
    };

    // Simulated latency based on inputs (e.g. 50ms to 200ms)
    const latencyMs = Date.now() - startTime + 50;

    // Simulated token usage
    const promptTokens = prompt.inputTokensEstimate || 150;
    const completionTokens = Math.ceil(JSON.stringify(mockResponseIntent).length / 4);

    return {
      content: JSON.stringify(mockResponseIntent),
      usage: {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
      },
      latencyMs,
      model: "mock-model",
      requestedModel: "mock-model",
      routedModel: "mock-model",
    };
  }
}
