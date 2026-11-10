import { createServer } from "node:http";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { sectorTo } from "../space/geometry.js";
import type { ActorCmd, ActorErrorCode, Avatar, AvatarState, HotelMsg, PairOutcome, RoomSnapshot, RunModel, ServerMsg, SidecarFrame, SidecarMsg, VerbVocabRef } from "../director/index.js";
import { actFrames, dramaStateFrame, helloDrama, sceneCutFrames } from "./fake-drama.js";
import type { ActScript } from "./fake-drama.js";

/**
 * In-process stand-in for the hotel's Director listener (docs/plans/hotel-package.md
 * 15, scaled to what the sidecar tests need). Real WebSocket, real framing and
 * `seq`; hotel behaviour is a small deterministic model of the Tilehouse rules
 * in embodiment.md 1.1: 300 ms ticks (scaled by `tickMs`), one tile per tick,
 * door spawn, walk-out, per-room `rev`, 8 commands per 5 s. Humans are scripted.
 */
export type FakeAvatar = { id: number; name: string; x: number; y: number; dir: number; state: AvatarState; ref?: string; run?: number };

type FakeRoom = { id: number; name: string; official: boolean; section: string | null; rev: number; avatars: Map<number, FakeAvatar>; w: number; h: number; door: [number, number] };

/**
 * What a hotel that offers drama adds to its `hello` (act-contract.md NEG-2): `proto_max`, `caps` and `drama`.
 * Absent means a hotel with the switch off (or an old one): today's hello, byte for byte.
 */
export type FakeDramaOffer = { vocab?: VerbVocabRef; caps?: string[]; dead?: number[]; protoMax?: number; enabled?: boolean };

export type FakeDirectorOptions = {
  secret: string;
  /** The drama offer; can be changed between connections with `offer`. */
  drama?: FakeDramaOffer;
  /** Play a `landed` act lifecycle for every act command that reaches a dialect 2 link (no chip, no witnesses). */
  autoAct?: boolean;
  /** Real ms per hotel tick; the hotel's is 300. */
  tickMs?: number;
  pairOutcome?: PairOutcome;
  /** The hotel ends a run that is not acked this long after it was started as `start_failed` (20 s). */
  ackTimeoutMs?: number;
  /** Apply the hotel's per-actor limits (chat 4 per 6 s, other commands 8 per 5 s, typing 6 per 10 s, a door 200 ms after a join) and refuse what goes over, as the hotel does. */
  enforceBudgets?: boolean;
};

/** What the hotel does to an actor's command, in `crates/server/src/world/actors.rs`: the same numbers as `replay-pacing.ts` and the sidecar's own budget. */
const HOTEL_BUDGETS = {
  chat: { count: 4, windowMs: 6000, code: "rate_limited" },
  cmds: { count: 8, windowMs: 5000, code: "slow_down" },
  typing: { count: 6, windowMs: 10_000, code: "rate_limited" },
} as const;
const HOTEL_JOIN_INTERVAL_MS = 200;

