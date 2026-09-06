import { describe, expect, it } from "vitest";
import { normalizeVideoSource } from "../read-source.js";

const event = (id: string, actorId: string, type: string, payload: Record<string, unknown> = {}, extra = {}) => ({
  id, actorId, type, payload, channelId: "room", pulseIndex: 0, ...extra,
});
const script = () => ({
  version: "perfectman-video-v1", title: "A recorded room", place: "An authored reading room",
  agents: [{ id: "ada", name: "Ada" }, { id: "nox", name: "Nox" }],
  channels: [{ id: "dm", name: "Ada and Nox", kind: "private", memberIds: ["ada", "nox"] }],
  steps: [{ phase: "Conversation", kind: "message", actorId: "ada", channel: "dm", text: "Stay.",
    recipientIds: ["nox"], audienceIds: ["ada", "nox"], presence: "active",
    stageAction: { kind: "invite", agentIds: ["nox"] } }],
});

describe("recorded channel and participant metadata", () => {
  it("retains authored setting and targeting without treating a private message as a thought", () => {
    const input = script(), before = JSON.stringify(input);
    const story = normalizeVideoSource(input);
    expect(story).toMatchObject({ place: input.place, channels: input.channels });
    expect(story.steps[0]).toMatchObject({ kind: "message", visibility: "private", recipientIds: ["nox"],
      audienceIds: ["ada", "nox"], presence: "active", stageAction: { kind: "invite", agentIds: ["nox"] } });
    expect(story.steps[0]?.raw).toBe(input.steps[0]);
    expect(story.steps[0]?.sourceRefs).toEqual(["/steps/0"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("validates all authored references and keeps old scripts without a channel catalog working", () => {
    for (const field of ["recipientIds", "audienceIds"]) {
      const input = script();
      Object.assign(input.steps[0]!, { [field]: ["missing"] });
      expect(() => normalizeVideoSource(input)).toThrow("Unknown script");
    }
    const badMember = script(); badMember.channels[0]!.memberIds = ["missing"];
    expect(() => normalizeVideoSource(badMember)).toThrow("channel memberId");
    const badStage = script(); badStage.steps[0]!.stageAction.agentIds = ["missing"];
    expect(() => normalizeVideoSource(badStage)).toThrow("stageAction agentId");
    const badChannel = script(); badChannel.steps[0]!.channel = "missing";
    expect(() => normalizeVideoSource(badChannel)).toThrow("Unknown script channel");
    const duplicate = script(); duplicate.channels.push(duplicate.channels[0]!);
    expect(() => normalizeVideoSource(duplicate)).toThrow("channel IDs must be unique");
    const noScope = script(); Object.assign(noScope.steps[0]!, { channel: undefined });
    expect(() => normalizeVideoSource(noScope)).toThrow("need a channel");
    const old = { version: "perfectman-video-v1", title: "Old", agents: [{ id: "a", name: "A" }],
      steps: [{ phase: "Before", kind: "message", actorId: "a", channel: "general", text: "Hello" }] };
    expect(normalizeVideoSource(old).channels).toEqual([{ id: "general", name: "general", kind: "public" }]);
  });

  it("inherits channel visibility, preserves private thoughts, and rejects public labels in private channels", () => {
    const input = script();
    input.channels.push({ id: "ops", name: "Operator", kind: "operator", memberIds: [] });
    input.steps.push({ ...input.steps[0]!, channel: "ops" }, { ...input.steps[0]!, kind: "private", channel: "ops" });
    expect(normalizeVideoSource(input).steps.map(step => step.visibility)).toEqual(["private", "operator", "private"]);
    Object.assign(input.steps[0]!, { visibility: "operator" });
    expect(normalizeVideoSource(input).steps[0]?.visibility).toBe("operator");
    Object.assign(input.steps[0]!, { visibility: "public" });
    expect(() => normalizeVideoSource(input)).toThrow("step 1 sets public visibility in private channel dm; omit visibility or use private/operator");
  });

  it("uses declared channel identity while preserving thoughts, operator records and raw input", () => {
    const input = { channels: [{ id: "room", type: "private_channel" }, { id: "ops", type: "operator_channel" }], events: [
      event("message", "ada", "message_sent", { content: "Private conversation" }),
      event("leave", "ada", "agent_left", {}, { visibility: { visibleToSpectators: true, visibilityReason: "public" } }),
      event("ops", "ada", "message_sent", { content: "Operator note" }, { channelId: "ops" }),
      event("thought", "ada", "private_motive_summary", { summary: "I need an answer" }, { channelId: "ops" }),
      event("internal", "system", "operator_warning"),
    ] };
    const before = JSON.stringify(input), story = normalizeVideoSource(input);
    expect(story.steps.map(step => step.visibility)).toEqual(["private", "private", "operator", "private", "operator"]);
    expect(story.steps[3]?.kind).toBe("private");
    expect(story.steps[0]?.raw).toBe(input.events[0]);
    expect(story.steps[0]?.sourceRefs).toEqual(["/events/0"]);
    expect(story.steps.every(step => !step.audienceIds)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses inferred private creation identity for later event and replay steps", () => {
    const created = event("created", "ada", "channel_created", { channelType: "private_channel", invitedAgentIds: ["nox"] });
    const later = [event("message", "ada", "message_sent", { content: "Later" }), event("leave", "nox", "agent_left")];
    for (const input of [{ events: [created, ...later] }, { agentIds: ["ada", "nox"], pulses: [
      { pulseIndex: 0, committedEvents: [created] }, { pulseIndex: 1, committedEvents: later },
    ] }]) {
      const story = normalizeVideoSource(input), steps = story.steps.filter(step => step.channel);
      expect(steps.map(step => step.visibility)).toEqual(["private", "private", "private"]);
      expect(steps[1]?.audienceIds).toBeUndefined();
      expect(steps[1]?.stageAction).toBeUndefined();
    }
  });

  it("keeps explicit public and operator channel types above per-event visibility inference", () => {
    const story = normalizeVideoSource({ events: [
      event("created", "ada", "channel_created", { channelType: "public_channel" }, { visibility: { visibleToSpectators: false } }),
      event("restricted", "ada", "message_sent", { content: "Restricted action" }, { visibility: { visibleToSpectators: false } }),
      event("public", "ada", "message_sent", { content: "Public action" }),
      event("early-ops", "ada", "message_sent", { content: "Operator note" }, { channelId: "ops" }),
      event("ops-created", "ada", "channel_created", { channelType: "operator_channel" }, { channelId: "ops" }),
    ] });
    expect(story.channels?.map(channel => [channel.id, channel.kind])).toEqual([["room", "public"], ["ops", "operator"]]);
    expect(story.steps.map(step => step.visibility)).toEqual(["private", "private", "public", "operator", "operator"]);
  });

  it("resolves earlier reply targets, distinguishes audience, and never turns a mention or future ID into a recipient", () => {
    const events = [
      event("first", "nox", "message_sent", { content: "Hello" }),
      event("reply", "ada", "reply_sent", { content: "Hello", replyToEventId: "first", mentionedAgentIds: ["third"] },
        { visibility: { visibleToAgents: ["ada", "nox", "third"] } }),
      event("unknown", "ada", "reply_sent", { content: "Later", replyToEventId: "future", mentionedAgentIds: ["nox"] }),
      event("future", "nox", "message_sent", { content: "Afterward" }),
      event("direct", "ada", "message_sent", { content: "For Nox", personTargets: ["nox"] }, { visibility: { visibleToAgents: [] } }),
    ];
    const story = normalizeVideoSource({ events });
    expect(story.steps[1]).toMatchObject({ recipientIds: ["nox"], audienceIds: ["ada", "nox", "third"] });
    expect(story.steps[1]?.sourceRefs).toContain("/events/0");
    expect(story.steps[2]?.recipientIds).toBeUndefined();
    expect(story.steps[4]?.recipientIds).toEqual(["nox"]);
    expect(story.steps[4]?.audienceIds).toBeUndefined();
    expect(story.agents.map(agent => agent.id)).toContain("third");
  });

  it("uses explicit invitation, departure and presence facts without copying actions onto private thoughts", () => {
    const story = normalizeVideoSource({ events: [
      event("create", "ada", "channel_created", { channelName: "Private room", channelType: "private_channel", invitedAgentIds: ["nox"] }),
      event("invite", "ada", "agent_invited", { invitedAgentId: "nox", privateMotiveSummary: "I want an answer." }),
      event("leave", "nox", "agent_left"),
      event("presence", "ada", "presence_changed", { presence: "offline" }),
    ] });
    expect(story.channels).toEqual([{ id: "room", name: "Private room", kind: "private", memberIds: ["ada", "nox"] }]);
    expect(story.steps[0]?.stageAction).toEqual({ kind: "invite", agentIds: ["nox"] });
    expect(story.steps[1]?.stageAction).toEqual({ kind: "invite", agentIds: ["nox"] });
    expect(story.steps[2]).toMatchObject({ kind: "private", visibility: "private" });
    expect(story.steps[2]?.stageAction).toBeUndefined();
    expect(story.steps[3]?.stageAction).toEqual({ kind: "leave", agentIds: ["nox"] });
    expect(story.steps[4]?.presence).toBe("offline");
    expect(story.steps[4]?.stageAction).toBeUndefined();
    const publicInvite = normalizeVideoSource({ events: [
      event("public", "ada", "message_sent", { content: "A public message" }),
      event("invite", "ada", "agent_invited", { invitedAgentId: "nox" }, { visibility: { visibleToSpectators: false, visibilityReason: "invite_parties" } }),
    ] });
    expect(publicInvite.channels?.[0]?.kind).toBe("public");
  });

  it("preserves declared cast, cross-pulse targeting, and recorded audiences without backfilling final membership", () => {
    const input = { agentIds: ["ada", "nox"], agentNames: { ada: "Ada", nox: "Nox" },
      channels: [{ id: "room", name: "Room", type: "private_channel", memberAgentIds: ["nox"] }],
      pulses: [
        { pulseIndex: 0, committedEvents: [event("first", "ada", "message_sent", { content: "Before" }), event("host", "host", "message_sent", { content: "Host note" })],
          agentStates: { ada: { agentId: "ada", presence: "active", arrivalPulse: 0 } } },
        { pulseIndex: 1, committedEvents: [event("reply", "nox", "reply_sent", { content: "Reply", replyToEventId: "first" }, { pulseIndex: 1 }),
          event("system", "system", "operator_warning", { reason: "Note" }, { pulseIndex: 1 })],
          operatorEvents: [{ type: "event_visibility", pulseIndex: 1, data: { eventId: "reply", visibleToAgents: ["ada", "nox"] } }] },
      ] };
    const story = normalizeVideoSource(input);
    expect(story.agents.map(agent => agent.id)).toEqual(["ada", "nox"]);
    expect(story.steps.some(step => step.actorId === "host")).toBe(true);
    expect(story.steps.some(step => step.actorId === "system")).toBe(true);
    expect(story.steps.find(step => step.text === "Before")?.audienceIds).toBeUndefined();
    const reply = story.steps.find(step => step.text === "Reply");
    expect(reply).toMatchObject({ recipientIds: ["ada"], audienceIds: ["ada", "nox"] });
    expect(reply?.sourceRefs).toContain("/pulses/0/committedEvents/0");
    const state = story.steps.find(step => step.kind === "state");
    expect(state?.presence).toBe("active");
    expect(state?.stageAction).toBeUndefined();
    expect(story.channels?.[0]?.memberIds).toEqual(["nox"]);
  });

  it("keeps lossy evidence participants and places unknown", () => {
    const story = normalizeVideoSource({ name: "A room is not an authored location", description: "Do not invent a place",
      transcript: [
        { pulse: 0, agent: "ada", type: "reply_sent", channelId: "general", private: false, content: "Nox, answer me." },
        { pulse: 1, agent: "ada", type: "channel_created", channelId: "secret", private: true },
        { pulse: 1, agent: "ada", type: "agent_invited", channelId: "secret", private: false },
      ] });
    expect(story.channels).toEqual([{ id: "general", name: "general", kind: "public" }, { id: "secret", name: "secret", kind: "private" }]);
    expect(story.place).toBeUndefined();
    expect(story.steps.every(step => !step.recipientIds && !step.audienceIds && !step.stageAction)).toBe(true);
    expect(story.channels?.every(channel => !channel.memberIds)).toBe(true);
  });
});
