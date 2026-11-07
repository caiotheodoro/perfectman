import { findPath, ringTiles, zoneGoalTiles } from "@perfectman/engine";
import type { AgentCommitInfo, SimulationRuntime } from "@perfectman/server";
import type { ActionIntent, BodyCommand, BodyHandleTarget, SimulationEvent, SpaceView, Tile } from "@perfectman/shared";
import type { FakeGridHotel, GridEvent } from "./fake-grid-hotel.js";

/**
 * A minimal stand-in for the hotel's executor, for eval tests ONLY. The real
 * planner (priority rules, anti-jitter, budgets, pair choreography) lives in
 * `packages/hotel`. This one does exactly what a validated `body` block says
 * and releases a deferred line on arrival, so the engine path can be probed
 * end to end on the fake grid.
 */
const BAND_TILES = { intimate: 1, personal: 2, social: 3 } as const;

type Pending = { intent: ActionIntent; targetRef: string };

export class TestBodyPlanner {
  private readonly pending = new Map<string, Pending>();
  private readonly releases: Promise<void>[] = [];
  /** Releases that failed, for the test to assert on. */
  readonly errors: unknown[] = [];

  constructor(
    private readonly grid: FakeGridHotel,
    private readonly runtime: SimulationRuntime,
  ) {}

  /** Wire as `HotelSimulationOptions.onAgentCommitted`. Sync: it only enqueues. */
  readonly onAgentCommitted = (info: AgentCommitInfo): void => {
    const commands = this.commandsFor(info);
    if (info.body?.deferral) {
      this.pending.set(info.agentId, { intent: info.intent, targetRef: info.body.deferral.targetRef });
    } else {
      commands.push(...this.speech(info.agentId, info.committedEvents, info.intent));
    }
    if (commands.length > 0) void this.grid.dispatch(commands);
  };

  /** Feed grid events here: an arrival releases the speaker's held line through the resolver. */
  onGridEvent(event: GridEvent): void {
    if (event.type !== "arrived") return;
    const held = this.pending.get(event.agentId);
    if (!held) return;
    this.pending.delete(event.agentId);
    this.releases.push(
      this.runtime.resolveDeferred(event.agentId, held.intent).then((resolved) => {
        const commands = this.speech(event.agentId, resolved.committedEvents, held.intent, held.targetRef);
        if (commands.length > 0) void this.grid.dispatch(commands);
      }).catch((err: unknown) => {
        this.errors.push(err);
      }),
    );
  }

  /**
   * Resolves when every released line has been dispatched. A release waits for
   * the speaker's lock, so call this only when no model call is pending on a
   * virtual timer (it would wait for the real generate deadline).
   */
  async settle(): Promise<void> {
    while (this.releases.length > 0) await this.releases.shift();
  }

  hasPending(agentId: string): boolean {
    return this.pending.has(agentId);
  }

  private speech(
    agentId: string,
    events: ReadonlyArray<Pick<SimulationEvent, "type" | "actorId" | "payload">>,
    intent: ActionIntent,
    to?: string,
  ): BodyCommand[] {
    const line = events.find((e) => (e.type === "message_sent" || e.type === "reply_sent") && e.actorId === agentId);
    const text = line?.payload["content"];
    if (typeof text !== "string") return [];
    const addressee = to ?? (line?.payload["addresseeIds"] as string[] | undefined)?.[0] ?? intent.personTargets[0];
    return [{ agentId, intentId: intent.id, cmd: "chat", mode: "say", text, ...(addressee ? { to: addressee } : {}) }];
  }

  private commandsFor(info: AgentCommitInfo): BodyCommand[] {
    const body = info.body;
    const view = info.space;
    if (!body || !view?.room || !view.self) return [];
    const { accepted, targets } = body;
    const out: BodyCommand[] = [];
    const base = { agentId: info.agentId, intentId: info.intent.id };
    const target = (h?: string): BodyHandleTarget | undefined => (h ? targets[h] : undefined);

    const move = accepted.move;
    if (move && move.kind !== "stay") {
      const t = target("target" in move ? move.target : "place" in move ? move.place : move.kind === "leave" ? move.to : undefined);
      if (move.kind === "leave" && t?.kind === "room") out.push({ ...base, cmd: "move_room", to: t.roomId });
      else {
        const dest = this.destination(view, move, t);
        if (dest) out.push({ ...base, cmd: "walk", to: dest });
      }
    }
    const posture = accepted.posture;
    if (posture) {
      const f = target(posture.at);
      if (posture.pose === "sit" && f?.kind === "furni") out.push({ ...base, cmd: "sit", furniId: f.furniId });
      else if (posture.pose === "stand") out.push({ ...base, cmd: "stand" });
      else if (posture.pose === "lay") out.push({ ...base, cmd: "lay" });
    }
    const face = target(accepted.face);
    if (face?.kind === "person") {
      const other = view.room.occupants.find((o) => o.ref === face.ref);
      if (other) out.push({ ...base, cmd: "face", targetTile: other.tile });
    }
    if (accepted.gesture) out.push({ ...base, cmd: "gesture", a: accepted.gesture.kind, ...(accepted.gesture.style !== undefined ? { style: accepted.gesture.style } : {}) });
    if (accepted.expression) out.push({ ...base, cmd: "expression", face: accepted.expression });
    return out;
  }

  private destination(view: SpaceView, move: NonNullable<AgentCommitInfo["body"]>["accepted"]["move"], t: BodyHandleTarget | undefined): Tile | undefined {
    const room = view.room!;
    const me = view.self!.tile;
    let goals: Tile[] = [];
    if (move?.kind === "approach" && t?.kind === "person") {
      const other = room.occupants.find((o) => o.ref === t.ref);
      if (other) goals = ringTiles(room, other.tile, BAND_TILES[move.band ?? "personal"]);
    } else if (move?.kind === "follow" && t?.kind === "person") {
      const other = room.occupants.find((o) => o.ref === t.ref);
      if (other) goals = ringTiles(room, other.tile, 1);
    } else if (move?.kind === "go_to" && t?.kind === "zone") {
      const zone = room.zones.find((z) => z.id === t.zoneId);
      const seats = new Set(room.furni.filter((f) => f.kinds.includes("sit")).flatMap((f) => f.tiles.map((x) => `${x[0]},${x[1]}`)));
      if (zone) goals = zoneGoalTiles(room, zone).filter((x) => !seats.has(`${x[0]},${x[1]}`));
    } else if (move?.kind === "go_to" && t?.kind === "furni") {
      goals = room.furni.find((f) => f.id === t.furniId)?.front ?? [];
    } else if (move?.kind === "leave") {
      const door = view.adjacency[0]?.viaDoor;
      if (door) goals = [door];
    }
    const route = goals.length > 0 ? findPath(room, me, goals) : null;
    return route && route.length > 0 ? route.at(-1) : undefined;
  }
}
