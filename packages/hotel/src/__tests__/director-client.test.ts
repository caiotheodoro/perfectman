import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { DirectorClient } from "../director/director-client.js";
import type { DirectorHandlers } from "../director/director-client.js";
import type { HotelFrame } from "../director/index.js";
import { nodeSocketFactory } from "../director/transport.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, waitFor } from "../testing/helpers.js";
import { LEASE_WAIT_MS } from "../director/director-client.js";

let fake: FakeDirector | undefined;
let client: DirectorClient | undefined;

afterEach(async () => {
  client?.stop();
  await fake?.stop();
  client = fake = undefined;
});

async function connect(over: { secret?: string; resume?: number[] } = {}) {
  fake = await FakeDirector.start({ secret: TEST_SECRET });
  fake.addRoom(12);
  const clock = new ManualClock();
  const frames: HotelFrame[] = [];
  const changes: boolean[] = [];
  const handlers: DirectorHandlers = {
    onHello: () => over.resume ?? [],
    onFrame: (f) => frames.push(f),
    onConnectionChange: (up) => changes.push(up),
  };
  client = new DirectorClient({ url: fake.url, secret: over.secret ?? TEST_SECRET, clock, socketFactory: nodeSocketFactory, handlers, rng: () => 0.5, sidecar: { version: "1", build: "t" } });
  client.start();
  return { fake, clock, frames, changes, client };
}

