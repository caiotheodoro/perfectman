/**
 * The hub's contract is a safety property, not a feature: a slow or dead
 * browser must never slow down or hang the simulation. These tests are the
 * enforcement.
 */
import { describe, expect, it } from "vitest";
import { SseHub, type SseSink } from "../sse-hub.js";

type FakeSink = SseSink & {
  chunks: string[];
  events: Array<Record<string, unknown>>;
  drain(): void;
  /** A real `drain` means the socket has room again; this mirrors that. */
  setAccept(value: boolean): void;
  destroyed: boolean;
  ended: boolean;
};

/** @param accept false makes every write report a full socket, like a stalled client. */
function fakeSink(accept = true): FakeSink {
  const listeners = new Map<string, Array<() => void>>();
  let accepting = accept;
  const sink: FakeSink = {
    chunks: [],
    events: [],
    destroyed: false,
    ended: false,
    writableLength: 0,
    write(chunk) {
      sink.chunks.push(chunk);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) sink.events.push(JSON.parse(line.slice(6)));
      }
      return accepting;
    },
    setAccept(value) {
      accepting = value;
    },
    end() {
      sink.ended = true;
    },
    destroy() {
      sink.destroyed = true;
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off(event, listener) {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
    },
    drain() {
      for (const listener of listeners.get("drain") ?? []) listener();
    },
  };
  return sink;
}

describe("SseHub — never blocks the producer", () => {
  it("publish returns synchronously even when the socket is full", () => {
    const hub = new SseHub();
    hub.subscribe(fakeSink(false));

    // If publish awaited anything, this would not be observable synchronously.
    let returned = false;
    hub.publish({ type: "pulse", data: { n: 1 }, coalesceKey: "pulse" });
    returned = true;
    expect(returned).toBe(true);
  });

  it("publish is not async — it returns undefined, not a promise", () => {
    const hub = new SseHub();
    hub.subscribe(fakeSink());
    expect(hub.publish({ type: "status", data: {} })).toBeUndefined();
  });

  it("a stalled client never delays publishing, however many frames arrive", () => {
    const hub = new SseHub();
    hub.subscribe(fakeSink(false));

    const started = Date.now();
    for (let i = 0; i < 500; i++) {
      hub.publish({ type: "pulse", data: { n: i }, coalesceKey: "pulse" });
    }
    // Not a benchmark — a guard against someone making publish await a drain.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("keeps publishing with no clients attached at all", () => {
    const hub = new SseHub();
    expect(() => hub.publish({ type: "pulse", data: { n: 1 } })).not.toThrow();
  });

  it("drops a client whose write throws instead of propagating", () => {
    const hub = new SseHub();
    const sink = fakeSink();
    sink.write = () => {
      throw new Error("socket gone");
    };
    hub.subscribe(sink);
    expect(() => hub.publish({ type: "pulse", data: {} })).not.toThrow();
    expect(hub.clientCount).toBe(0);
  });
});

describe("SseHub — backpressure policy", () => {
  it("coalesces pulse frames to the newest, rather than queueing a backlog", () => {
    const hub = new SseHub();
    const sink = fakeSink(false);
    hub.subscribe(sink);

    for (let i = 0; i < 10; i++) {
      hub.publish({ type: "pulse", data: { n: i }, coalesceKey: "pulse" });
    }
    sink.drain();

    // The first write went out before the socket reported full; the rest
    // collapsed into one, which carries the newest state.
    const delivered = sink.events.map((e) => e["n"]);
    expect(delivered).toContain(9);
    expect(delivered.length).toBeLessThan(10);
  });

  it("tells the client how many frames it missed", () => {
    const hub = new SseHub();
    const sink = fakeSink(false);
    hub.subscribe(sink);

    for (let i = 0; i < 5; i++) {
      hub.publish({ type: "pulse", data: { n: i }, coalesceKey: "pulse" });
    }
    sink.drain();

    const last = sink.events[sink.events.length - 1];
    expect(last?.["droppedBefore"]).toBeGreaterThan(0);
  });

  it("never drops a stopped frame, however far behind the client is", () => {
    const hub = new SseHub();
    const sink = fakeSink(false);
    hub.subscribe(sink);

    // 200 frames against a stalled socket: the pulses coalesce away, but the
    // stopped frame has no coalesce key and must survive to be delivered when
    // the socket finally has room.
    for (let i = 0; i < 200; i++) {
      hub.publish({ type: "pulse", data: { n: i }, coalesceKey: "pulse" });
    }
    hub.publish({ type: "stopped", data: { type: "stopped" } });

    sink.setAccept(true);
    sink.drain();

    expect(sink.events.some((e) => e["type"] === "stopped")).toBe(true);
  });

  it("destroys a client that buffers past the ceiling rather than growing forever", () => {
    const hub = new SseHub();
    const sink = fakeSink(false);
    sink.writableLength = 2_000_000;
    hub.subscribe(sink);

    hub.publish({ type: "pulse", data: { n: 1 }, coalesceKey: "pulse" });
    expect(sink.destroyed).toBe(true);
    expect(hub.clientCount).toBe(0);
  });

  it("resumes writing when the socket drains", () => {
    const hub = new SseHub();
    const sink = fakeSink(false);
    hub.subscribe(sink);

    hub.publish({ type: "a", data: { n: 1 } });
    hub.publish({ type: "b", data: { n: 2 } });
    const before = sink.events.length;

    sink.setAccept(true);
    sink.drain();
    expect(sink.events.length).toBeGreaterThan(before);
  });
});

