/**
 * A run whose model never answers usably is a failed run, not a quiet one.
 *
 * The health check before a run catches a dead endpoint or a bad key. It
 * cannot catch the case where the model answers but with nothing the parser
 * can use — the wrong output format, reasoning that eats the whole budget —
 * because that only shows on a real turn. Left alone, such a run plays out
 * as a room where nobody says anything, and the person watching concludes
 * the product is broken rather than the key.
 *
 * So the first few calls are watched. If every one of them came back as an
 * engine fallback, the run stops with the last reason and a hint; one usable
 * answer proves the model works, and after that ordinary failures are the
 * engine's business.
 */
import type { ChannelType, EndReason, EndingOffer, OperatorEvent, SpectatorEvent } from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../../simulation/scheduler-contracts.js";

export type LlmFatal = { message: string; hint: string };

/** Motive prefixes that mean the model, not the character, failed to answer. */
const MODEL_FAILURE_PREFIXES = ["Provider failed:", "Fallback applied:", "Retry call failed."];

export const LLM_FAILURE_HINT =
  "Check the API key, the base URL and the model name. If the model reasons by default, switch JSON mode to json_object or add the extra field that disables reasoning.";

export class LlmHealthWatch {
  private calls = 0;
  private failures = 0;
  private lastReason = "";
  private proven = false;
  private verdict: LlmFatal | null = null;

  constructor(private readonly window = 3) {}

  /** Returns the fatal verdict the first time it is reached; null otherwise. */
  observe(event: OperatorEvent): LlmFatal | null {
    if (this.proven || this.verdict || event.type !== "action_intent") return null;
    const motive = typeof event.data?.["privateMotiveSummary"] === "string" ? (event.data["privateMotiveSummary"] as string) : "";
    this.calls += 1;
    if (MODEL_FAILURE_PREFIXES.some((prefix) => motive.startsWith(prefix))) {
      this.failures += 1;
      this.lastReason = motive;
    } else {
      this.proven = true;
      return null;
    }
    if (this.calls >= this.window && this.failures === this.calls) {
      this.verdict = {
        message: `The model answered nothing usable in the first ${this.window} calls. Last reason: ${this.lastReason}`,
        hint: LLM_FAILURE_HINT,
      };
      return this.verdict;
    }
    return null;
  }
}

/** A gateway that only listens, and tells the run when the model has failed it. */
export class LlmHealthGateway implements IDeliveryGateway {
  constructor(
    private readonly watch: LlmHealthWatch,
    private readonly onFatal: (fatal: LlmFatal) => void,
  ) {}

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    const fatal = this.watch.observe(event);
    if (fatal) this.onFatal(fatal);
    return Promise.resolve();
  }

  sendAgentMessage(_channelId: string, _message: DeliveryMessage): Promise<void> {
    return Promise.resolve();
  }
  createChannel(_channelId: string, _type: ChannelType, _memberAgentIds: string[]): Promise<void> {
    return Promise.resolve();
  }
  addMember(_channelId: string, _agentId: string): Promise<void> {
    return Promise.resolve();
  }
  removeMember(_channelId: string, _agentId: string): Promise<void> {
    return Promise.resolve();
  }
  sendSpectatorEvent(_event: SpectatorEvent): Promise<void> {
    return Promise.resolve();
  }
  onSimulationStopped(_simulationId: string, _endReason?: EndReason, _endingOffer?: EndingOffer): Promise<void> {
    return Promise.resolve();
  }
}
