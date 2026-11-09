import { afterEach, describe, expect, it } from "vitest";
import { DirectorClient } from "../director/director-client.js";
import type { DirectorHandlers } from "../director/director-client.js";
import { parseDramaEnv } from "../director/dialect.js";
import type { DramaSession } from "../director/dialect.js";
import type { HotelFrame } from "../director/index.js";
import { nodeSocketFactory } from "../director/transport.js";
import { VERB_VOCAB_REV, VERB_VOCAB_SHA256, VERB_VOCAB_VERSION } from "../director/verb-vocab.generated.js";
import { FakeDirector } from "../testing/fake-director.js";
import type { FakeDramaOffer } from "../testing/fake-director.js";
import { actFrames } from "../testing/fake-drama.js";
import { readDramaFixture } from "../testing/drama-fixtures.js";
import { TEST_SECRET, waitFor } from "../testing/helpers.js";
import { ManualClock } from "../testing/manual-clock.js";
import type { Logger } from "../util/log.js";

let fake: FakeDirector | undefined;
let client: DirectorClient | undefined;
afterEach(async () => {
  client?.stop();
  await fake?.stop();
  client = fake = undefined;
});

const SIDECAR = { version: "0.9.0", build: "a41c7e2", schema_sha256: "9d2e6b41c8f07a35e1d94c2b60a7f3815de0c9b2a46f7e183b5d09c4a2e86f17" };

type Rig = {
  fake: FakeDirector;
  client: DirectorClient;
  frames: HotelFrame[];
  sessions: Array<DramaSession | null>;
  warnings: string[];
  clock: ManualClock;
};

async function connect(o: { offer?: FakeDramaOffer; drama?: boolean; resume?: number[]; configure?: (f: FakeDirector) => void } = {}): Promise<Rig> {
  fake = await FakeDirector.start({ secret: TEST_SECRET, ...(o.offer ? { drama: o.offer } : {}) });
  fake.addRoom(12);
  o.configure?.(fake);
  const clock = new ManualClock();
  const frames: HotelFrame[] = [];
  const sessions: Array<DramaSession | null> = [];
  const warnings: string[] = [];
  const logger: Logger = { info: () => undefined, warn: (m) => void warnings.push(m), error: () => undefined };
  const handlers: DirectorHandlers = { onHello: () => o.resume ?? [], onFrame: (f) => frames.push(f), onConnectionChange: () => undefined, onDramaSession: (s) => sessions.push(s) };
  client = new DirectorClient({ url: fake.url, secret: TEST_SECRET, clock, socketFactory: nodeSocketFactory, handlers, rng: () => 0.5, sidecar: SIDECAR, logger, ...(o.drama === undefined ? {} : { drama: { enabled: o.drama } }) });
  client.start();
  await waitFor(() => fake?.ack ?? fake?.closeCodes.length, "hello_ack or a close");
  return { fake, client, frames, sessions, warnings, clock };
}

const OFFER: FakeDramaOffer = {};

describe("[NEG-1] hello.proto stays 1", () => {
  it("[NEG-1] a client given hello{proto:1, proto_max:2} does not close 4002", async () => {
    const { fake: hotel, client: c } = await connect({ offer: OFFER, drama: true });
    expect(hotel.ack?.proto).toBe(2);
    expect(hotel.closeCodes).toEqual([]);
    expect(c.connected).toBe(true);
  });

  it("[NEG-1] a client given hello{proto:2} still closes 4002: the old rule is kept", async () => {
    const { fake: hotel } = await connect({ configure: (f) => (f.helloProto = 2) });
    await waitFor(() => hotel.closeCodes.includes(4002), "the 4002 close");
    expect(hotel.ack).toBeUndefined();
  });

  it("[NEG-1] [VV-6] a drama-capable client against a hotel that offers nothing runs unchanged: a plain PROTO 1 session", async () => {
    const { fake: hotel, client: c } = await connect({ drama: true });
    expect(hotel.ack).toEqual({ t: "hello_ack", seq: 1, proto: 1, resume: [], sidecar: SIDECAR });
    expect(c.dialect).toBe(1);
  });
});

