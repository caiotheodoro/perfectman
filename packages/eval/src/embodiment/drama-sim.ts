import { buildBodyPerception, computeActionEmotions, validateBodyIntent } from "@perfectman/engine";
import {
  BeatPlayer,
  DramaBody,
  DramaDirector,
  MockActMemory,
  composeDramaSinks,
  isDramaFrame,
  mirrorWorld,
  mockAct,
  plan,
  resolveRunDrama,
  routeDramaFrame,
  updateMemory,
  validateActCmd,
} from "@perfectman/hotel/drama";
import type { ActSend, Clock, DramaDecision, DramaFrame, DramaFrameSink, DramaLink, DramaSession, DramaTuning, MockDrama, PlannedCommand, PlanInput, ScenarioBeat, ScenarioDrama } from "@perfectman/hotel/drama";
import { BodyIntentSchema } from "@perfectman/shared";
import type { ActVerb, AgentState, BlockedReason, BodyCommand, BodyIntent, Tile } from "@perfectman/shared";
import { extractDramaEvents } from "../drama/index.js";
import type { DramaEvent } from "../drama/index.js";
import { runDramaProbes } from "../probes/drama.js";
import type { DramaProbeResult } from "../probes/drama.js";
import { normalizeFrame } from "../hotel/index.js";
import { FakeActHotel } from "./fake-act-hotel.js";
import type { ActFrame, ActWire, ChipAnswer, ChipQuestion } from "./fake-act-hotel.js";
import { FakeGridHotel } from "./fake-grid-hotel.js";
import { LOUNGE } from "./layouts.js";
import { GridActorSpace } from "./grid-actor-space.js";

/**
 * The drama stack run offline end to end (docs/drama/act-contract.md 11.2 P4): the REAL drama director and the REAL planner side
 * (`DramaBody`, the act lock, owed reactions, the memory an act leaves, and `plan`) of the hotel package, a mock model that proposes acts
 * from each actor's own emotion state and the scenario (`mockAct`, the very function the hotel's mock provider uses), and the fake grid
 * hotel underneath with its act sequencer. Time only moves when the loop says so, so a run is the same every time for one seed.
 *
 * Not in the loop: the LLM, the prompt (it is tested on its own, `drama-prompt.test.ts`), and the engine's chat-driven emotion update
 * (the actors' feelings start from the scenario's seeds and move with what the acts do to them, `rememberAct`). The scenario's script (`beats`:
 * authored acts and scene cuts) is played by the sidecar's own `BeatPlayer`, the one a run uses, so the sim exercises the production path.
 */

const CONN = 4;
const LEASE = 1;
const MOCK_SPEECH: Record<string, string[]> = {
  glare: ["...", "Pode olhar. Eu também estou olhando."],
  insult: ["Você mentiu pra todo mundo, {t}, e agora vai ouvir!", "{t}, tenha vergonha na cara!"],
  shove: ["Sai da minha frente, {t}!", "Chega, {t}. Já deu."],
  slap: ["Isso é por tudo que você fez, {t}!", "Nunca mais fale assim comigo, {t}!"],
  punch: ["Eu avisei, {t}!", "Você pediu por isso, {t}!"],
  kill: ["Acabou, {t}.", "Você não vai contar a ninguém, {t}."],
  hug: ["Vem cá, {t}. Acabou.", "Que bom que você voltou, {t}."],
  kiss: ["Eu nunca deixei de te amar, {t}."],
  cry: ["Eu não aguento mais isso..."],
  faint: ["Ai... tudo está rodando..."],
  tend_fallen: ["Alguém chama ajuda! {t}, fala comigo!"],
  freeze_gasp: ["Meu Deus..."],
  tableau: [""],
};

export type SimControl = { atMs: number; calm?: boolean; enabled?: boolean; optIn?: { human: number; on: boolean } };
export type SimHuman = { id: number; name: string; tile: Tile; optIn: boolean; answer?: ChipAnswer | ((q: ChipQuestion) => ChipAnswer) };

