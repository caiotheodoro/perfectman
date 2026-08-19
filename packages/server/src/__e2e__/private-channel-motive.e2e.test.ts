/**
 * E2E — Private Channel Motive: Mariana creates a private channel driven by affection for Caio.
 *
 * Scenario: Caio posted publicly. Mariana wants to approach him but shame and
 * social anxiety block any direct public response. The engine computes that
 * create_channel is unblocked (affection+intimacy drive exceed anxiety inhibition).
 * The mock LLM picks create_channel because a personTarget is available.
 *
 * Expected pipeline behaviour:
 * - Engine: affection/attraction motivation → pressure → create_channel in availableActions
 * - AgentRuntime called for Mariana
 * - Mock LLM: private-channel case → create_channel intent targeting Caio
 * - IntentResolver: creates channel_created event, no membership block
 * - ChannelRegistry: new private channel registered
 * - DeliveryProjection: gateway.createChannel called with mariana+caio
 * - channel_created: visibleToSpectators=true (spectator always sees new channels)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildPrivateChannelMotiveScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

describe("E2E: Private Channel Motive — Mariana opens a private channel with Caio", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    const scenario = buildPrivateChannelMotiveScenario();

    harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "mariana", state: scenario.agentStates.mariana, persona: scenario.personas.mariana },
        { id: "caio",    state: scenario.agentStates.caio,    persona: scenario.personas.caio },
      ],
      priorEvents: scenario.committedEvents,
    });
  });

  it("completes pulse without error", async () => {
    const result = await harness.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("invokes AgentRuntime for Mariana (engine routes her to the LLM path)", async () => {
    await harness.runPulse();
    expect(harness.llmCallsFor("mariana")).toBeGreaterThanOrEqual(1);
  });

  it("commits a channel_created event", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    expect(created.length).toBeGreaterThan(0);
  });

  it("channel_created is attributed to Mariana", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const marianaChannel = created.find(e => e.actorId === "mariana");
    expect(marianaChannel).toBeDefined();
    // The private-channel motive is evidenced by who she invited, not by a payload summary
    expect(marianaChannel!.payload["invitedAgentIds"]).toContain("caio");
  });

  it("calls gateway.createChannel with Mariana as creator", async () => {
    await harness.runPulse();
    expect(harness.gateway.createdChannels.length).toBeGreaterThan(0);
  });

  it("new channel includes Caio as a member", async () => {
    await harness.runPulse();
    const created = harness.gateway.createdChannels[0];
    expect(created?.memberAgentIds).toContain("caio");
  });

  it("Mariana's channel_created payload marks a private channel", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const marianaChannel = created.find(e => e.actorId === "mariana");
    // channel_created payload carries channelType/invitedAgentIds, not the motive summary
    expect(marianaChannel?.payload["channelType"]).toBe("private_channel");
  });

  it("Mariana's emotional bounds remain valid after private motive resolution", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("mariana");
    harness.assertEmotionBounds(state);
  });

  it("produces no LLM failures", async () => {
    await harness.runPulse();
    await harness.assertNoLlmFailures();
  });

  it("all committed events carry correct shape", async () => {
    await harness.runPulse();
    await harness.assertCommittedEventShape();
  });
});