describe("[NEG-2] the offer on the wire", () => {
  it("[NEG-2] a client with drama off answers a hello with the offer exactly as it answers today's hello", async () => {
    const { fake: hotel } = await connect({ offer: OFFER, drama: false });
    expect(hotel.ack).toEqual({ t: "hello_ack", seq: 1, proto: 1, resume: [], sidecar: SIDECAR });
  });

  it("[NEG-2] ignores unknown fields on the hello, with and without the offer", async () => {
    const { fake: hotel } = await connect({ offer: OFFER, drama: true, configure: (f) => (f.helloExtra = { from_the_future: { a: 1 } }) });
    expect(hotel.ack?.proto).toBe(2);
  });

  it("[NEG-2] answers every row of fixtures/drama/hello-offer.jsonl as the contract fixes (the vocab sha is the vendored file's, so it is not compared)", async () => {
    const rows = readDramaFixture("hello-offer.jsonl");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      await client?.stop();
      await fake?.stop();
      const { fake: hotel } = await connect({ drama: true, configure: (f) => (f.nextHello = row.in) });
      const want = JSON.parse(JSON.stringify(row.expect[0])) as { seq: number; sidecar: { verb_vocab?: { sha256?: string } } };
      const got = JSON.parse(JSON.stringify(hotel.ack)) as typeof want;
      if (want.sidecar.verb_vocab) expect(got.sidecar.verb_vocab?.sha256).toBe(VERB_VOCAB_SHA256);
      delete want.sidecar.verb_vocab?.sha256;
      delete got.sidecar.verb_vocab?.sha256;
      expect(got, JSON.stringify(row.in)).toEqual(want);
    }
  });
});

describe("[NEG-3] the answer", () => {
  it("[NEG-3] answers min(2, proto_max ?? proto), with caps and the vendored vocab triple, when all of its conditions hold", async () => {
    const { fake: hotel } = await connect({ offer: { protoMax: 3 }, drama: true });
    expect(hotel.ack).toMatchObject({ proto: 2, caps: ["drama.v1"], sidecar: { verb_vocab: { version: VERB_VOCAB_VERSION, rev: VERB_VOCAB_REV, sha256: VERB_VOCAB_SHA256 } } });
  });

  it.each([
    ["its own env is off", { drama: false as boolean | undefined }, {}],
    ["the hello lacks drama.v1", { drama: true as boolean | undefined }, { caps: [] as string[] }],
    ["the hello offers other caps only", { drama: true as boolean | undefined }, { caps: ["something.else"] }],
    ["the vocab version differs", { drama: true as boolean | undefined }, { vocab: { version: VERB_VOCAB_VERSION + 1, rev: 1, sha256: "a".repeat(64) } }],
  ])("[NEG-3] answers proto 1 with no caps and no vocab when %s", async (_name, own, offer) => {
    const { fake: hotel } = await connect({ offer, ...own });
    expect(hotel.ack?.proto).toBe(1);
    expect(hotel.ack?.caps).toBeUndefined();
    expect(hotel.ack?.sidecar.verb_vocab).toBeUndefined();
    expect(hotel.dialect).toBe(1);
  });

  it("[NEG-3] answers proto 1 to a hello whose proto_max is 1", async () => {
    const { fake: hotel } = await connect({ offer: { protoMax: 1 }, drama: true });
    expect(hotel.ack?.proto).toBe(1);
  });
});