export class FakeDirector {
  readonly rooms = new Map<number, FakeRoom>();
  /** Every frame the sidecar sent, in order, across connections. */
  readonly received: SidecarFrame[] = [];
  /** ui_push frames that carried a lease other than the run's current one. */
  staleUiPushes = 0;
  readonly chats: { actor: number; mode: string; text: string; to?: number | null; at: number }[] = [];
  readonly typingLog: { actor: number; on: boolean }[] = [];
  /** Runs the hotel would call live: acked and not ended. */
  private readonly liveRuns = new Set<number>();
  /** Runs the sidecar ended itself, with the reason it gave (`run_end`): the hotel records these as `ended` or `failed`. */
  readonly endedRuns: { run: number; reason: string }[] = [];
  /** Runs the hotel marked `interrupted` (`sidecar_lost`): a `hello_ack` that did not resume a run it still held live (director-protocol.md 4). */
  readonly interruptedRuns: number[] = [];
  /** Every `actor_error` the hotel answered with, in order. */
  readonly errorsSent: { actor: number | undefined; code: string }[] = [];
  /** Commands the modelled limits refused (`enforceBudgets`). */
  readonly refused: { actor: number; k: string; code: string }[] = [];
  private readonly budgetTimes = new Map<string, number[]>();
  private readonly joinedAt = new Map<number, number>();
  readonly gone: { actor: number; reason: string }[] = [];
  connections = 0;
  /** The drama offer of the next `hello`; `null` is a hotel without the switch. */
  offer: FakeDramaOffer | null;
  /** `hello.proto`: 1 in every hello (NEG-1); a test sets 2 to see a v1 sidecar's refusal. */
  helloProto = 1;
  /** Unknown top-level fields added to the next hellos (unknown fields are ignored on both ends). */
  helloExtra: Record<string, unknown> = {};
  /** A raw `hello` frame (without `seq`) sent once instead of the built one: the `in` of a fixture row. */
  nextHello: Record<string, unknown> | undefined;
  /** The `hello_ack` of the current connection. */
  ack: Extract<SidecarMsg, { t: "hello_ack" }> | undefined;
  /** NEG-4, from the hotel's side: 2 only for an ack with proto 2 and `drama.v1` while the offer was made. */
  dialect: 1 | 2 = 1;
  /** What the current connection's `hello` offered (`proto_max`, or 1 with no offer), for the NEG-1 and NEG-4 rules. */
  private offeredMax = 1;
  private offeredCaps: string[] = [];
  /** Close codes the sidecar closed with, in order. */
  readonly closeCodes: number[] = [];
  /** Acts the sidecar sent on a dialect 2 link, and the ones a dialect 1 link refused as `bad_message` (NEG-5). */
  readonly acts: Extract<SidecarMsg, { t: "actor_cmd" }>[] = [];
  readonly rejectedActs: number[] = [];
  /** `scene_advance` frames: kept on dialect 2, dropped silently on dialect 1. */
  readonly sceneAdvances: Extract<SidecarMsg, { t: "scene_advance" }>[] = [];
  readonly droppedSceneAdvances: number[] = [];
  /** Drama frames a script wanted to send to a link that is not dialect 2: the hotel never sends them (NEG-5). */
  suppressedDrama = 0;
  /** Human ids that opted in, per room, for `drama_state`. */
  readonly optIn = new Map<number, number[]>();
  /** Test switch: on hello_ack, do not renew leases (a hotel that is slow to bump them). */
  withholdLeases = false;
  /** Test switch: subscribe_room is refused silently (a hotel that rate-limits resnapshots). */
  ignoreSubscribe = false;
  authFailures = 0;
  /** Runs the hotel gave up on because the sidecar never sent `run_ack` (or `run_end`) in time. */
  readonly startFailed: number[] = [];
  private ackTimers = new Map<number, NodeJS.Timeout>();
  private server!: Server;
  private wss!: WebSocketServer;
  private sock: WebSocket | undefined;
  private seq = 0;
  private lease = new Map<number, number>();
  private nextSlot = new Map<number, number>();
  private subscribed = new Set<number>();
  private readonly tickMs: number;
  private walkTimers = new Set<NodeJS.Timeout>();
  port = 0;
  url = "";

  constructor(private readonly o: FakeDirectorOptions) {
    this.tickMs = o.tickMs ?? 5;
    this.offer = o.drama ?? null;
  }

  static async start(o: FakeDirectorOptions): Promise<FakeDirector> {
    const d = new FakeDirector(o);
    await d.listen();
    return d;
  }

