import type { BodyCommand, OperatorEvent } from "@perfectman/shared";
import type { DeliveryMessage } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { HotelGateway } from "../gateway/hotel-gateway.js";
import type { GatewayDeps } from "../gateway/hotel-gateway.js";

const msg = (agentId: string, content: string, over: Partial<DeliveryMessage> = {}): DeliveryMessage =>
  ({ kind: "message", agentId, content, salience: "low", ...over }) as DeliveryMessage;

function setup(over: Partial<GatewayDeps> = {}) {
  const clock = new ManualClock();
  const sent: { at: number; cmd: BodyCommand }[] = [];
  const thoughts: string[] = [];
  const gateway = new HotelGateway({
    clock,
    rng: () => 0,
    executor: {
      send: (cmds) => cmds.forEach((cmd) => sent.push({ at: clock.now(), cmd })),
      sendThought: (_a, text) => thoughts.push(text),
    },
    cast: new Map([
      ["duda", { name: "Duda", responseDelayMs: [1000, 1000] as const }],
      ["rafa", { name: "Rafa", responseDelayMs: [0, 0] as const }],
    ]),
    roomOfChannel: (c) => (c === "room:12" ? "12" : undefined),
    roomOfAgent: () => "12",
    timing: { perCharMs: 0 },
    ...over,
  });
  const chats = () => sent.filter((s) => s.cmd.cmd === "chat");
  return { clock, gateway, sent, chats, thoughts };
}