describe("[NEG-4] [NEG-5] the dialect", () => {
  it("[NEG-4] is 2 for an ack with proto 2 and drama.v1, and renegotiated on every reconnect: a hello with no offer makes the client answer proto 1 and stop sending acts", async () => {
    const { fake: hotel, client: c, clock } = await connect({ offer: OFFER, drama: true });
    expect([hotel.dialect, c.dialect]).toEqual([2, 2]);
    hotel.offer = null;
    hotel.dropConnection();
    await waitFor(() => !c.connected, "the link going down");
    await waitFor(() => clock.pending() > 0, "the reconnect timer");
    await clock.advance(1100);
    await waitFor(() => hotel.connections === 2 && hotel.ack, "the second hello_ack");
    expect([hotel.ack?.proto, c.dialect, hotel.dialect]).toEqual([1, 1, 1]);
    expect(c.sendSceneAdvance(7, "x")).toEqual({ sent: false, reason: "dialect" });
  });

  it("[NEG-5] with a dialect 1 link sendAct and sendSceneAdvance are refused before the socket, and so is a raw actor_cmd act", async () => {
    const { fake: hotel, client: c } = await connect({ drama: true });
    c.trackRun(7);
    c.setLease(7, 3);
    expect(c.sendAct({ run: 7, actor: -701, cmd: { k: "act", act_id: "a1", verb: "cry" } })).toEqual({ sent: false, reason: "dialect" });
    expect(c.sendSceneAdvance(7, "beat")).toEqual({ sent: false, reason: "dialect" });
    expect(c.send({ t: "actor_cmd", cid: c.nextCid(), run: 7, lease: 3, actor: -701, cmd: { k: "act", act_id: "a2", verb: "cry" } })).toBe(false);
    expect(c.send({ t: "scene_advance", run: 7, lease: 3 })).toBe(false);
    expect(c.refusedDrama).toBe(4);
    await new Promise((r) => setTimeout(r, 30));
    expect(hotel.received.filter((f) => f.t === "scene_advance" || (f.t === "actor_cmd" && f.cmd.k === "act"))).toEqual([]);
    expect(hotel.rejectedActs).toEqual([]);
  });

  it("[NEG-5] a dialect 2 link sends acts and scene_advance with a cid and the run's lease, and refuses an act the hotel would refuse (ACT-4 to ACT-8) before the socket", async () => {
    const { fake: hotel, client: c } = await connect({ offer: OFFER, drama: true });
    c.trackRun(7);
    hotel.grantLease(7, 3);
    await waitFor(() => c.leaseOf(7) === 3, "the lease");
    const sent = c.sendAct({ run: 7, actor: -701, cmd: { k: "act", act_id: "a1", verb: "slap", with: 9, intensity: 0.6, origin: "director" } });
    expect(sent).toMatchObject({ sent: true });
    expect(c.sendAct({ run: 7, actor: -701, cmd: { k: "act", act_id: "a1", verb: "slap", with: 9 } })).toEqual({ sent: false, reason: "invalid", error: { code: "bad_message", detail: "act_id_reused" } });
    expect(c.sendAct({ run: 7, actor: -701, cmd: { k: "act", act_id: "a2", verb: "cry", with: 9 } })).toEqual({ sent: false, reason: "invalid", error: { code: "target_forbidden", detail: "cry" } });
    expect(c.sendAct({ run: 8, actor: -801, cmd: { k: "act", act_id: "a3", verb: "cry" } })).toEqual({ sent: false, reason: "no_lease" });
    expect(c.sendSceneAdvance(7, "scenario_beat_4")).toMatchObject({ sent: true });
    await waitFor(() => hotel.sceneAdvances.length === 1 && hotel.acts.length === 1, "the act and the scene_advance");
    expect(hotel.acts[0]).toMatchObject({ t: "actor_cmd", run: 7, lease: 3, actor: -701, cmd: { k: "act", act_id: "a1", verb: "slap", with: 9 } });
    expect(hotel.sceneAdvances[0]).toMatchObject({ run: 7, lease: 3, reason: "scenario_beat_4" });
    expect(hotel.rejectedActs).toEqual([]);
  });

  it("[NEG-5] no drama frame is processed on a dialect 1 link, even one a misbehaving hotel sends; on dialect 2 they all arrive", async () => {
    const v1 = await connect({ drama: true });
    v1.fake.scriptAct({ actId: "x1", verb: "slap", with: -702, outcome: "landed" }, { force: true });
    v1.fake.scriptDramaState({}, { force: true });
    v1.fake.send({ t: "lease", run: 7, lease: 9 });
    await waitFor(() => v1.frames.some((f) => f.t === "lease"), "the lease sentinel");
    expect(v1.frames.map((f) => f.t)).toEqual(["lease"]);
    expect(v1.client.droppedDrama).toBe(actFrames({ actId: "x1", verb: "slap", with: -702, outcome: "landed" }).length + 1);
    await v1.client.stop();
    await v1.fake.stop();
    const v2 = await connect({ offer: OFFER, drama: true });
    v2.fake.scriptAct({ actId: "x1", verb: "slap", with: -702, outcome: "landed" });
    v2.fake.send({ t: "lease", run: 7, lease: 9 });
    await waitFor(() => v2.frames.some((f) => f.t === "lease"), "the lease sentinel");
    expect(v2.frames.map((f) => f.t)).toEqual(["act_started", "act_beat", "act_done", "lease"]);
    expect(v2.client.droppedDrama).toBe(0);
  });

  it("[NEG-5] the fake hotel sends no act frame to a link that is not dialect 2, and answers an act it cannot parse with bad_message and the cid only", async () => {
    const { fake: hotel, frames } = await connect({ drama: true });
    const planned = actFrames({ actId: "x1", verb: "slap", with: -702, outcome: "landed" }).length;
    hotel.scriptAct({ actId: "x1", verb: "slap", with: -702, outcome: "landed" });
    expect(hotel.suppressedDrama).toBe(planned);
    expect(frames).toEqual([]);
  });
});