  private listen(): Promise<void> {
    this.server = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => {
      if (req.headers.authorization !== `Bearer ${this.o.secret}`) {
        this.authFailures++;
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws));
    });
    return new Promise((resolve) =>
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        this.url = `ws://127.0.0.1:${this.port}/director`;
        resolve();
      }),
    );
  }

  async stop(): Promise<void> {
    this.ackTimers.forEach(clearTimeout);
    this.ackTimers.clear();
    this.walkTimers.forEach(clearTimeout);
    this.wss.clients.forEach((c) => c.terminate());
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Drops the current connection from the hotel side (a network failure). */
  dropConnection(code = 1006): void {
    this.sock?.close(code === 1006 ? 4009 : code);
  }

  get connected(): boolean {
    return this.sock?.readyState === 1;
  }

  // ---- rooms ------------------------------------------------------------------

  /** A room the hotel lists in `hello.rooms`; `official`/`section` mark a navigator room such as one of the Perfectman wing. */
  addRoom(id: number, w = 10, h = 8, meta: { name?: string; official?: boolean; section?: string } = {}): FakeRoom {
    const room: FakeRoom = { id, name: meta.name ?? `Room ${id}`, official: meta.official ?? false, section: meta.section ?? null, rev: 1, avatars: new Map(), w, h, door: [0, Math.floor(h / 2)] };
    this.rooms.set(id, room);
    return room;
  }

  addHuman(room: number, id: number, name: string, x: number, y: number): void {
    const r = this.rooms.get(room);
    if (!r) throw new Error(`no room ${room}`);
    const a: FakeAvatar = { id, name, x, y, dir: 2, state: "stand" };
    r.avatars.set(id, a);
    if (this.subscribed.has(room)) this.delta(room, { t: "avatar_joined", avatar: this.wireAvatar(a) });
  }

  /** An actor by its character ref; `run` tells two runs that share refs apart. */
  avatarByRef(ref: string, run?: number): FakeAvatar | undefined {
    for (const r of this.rooms.values()) for (const a of r.avatars.values()) if (a.ref === ref && (run === undefined || a.run === run)) return a;
    return undefined;
  }

  actorsLeft(): number {
    let n = 0;
    for (const r of this.rooms.values()) for (const a of r.avatars.values()) if (a.id < 0) n++;
    return n;
  }

  // ---- scripted humans --------------------------------------------------------

  humanSay(room: number, userId: number, text: string, mode: "say" | "shout" | "whisper" = "say", to?: number): void {
    const r = this.rooms.get(room);
    const a = r?.avatars.get(userId);
    if (!r || !a) throw new Error("unknown human");
    this.send({ t: "human_chat", room, rev: r.rev, from: { id: userId, name: a.name }, mode, to: to ?? null, text, at: Date.now(), untrusted: true });
  }

  humanTyping(room: number, userId: number, on: boolean): void {
    this.delta(room, { t: "typing", id: userId, on });
  }

  moveHuman(room: number, userId: number, x: number, y: number): void {
    const a = this.rooms.get(room)?.avatars.get(userId);
    if (!a) return;
    a.x = x;
    a.y = y;
    this.delta(room, { t: "moves", moves: [{ id: userId, x, y, dir: a.dir, state: "stand" }] });
  }

  /** An actor takes a door: it leaves its room and appears at the other room's door (`moved_room`, then the join delta). */
  moveActorToRoom(ref: string, toRoom: number, id?: number): void {
    const to = this.rooms.get(toRoom);
    // By hotel id when given: two runs can use the same ref.
    const hit = [...this.rooms.values()].flatMap((r) => [...r.avatars.values()].filter((a) => (id !== undefined ? a.id === id : a.ref === ref)).map((a) => ({ r, a })))[0];
    if (!to || !hit) throw new Error(`cannot move ${ref} to room ${toRoom}`);
    const { r, a } = hit;
    r.avatars.delete(a.id);
    this.delta(r.id, { t: "avatar_left", id: a.id });
    a.x = to.door[0];
    a.y = to.door[1];
    to.avatars.set(a.id, a);
    this.send({ t: "moved_room", actor: a.id, from: r.id, to: toRoom, x: a.x, y: a.y });
    if (this.subscribed.has(toRoom)) this.delta(toRoom, { t: "avatar_joined", avatar: this.wireAvatar(a) });
  }

  // ---- hotel -> sidecar -------------------------------------------------------

  startRun(p: { run: number; room: number; scenarioVersion: number; lease?: number; capActors?: number; mode?: "default" | "cinematic"; model?: RunModel }): void {
    const lease = p.lease ?? 1;
    this.lease.set(p.run, lease);
    this.awaitAck(p.run);
    this.send({ t: "run_start", run: p.run, lease, mode: p.mode ?? "default", room: p.room, scenario_version: p.scenarioVersion, admin: { id: 9, name: "caio" }, cap_actors: p.capActors ?? 12, ...(p.model ? { model: p.model } : {}) });
  }

  /** The hotel made a run row for a replay and gave it a lease, without a `run_start` (director-protocol.md 6.1). */
  grantLease(run: number, lease = 1): void {
    this.lease.set(run, lease);
    this.awaitAck(run);
    this.send({ t: "lease", run, lease });
  }

  /** The hotel started this run: it must be acked (or ended) within the timeout, else it is `start_failed`. */
  private awaitAck(run: number): void {
    clearTimeout(this.ackTimers.get(run));
    this.ackTimers.set(run, setTimeout(() => {
      this.ackTimers.delete(run);
      this.startFailed.push(run);
    }, this.o.ackTimeoutMs ?? 20_000));
  }

  private settleAck(run: number): void {
    clearTimeout(this.ackTimers.get(run));
    this.ackTimers.delete(run);
  }

  pmCommand(run: number, room: number, cmd: Extract<HotelMsg, { t: "pm_command" }>["cmd"], args?: string, source: "chat" | "panel" | "auto" = "panel"): void {
    this.send({ t: "pm_command", run, room, cmd, source, ...(args ? { args } : {}), ...(source === "auto" ? {} : { admin: { id: 9, name: "caio" } }) });
  }

  send(msg: HotelMsg): void {
    const ws = this.sock;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ ...msg, seq: ++this.seq }));
  }

  /** A raw frame with a chosen `seq`, to test sequence handling. */
  sendRaw(text: string): void {
    this.sock?.send(text);
  }

  ping(room: number, rev?: number): void {
    const r = this.rooms.get(room);
    if (r) this.send({ t: "room_ping", room, rev: rev ?? r.rev });
  }

  /** Delivers a delta, bumping the room's rev by exactly one. `skip` leaves a gap. */
  delta(room: number, msg: ServerMsg, skip = 0): void {
    const r = this.rooms.get(room);
    if (!r) return;
    r.rev += 1 + skip;
    this.send({ t: "delta", room, rev: r.rev, msg });
  }

  // ---- internals --------------------------------------------------------------

  private onConnect(ws: WebSocket): void {
    this.connections++;
    this.sock = ws;
    this.seq = 0;
    this.ack = undefined;
    this.dialect = 1;
    this.subscribed.clear();
    ws.on("close", (code) => this.closeCodes.push(code));
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as SidecarFrame;
      this.received.push(frame);
      this.onFrame(frame);
    });
    const live = [...this.rooms.values()].flatMap((r) =>
      [...r.avatars.values()].filter((a) => a.id < 0 && a.ref).map((a) => ({ actor: a.id, ref: a.ref ?? "", run: a.run ?? 0, name: a.name, room: r.id, x: a.x, y: a.y, dir: a.dir, state: "stand" as const })),
    );
    const runs = [...new Set(live.map((a) => a.run))].map((run) => ({ run, state: "running" as const, room: live.find((a) => a.run === run)?.room ?? 0, room_name: "Lounge", scenario_version: 1, mode: "default" as const }));
    const nextHello = this.nextHello;
    this.nextHello = undefined;
    if (nextHello) {
      this.offeredMax = typeof nextHello["proto_max"] === "number" ? nextHello["proto_max"] : 1;
      this.offeredCaps = Array.isArray(nextHello["caps"]) ? (nextHello["caps"] as string[]) : [];
      this.sock?.send(JSON.stringify({ ...nextHello, seq: ++this.seq }));
      return;
    }
    const offer = this.offer;
    this.offeredMax = offer ? (offer.protoMax ?? 2) : 1;
    this.offeredCaps = offer ? (offer.caps ?? ["drama.v1"]) : [];
    this.send({
      t: "hello",
      proto: this.helloProto,
      ...(offer ? { proto_max: offer.protoMax ?? 2, caps: offer.caps ?? ["drama.v1"], drama: helloDrama({ ...(offer.vocab ? { vocab: offer.vocab } : {}), dead: offer.dead ?? [], ...(offer.enabled !== undefined ? { enabled: offer.enabled } : {}) }) } : {}),
      ...this.helloExtra,
      session: `s${this.connections}`,
      hotel: { build: "fake", tick_ms: 300, max_chat: 200, max_actions_per_5s: 8, join_interval_ms: 200, human_reserve: 10, max_avatars_per_room: 50 },
      runs,
      actors: live,
      // Every room the hotel has (D24: an actor can travel to any of them); the vendored hello has no such list yet.
      rooms: [...this.rooms.values()].map((r) => ({ id: r.id, name: r.name, official: r.official, section: r.section })),
    });
  }

  private onFrame(f: SidecarMsg): void {
    // A ui_push may omit its lease (older sidecars); one that is present must be the run's current lease.
    if (f.t === "ui_push" && f.lease != null && this.lease.has(f.run) && this.lease.get(f.run) !== f.lease) this.staleUiPushes++;
    if (f.t === "run_ack" || f.t === "run_end") this.settleAck(f.run);
    if (f.t === "run_ack" && f.ok) this.liveRuns.add(f.run);
    if (f.t === "run_end") {
      this.liveRuns.delete(f.run);
      this.endedRuns.push({ run: f.run, reason: f.reason });
    }
    switch (f.t) {
      case "hello_ack":
        if (!this.acceptAck(f)) return;
        for (const run of [...this.liveRuns]) {
          if (f.resume?.includes(run)) continue;
          this.liveRuns.delete(run);
          this.interruptedRuns.push(run);
        }
        if (this.withholdLeases) break;
        for (const run of f.resume ?? []) {
          const lease = (this.lease.get(run) ?? 0) + 1;
          this.lease.set(run, lease);
          this.send({ t: "lease", run, lease });
        }
        // NEG-9: after each resuming lease, one drama_state per room of the run (dialect 2 only).
        if (this.dialect === 2) {
          for (const run of f.resume ?? []) {
            const rooms = [...this.rooms.values()].filter((r) => [...r.avatars.values()].some((a) => a.run === run));
            for (const r of rooms) this.send(dramaStateFrame({ run, room: r.id, scene: `${run}.1`, optIn: this.optIn.get(r.id) ?? [] }));
          }
        }
        break;
      case "scene_advance":
        // A dialect 1 hotel cannot parse it and, with no `cid`, drops it silently (NEG-5).
        if (this.dialect === 2) this.sceneAdvances.push(f);
        else this.droppedSceneAdvances.push(f.run);
        break;
      case "subscribe_room": {
        const r = this.rooms.get(f.room);
        if (!r || this.ignoreSubscribe) return;
        this.subscribed.add(f.room);
        this.send(this.snapshot(r));
        break;
      }
      case "actor_spawn":
        this.spawn(f);
        break;
      case "actor_despawn":
        this.despawn(f);
        break;
      case "actor_cmd":
        // NEG-5: in a dialect 1 session `k:"act"` is an unparseable frame, answered by the existing director_reject path:
        // actor_error{bad_message} with the cid, no actor and no detail.
        if (f.cmd.k === "act" && this.dialect !== 2) {
          this.rejectedActs.push(f.cid);
          this.err(f.cid, undefined, "bad_message");
          break;
        }
        if (f.cmd.k === "act") this.acts.push(f);
        this.command(f);
        break;
      default:
        break;
    }
  }

  /** NEG-1 and NEG-4: `hello_ack.proto` must be in [1, offered max]; the dialect is 2 only for proto 2 with `drama.v1` while it was offered. */
  private acceptAck(f: Extract<SidecarMsg, { t: "hello_ack" }>): boolean {
    if (f.proto < 1 || f.proto > this.offeredMax) {
      this.sock?.close(4002, "bad hello_ack proto");
      return false;
    }
    this.ack = f;
    this.dialect = f.proto === 2 && this.offeredCaps.includes("drama.v1") && f.caps?.includes("drama.v1") ? 2 : 1;
    return true;
  }

  // ---- drama scripting (dialect 2) -----------------------------------------------------

  /** Plays the frames of an act, in the order of FRM-1 (a blocked act is one `act_done`, FRM-2). To a link that is not dialect 2 nothing is sent. */
  scriptAct(script: ActScript, o: { force?: boolean } = {}): void {
    this.sendDrama(actFrames(script), o.force);
  }

  /** `scene_cut`, then the `actor_revive` / `actor_gone{died}` it causes (SCENE-4). */
  scriptSceneCut(p: Parameters<typeof sceneCutFrames>[0], o: { force?: boolean } = {}): void {
    this.sendDrama(sceneCutFrames(p), o.force);
  }

  scriptDramaState(p: Parameters<typeof dramaStateFrame>[0] = {}, o: { force?: boolean } = {}): void {
    this.sendDrama([dramaStateFrame(p)], o.force);
  }

  private sendDrama(frames: HotelMsg[], force = false): void {
    if (this.dialect !== 2 && !force) {
      this.suppressedDrama += frames.length;
      return;
    }
    for (const f of frames) this.send(f);
  }

  private err(cid: number | undefined, actor: number | undefined, code: ActorErrorCode, detail?: string): void {
    this.errorsSent.push({ actor, code });
    this.send({ t: "actor_error", ...(cid !== undefined ? { cid } : {}), ...(actor !== undefined ? { actor } : {}), code, ...(detail ? { detail } : {}) });
  }

  private snapshot(r: FakeRoom): RoomSnapshot & { t: "room_snapshot" } {
    const row = "0".repeat(r.w);
    return {
      t: "room_snapshot",
      room: r.id,
      rev: r.rev,
      name: "Lounge",
      template: "studio",
      owner: 9,
      layout: { rows: Array.from({ length: r.h }, () => row), door: r.door, door_dir: 2 },
      walk: Array.from({ length: r.h }, () => row),
      defs: {
        sofa_blue: { name: "Blue sofa", w: 2, d: 1, h: 50, walkable: false, seat: true, lay: false, wall: false, states: 1 },
        bar_counter: { name: "Bar counter", w: 1, d: 2, h: 100, walkable: false, seat: false, lay: false, wall: false, states: 1 },
      },
      furni: [
        { id: 1, def: "sofa_blue", x: 4, y: 2, rot: 0 },
        { id: 2, def: "bar_counter", x: r.w - 2, y: 1, rot: 0 },
      ],
      seats: [{ furni: 1, tiles: [[4, 2], [5, 2]], dir: 4, lay: false }],
      avatars: [...r.avatars.values()].map((a) => this.wireAvatar(a)),
    };
  }

  private wireAvatar(a: FakeAvatar): Avatar {
    return { id: a.id, name: a.name, x: a.x, y: a.y, dir: a.dir, state: a.state, look: { skin: 1, hair: 1, shirt: 1, pants: 1 } };
  }

  private checkLease(f: { run: number; lease: number; cid: number }, actor?: number): boolean {
    if (this.lease.get(f.run) !== f.lease) {
      this.err(f.cid, actor, "stale_lease");
      return false;
    }
    return true;
  }

  private spawn(f: Extract<SidecarMsg, { t: "actor_spawn" }>): void {
    if (!this.checkLease(f)) return;
    const r = this.rooms.get(f.room);
    if (!r || !this.subscribed.has(f.room)) return this.err(f.cid, undefined, "not_subscribed");
    if ([...r.avatars.values()].some((a) => a.name.toLowerCase() === f.name.toLowerCase())) return this.err(f.cid, undefined, "name_taken");
    const slot = (this.nextSlot.get(f.run) ?? 0) + 1;
    this.nextSlot.set(f.run, slot);
    const id = -(f.run * 100 + slot);
    const a: FakeAvatar = { id, name: f.name, x: r.door[0], y: r.door[1], dir: 2, state: "stand", ref: f.ref, run: f.run };
    r.avatars.set(id, a);
    this.joinedAt.set(id, Date.now());
    this.send({ t: "actor_spawned", cid: f.cid, ref: f.ref, actor: id, room: f.room, x: a.x, y: a.y, dir: a.dir });
    this.delta(f.room, { t: "avatar_joined", avatar: this.wireAvatar(a) });
  }

  private find(actor: number): { r: FakeRoom; a: FakeAvatar } | undefined {
    for (const r of this.rooms.values()) {
      const a = r.avatars.get(actor);
      if (a) return { r, a };
    }
    return undefined;
  }

  private command(f: Extract<SidecarMsg, { t: "actor_cmd" }>): void {
    if (!this.checkLease(f, f.actor)) return;
    const hit = this.find(f.actor);
    if (!hit) return this.err(f.cid, f.actor, "unknown_actor");
    const { r, a } = hit;
    const cmd: ActorCmd = f.cmd;
    if (this.o.enforceBudgets && !this.withinBudget(f.actor, cmd)) return this.err(f.cid, f.actor, this.refused[this.refused.length - 1]?.code as ActorErrorCode);
    switch (cmd.k) {
      case "walk":
        this.walk(r, a, cmd.x, cmd.y, cmd.plan ?? null);
        break;
      case "chat":
        this.chats.push({ actor: f.actor, mode: cmd.mode, text: cmd.text, to: cmd.to ?? null, at: Date.now() });
        if (cmd.mode === "say" || cmd.mode === "shout" || cmd.mode === "whisper") {
          this.delta(r.id, { t: "chat", from: f.actor, name: a.name, text: cmd.text, mode: cmd.mode });
        }
        break;
      case "face": {
        // Turning is instant and visible, as in the hotel: a `moves` delta with the new direction.
        const to = cmd.tile ? sectorTo([a.x, a.y], [cmd.tile[0], cmd.tile[1]]) : typeof cmd.dir === "number" ? cmd.dir : undefined;
        if (to !== undefined && a.state !== "walk") {
          a.dir = to;
          this.delta(r.id, { t: "moves", moves: [{ id: a.id, x: a.x, y: a.y, dir: a.dir, state: a.state }] });
        }
        break;
      }
      case "typing":
        this.typingLog.push({ actor: f.actor, on: cmd.on });
        this.delta(r.id, { t: "typing", id: f.actor, on: cmd.on });
        break;
      case "action":
        this.delta(r.id, { t: "avatar_action", id: f.actor, action: cmd.action, ...(cmd.style !== undefined ? { style: cmd.style } : {}) });
        break;
      case "sit": {
        const seat = cmd.furni === 1 ? [4, 2] : undefined;
        if (!seat) return this.err(f.cid, f.actor, "not_a_seat");
        this.walk(r, a, seat[0] ?? 0, seat[1] ?? 0, null, "sit");
        break;
      }
      case "move_room":
        if (!this.rooms.has(cmd.room)) return this.err(f.cid, f.actor, "no_such_room");
        // The real hotel refuses a door into a room the connection has not subscribed (`not_subscribed`).
        if (!this.subscribed.has(cmd.room)) return this.err(f.cid, f.actor, "not_subscribed");
        this.moveActorToRoom(a.ref ?? "", cmd.room, a.id);
        break;
      case "act": {
        if (this.o.autoAct) this.scriptAct({ actId: cmd.act_id, verb: cmd.verb, actor: f.actor, run: f.run, outcome: "landed", ...(cmd.with != null ? { with: cmd.with } : {}), ...(cmd.intensity != null ? { intensity: cmd.intensity } : {}), ...(cmd.origin ? { origin: cmd.origin } : {}) });
        break;
      }
      case "pair":
        setTimeout(() => this.send({ t: "pair_reaction", run: f.run, pair: cmd.pair, actor: f.actor, with: cmd.with, outcome: this.o.pairOutcome ?? "done", at: Date.now() }), this.tickMs);
        break;
      default:
        break;
    }
  }

  /** Spends the budgets `cmd` falls under; false (and a `refused` row) when one is used up. */
  private withinBudget(actor: number, cmd: ActorCmd): boolean {
    const now = Date.now();
    const spend = (key: keyof typeof HOTEL_BUDGETS): boolean => {
      const b = HOTEL_BUDGETS[key];
      const id = `${actor}|${key}`;
      const times = (this.budgetTimes.get(id) ?? []).filter((t) => now - t <= b.windowMs);
      this.budgetTimes.set(id, times);
      if (times.length >= b.count) {
        this.refused.push({ actor, k: cmd.k, code: b.code });
        return false;
      }
      times.push(now);
      return true;
    };
    if (cmd.k === "chat") return spend("chat");
    if (cmd.k === "typing") return !cmd.on || spend("typing");
    if (!spend("cmds")) return false;
    if (cmd.k === "move_room") {
      const joined = this.joinedAt.get(actor);
      if (joined !== undefined && now - joined < HOTEL_JOIN_INTERVAL_MS) {
        this.refused.push({ actor, k: cmd.k, code: "rate_limited" });
        return false;
      }
      this.joinedAt.set(actor, now);
    }
    return true;
  }

  private route(a: FakeAvatar, x: number, y: number): [number, number][] {
    const out: [number, number][] = [];
    let cx = a.x;
    let cy = a.y;
    while (cx !== x || cy !== y) {
      cx += Math.sign(x - cx);
      cy += Math.sign(y - cy);
      out.push([cx, cy]);
    }
    return out;
  }

  private walk(r: FakeRoom, a: FakeAvatar, x: number, y: number, plan: string | null, then?: "sit", after?: () => void): void {
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) return this.err(undefined, a.id, "no_route");
    const steps = this.route(a, x, y);
    this.send({ t: "walk_started", actor: a.id, plan, eta_ms: steps.length * 300, steps: steps.length });
    let i = 0;
    const step = (): void => {
      const next = steps[i++];
      if (!next) {
        a.state = then ?? "stand";
        this.delta(r.id, { t: "moves", moves: [{ id: a.id, x: a.x, y: a.y, dir: a.dir, state: a.state }] });
        this.send({ t: "arrived", actor: a.id, room: r.id, x: a.x, y: a.y, plan });
        after?.();
        return;
      }
      a.dir = sectorTo([a.x, a.y], [next[0], next[1]]);
      a.x = next[0];
      a.y = next[1];
      a.state = "walk";
      this.delta(r.id, { t: "moves", moves: [{ id: a.id, x: a.x, y: a.y, dir: a.dir, state: "walk" }] });
      const t = setTimeout(step, this.tickMs);
      this.walkTimers.add(t);
    };
    const t = setTimeout(step, this.tickMs);
    this.walkTimers.add(t);
  }

  private despawn(f: Extract<SidecarMsg, { t: "actor_despawn" }>): void {
    if (!this.checkLease(f, f.actor)) return;
    const hit = this.find(f.actor);
    if (!hit) return this.err(f.cid, f.actor, "unknown_actor");
    const { r, a } = hit;
    const remove = (): void => {
      r.avatars.delete(a.id);
      this.delta(r.id, { t: "avatar_left", id: a.id });
      this.gone.push({ actor: a.id, reason: "despawned" });
      this.send({ t: "actor_gone", actor: a.id, run: f.run, reason: "despawned" });
    };
    if (f.mode === "now") remove();
    else this.walk(r, a, r.door[0], r.door[1], null, undefined, remove);
  }
}
