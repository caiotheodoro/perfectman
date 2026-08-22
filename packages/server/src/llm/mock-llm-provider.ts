import type { AgentRuntimeInput } from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMProvider, LLMProviderResult } from "./llm-provider.js";

export class MockLLMProvider implements LLMProvider {
  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult> {
    const startTime = Date.now();
    const actorId = input.agentId;

    let intentType: string = "no_op";
    let channelTarget: string | undefined = undefined;
    let personTargets: string[] = [];
    let visibleContent: string | undefined = undefined;
    let privateMotiveSummary: string = "No active urges detected, choosing silence.";
    let emotionDrivers: string[] = [];
    let motivationDrivers: string[] = [];

    const sendMsgAction = input.availableActions.find(a => a.intentType === "send_message");
    const replyMsgAction = input.availableActions.find(a => a.intentType === "reply_to_message");
    const createChannelAction = input.availableActions.find(a => a.intentType === "create_channel");

    // Case 1: High inhibition — stay silent
    const hasHighInhibition = input.activeInhibitions.some(inh => inh.strength === "high");
    if (hasHighInhibition) {
      intentType = "no_op";
      privateMotiveSummary = "I want to speak but my internal hesitations are holding me back completely.";
      emotionDrivers = ["shame"];
      motivationDrivers = ["avoidance"];
    }
    // Case 2: Attention event (mention / direct reply) — respond publicly unless social anxiety pushes to private
    else if (
      input.triggeringReason === "attention_event" &&
      !input.activeInhibitions.some(i => i.type === "social_anxiety_block")
    ) {
      const triggeringEvent = input.perceptionPacket.triggeringEvent;
      const triggerActor = triggeringEvent?.actorId ?? replyMsgAction?.personTargets[0];

      if (replyMsgAction && !replyMsgAction.blocked && triggerActor && replyMsgAction.personTargets.includes(triggerActor)) {
        intentType = "reply_to_message";
        channelTarget = replyMsgAction.channelTargets[0];
        personTargets = [triggerActor];
        visibleContent = "oi tudo bem";
        privateMotiveSummary = `Responding to direct mention by ${triggerActor}.`;
        emotionDrivers = ["warmth"];
        motivationDrivers = ["affinity"];
      } else if (sendMsgAction && !sendMsgAction.blocked) {
        intentType = "send_message";
        channelTarget = sendMsgAction.channelTargets[0];
        visibleContent = "olá";
        privateMotiveSummary = "Reacting to activity in the channel.";
        emotionDrivers = ["warmth"];
        motivationDrivers = ["affinity"];
      }
    }
    // Case 3: Private-channel motive — social anxiety or no attention event, prefer privacy
    else if (createChannelAction && !createChannelAction.blocked && createChannelAction.personTargets.length > 0) {
      intentType = "create_channel";
      personTargets = [createChannelAction.personTargets[0]!];
      privateMotiveSummary = "Start a private channel to connect one-on-one.";
      emotionDrivers = ["warmth"];
      motivationDrivers = ["gossip"];
    }
    // Case 4: Boredom / cold-start initiative — break the silence
    else if (sendMsgAction && !sendMsgAction.blocked) {
      intentType = "send_message";
      channelTarget = sendMsgAction.channelTargets[0];
      visibleContent = "pois é";
      privateMotiveSummary = "Bored, sending a casual opener to break the silence.";
      emotionDrivers = ["warmth"];
      motivationDrivers = ["boredom"];
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