describe("SseHub — late joiners", () => {
  it("replays the backlog so a client connecting after start still gets hello", () => {
    const hub = new SseHub(16);
    hub.publish({ type: "hello", data: { type: "hello" } });
    hub.publish({ type: "pulse", data: { n: 0 }, coalesceKey: "pulse" });

    const sink = fakeSink();
    hub.subscribe(sink);

    expect(sink.events.some((e) => e["type"] === "hello")).toBe(true);
  });

  it("keeps the backlog bounded", () => {
    const hub = new SseHub(4);
    for (let i = 0; i < 20; i++) hub.publish({ type: "pulse", data: { n: i } });

    const sink = fakeSink();
    hub.subscribe(sink);
    expect(sink.events).toHaveLength(4);
  });

  it("does not replay a previous run's frames after a reset", () => {
    const hub = new SseHub(16);
    hub.publish({ type: "hello", data: { type: "hello", run: "old" } });
    hub.resetBacklog();

    const sink = fakeSink();
    hub.subscribe(sink);
    expect(sink.events).toHaveLength(0);
  });

  it("keeps existing clients connected across a reset", () => {
    const hub = new SseHub(16);
    const sink = fakeSink();
    hub.subscribe(sink);
    hub.resetBacklog();
    hub.publish({ type: "hello", data: { type: "hello", run: "new" } });
    expect(sink.events.some((e) => e["run"] === "new")).toBe(true);
  });
});

describe("SseHub — wire format", () => {
  it("emits well-formed SSE frames", () => {
    const hub = new SseHub();
    const sink = fakeSink();
    hub.subscribe(sink);
    hub.publish({ type: "pulse", data: { n: 1 }, id: 7 });

    expect(sink.chunks[0]).toBe('event: pulse\nid: 7\ndata: {"n":1}\n\n');
  });

  it("ends every client on close", () => {
    const hub = new SseHub();
    const sink = fakeSink();
    hub.subscribe(sink);
    hub.closeAll();
    expect(sink.ended).toBe(true);
    expect(hub.clientCount).toBe(0);
  });

  it("stops delivering to a client whose socket closed", () => {
    const hub = new SseHub();
    const sink = fakeSink();
    const unsubscribe = hub.subscribe(sink);
    unsubscribe();
    hub.publish({ type: "pulse", data: { n: 1 } });
    expect(sink.events).toHaveLength(0);
  });
});

describe("timeboxGateway", () => {
  it("resolves a call that never settles, so one stuck gateway cannot hang a pulse", async () => {
    const { timeboxGateway } = await import("../../delivery/timeboxed-gateway.js");
    const hanging = {
      sendAgentMessage: () => new Promise<void>(() => {}),
      createChannel: () => Promise.resolve(),
      addMember: () => Promise.resolve(),
      removeMember: () => Promise.resolve(),
      sendSpectatorEvent: () => Promise.resolve(),
      sendOperatorEvent: () => Promise.resolve(),
      onSimulationStopped: () => Promise.resolve(),
    };
    const gateway = timeboxGateway(hanging, 20);

    await expect(
      gateway.sendAgentMessage("c", { kind: "message", agentId: "a", content: "x", salience: "low" }),
    ).resolves.toBeUndefined();
    expect(gateway.counter.timeouts).toBe(1);
  });

  it("swallows a throwing gateway the way the projection does", async () => {
    const { timeboxGateway } = await import("../../delivery/timeboxed-gateway.js");
    const throwing = {
      sendAgentMessage: () => Promise.reject(new Error("nope")),
      createChannel: () => Promise.resolve(),
      addMember: () => Promise.resolve(),
      removeMember: () => Promise.resolve(),
      sendSpectatorEvent: () => Promise.resolve(),
      sendOperatorEvent: () => Promise.resolve(),
      onSimulationStopped: () => Promise.resolve(),
    };
    const gateway = timeboxGateway(throwing, 50);
    await expect(
      gateway.sendAgentMessage("c", { kind: "message", agentId: "a", content: "x", salience: "low" }),
    ).resolves.toBeUndefined();
  });

  it("does not wait the full timeout for a call that settles promptly", async () => {
    const { timeboxGateway } = await import("../../delivery/timeboxed-gateway.js");
    const fast = {
      sendAgentMessage: () => Promise.resolve(),
      createChannel: () => Promise.resolve(),
      addMember: () => Promise.resolve(),
      removeMember: () => Promise.resolve(),
      sendSpectatorEvent: () => Promise.resolve(),
      sendOperatorEvent: () => Promise.resolve(),
      onSimulationStopped: () => Promise.resolve(),
    };
    const gateway = timeboxGateway(fast, 5_000);
    const started = Date.now();
    await gateway.sendOperatorEvent({
      type: "pulse_metrics",
      simulationId: "s",
      pulseIndex: 0,
      detail: "",
      createdAt: 0,
    });
    expect(Date.now() - started).toBeLessThan(100);
    expect(gateway.counter.timeouts).toBe(0);
  });
});
