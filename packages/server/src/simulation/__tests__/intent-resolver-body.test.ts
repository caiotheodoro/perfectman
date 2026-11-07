import { describe, it, expect } from "vitest";
import { applySpaceAction, buildBodyPerception, createSpaceModel, projectSpaceView } from "@perfectman/engine";
import type { ActionIntent, AvailableAction, Presence } from "@perfectman/shared";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import { SETTINGS, ZERO_ACTION, makeAgentState } from "./fixtures.js";

const T0 = 2_000_000;
const person = (ref: string, name: string, tile: [number, number]): Presence => ({
  ref, name, kind: "actor", tile, dir: 2, state: "stand", since: 0, lastMovedAt: 0,
});

function scene(duda: [number, number]) {
  const model = createSpaceModel();
  applySpaceAction(model, { type: "agent_room", agentId: "rafa", room: "lounge" });
  applySpaceAction(model, {
    type: "room_snapshot", at: T0, rev: 1,
    room: {
      id: "lounge", name: "Lounge", template: "lounge", w: 14, h: 8, door: [0, 4], doorDir: 2,
      heights: new Array<number>(14 * 8).fill(0), furni: [],
      occupants: [person("rafa", "Rafa", [2, 4]), person("duda", "Duda", duda)],
    },
  });
  const view = projectSpaceView(model, "rafa", T0 + 100)!;
  // Someone far away only gets a handle if she spoke recently: she just called out.
  const spoke = {
    id: "e1", simulationId: "s", channelId: "room:lounge", actorId: "duda", type: "message_sent" as const,
    payload: { content: "rafa!" }, createdAt: 1, pulseIndex: 1, sourceEventIds: [], emotionalSalience: "low" as const,
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  };
  const { handles } = buildBodyPerception({ view, events: [spoke], language: "pt-BR" });
  const dudaHandle = Object.entries(handles).find(([, t]) => t.kind === "person" && t.ref === "duda")![0];
  return { view, handles, dudaHandle };
}

