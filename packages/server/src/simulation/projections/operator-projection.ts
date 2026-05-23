import type {
  CommittedEvent,
  OperatorEvent,
  SimulationSettings,
} from "@perfectman/shared";
import type { IDeliveryGateway } from "../scheduler-contracts.js";

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
      case "intent_blocked":
        return {
          type: "intent_blocked",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Intent blocked: ${String(event.payload["intentType"] ?? "unknown")}`,
          data: { violations: event.payload["violations"] },
          createdAt: event.createdAt,
        };
      case "intent_delayed":
        return {
          type: "intent_delayed",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Intent delayed: ${String(event.payload["intentType"] ?? "unknown")}`,
          data: { delayUntilPulse: event.payload["delayUntilPulse"] },
          createdAt: event.createdAt,
        };
      case "stagnation_detected":
        return {
          type: "stagnation_warning",
          simulationId: event.simulationId,
          pulseIndex: event.pulseIndex,
          detail: `Stagnation detected: ${String(event.payload["level"] ?? "unknown")}`,
          data: { metrics: event.payload["metrics"] },
          createdAt: event.createdAt,
        };
      case "llm_failure":
        return {
          type: "llm_failure",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: String(event.payload["reason"] ?? "LLM failure"),
          data: event.payload,
          createdAt: event.createdAt,
        };
      default:
        return null;
    }
  }
}
