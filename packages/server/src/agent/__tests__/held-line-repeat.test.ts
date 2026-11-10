import { describe, expect, it } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import { heldLineRepeat } from "../repetition-guard.js";
import { CAIO_JOKE, IAN_FIRST, IAN_SECOND, NORMAL } from "./fixtures/ptbr-lines.js";

const said = (id: string, actorId: string, content: string, extra: { untrusted?: boolean; hearers?: string[] } = {}): CommittedEvent =>
  ({
    id,
    simulationId: "sim-1",
    channelId: "room:12",
    actorId,
    type: "message_sent",
    payload: { content, ...(extra.untrusted ? { untrusted: true } : {}) },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: extra.hearers ?? ["ian", "caio"], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  }) as CommittedEvent;

describe("a held line, released after a walk, is judged like a fresh one", () => {
  it("is a repeat of the actor's own line said while it waited, even with a changed tail", () => {
    const log = [said("e1", "ian", IAN_FIRST), said("e2", "caio", NORMAL[3]!)];
    expect(heldLineRepeat("ian", IAN_SECOND, log)).toBe("own");
    expect(heldLineRepeat("ian", IAN_FIRST, log)).toBe("own");
  });

  it("is a copy of what somebody else said in the meantime, only if the actor could hear it", () => {
    expect(heldLineRepeat("ian", CAIO_JOKE, [said("e1", "caio", CAIO_JOKE)])).toBe("room");
    expect(heldLineRepeat("ian", CAIO_JOKE, [said("e1", "caio", CAIO_JOKE, { hearers: ["caio"] })])).toBeUndefined();
  });

  it("does not take a guest's line for a copy: answering a person in their words is not a repeat", () => {
    expect(heldLineRepeat("ian", CAIO_JOKE, [said("e1", "h:9", CAIO_JOKE, { untrusted: true })])).toBeUndefined();
  });

  it("lets a new line, an empty log and operator bookkeeping through", () => {
    expect(heldLineRepeat("ian", NORMAL[10]!, [said("e1", "ian", IAN_FIRST), said("e2", "caio", CAIO_JOKE)])).toBeUndefined();
    expect(heldLineRepeat("ian", IAN_FIRST, [])).toBeUndefined();
    const bookkeeping = { ...said("e3", "ian", IAN_FIRST), type: "speech_deferred" } as CommittedEvent;
    expect(heldLineRepeat("ian", IAN_FIRST, [bookkeeping])).toBeUndefined();
  });
});