export type SimConfig = {
  title: string;
  seed: number;
  durationMs: number;
  /** Every actor is consulted this often, staggered. Default 6000. */
  consultMs?: number;
  actors: ReadonlyArray<{ ref: string; name: string; tile?: Tile }>;
  humans?: readonly SimHuman[];
  /** Each actor's feelings at the start, by ref. */
  states: ReadonlyMap<string, AgentState>;
  /** The scenario's `drama` block (refs are the actors' refs). Absent: free play. */
  drama?: ScenarioDrama;
  /** Drama off for the run: no director, no session, the planner exactly as it was. Default on. */
  dramaOn?: boolean;
  /** The scenario's script as the body carries it (`ScenarioBeat`, refs are the actors' refs); played by the production `BeatPlayer`. Absent: no script. */
  beats?: readonly ScenarioBeat[];
  controls?: readonly SimControl[];
  /** The mock model's quirks (`MockDrama` less what the scenario gives it). */
  mock?: Pick<MockDrama, "gap" | "malformedEvery" | "skip">;
  /** The harm limit of the room (SAFE-4). */
  harmMax?: number;
  /** The director's tuning; absent is the sidecar's default. */
  tuning?: DramaTuning;
};

export type FrameLine = { conn: number; dir: "in" | "out"; frame: Record<string, unknown>; run: number; ts_ms: number };

export type Proposal = { atMs: number; actor: string; verb: ActVerb; with?: string; decision: string; reason?: string; detail?: string };

export type SimResult = {
  title: string;
  seed: number;
  run: number;
  durationMs: number;
  actors: string[];
  /** `frames.jsonl`: the hotel's frame log wrapper `{conn, dir, frame, run, ts_ms}`, `in` for what the sidecar sent, `out` for the hotel. */
  lines: FrameLine[];
  events: DramaEvent[];
  probes: DramaProbeResult[];
  /** What the mock proposed and what the director made of it, in order. */
  proposals: Proposal[];
  speech: Array<{ atMs: number; actor: string; text: string }>;
  /** Drama off: consults whose planned commands differed from the plain planner's (must be 0). */
  offDeviations: number;
  /** Proposals whose body block the schema dropped (the speech stayed). */
  droppedBodies: number;
  /** Proposals whose `act` the engine's validator dropped (the rest of the block and the speech stayed). */
  droppedActs: number;
  /** What became of each authored scene cut (`BeatPlayer`): sent, or dropped and why. */
  cuts: Array<{ atMs: number; outcome: "played" | "dropped"; why: string }>;
  /** Acts that held: started, and how each ended. */
  stats: { started: number; blocked: number; aborted: number; done: number };
};

/** Timers on the sim's own clock. */
class SimClock implements Clock {
  private seq = 0;
  private readonly timers: Array<{ at: number; seq: number; fn: () => void; live: boolean }> = [];
  constructor(private readonly grid: FakeGridHotel) {}
  now(): number {
    return this.grid.now();
  }
  setTimer(fn: () => void, ms: number): { cancel(): void } {
    const t = { at: this.now() + Math.max(0, ms), seq: this.seq++, fn, live: true };
    this.timers.push(t);
    return { cancel: () => void (t.live = false) };
  }
  runDue(): void {
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= this.now()).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers.splice(this.timers.indexOf(due), 1);
      due.fn();
    }
  }
}

/** Mulberry32: a seeded `() => number` for the planner. */
const rngOf = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const RUN = 7;
const ROOM = 12;
/** The hotel names rooms by number, and the drama layer reads them as numbers (`mirrorWorld`): the lounge, as room 12. */
const PARTY: typeof LOUNGE = { ...LOUNGE, id: String(ROOM), name: "Salão", exits: {} };
const SESSION: DramaSession = { enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] };

/** The positions actors start in when the config names none: a tight cluster, the first two beside each other (a scene puts its main pair first). */
function defaultTiles(n: number): Tile[] {
  const spots: Tile[] = [[4, 4], [5, 4], [4, 5], [5, 5], [6, 4], [6, 5]];
  return spots.slice(0, n);
}