const actions: AvailableAction[] = [
  { intentType: "send_message", channelTargets: [], personTargets: [], blocked: false },
  { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
];

function resolve(intent: Partial<ActionIntent>, s: ReturnType<typeof scene>, bodyDropped?: never[], hotel: ConstructorParameters<typeof IntentResolver>[4] = {}) {
  const resolver = new IntentResolver(new RateLimitGate(SETTINGS), new ChannelRegistry(new InMemoryChannelRepository()), undefined, () => T0 + 200, hotel);
  return resolver.resolve(
    {
      id: "i1", actorId: "rafa", intentType: "send_message", visibleContent: "vem ca", personTargets: [],
      privateMotiveSummary: "x", emotionDrivers: [], motivationDrivers: [], memoryWrites: [], fallbackIfBlocked: "no_op",
      ...intent,
    },
    {
      simulationId: "s", channelId: "room:lounge", pulseIndex: 2, agentState: makeAgentState({ agentId: "rafa" }),
      availableActions: actions, channels: [], membership: [], settings: SETTINGS, actionEmotions: ZERO_ACTION,
      agentNames: { rafa: "Rafa", duda: "Duda" }, space: s.view, bodyHandles: s.handles,
      ...(bodyDropped ? { bodyDropped } : {}),
    },
  );
}

describe("IntentResolver body block (ADR-0019, hotel mode)", () => {
  it("holds the line until the speaker arrives when the addressee is out of earshot", async () => {
    const s = scene([12, 4]); // 10 tiles away
    const r = await resolve({ body: { move: { kind: "approach", target: s.dudaHandle, band: "personal" }, order: "move_then_speak" } }, s);
    const types = r.committedEvents.map((e) => e.type);
    expect(r.outcome).toBe("delayed");
    expect(types).toContain("speech_deferred");
    expect(types).toContain("body_action_committed");
    expect(types).not.toContain("message_sent");
    expect(r.body?.deferral?.targetRef).toBe("duda");
    const committed = r.committedEvents.find((e) => e.type === "body_action_committed")!;
    expect(committed.payload["commands"]).toEqual(["walk"]);
    expect(committed.visibility.visibilityReason).toBe("operator_only");
  });

  it("speaks now and moves when the addressee is in range or the order is speak_then_move", async () => {
    const near = scene([5, 4]);
    const a = await resolve({ body: { move: { kind: "approach", target: near.dudaHandle, band: "intimate" }, order: "move_then_speak" } }, near);
    expect(a.outcome).toBe("committed");
    expect(a.committedEvents.map((e) => e.type)).toEqual(expect.arrayContaining(["message_sent", "body_action_committed"]));
    const far = scene([12, 4]);
    const b = await resolve({ body: { move: { kind: "approach", target: far.dudaHandle, band: "personal" }, order: "speak_then_move" } }, far);
    expect(b.outcome).toBe("committed");
    expect(b.committedEvents.map((e) => e.type)).toContain("message_sent");
  });

  it("a silent body act is valid, and a parser-dropped block is recorded without costing the line", async () => {
    const s = scene([5, 4]);
    const silent = await resolve({ intentType: "no_op", visibleContent: undefined, body: { gesture: { kind: "wave", toward: s.dudaHandle }, order: "move_then_speak" } }, s);
    expect(silent.committedEvents.map((e) => e.type)).toEqual(expect.arrayContaining(["no_op_recorded", "body_action_committed"]));
    const dropped = await resolve({}, s, [{ code: "unknown_ref", ref: "p9" }] as never);
    expect(dropped.outcome).toBe("committed");
    const blocked = dropped.committedEvents.find((e) => e.type === "body_blocked")!;
    expect(blocked.payload["reasons"]).toEqual([{ code: "unknown_ref", ref: "p9" }]);
    expect(dropped.committedEvents.map((e) => e.type)).toContain("message_sent");
  });

  it("changes nothing without a space: a body block on a non-hotel resolve is ignored", async () => {
    const s = scene([5, 4]);
    const resolver = new IntentResolver(new RateLimitGate(SETTINGS), new ChannelRegistry(new InMemoryChannelRepository()));
    const r = await resolver.resolve(
      {
        id: "i2", actorId: "rafa", intentType: "send_message", visibleContent: "oi", personTargets: [], privateMotiveSummary: "x",
        emotionDrivers: [], motivationDrivers: [], memoryWrites: [], fallbackIfBlocked: "no_op",
        body: { move: { kind: "stay" }, order: "move_then_speak" },
      },
      { simulationId: "s", channelId: "c", pulseIndex: 1, agentState: makeAgentState({ agentId: "rafa" }), availableActions: actions, channels: [], membership: [], settings: SETTINGS, actionEmotions: ZERO_ACTION },
    );
    void s;
    expect(r.body).toBeUndefined();
    expect(r.committedEvents.map((e) => e.type)).not.toContain("body_blocked");
  });

  describe("an addressed say line to someone beyond the say radius", () => {
    const addressed = { personTargets: ["duda"] };

    it("walks to them first even when the model gave no body at all", async () => {
      const s = scene([12, 4]);
      const r = await resolve(addressed, s);
      const types = r.committedEvents.map((e) => e.type);
      expect(r.outcome).toBe("delayed");
      expect(types).toContain("speech_deferred");
      expect(types).not.toContain("message_sent");
      expect(r.body?.accepted.move).toMatchObject({ kind: "approach" });
      expect(r.body?.accepted.order).toBe("move_then_speak");
      expect(r.body?.deferral?.targetRef).toBe("duda");
      const target = (r.body?.accepted.move as { target: string }).target;
      expect(r.body?.targets[target]).toEqual({ kind: "person", ref: "duda" });
    });

    it("overrides a body with no move, and a speak_then_move order, into a walk then talk", async () => {
      const s = scene([12, 4]);
      const wave = await resolve({ ...addressed, body: { expression: "smile", order: "move_then_speak" } }, s);
      expect(wave.outcome).toBe("delayed");
      expect(wave.body?.accepted).toMatchObject({ expression: "smile", move: { kind: "approach" } });
      const later = await resolve({ ...addressed, body: { move: { kind: "approach", target: s.dudaHandle, band: "personal" }, order: "speak_then_move" } }, s);
      expect(later.outcome).toBe("delayed");
      expect(later.body?.accepted.order).toBe("move_then_speak");
    });

    it("also walks to someone the words call by name, as the event's addressees do", async () => {
      const s = scene([12, 4]);
      const r = await resolve({ personTargets: [], visibleContent: "Duda, vem aqui um segundo" }, s);
      expect(r.outcome).toBe("delayed");
      expect(r.body?.deferral?.targetRef).toBe("duda");
    });

    it("speaks now when the addressee is in range, and a line the planner will shout is not held", async () => {
      const near = scene([5, 4]);
      expect((await resolve(addressed, near)).outcome).toBe("committed");
      const far = scene([12, 4]);
      const shouted = await resolve(addressed, far, undefined, { wouldShout: () => true });
      expect(shouted.outcome).toBe("committed");
      expect(shouted.committedEvents.map((e) => e.type)).toContain("message_sent");
    });
  });
});
