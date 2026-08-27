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
      case "goal_proposed": {
        const goalId = payloadString(event.payload, "goalId", "?");
        return {
          type: "goal_proposed",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Goal proposed: ${goalId}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      case "goal_accepted": {
        const goalId = payloadString(event.payload, "goalId", "?");
        return {
          type: "goal_accepted",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Goal accepted: ${goalId}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      case "goal_declined": {
        const goalId = payloadString(event.payload, "goalId", "?");
        return {
          type: "goal_declined",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: `Goal declined: ${goalId}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      case "world_verdict": {
        const determination = payloadString(
          (event.payload["verdict"] ?? {}) as EventPayload,
          "determination",
          "?",
        );
        return {
          type: "world_verdict",
          simulationId: event.simulationId,
          pulseIndex: event.pulseIndex,
          detail: `World verdict: ${determination}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      case "delusion_gap_sampled": {
        const goalId = payloadString(event.payload, "goalId", "?");
        return {
          type: "delusion_gap_sampled",
          simulationId: event.simulationId,
          pulseIndex: event.pulseIndex,
          detail: `Delusion gap sampled: ${goalId}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      case "ending_offered": {
        const goalId = payloadString(event.payload, "goalId", "?");
        return {
          type: "ending_offered",
          simulationId: event.simulationId,
          pulseIndex: event.pulseIndex,
          detail: `Ending offered: ${goalId}`,
          data: event.payload satisfies EventPayload,
          createdAt: event.createdAt,
        };
      }
      default:
        return null;
    }
  }
}