export function runDramaSim(config: SimConfig): SimResult {
  const dramaOn = config.dramaOn !== false;
  const grid = new FakeGridHotel({ startMs: 1_000_000, snapshotEveryMs: 60_000, layouts: [PARTY] });
  const clock = new SimClock(grid);
  const space = new GridActorSpace(grid, RUN);
  const lines: FrameLine[] = [];
  const proposals: Proposal[] = [];
  const speech: SimResult["speech"] = [];
  const blocked = new Map<string, BlockedReason[]>();
  const states = new Map<string, AgentState>([...config.states].map(([ref, s]) => [ref, { ...s }]));
  const plannerMemory = new Map<string, NonNullable<PlanInput["memory"]>>();
  const rng = rngOf(config.seed);
  const startMs = grid.now();
  let seq = 0;
  let offDeviations = 0;
  let droppedBodies = 0;
  let droppedActs = 0;

  const log = (dir: "in" | "out", frame: Record<string, unknown>, at?: number): void => {
    lines.push({ conn: CONN, dir, frame: { ...frame, seq: ++seq }, run: RUN, ts_ms: at ?? grid.now() });
  };

  // ---- who is here ------------------------------------------------------------------------------------------
  const tiles = defaultTiles(config.actors.length);
  const slotOf = new Map<string, number>();
  config.actors.forEach((a, i) => {
    const id = -(RUN * 100 + (i + 1));
    slotOf.set(a.ref, id);
    space.assign(a.ref, id);
    grid.advance(250);
    grid.spawnActor(a.ref, a.name, String(ROOM), a.tile ?? tiles[i]);
  });
  for (const h of config.humans ?? []) {
    grid.advance(250);
    const ref = grid.humanEnter(String(h.id), h.name, String(ROOM), h.tile);
    space.assign(ref, h.id);
  }
  log("out", { t: "run_start", run: RUN, room: ROOM, scenario_version: 31, lease: LEASE, mode: "default", cap_actors: 12, admin: { id: 27, name: "a" } }, startMs - 100);
  config.actors.forEach((a, i) => {
    const t = grid.model().rooms.get(String(ROOM))?.occupants.get(a.ref)?.tile ?? [0, 0];
    log("out", { t: "actor_spawned", room: ROOM, actor: slotOf.get(a.ref)!, ref: a.ref, cid: i + 1, x: t[0], y: t[1], dir: 2 }, startMs - 90 + i);
  });

  const actorRefs = config.actors.map((a) => a.ref);
  const nameOf = (ref: string): string => config.actors.find((a) => a.ref === ref)?.name ?? config.humans?.find((h) => space.avatarId(`h:${h.id}`) !== undefined && `h:${h.id}` === ref)?.name ?? ref;

  // ---- the hotel's side: the act sequencer ---------------------------------------------------------------
  const sinkRef: { current: DramaFrameSink | undefined } = { current: undefined };
  const humanPolicy = new Map((config.humans ?? []).map((h) => [h.id, h.answer]));
  const acts = new FakeActHotel({
    run: RUN,
    room: ROOM,
    now: () => grid.now(),
    world: {
      avatars: () =>
        [...(grid.model().rooms.get(String(ROOM))?.occupants.values() ?? [])].flatMap((p) => {
          const id = space.avatarId(p.ref);
          return id === undefined ? [] : [{ id, ref: p.ref, human: p.kind === "human", tile: p.tile, state: p.state }];
        }),
      markFallen: (id, kind) => space.markFallen(space.refOfAvatar(id), kind),
    },
    emit: (frame) => deliver(frame),
    ...(config.drama ? { drama: config.drama } : {}),
    optIn: (config.humans ?? []).filter((h) => h.optIn).map((h) => h.id),
    humanAnswer: (q) => {
      const policy = humanPolicy.get(q.human);
      return typeof policy === "function" ? policy(q) : (policy ?? (q.family === "affection" ? "take" : "dodge"));
    },
    ...(config.harmMax !== undefined ? { harmMax: config.harmMax } : {}),
  });

  /** A frame from the hotel: logged as the hotel's frame log writes it, then handed to the drama sinks the way the run manager does. */
  function deliver(frame: ActFrame): void {
    const at = typeof frame.at === "number" ? frame.at : grid.now();
    log("out", frame, at);
    const last = lines.at(-1)!.frame;
    if (dramaOn && sinkRef.current && isDramaFrame(last as DramaFrame)) routeDramaFrame(last as DramaFrame, sinkRef.current);
  }

  // The planner's commands reach the grid through the sequencer first: a locked actor is refused, an act is started, a reaction is credited.
  grid.setActPort({
    command(agentId, command) {
      const id = space.avatarId(agentId);
      if (id === undefined) return undefined;
      if (command.cmd === "act") {
        const wire: ActWire = { act_id: command.actId, verb: command.verb, ...(command.with !== undefined ? { with: space.avatarId(command.with) ?? null } : {}), ...(command.intensity !== undefined ? { intensity: command.intensity } : {}), origin: command.origin ?? "model", ...(command.authoredSkip ? { authored_skip: true } : {}) };
        log("in", { t: "actor_cmd", cid: 0, run: RUN, lease: LEASE, actor: id, cmd: { k: "act", ...wire } });
        acts.receive(id, wire, 0);
        return undefined;
      }
      return acts.onBodyCommand(id, command.cmd === "gesture" || command.cmd === "expression" ? (command.cmd === "gesture" ? "action" : "expression") : command.cmd);
    },
  });

  // ---- the sidecar's side: the director and the planner ----------------------------------------------------
  const consumed = new Set<string>();
  let cid = 100;
  const link: DramaLink = {
    dialect: 2,
    sendAct({ run, actor, cmd }): ActSend {
      const error = validateActCmd(cmd, { run, actor }, consumed);
      if (error) return { sent: false, reason: "invalid", error };
      const c = ++cid;
      log("in", { t: "actor_cmd", cid: c, run, lease: LEASE, actor, cmd });
      acts.receive(actor, { act_id: cmd.act_id, verb: cmd.verb, with: cmd.with ?? null, intensity: cmd.intensity ?? null, origin: cmd.origin ?? "director", authored_skip: cmd.authored_skip ?? null }, c);
      return { sent: true, cid: c };
    },
    sendSceneAdvance(run, reason): ActSend {
      log("in", { t: "scene_advance", run, lease: LEASE, reason: (reason ?? "sidecar").slice(0, 40) });
      acts.advanceScene(reason ?? "sidecar");
      return { sent: true };
    },
  };

  const world = mirrorWorld(space, () => actorRefs, () => grid.now());
  const director = new DramaDirector({ run: RUN, clock, link, world, scenario: resolveRunDrama(config.drama ? { drama: config.drama } : {}), session: dramaOn ? SESSION : null, ...(config.tuning ? { tuning: config.tuning } : {}) });

  /** The port the planner asks, recording every answer so a proposal's fate is read, not guessed. */
  const asked: Array<{ actor: number; proposed: boolean; decision: DramaDecision }> = [];
  const port = {
    get active() {
      return director.active;
    },
    get scene() {
      return director.scene;
    },
    decide(turn: Parameters<DramaDirector["decide"]>[0]) {
      const decision = director.decide(turn);
      asked.push({ actor: turn.actor, proposed: turn.proposal !== undefined, decision });
      return decision;
    },
    feed: (f: Parameters<DramaDirector["feed"]>[0]) => director.feed(f),
    advanceScene: (reason: string) => director.advanceScene(reason),
    busyActId: (actor: number) => director.busyActId(actor),
  };

  const body = new DramaBody({
    run: RUN,
    clock,
    mirror: space,
    executor: { send: (cmds: readonly PlannedCommand[]) => void send(cmds) },
    port: () => port,
    isOwn: (ref) => slotOf.has(ref),
    names: (ref) => nameOf(ref),
    lang: "pt-BR",
    pool: { defer: () => undefined, admit: () => undefined, retire: () => undefined },
    store: {
      get: (ref) => Promise.resolve(states.has(ref) ? { ...states.get(ref)!, updatedAt: grid.now() } : null),
      upsert: (state) => {
        states.set(state.agentId, state);
        return Promise.resolve();
      },
    },
    hooks: { blocked: (agentId, reasons) => void blocked.set(agentId, [...reasons]) },
  });
  sinkRef.current = composeDramaSinks(director, body);
  if (dramaOn) {
    sinkRef.current.onSession(SESSION);
    space.setDrama(true);
  }

  function send(cmds: readonly PlannedCommand[]): void {
    const out: BodyCommand[] = cmds.map(({ afterArrival: _a, fidget: _f, owed: _o, ...c }) => c);
    // The executor folds what it sent into the planner's memory (cooldowns, the held turn, the last walk), as the run's does.
    for (const c of cmds) plannerMemory.set(c.agentId, updateMemory(plannerMemory.get(c.agentId) ?? {}, [c], grid.now(), grid.model().rooms.get(String(ROOM))?.occupants.get(c.agentId)?.tile ?? [0, 0], String(ROOM)));
    void grid.dispatch(out);
  }

  // ---- one consult of one actor ---------------------------------------------------------------------------
  const mock = new MockActMemory();
  const drama: MockDrama = { maxRung: (config.drama ?? { max_rung: 3 }).max_rung, mayDie: (config.drama?.may_die ?? []).filter((r) => r !== "@human"), ...config.mock };
  const consults = new Map<string, number>();
  const cuts: SimResult["cuts"] = [];

  function consult(ref: string): void {
    const now = grid.now();
    const state = states.get(ref);
    const view = space.view(ref, now);
    if (!state || !view?.room || body.isDead(ref)) return;
    const n = (consults.get(ref) ?? 0) + 1;
    consults.set(ref, n);
    const built = buildBodyPerception({ view, relational: state.relationalStates, language: "pt-BR" });
    const perceived = { ...built.body, blocked: blocked.get(ref) ?? [], ...(dramaOn ? { drama: true as const } : {}) };
    blocked.delete(ref);
    const proposed = mockAct({ agentId: ref, perceptionPacket: { body: perceived, bodyHandles: built.handles }, emotionalState: { socialEmotions: state.socialEmotions, relationalStates: state.relationalStates } }, n, drama, mock);
    // The model's block, the way a run takes it: the schema first (a malformed block is dropped, the speech stays), then the engine's validator,
    // which drops an `act` that needs a target it does not have and names what it refused (`body.blocked` at the next consult).
    let bodyIntent: BodyIntent | undefined;
    let handles = built.handles;
    if (proposed) {
      const parsed = BodyIntentSchema.safeParse(proposed);
      if (!parsed.success) droppedBodies += 1;
      else {
        const checked = validateBodyIntent(view, ref, parsed.data, now, built.handles);
        bodyIntent = checked.accepted;
        handles = { ...built.handles, ...checked.targets };
        if (parsed.data.act !== undefined && checked.accepted.act === undefined) droppedActs += 1;
        if (checked.blocked.length > 0) blocked.set(ref, [...(blocked.get(ref) ?? []), ...checked.blocked]);
      }
    }
    const act = bodyIntent?.act;
    const targetRef = act?.target !== undefined ? (handles[act.target]?.kind === "person" ? (handles[act.target] as { ref: string }).ref : undefined) : undefined;
    const before = proposals.length;
    if (act) proposals.push({ atMs: now - startMs, actor: ref, verb: act.verb, ...(targetRef ? { with: targetRef } : {}), decision: "proposed" });
    const input: PlanInput = {
      space: view,
      agentState: state,
      committedEvents: [],
      ...(bodyIntent ? { bodyIntent } : {}),
      now,
      rng,
      handles,
      memory: plannerMemory.get(ref) ?? plannerMemory.set(ref, {}).get(ref)!,
      actionEmotions: computeActionEmotions(state.coreMood, state.socialEmotions, state.relationalStates),
    };
    if (!dramaOn) {
      // Drama off is the planner as it always was: the plain planner on a copy of the same input, and whether the two ever differ.
      const plain = JSON.stringify(plan({ ...input, memory: structuredClone(input.memory ?? {}) }).map(({ agentId, cmd }) => [agentId, cmd]));
      const planned = body.planFor(ref, input);
      if (plain !== JSON.stringify(planned.map(({ agentId, cmd }) => [agentId, cmd]))) offDeviations += 1;
      send(planned);
      return;
    }
    asked.length = 0;
    const cmds = body.planFor(ref, input);
    for (const a of asked) {
      const d = a.decision;
      const fate = d.kind === "veto" ? { decision: "veto", reason: d.reason, ...(d.detail !== undefined ? { detail: d.detail } : {}) } : d.kind === "pass" ? { decision: "pass", reason: d.why } : { decision: d.kind };
      if (a.proposed && act && proposals.length > before) Object.assign(proposals[before]!, fate);
      else if (d.kind === "initiate") proposals.push({ atMs: now - startMs, actor: ref, verb: d.verb, ...(d.with !== undefined ? { with: space.refOfAvatar(d.with) } : {}), ...fate });
    }
    send(cmds);
    const line = act ? lineFor(ref, act.verb, targetRef, n) : undefined;
    if (line && !body.isDead(ref)) {
      speech.push({ atMs: now - startMs, actor: ref, text: line });
      log("in", { t: "actor_cmd", cid: ++cid, run: RUN, lease: LEASE, actor: slotOf.get(ref)!, cmd: { k: "chat", mode: act && ["insult", "slap", "punch", "kill"].includes(act.verb) ? "shout" : "say", text: line, ...(targetRef ? { to: slotOf.get(targetRef) ?? space.avatarId(targetRef) } : {}) } });
      void grid.dispatch([{ agentId: ref, cmd: "chat", mode: "say", text: line, ...(targetRef ? { to: targetRef } : {}) }]);
    }
  }

  function lineFor(_ref: string, verb: ActVerb, target: string | undefined, n: number): string | undefined {
    const options = MOCK_SPEECH[verb];
    if (!options) return undefined;
    const text = options[n % options.length]!.replace("{t}", target ? nameOf(target) : "");
    return text.length > 0 ? text : undefined;
  }

  // ---- the loop --------------------------------------------------------------------------------------------
  const consultMs = config.consultMs ?? 8000;
  const next = new Map(actorRefs.map((ref, i) => [ref, startMs + 1000 + i * Math.floor(consultMs / Math.max(1, actorRefs.length))]));
  const controls = [...(config.controls ?? [])].sort((a, b) => a.atMs - b.atMs);
  const end = startMs + config.durationMs;
  if (dramaOn) acts.announce();

  // The production player, on the sim's clock: it counts the script's seconds from here, as a run's does once its cast is in.
  const script = dramaOn && (config.beats?.length ?? 0) > 0
    ? new BeatPlayer({
        clock,
        port: () => port,
        beats: config.beats ?? [],
        drama: resolveRunDrama(config.drama ? { drama: config.drama } : {}),
        wireOf: (ref) => space.avatarId(ref),
        onReport: (r) => {
          const decision = r.outcome === "played" ? `authored:${r.decision?.kind ?? "cut"}` : `authored:${r.decision?.kind ?? "dropped"}`;
          const veto = r.decision?.kind === "veto" ? { reason: r.decision.reason, ...(r.decision.detail !== undefined ? { detail: r.decision.detail } : {}) } : { reason: r.why };
          if (r.beat.kind === "act") proposals.push({ atMs: r.at - startMs, actor: r.beat.actor, verb: r.beat.verb, ...(r.beat.with ? { with: r.beat.with } : {}), decision, ...(r.outcome === "dropped" ? veto : {}) });
          else cuts.push({ atMs: r.at - startMs, outcome: r.outcome, why: r.why });
        },
      })
    : undefined;
  script?.start();

  const settleMs = 12_000;
  const stopAt = end + settleMs;
  while (grid.now() < stopAt) {
    grid.advance(50);
    const now = grid.now();
    clock.runDue();
    acts.advanceTo(now);
    while (controls.length > 0 && startMs + controls[0]!.atMs <= now) {
      const c = controls.shift()!;
      if (c.calm !== undefined) acts.setCalm(c.calm);
      if (c.enabled !== undefined) acts.setEnabled(c.enabled);
      if (c.optIn) acts.setOptIn(c.optIn.human, c.optIn.on);
    }
    if (script && now >= end) script.stop();
    if (now < end) for (const ref of actorRefs) if ((next.get(ref) ?? Infinity) <= now) {
      next.set(ref, now + consultMs);
      consult(ref);
    }
  }

  // ---- what the frames say ---------------------------------------------------------------------------------
  const frames = lines.map((l) => normalizeFrame(l)).flatMap((f) => (f ? [f] : []));
  const events = extractDramaEvents(frames);
  const probes = runDramaProbes({ events, actorIds: actorRefs, durationMs: stopAt - startMs });
  return { title: config.title, seed: config.seed, run: RUN, durationMs: stopAt - startMs, actors: actorRefs, lines, events, probes, proposals, speech, offDeviations, droppedBodies, droppedActs, cuts, stats: { ...acts.stats } };
}