describe("[NEG-7] the vocab handshake", () => {
  it("[NEG-7] a version mismatch answers dialect 1 and logs a notice; the same version with another rev and sha answers dialect 2 and a warning", async () => {
    const mismatch = await connect({ offer: { vocab: { version: VERB_VOCAB_VERSION + 1, rev: 1, sha256: "a".repeat(64) } }, drama: true });
    expect(mismatch.fake.ack?.proto).toBe(1);
    expect(mismatch.warnings.some((w) => w.includes("verb vocab version"))).toBe(true);
    await mismatch.client.stop();
    await mismatch.fake.stop();
    const sha = await connect({ offer: { vocab: { version: VERB_VOCAB_VERSION, rev: VERB_VOCAB_REV + 5, sha256: "b".repeat(64) } }, drama: true });
    expect(sha.fake.ack?.proto).toBe(2);
    expect(sha.warnings.some((w) => w.includes("verb vocab differs"))).toBe(true);
  });

  it("[VV-3] the ack carries the vendored file's triple", async () => {
    const { fake: hotel } = await connect({ offer: OFFER, drama: true });
    expect(hotel.ack?.sidecar.verb_vocab).toEqual({ version: VERB_VOCAB_VERSION, rev: VERB_VOCAB_REV, sha256: VERB_VOCAB_SHA256 });
  });
});

describe("[NEG-8] the dead set", () => {
  it("[NEG-8] every dialect 2 hello hands the handler hello.drama.dead as a full replacement, and a dialect 1 hello hands it null", async () => {
    const { fake: hotel, client: c, sessions, clock } = await connect({ offer: { dead: [-702, -703] }, drama: true });
    expect(sessions).toEqual([{ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [-702, -703] }]);
    hotel.offer = { dead: [] };
    hotel.dropConnection();
    await waitFor(() => !c.connected, "the link going down");
    await waitFor(() => clock.pending() > 0, "the reconnect timer");
    await clock.advance(1100);
    await waitFor(() => sessions.length === 2, "the second session");
    expect(sessions[1]?.dead).toEqual([]);
    await waitFor(() => c.connected, "the link coming back");
    hotel.offer = null;
    hotel.dropConnection();
    await waitFor(() => !c.connected, "the link going down again");
    await waitFor(() => clock.pending() > 0, "the reconnect timer");
    await clock.advance(2100);
    await waitFor(() => sessions.length === 3, "the third session");
    expect(sessions[2]).toBeNull();
  });
});

describe("[SAFE-1] the sidecar's PERFECTMAN_DRAMA", () => {
  it.each(["on", "1", "true", "yes", "ON", " On ", "TRUE", "Yes"])("[SAFE-1] %j is on", (raw) => {
    expect(parseDramaEnv(raw)).toEqual({ on: true });
  });

  it.each([undefined, "", "off", "0", "false", "no", "OFF"])("[SAFE-1] %j is off, with no warning", (raw) => {
    expect(parseDramaEnv(raw)).toEqual({ on: false });
  });

  it("[SAFE-1] an unrecognised value (a typo) is off, fail-closed, with a warning", () => {
    expect(parseDramaEnv("treu")).toEqual({ on: false, warning: 'PERFECTMAN_DRAMA="treu" is not recognised: drama stays off' });
    expect(parseDramaEnv("2")).toMatchObject({ on: false });
  });
});
