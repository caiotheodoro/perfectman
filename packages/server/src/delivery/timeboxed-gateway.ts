/**
 * Bounds how long a gateway can hold up a pulse.
 *
 * `DeliveryProjection.safeGatewayCall` already swallows a gateway that
 * *throws*, but a gateway that simply never settles is a different failure:
 * every call is awaited inline in the pulse and fanned out with `Promise.all`,
 * and nothing on that path has a timeout. One stuck gateway therefore hangs the
 * run forever.
 *
 * The timeout **resolves** rather than rejects, so the composite's `Promise.all`
 * proceeds and the pulse completes. A run that quietly loses a delivery is
 * better than one that never ends — and the counter makes "quietly" false.
 */
import type { ChannelType, EndReason, EndingOffer, OperatorEvent, SpectatorEvent } from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";

export type TimeboxCounter = { timeouts: number };

export function timeboxGateway(
  inner: IDeliveryGateway,
  timeoutMs: number,
  counter: TimeboxCounter = { timeouts: 0 },
): IDeliveryGateway & { readonly counter: TimeboxCounter } {
  const bound = async (call: () => Promise<void>): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        counter.timeouts++;
        resolve();
      }, timeoutMs);
    });
    try {
      await Promise.race([call(), timeout]);
    } catch {
      // Matches the projection's own behaviour: a throwing gateway must not
      // take the pulse down with it.
      counter.timeouts++;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    counter,
    sendAgentMessage: (channelId: string, message: DeliveryMessage) =>
      bound(() => inner.sendAgentMessage(channelId, message)),
    createChannel: (channelId: string, type: ChannelType, memberAgentIds: string[]) =>
      bound(() => inner.createChannel(channelId, type, memberAgentIds)),
    addMember: (channelId: string, agentId: string) => bound(() => inner.addMember(channelId, agentId)),
    removeMember: (channelId: string, agentId: string) =>
      bound(() => inner.removeMember(channelId, agentId)),
    sendSpectatorEvent: (event: SpectatorEvent) => bound(() => inner.sendSpectatorEvent(event)),
    sendOperatorEvent: (event: OperatorEvent) => bound(() => inner.sendOperatorEvent(event)),
    onSimulationStopped: (simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer) =>
      bound(() => inner.onSimulationStopped(simulationId, endReason, endingOffer)),
  };
}
