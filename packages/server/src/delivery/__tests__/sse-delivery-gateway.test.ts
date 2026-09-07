/**
 * What the browser learns about channels. A private room's membership
 * changes after it is created — someone is invited, someone leaves — and the
 * viewer draws the room from the member list, so it has to hear about it.
 */
import { describe, expect, it, vi } from "vitest";
import { SseDeliveryGateway } from "../sse-delivery-gateway.js";
import { SseHub, type SseMessage } from "../../http/sse-hub.js";

function harness() {
  const published: SseMessage[] = [];
  const hub = new SseHub();
  vi.spyOn(hub, "publish").mockImplementation((message: SseMessage) => {
    published.push(message);
  });
  const gateway = new SseDeliveryGateway(hub, { simulationId: "s", simulationName: "s", agents: {}, channels: { geral: { name: "geral" } } });
  const channels = () => published.filter((m) => m.type === "channel").map((m) => (m.data as { channel: { id: string; memberAgentIds: string[] } }).channel);
  return { gateway, published, channels };
}

describe("SseDeliveryGateway channels", () => {
  it("tells the viewer when someone is added to a room", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["rex"]);
    await gateway.addMember("dm", "goulart");
    const last = channels().at(-1);
    expect(last?.id).toBe("dm");
    expect(last?.memberAgentIds.sort()).toEqual(["goulart", "rex"]);
  });

  it("tells the viewer when someone leaves", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["rex", "goulart"]);
    await gateway.removeMember("dm", "rex");
    expect(channels().at(-1)?.memberAgentIds).toEqual(["goulart"]);
  });

  it("merges members when the same room is announced twice", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["rex"]);
    await gateway.createChannel("dm", "private_channel", ["goulart"]);
    expect(channels().at(-1)?.memberAgentIds.sort()).toEqual(["goulart", "rex"]);
  });

  it("does not repeat a room whose members did not change", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["rex"]);
    await gateway.addMember("dm", "rex");
    expect(channels()).toHaveLength(1);
  });

  it("never lets a slow client lose a pulse: frames are not coalesced", () => {
    const { gateway, published } = harness();
    gateway.commitPulse({ pulseIndex: 0, eventsCommitted: 0, agentsCalled: 0 });
    gateway.commitPulse({ pulseIndex: 1, eventsCommitted: 0, agentsCalled: 0 });
    const pulses = published.filter((m) => m.type === "pulse");
    expect(pulses).toHaveLength(2);
    expect(pulses.every((m) => m.coalesceKey === undefined)).toBe(true);
  });
});