describe("HotelGateway", () => {
  it("enqueues and returns at once: sendAgentMessage never waits for the hotel", async () => {
    const { gateway, chats } = setup();
    await gateway.sendAgentMessage("room:12", msg("duda", "oi, tudo bem?"));
    expect(chats()).toHaveLength(0);
  });

  it("lands an addressed reply within 2.2 s of the consult however long the persona delay and the line, an ambient one within 4 s", async () => {
    const { clock, gateway, chats } = setup({ timing: { perCharMs: 55 }, cast: new Map([["duda", { name: "Duda", responseDelayMs: [3000, 3000] as const }]]) });
    const t0 = clock.now();
    gateway.noteConsult("duda", t0);
    await gateway.sendAgentMessage("room:12", msg("duda", "a".repeat(60), { kind: "reply" } as Partial<DeliveryMessage>));
    await clock.advance(2199);
    expect(chats()).toHaveLength(0);
    await clock.advance(1);
    expect(chats()).toHaveLength(1);
    gateway.noteConsult("duda", clock.now());
    const t1 = clock.now();
    await gateway.sendAgentMessage("room:12", msg("duda", "b".repeat(60)));
    await clock.advance(3999);
    expect(chats()).toHaveLength(1);
    await clock.advance(1);
    expect(chats()).toHaveLength(2);
    expect(chats()[1]?.at).toBe(t1 + 4000);
  });

  it("lands a line at consult + min(4 s, persona delay + 55 ms per char), typing off right before", async () => {
    const { clock, gateway, sent, chats } = setup({ timing: { perCharMs: 55 } });
    const t0 = clock.now();
    gateway.noteConsult("duda", t0);
    expect(sent.map((s) => s.cmd)).toEqual([{ agentId: "duda", cmd: "typing", on: true }]);
    await clock.advance(1800); // the model took 1.8 s
    const text = "a".repeat(20);
    await gateway.sendAgentMessage("room:12", msg("duda", text));
    // 1000 delay + 20 x 55 = 2100 ms after the consult.
    await clock.advance(299);
    expect(chats()).toHaveLength(0);
    await clock.advance(1);
    expect(chats()).toHaveLength(1);
    expect(chats()[0]?.at).toBe(t0 + 2100);
    expect(sent.slice(-2).map((s) => s.cmd)).toEqual([
      { agentId: "duda", cmd: "typing", on: false },
      { agentId: "duda", cmd: "chat", mode: "say", text },
    ]);
  });

  it("lands at once when the model was slower than the persona delay", async () => {
    const { clock, gateway, chats } = setup();
    gateway.noteConsult("duda", clock.now());
    await clock.advance(7000);
    await gateway.sendAgentMessage("room:12", msg("duda", "late"));
    expect(chats()).toHaveLength(1);
  });

  it("caps persona delay plus typing time at 4 s", async () => {
    const { clock, gateway, chats } = setup({ timing: { perCharMs: 55 }, cast: new Map([["duda", { name: "Duda", responseDelayMs: [18_000, 18_000] as const }]]) });
    const t0 = clock.now();
    gateway.noteConsult("duda", t0);
    await gateway.sendAgentMessage("room:12", msg("duda", "x"));
    await clock.advance(3999);
    expect(chats()).toHaveLength(0);
    await clock.advance(1);
    expect(chats()[0]?.at).toBe(t0 + 4000);
  });

  it("keeps 2.5 s between lines in a room and lets an addressed reply jump an ambient line", async () => {
    const { clock, gateway, chats } = setup();
    await gateway.sendAgentMessage("room:12", msg("rafa", "first"));
    expect(chats()).toHaveLength(1);
    await gateway.sendAgentMessage("room:12", msg("duda", "ambient", { salience: "low" }));
    await gateway.sendAgentMessage("room:12", msg("rafa", "addressed", { kind: "reply", replyToEventId: "e1", salience: "high" } as Partial<DeliveryMessage>));
    await clock.advance(2499);
    expect(chats()).toHaveLength(1);
    await clock.advance(1);
    const order = chats().map((c) => (c.cmd.cmd === "chat" ? c.cmd.text : ""));
    expect(order).toEqual(["first", "addressed"]);
    await clock.advance(2500);
    expect(chats().map((c) => (c.cmd.cmd === "chat" ? c.cmd.text : ""))).toEqual(["first", "addressed", "ambient"]);
  });

  it("drops the oldest ambient line first when the room queue passes 6, and counts it", async () => {
    const { clock, gateway, chats } = setup();
    await gateway.sendAgentMessage("room:12", msg("rafa", "now"));
    for (let i = 0; i < 6; i++) await gateway.sendAgentMessage("room:12", msg(i % 2 ? "duda" : "rafa", `amb${i}`));
    await gateway.sendAgentMessage("room:12", msg("rafa", "reply", { kind: "reply", replyToEventId: "e", salience: "high" } as Partial<DeliveryMessage>));
    expect(gateway.undeliveredCommitted).toBe(1);
    await clock.advance(60_000);
    const said = chats().map((c) => (c.cmd.cmd === "chat" ? c.cmd.text : ""));
    expect(said).not.toContain("amb0");
    expect(said).toContain("reply");
  });

  it("strips links and markdown from actor text", async () => {
    const { gateway, chats } = setup();
    await gateway.sendAgentMessage("room:12", msg("rafa", "**olha** [isso](https://x.example/a) https://y.example/b agora"));
    const cmd = chats()[0]?.cmd;
    expect(cmd && cmd.cmd === "chat" ? cmd.text : "").toBe("olha isso agora");
  });

  it("delivers a private channel as a whisper to the other member, and drops it when they are apart", async () => {
    const { clock, gateway, chats } = setup({ togetherForHuddle: () => true });
    await gateway.createChannel("huddle:1", "private_channel", ["duda", "rafa"]);
    await gateway.sendAgentMessage("huddle:1", msg("rafa", "psiu"));
    expect(chats()[0]?.cmd).toEqual({ agentId: "rafa", cmd: "chat", mode: "whisper", text: "psiu", to: "duda" });
    const apart = setup({ togetherForHuddle: () => false });
    await apart.gateway.createChannel("huddle:1", "private_channel", ["duda", "rafa"]);
    await apart.gateway.sendAgentMessage("huddle:1", msg("rafa", "psiu"));
    await apart.clock.advance(10_000);
    expect(apart.chats()).toHaveLength(0);
    expect(apart.gateway.undeliveredCommitted).toBe(1);
    void clock;
  });

  it("tells the run when a line leaves for the wire, with the event it came from", async () => {
    const lines: Array<{ agentId: string; mode: string; eventId?: string; room: string }> = [];
    const { clock, gateway } = setup({ onLine: (l) => lines.push(l) });
    await gateway.sendAgentMessage("room:12", msg("duda", "oi, Rafa", { eventId: "evt-9" }));
    expect(lines).toEqual([]);
    await clock.advance(3000);
    expect(lines).toEqual([{ agentId: "duda", mode: "say", eventId: "evt-9", room: "12" }]);
  });

  it("maps reactions to gestures, not text", async () => {
    const { gateway, sent } = setup();
    await gateway.sendAgentMessage("room:12", { kind: "reaction", agentId: "rafa", emoji: "👍", targetEventId: "e1", salience: "low" });
    expect(sent.map((s) => s.cmd)).toEqual([{ agentId: "rafa", cmd: "gesture", a: "thumbs" }]);
  });

  it("forwards a thought but not an engine-authored motive, and stops typing after a silent consult", async () => {
    const { clock, gateway, sent, thoughts } = setup();
    gateway.noteConsult("rafa", clock.now());
    const op = (summary: string): OperatorEvent => ({ type: "action_intent", simulationId: "s", agentId: "rafa", pulseIndex: 1, detail: "", createdAt: 0, data: { intentType: "no_op", privateMotiveSummary: summary } });
    await gateway.sendOperatorEvent(op("Fallback applied: provider timed out"));
    await gateway.sendOperatorEvent(op("I would rather listen for now."));
    expect(thoughts).toEqual(["I would rather listen for now."]);
    await clock.advance(800);
    expect(sent.at(-1)?.cmd).toEqual({ agentId: "rafa", cmd: "typing", on: false });
  });

  it("delivers the mode the resolver already stamped (shout) without asking the planner again", async () => {
    let asked = 0;
    const { clock, gateway, chats } = setup({ chooseMode: () => (asked++, "say") });
    await gateway.sendAgentMessage("room:12", msg("rafa", "AAAA!", { mode: "shout" }));
    await clock.advance(10);
    expect(chats()[0]?.cmd).toMatchObject({ mode: "shout" });
    expect(asked).toBe(0);
    // a message with no stamped mode still goes through the planner's choice
    await gateway.sendAgentMessage("room:12", msg("rafa", "oi"));
    expect(asked).toBe(1);
  });

  it("resolves the actor's room when the line is released: a line queued before a door is dropped, not said in the other room", async () => {
    let where = "12";
    const { clock, gateway, chats } = setup({ roomOfAgent: () => where });
    await gateway.sendAgentMessage("room:12", msg("duda", "oi, tudo bem?"));
    where = "13";
    await clock.advance(10_000);
    expect(chats()).toHaveLength(0);
    expect(gateway.undeliveredCommitted).toBe(1);
    where = "12";
    await gateway.sendAgentMessage("room:12", msg("rafa", "e ai"));
    await clock.advance(10_000);
    expect(chats()).toHaveLength(1);
  });

  it("a paused run releases nothing and goes on from the backlog on resume", async () => {
    const { clock, gateway, chats } = setup();
    gateway.setPaused(true);
    await gateway.sendAgentMessage("room:12", msg("rafa", "um"));
    await clock.advance(30_000);
    expect(chats()).toHaveLength(0);
    await gateway.sendAgentMessage("room:12", msg("duda", "dois"));
    await clock.advance(30_000);
    expect(chats()).toHaveLength(0);
    gateway.setPaused(false);
    await clock.advance(10_000);
    expect(chats().map((c) => (c.cmd.cmd === "chat" ? c.cmd.text : ""))).toEqual(["um", "dois"]);
  });

  it("counts a line the executor could not send as undelivered, not delivered", async () => {
    const clock = new ManualClock();
    const sent: BodyCommand[] = [];
    const gateway = new HotelGateway({
      clock,
      rng: () => 0,
      executor: { send: (c) => sent.push(...c), sendThought: () => undefined, sendChat: () => false },
      cast: new Map([["rafa", { name: "Rafa", responseDelayMs: [0, 0] as const }]]),
      roomOfChannel: () => "12",
      roomOfAgent: () => "12",
      timing: { perCharMs: 0 },
    });
    await gateway.sendAgentMessage("room:12", msg("rafa", "oi"));
    await clock.advance(10);
    expect(gateway.stats.delivered).toBe(0);
    expect(gateway.undeliveredCommitted).toBe(1);
  });
});
