import type {
  CommittedEvent,
  EventPayload,
  OperatorEvent,
  SimulationSettings,
} from "@perfectman/shared";
import type { IDeliveryGateway } from "../scheduler-contracts.js";
import { payloadString } from "../payload-readers.js";

export class OperatorProjection {
  constructor(private readonly gateway: IDeliveryGateway) {}

  async project(
    event: CommittedEvent,
    settings: SimulationSettings,
  ): Promise<void> {
    const opEvent = this.toOperatorEvent(event);
    if (opEvent) {
      await this.gateway.sendOperatorEvent(opEvent);
    }
  }

  async emit(opEvent: OperatorEvent): Promise<void> {
    await this.gateway.sendOperatorEvent(opEvent);
  }

  private toOperatorEvent(event: CommittedEvent): OperatorEvent | null {
    switch (event.type) {
      case "intent_blocked": {
        const intentType = payloadString(event.payload, "intentType", "unknown");
        return {
          type: "intent_blocked",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Intent blocked: ${intentType}`,
          data: { violations: event.payload["violations"] ?? [] },
          createdAt: event.createdAt,
        };
      }
      case "intent_delayed": {
        const intentType = payloadString(event.payload, "intentType", "unknown");
        return {
          type: "intent_delayed",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Intent delayed: ${intentType}`,
          data: { delayUntilPulse: event.payload["delayUntilPulse"] ?? 0 },
          createdAt: event.createdAt,
        };
      }
      case "stagnation_detected": {
        const level = payloadString(event.payload, "level", "unknown");
        return {
          type: "stagnation_warning",
          simulationId: event.simulationId,
          pulseIndex: event.pulseIndex,
          detail: `Stagnation detected: ${level}`,
          data: { metrics: event.payload["metrics"] ?? {} },
          createdAt: event.createdAt,
        };
      }
      case "llm_failure":
        return {
          type: "llm_failure",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: payloadString(event.payload, "reason", "LLM failure"),
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      default:
        return null;
    }
  }
}