/** Resolves once `read()` has held still for 100 ms: the hotel counts a refusal when it sees it, which can be a moment before the client reacts to it, and under load a late one lands after the count was taken. */
async function quiet(read: () => number): Promise<void> {
  let last = read();
  let since = Date.now();
  while (Date.now() - since < 100) {
    await new Promise((r) => setTimeout(r, 10));
    const now = read();
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
}

describe("Director client", () => {
  it("authenticates with the Bearer secret, answers hello with hello_ack and goes up", async () => {
    const { fake: hotel, changes } = await connect();
    await waitFor(() => hotel.received.find((f) => f.t === "hello_ack"), "hello_ack");
    expect(changes).toEqual([true]);
    const ack = hotel.received.find((f) => f.t === "hello_ack");
    expect(ack).toMatchObject({ t: "hello_ack", proto: 1, resume: [], seq: 1 });
  });

  it("does not connect with the wrong secret, and keeps retrying on the backoff schedule", async () => {
    const { fake: hotel, clock, changes } = await connect({ secret: "wrong" });
    // The runtime may probe an upgrade more than once, so the count is compared, not pinned.
    await waitFor(() => hotel.authFailures >= 1, "first refusal");
    // The refusal is seen by the hotel before the client has closed the socket and set its retry timer; advancing the manual clock before that
    // makes the timer start from the advanced time and never come due.
    await waitFor(() => clock.pending() > 0, "the 1 s retry timer");
    await quiet(() => hotel.authFailures);
    const first = hotel.authFailures;
    await clock.advance(999);
    expect(hotel.authFailures).toBe(first);
    await clock.advance(1);
    await waitFor(() => hotel.authFailures > first, "retry after 1 s");
    await waitFor(() => clock.pending() > 0, "the 2 s retry timer");
    await quiet(() => hotel.authFailures);
    const second = hotel.authFailures;
    await clock.advance(1999);
    expect(hotel.authFailures).toBe(second);
    await clock.advance(1);
    await waitFor(() => hotel.authFailures > second, "retry after 2 s");
    expect(changes).toEqual([]);
  });

  it("numbers outgoing frames from 1 per connection and sends run_heartbeat every 5 s for tracked runs, paused or not", async () => {
    const { fake: hotel, clock, client: c, changes } = await connect();
    await waitFor(() => changes.includes(true), "up");
    await waitFor(() => hotel.received.some((f) => f.t === "hello_ack"), "hello_ack");
    c.trackRun(7);
    await clock.advance(5000);
    await clock.advance(5000);
    await waitFor(() => hotel.received.filter((f) => f.t === "run_heartbeat").length === 2, "two heartbeats");
    expect(hotel.received.map((f) => f.seq)).toEqual([1, 2, 3]);
    c.untrackRun(7);
    await clock.advance(5000);
    expect(hotel.received.filter((f) => f.t === "run_heartbeat")).toHaveLength(2);
  });

  it("tracks leases from run_start and lease frames", async () => {
    const { fake: hotel, client: c, changes, frames } = await connect();
    await waitFor(() => changes.includes(true), "up");
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 1, lease: 3 });
    await waitFor(() => c.leaseOf(7) === 3, "lease 3");
    hotel.send({ t: "lease", run: 7, lease: 4 });
    await waitFor(() => c.leaseOf(7) === 4, "lease 4");
    expect(frames.map((f) => f.t)).toEqual(["run_start", "lease"]);
  });

  it("reconnects after a drop on 1, 2, 4, 8 s, resets after a good hello, and renews leases for resumed runs", async () => {
    const { fake: hotel, clock, client: c, changes } = await connect({ resume: [7] });
    await waitFor(() => changes.includes(true), "up");
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 1, lease: 1 });
    await waitFor(() => c.leaseOf(7) === 1, "lease 1");
    hotel.dropConnection();
    await waitFor(() => changes.at(-1) === false, "down");
    await clock.advance(999);
    expect(hotel.connections).toBe(1);
    await clock.advance(1);
    await waitFor(() => hotel.connections === 2, "second connection");
    await waitFor(() => c.leaseOf(7) === 2, "lease renewed to 2");
    expect(hotel.received.filter((f) => f.t === "hello_ack").map((f) => f.t === "hello_ack" && f.resume)).toEqual([[7], [7]]);
    // The second connection's frames restart at seq 1.
    const second = hotel.received.slice(hotel.received.findIndex((f, i) => f.t === "hello_ack" && i > 0));
    expect(second[0]?.seq).toBe(1);
  });

  it("holds the command loop on a reconnect until the renewed lease has arrived, and goes on after a bounded wait if it never does", async () => {
    fake = await FakeDirector.start({ secret: TEST_SECRET });
    fake.addRoom(12);
    const clock = new ManualClock();
    const leaseAtUp: Array<number | undefined> = [];
    let downs = 0;
    const handlers: DirectorHandlers = {
      onHello: () => [7],
      onFrame: () => undefined,
      onConnectionChange: (up) => {
        if (up) leaseAtUp.push(client?.leaseOf(7));
        else downs++;
      },
    };
    client = new DirectorClient({ url: fake.url, secret: TEST_SECRET, clock, socketFactory: nodeSocketFactory, handlers, rng: () => 0.5, sidecar: { version: "1", build: "t" } });
    client.start();
    await waitFor(() => leaseAtUp.length === 1, "first up");
    fake.startRun({ run: 7, room: 12, scenarioVersion: 1, lease: 1 });
    await waitFor(() => client?.leaseOf(7) === 1, "lease 1");
    fake.dropConnection();
    await waitFor(() => downs === 1, "down");
    await clock.advance(1000);
    await waitFor(() => leaseAtUp.length === 2, "second up");
    // Up is announced only once the bumped lease is in hand: commands never go out with the old one.
    expect(leaseAtUp).toEqual([1, 2]);

    fake.withholdLeases = true;
    fake.dropConnection();
    await waitFor(() => downs === 2, "down again");
    await clock.advance(2000);
    await waitFor(() => fake?.connections === 3, "third connection");
    await waitFor(() => fake?.received.filter((f) => f.t === "hello_ack").length === 3, "third hello_ack");
    expect(leaseAtUp).toHaveLength(2);
    await clock.advance(LEASE_WAIT_MS - 1);
    expect(leaseAtUp).toHaveLength(2);
    await clock.advance(1);
    expect(leaseAtUp).toHaveLength(3);
  });

  it("closes and reconnects when the hotel breaks the sequence", async () => {
    const { fake: hotel, clock, changes, frames } = await connect();
    await waitFor(() => changes.includes(true), "up");
    hotel.sendRaw(JSON.stringify({ t: "room_ping", room: 12, rev: 1, seq: 9 }));
    await waitFor(() => changes.at(-1) === false, "closed on a seq gap");
    expect(frames).toEqual([]);
    await clock.advance(1000);
    await waitFor(() => hotel.connections === 2, "reconnected");
  });

  it("drops frames sent while the link is down instead of replaying them under a stale lease", async () => {
    const { fake: hotel, client: c, changes } = await connect();
    await waitFor(() => changes.includes(true), "up");
    hotel.dropConnection();
    await waitFor(() => changes.at(-1) === false, "down");
    expect(c.send({ t: "run_heartbeat", run: 7 })).toBe(false);
    expect(c.droppedWhileDown).toBe(1);
  });

  it("stamps the run's current lease on every ui_push, and leaves it off while a bumped lease is pending", async () => {
    const { fake: hotel, client: c } = await connect({ resume: [7] });
    await waitFor(() => hotel.received.find((f) => f.t === "hello_ack"), "hello_ack");
    await waitFor(() => c.leaseOf(7) === 1, "bumped lease");
    c.send({ t: "ui_push", run: 7, to: { run: 7 }, ui: { k: "notice", code: "x", kind: "info" } });
    await waitFor(() => hotel.received.some((f) => f.t === "ui_push"), "ui_push");
    expect(hotel.received.find((f) => f.t === "ui_push")).toMatchObject({ lease: 1 });
    expect(hotel.staleUiPushes).toBe(0);
    // an explicit lease is left alone
    c.send({ t: "ui_push", run: 7, to: { run: 7 }, lease: 5, ui: { k: "notice", code: "y", kind: "info" } });
    await waitFor(() => hotel.received.filter((f) => f.t === "ui_push").length === 2, "second ui_push");
    expect(hotel.received.filter((f) => f.t === "ui_push")[1]).toMatchObject({ lease: 5 });
  });
});
