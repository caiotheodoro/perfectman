import { describe, expect, it } from "vitest";
import { addresseesOf } from "../addressees.js";
import type { DirectorEvent } from "../types.js";

const NAMES = { neide: "Dona Neide", tavo: "Tavo", priya: "Priya", okafor: "Mr. Okafor" };
const CHANNEL = { id: "c", name: "c", type: "public_channel", memberAgentIds: ["neide", "tavo", "priya", "okafor"] };
const ev = (actorId: string, payload: Record<string, unknown>, type = "message_sent"): DirectorEvent => ({ id: "e", channelId: "c", actorId, type, payload });

describe("addresseesOf", () => {
  it("trusts what the engine recorded and says it was not inferred", () => {
    const r = addresseesOf(ev("tavo", { content: "hi", addresseeIds: ["priya", "tavo"] }), { agentNames: NAMES, channel: CHANNEL });

    expect(r).toEqual({ ids: ["priya"], inferred: false });
  });

  it("infers from the reply target first, then recorded mentions, and flags it", () => {
    const r = addresseesOf(ev("tavo", { content: "ok", replyToActorId: "neide", mentionedAgentIds: ["priya"] }, "reply_sent"), { agentNames: NAMES, channel: CHANNEL });

    expect(r).toEqual({ ids: ["neide", "priya"], inferred: true });
  });

  it("reads names out of the text, by the name people actually use", () => {
    const r = addresseesOf(ev("priya", { content: "Neide, you gave no notice to Okafor." }), { agentNames: NAMES, channel: CHANNEL });

    expect(r.ids.sort()).toEqual(["neide", "okafor"]);
    expect(r.inferred).toBe(true);
  });

  it("never addresses the author and stays inside the channel", () => {
    const small = { ...CHANNEL, memberAgentIds: ["tavo", "priya"] };
    const r = addresseesOf(ev("tavo", { content: "Tavo and Neide and Priya" }), { agentNames: NAMES, channel: small });

    expect(r.ids).toEqual(["priya"]);
  });

  it("assumes a reply answers the last other voice, but an open remark addresses the room", () => {
    const ctx = { agentNames: NAMES, channel: CHANNEL, lastOtherSpeaker: "okafor" };

    expect(addresseesOf(ev("tavo", { content: "fine" }, "reply_sent"), ctx).ids).toEqual(["okafor"]);
    expect(addresseesOf(ev("tavo", { content: "fine" }), ctx).ids).toEqual([]);
  });
});
