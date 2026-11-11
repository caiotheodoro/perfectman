import { buildBodyPerception, computeActionEmotions, validateBodyIntent } from "@perfectman/engine";
import {
  BeatPlayer,
  DramaBody,
  DramaLog,
  DramaDirector,
  HumanBody,
  MockActMemory,
  SceneRecorder,
  SceneSpine,
  SheetPlayer,
  SpineEscalation,
  buildSceneSpine,
  composeDramaSinks,
  isDramaFrame,
  mirrorWorld,
  mockAct,
  moodOfState,
  plan,
  planBlock,
  planFace,
  planProp,
  readHostility,
  resolveRunDrama,
  routeDramaFrame,
  updateMemory,
  validateActCmd,
} from "@perfectman/hotel/drama";
import type { ActSend, Clock, DramaDecision, SheetSummary, HumanLogEntry, HumanProp, DramaLogLine, DramaFrame, DramaFrameSink, DramaLink, DramaMode, DramaSession, DramaTuning, MockDrama, PlannedCommand, PlanInput, ScenarioBeat, ScenarioDrama } from "@perfectman/hotel/drama";
import { BodyIntentSchema } from "@perfectman/shared";
import type { ActVerb, AgentState, BeatSheet, BlockedReason, BodyCommand, BodyHandleMap, BodyIntent, SpineObjective, Tile } from "@perfectman/shared";
import { extractDramaEvents } from "../drama/index.js";
import type { DramaEvent } from "../drama/index.js";
import { runDramaProbes } from "../probes/drama.js";
import type { DramaProbeResult } from "../probes/drama.js";
import { normalizeFrame } from "../hotel/index.js";
import { FakeActHotel } from "./fake-act-hotel.js";
import type { ActFrame, ActWire, ChipAnswer, ChipQuestion } from "./fake-act-hotel.js";
import { FakeGridHotel } from "./fake-grid-hotel.js";
import { LOUNGE } from "./layouts.js";
import type { RoomLayout } from "./layouts.js";
import { SimFilm } from "../humanlike/sim-film.js";
import type { SimFilmDeps } from "../humanlike/sim-film.js";
import type { HumanTrace, TraceEvent } from "../humanlike/trace.js";
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

export type SimOwnWalk = { actor: string; everyMs: readonly [number, number] };
/** What the scripted model (`SimConfig.model`) is told of a consult. */
export type SimModelTurn = { ref: string; n: number; atMs: number; handleOf(ref: string): string | undefined; blocked: readonly BlockedReason[] };
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
  /** The body's `drama_mode`: `default` for the block a scene with none is given, `off` for `drama: off` (then `drama` is the off block and the director starts no act). */
  dramaMode?: DramaMode;
  /** Drama off for the run: no director, no session, the planner exactly as it was. Default on. */
  dramaOn?: boolean;
  /** The scenario's script as the body carries it (`ScenarioBeat`, refs are the actors' refs); played by the production `BeatPlayer`, with the run's walker for a beat that starts `too_far`. Absent: no script. */
  beats?: readonly ScenarioBeat[];
  /**
   * The scene's beat sheet as the body carries it (Contract A; refs are the actors' refs), played by the production `SheetPlayer` on the sim's clock: its acts and cuts through the
   * director as scenario acts, its blocking, props and faces as body commands on the grid, its camera and silence recorded in `SimResult.sheet`, and nobody speaks during a pause.
   * Exclusive with `beats`; the scene spine is inert, as in a run.
   */
  sheet?: BeatSheet;
  controls?: readonly SimControl[];
  /** The mock model's quirks (`MockDrama` less what the scenario gives it). */
  mock?: Pick<MockDrama, "gap" | "malformedEvery" | "skip">;
  /** The model only talks (a flash model that never fills `body.act`): the mock proposes nothing, so only the director's own beats can start an act (issue #262). */
  speechOnly?: boolean;
  /**
   * A scripted walker (a test seam, not a model): `actor` is sent to the next of `tiles` every `everyMs`, starting `everyMs` in, round and round, whatever else it
   * is doing. It is how a target that keeps walking away from the actor that is after it is staged (issue #262, a live model's own walks). Absent: nobody wanders.
   */
  wander?: { actor: string; everyMs: number; tiles: readonly Tile[] };
  /**
   * The model-driven actor's own walks (a test seam, issue #262): every `everyMs[0]` to `everyMs[1]` ms (seeded, so the same on every run) `actor` is planned a turn whose
   * only content is a `go_to` a random piece of furniture or zone in view, through the same `DramaBody.planFor` as a consult (but with no feelings, so the director is not asked on it), so the walk is the planner's own (its plan id
   * is not `drama:`) and meets whatever the body does about it. It is how a live model that keeps sending its actor somewhere else is staged. Absent: no own walks.
   */
  ownWalk?: SimOwnWalk | readonly SimOwnWalk[];
  /**
   * The model's body block for one consult (a test seam, errata P9), in place of the mock: what a live model was seen to do, scripted. It gets the actor, its consult number, the
   * time and the handle the render gives each person, and answers the block it would send (or none). The block goes through the schema and the engine's validator as the mock's does.
   * Absent: the mock (`mockAct`), or nothing with `speechOnly`.
   */
  model?: (turn: SimModelTurn) => Record<string, unknown> | undefined;
  /**
   * Feelings that move (a test seam, errata P9): called at every consult with the actor's state and the time, it returns the state the consult plans with, kept for the next one. The
   * engine's chat-driven update is not in the sim, so a feelings that drift in a live run (arousal, momentum, what the actor holds against each person) are staged here.
   * Absent: the state stays what the scenario seeded and what an act's memory made of it.
   */
  drift?: (ref: string, state: AgentState, atMs: number) => AgentState;
  /**
   * What the cast says (a test seam, errata P7): at `atMs` after the start `actor` says `text`, to `to` when given. The line goes to the grid as chat and to the body's grievance
   * ledger as a run's committed lines do (`DramaBody.noteSpoken`: who it names, who it is for), so a cast that only talks can be heated, or left cold, by what it says.
   */
  dialogue?: ReadonlyArray<{
    atMs: number;
    actor: string;
    text: string;
    to?: string;
    /** `false`: the line is spoken (on the grid, in the recorder the spine reads) but the grievance ledger and the spine's look at the evidence never see it (errata P9: a live run's talk whose addressees are not on record). Default: read. */
    read?: boolean;
    /** Authored (a beat sheet's note): the speaker is lying in this line, or the line reveals something. The human layer's gaze and witnesses read them. */
    lie?: boolean;
    reveal?: boolean;
  }>;
  /** The room, in place of the lounge (the Terraço of run 63, for the human-likeness preview). The actors' `tile`s are in it. */
  layout?: RoomLayout;
  /** Actors that start seated, by ref: the furniture id they sit on (a `sit` is sent at the start). */
  seated?: Readonly<Record<string, number>>;
  /**
   * The human layer (cinematic revamp B5): `likeness` is `human_likeness` (0 = the body as it was). The dialogue then plays on a film (the real shot planner), with typing
   * time by line length, a pause by feeling and talk-over, and the people react to each line (gaze, gesture, silent answers). Absent: the sim as it was. `props` are things the
   * lines point at; `appraise` stands in for the engine's chat-driven mood update (a hostile line heats the one it is for), which the sim does not have.
   * `film: true` with `likeness` 0 plays the same film at the old timing: the baseline arm.
   */
  humanLike?: { likeness: number; seed?: number; props?: readonly HumanProp[]; film?: boolean; appraise?: boolean; cine?: Partial<import("@perfectman/hotel/drama").CineConfig> };
  /** Records where everyone is and faces, every 100 ms, into the result's trace (the human-likeness metrics read it). */
  trace?: boolean;
  /**
   * The scene spine of a run with no authored beats (errata P8), as a run builds it: four steps, the turn and the decision opening the ladder for a cast that was heard
   * heating up (`SpineEscalation`, the run's own class on the sim's clock). Absent: no spine, the sim as it was. `cast` gives an actor's private objective (people who share
   * a `scarceResourceId` contend: the first is the holder, the rest challengers); `escalate: false` is `PERFECTMAN_SPINE_ESCALATE=0`, the spine that writes notes and opens
   * nothing. The spine is inert, as in a run, when the scene has authored beats, drama is off, or fewer than two actors. The notes themselves are not read (the sim has no prompt).
   */
  spine?: { language?: "pt-BR" | "en"; cast?: ReadonlyArray<{ ref: string; objective?: SpineObjective }>; escalate?: boolean };
  /**
   * The run's idle sweep (errata P9): after every base pulse (`everyMs`) each actor the model was not consulted for in it is planned with no model block and no proposal, as `Run.sweepIdle`
   * does, so the director is asked to originate a beat of its own at the pulse's pace and not only at the model's turn. An actor consulted within the last half pulse is skipped (it was planned
   * this pulse). Absent: only the model's consults plan an actor, the sim as it was.
   */
  sweep?: { everyMs: number };
  /**
   * Unlocks the scene spine granted (a test seam, errata P9): at `atMs` the body is told to open `level` for `aggressor` toward `target` as `DramaBody.escalate` would have after it read the
   * evidence. It is how a live run's grants (the manifest's `scene_spine.unlocks`) are put back at their seconds when the talk that earned them is not.
   */
  grants?: ReadonlyArray<{ atMs: number; level: "shove" | "slap"; aggressor: string; target: string }>;
  /** The scene lets a human be the target of an act without the consent chip (`may_target_humans`, `RunDrama.humansTargetable`); the fake hotel then asks no chip of a human who did not opt in. Default: the chip, as the sim has always run. */
  humansTargetable?: boolean;
  /** The scene's climax deadline (`drama.pressure_floor`): the ladder's volition gets a floor that rises toward it. Absent: free play, no floor. */
  pressure?: { climax_at_ms: number };
  /** The player's Block: true when the human blocked the actor (the actor never targets them). */
  blocks?: (human: number, actor: number) => boolean;
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
  /** Every `blocked` hook of the body, in order: what it refused to send the model's actor and why (the model reads them as `body.blocked` at its next turn). */
  bodyBlocked: Array<{ atMs: number; actor: string; code: string; detail?: string }>;
  /** The sheet when the config had one: what became of its climax and beats, and what the stage hooks were asked (blocking, props, faces, camera, silence) with when. */
  sheet?: { sheet: BeatSheet; summary: SheetSummary; stage: Array<{ atMs: number; kind: string; beat: string; detail?: string }>; reports: Array<{ atMs: number; beat: string; kind: string; outcome: string; why: string; late?: boolean }> };
  /** Acts that held: started, and how each ended. */
  stats: { started: number; blocked: number; aborted: number; done: number };
  /** The body's own counters, as a run's summary carries them (`grievance_raised`, `act_blocked_notes`, `spine_unlock_*`, ...): only the ones that are not zero. */
  counters: Record<string, number>;
  /** The drama decision log of the run (errata P9), the lines `drama-log.jsonl` would hold. */
  dramaLog: DramaLogLine[];
  /** The scene spine when the config had one (errata P8): the step it ended on, each advance (ms on the sim clock, `progress` or `released`) and what it opened of the ladder. */
  spine?: { step: number; advances: Array<{ step: number; atMs: number; via: string }>; unlocks?: ReturnType<SpineEscalation["manifest"]> };
  /** What the run looked like, for the human-likeness metrics (`SimConfig.trace`). */
  trace?: HumanTrace;
  /** The human layer's decisions (`body-log.jsonl`), when it was on. */
  bodyLog: Array<HumanLogEntry & { t_ms: number }>;
  /** The film's programs: when each line's typing came up and when it played, in sim ms from the start. */
  film?: Array<{ id: string; ref: string; startedAt: number; releasedAt?: number; typingAt?: number; cut: boolean }>;
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
  const party: RoomLayout = config.layout ? { ...config.layout, id: String(ROOM), exits: {} } : PARTY;
  const grid = new FakeGridHotel({ startMs: 1_000_000, snapshotEveryMs: 60_000, layouts: [party] });
  const clock = new SimClock(grid);
  const space = new GridActorSpace(grid, RUN);
  const lines: FrameLine[] = [];
  const proposals: Proposal[] = [];
  const speech: SimResult["speech"] = [];
  const blocked = new Map<string, BlockedReason[]>();
  const bodyBlocked: SimResult["bodyBlocked"] = [];
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
  for (const [ref, furniId] of Object.entries(config.seated ?? {})) void grid.dispatch([{ agentId: ref, cmd: "sit", furniId }]);
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
    ...(config.humansTargetable === true ? { chiplessHumans: true } : {}),
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
  const dramaLines: string[] = [];
  const dramaLog = new DramaLog((line) => dramaLines.push(line), () => grid.now() - startMs);
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

  const baseWorld = mirrorWorld(space, () => actorRefs, () => grid.now());
  const world = config.blocks ? { ...baseWorld, blocks: config.blocks } : baseWorld;
  const runDrama = resolveRunDrama({ ...(config.drama ? { drama: config.drama } : {}), ...(config.dramaMode ? { drama_mode: config.dramaMode } : {}), drama_ext: { may_target_humans: config.humansTargetable === true, ...(config.pressure ? { pressure_floor: config.pressure } : {}) }, ...(config.sheet && (config.beats?.length ?? 0) === 0 ? { beat_sheet: config.sheet } : {}) }, {});
  const director = new DramaDirector({ run: RUN, clock, link, world, scenario: runDrama, session: dramaOn ? SESSION : null, ...(config.tuning ? { tuning: config.tuning } : {}) });

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
    trace: () => director.trace(),
    pressure: () => director.pressure(),
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
    log: () => dramaLog,
    hooks: {
      blocked: (agentId, reasons) => {
        blocked.set(agentId, [...reasons]);
        for (const r of reasons) bodyBlocked.push({ atMs: grid.now() - startMs, actor: agentId, code: r.code, ...(r.detail !== undefined ? { detail: r.detail } : {}) });
      },
    },
    // What the cast says may raise a grievance between the pairs the scenario lets (never a human, never off), as a run's `mayProvoke` decides.
    provocation: {
      allow: (observer, offender) => {
        const rd = runDrama;
        return !rd.off && slotOf.has(observer) && slotOf.has(offender) && rd.effective.may_target.some(([a, b]) => a === observer && b === offender);
      },
      ...(config.tuning ? { tuning: () => config.tuning!.provocation } : {}),
    },
    // The model reads the refusal at its next consult, as a run's prompt does.
    note: (agentId, reasons) => void blocked.set(agentId, [...reasons]),
    ...(config.tuning ? { assist: config.tuning.origination.askAfterRefusal } : {}),
    ...(config.tuning ? { follow: { windowMs: config.tuning.origination.climb.followWindowMs, everyMs: config.tuning.origination.climb.followEveryMs, gapMs: config.tuning.origination.climb.gapMs, maxRung: config.tuning.origination.climb.maxRung } } : {}),
  });
  // ---- the human layer (cinematic revamp B5): absent at likeness 0, so that arm is the sim as it was ----
  const hl = config.humanLike;
  const bodyLog: SimResult["bodyLog"] = [];
  const heat = new Map<string, Array<{ at: number; ar: number; val: number; shame: number }>>();
  const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
  /** The actor's feelings with what has been said to it lately (a stand-in for the engine's chat-driven update, which the sim does not have). */
  const appraised = (ref: string): AgentState | undefined => {
    const st = states.get(ref);
    if (!st || !hl?.appraise) return st;
    const now = grid.now();
    let ar = 0;
    let val = 0;
    let shame = 0;
    for (const h of heat.get(ref) ?? []) {
      const k = Math.exp(-(now - h.at) / 25_000);
      ar += h.ar * k;
      val += h.val * k;
      shame += h.shame * k;
    }
    return { ...st, coreMood: { ...st.coreMood, arousal: clamp01(st.coreMood.arousal + ar), valence: Math.min(1, Math.max(-1, st.coreMood.valence + val)) }, socialEmotions: { ...st.socialEmotions, shame: clamp01(st.socialEmotions.shame + shame) } };
  };
  const hb =
    hl && hl.likeness > 0
      ? new HumanBody({
          clock,
          likeness: hl.likeness,
          seed: hl.seed ?? config.seed,
          view: (ref, now) => space.view(ref, now),
          refOfAvatar: (id) => space.refOfAvatar(id),
          isOwn: (ref) => slotOf.has(ref),
          names: () => new Map(config.actors.map((a) => [a.ref, a.name])),
          stateOf: (ref) => appraised(ref),
          send: (cmds) => send(cmds),
          memory: { get: (ref) => plannerMemory.get(ref), set: (ref, m) => void plannerMemory.set(ref, m) },
          isDead: (ref) => body.isDead(ref),
          isLocked: (ref) => body.ledger.lockOf(ref) !== undefined,
          holdMove: (ref) => body.ledger.lockOf(ref) !== undefined,
          ...(hl.props ? { props: () => hl.props! } : {}),
          log: ({ at, ...e }) => void bodyLog.push({ ...e, t_ms: at - startMs }),
        })
      : undefined;
  sinkRef.current = composeDramaSinks(...(hb ? [director, body, hb.sink] : [director, body]));
  if (dramaOn) {
    sinkRef.current.onSession(SESSION);
    space.setDrama(true);
  }

  // The scene spine of a run with no authored beats, and its coupling to the ladder: built as `Run.startSpine` builds it, driven by the sim's clock and lines.
  const recorder = new SceneRecorder(config.actors.map((a) => a.name));
  let spineScene: SceneSpine | undefined;
  let escalation: SpineEscalation | undefined;
  const spineLang = config.spine?.language ?? "pt-BR";
  if (dramaOn && config.spine && (config.beats?.length ?? 0) === 0 && config.sheet === undefined && !runDrama.off) {
    const built = buildSceneSpine({
      language: spineLang,
      cast: config.actors.map((a) => ({ id: a.ref, name: a.name, ...(config.spine?.cast?.find((c) => c.ref === a.ref)?.objective ? { objective: config.spine.cast.find((c) => c.ref === a.ref)!.objective! } : {}) })),
    });
    if (built) {
      escalation = config.spine.escalate === false ? undefined : new SpineEscalation(body, built, spineLang);
      spineScene = new SceneSpine(built, recorder, startMs, escalation?.onAdvance);
      escalation?.attach(spineScene);
    }
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

  const ownRng = rngOf(config.seed ^ 0x9e3779b1);

  /** An own-walk turn (`SimConfig.ownWalk`): the model's whole block is a `go_to` somewhere in view. Not a consult: it is not counted and speaks nothing. */
  function ownWalkIntent(handles: BodyHandleMap): BodyIntent | undefined {
    const places = Object.entries(handles).filter(([, t]) => t.kind === "furni" || t.kind === "zone").map(([h]) => h);
    const place = places[Math.floor(ownRng() * places.length)];
    return place === undefined ? undefined : { move: { kind: "go_to", place }, order: "move_then_speak" };
  }

  function consult(ref: string, own = false, sweep = false): void {
    const now = grid.now();
    const state0 = states.get(ref);
    const view = space.view(ref, now);
    if (!state0 || !view?.room || body.isDead(ref)) return;
    const state = !own && config.drift ? config.drift(ref, state0, now - startMs) : state0;
    if (state !== state0) states.set(ref, state);
    const n = own || sweep ? (consults.get(ref) ?? 0) : (consults.get(ref) ?? 0) + 1;
    if (!own && !sweep) consults.set(ref, n);
    const built = buildBodyPerception({ view, relational: state.relationalStates, language: "pt-BR" });
    const perceived = { ...built.body, blocked: blocked.get(ref) ?? [], ...(dramaOn ? { drama: true as const } : {}) };
    // A sweep is not a turn of the model: it reads nothing, so what the body refused is still there for the actor's next turn.
    if (!sweep) blocked.delete(ref);
    const handleOf = (target: string): string | undefined => Object.entries(built.handles).find(([, t]) => t.kind === "person" && t.ref === target)?.[0];
    const proposed = own ? ownWalkIntent(built.handles) : sweep ? undefined : config.model ? config.model({ ref, n, atMs: now - startMs, handleOf, blocked: perceived.blocked }) : config.speechOnly === true ? undefined : mockAct({ agentId: ref, perceptionPacket: { body: perceived, bodyHandles: built.handles }, emotionalState: { socialEmotions: state.socialEmotions, relationalStates: state.relationalStates } }, n, drama, mock);
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
      ...(hb ? { human: hb.planCtx(ref) } : {}),
      // An own-walk turn carries no feelings, so the body does not ask the director on it (the director's passive consult is the model's committed turn, not every walk).
      ...(own ? {} : { actionEmotions: computeActionEmotions(state.coreMood, state.socialEmotions, state.relationalStates) }),
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
    // A run's prompt build reads the spine's note, which brings the arc up to the clock (and so opens the ladder at its turn and decision).
    spineScene?.advance(now);
    const cmds = body.planFor(ref, input);
    for (const a of asked) {
      const d = a.decision;
      const fate = d.kind === "veto" ? { decision: "veto", reason: d.reason, ...(d.detail !== undefined ? { detail: d.detail } : {}) } : d.kind === "pass" ? { decision: "pass", reason: d.why } : { decision: d.kind };
      if (a.proposed && act && proposals.length > before) Object.assign(proposals[before]!, fate);
      else if (d.kind === "initiate") proposals.push({ atMs: now - startMs, actor: ref, verb: d.verb, ...(d.with !== undefined ? { with: space.refOfAvatar(d.with) } : {}), ...fate });
    }
    send(cmds);
    // An authored pause (a sheet's `pause` beat): nobody speaks.
    const line = act && !sweep && grid.now() >= silentUntil ? lineFor(ref, act.verb, targetRef, n) : undefined;
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
  let wanderAt = config.wander ? startMs + config.wander.everyMs : Infinity;
  let wanderStep = 0;
  const ownGap = (w: SimOwnWalk): number => {
    const [lo, hi] = w.everyMs;
    return lo + Math.floor(ownRng() * (hi - lo + 1));
  };
  const walkers = config.ownWalk === undefined ? [] : Array.isArray(config.ownWalk) ? [...config.ownWalk] : [config.ownWalk as SimOwnWalk];
  const ownAt = walkers.map((w) => startMs + ownGap(w));
  if (dramaOn) acts.announce();

  // The production player, on the sim's clock: it counts the script's seconds from here, as a run's does once its cast is in.
  const script = dramaOn && (config.beats?.length ?? 0) > 0
    ? new BeatPlayer({
        clock,
        port: () => port,
        beats: config.beats ?? [],
        drama: runDrama,
        ...(config.tuning ? { tuning: config.tuning.beats } : {}),
        wireOf: (ref) => space.avatarId(ref),
        // The run's walker (run.ts): the planner's own approach, ordered through the same executor, so an authored contact beat that starts apart walks together (habbo#41).
        walkCloser: (actor, target) => {
          const cmds = body.approach(actor, target, space.view(actor, grid.now())?.room, rng);
          if (cmds.length > 0) send(cmds);
          return cmds.length > 0;
        },
        onReport: (r) => {
          const decision = r.outcome === "played" ? `authored:${r.decision?.kind ?? "cut"}` : `authored:${r.decision?.kind ?? "dropped"}`;
          // A beat's own final detail (`retry_window_expired`, `scene_cut`) wins over the director's per-ask one (`distance`).
          const detail = r.detail ?? (r.decision?.kind === "veto" ? r.decision.detail : undefined);
          const veto = r.decision?.kind === "veto" ? { reason: r.decision.reason, ...(detail !== undefined ? { detail } : {}) } : { reason: r.why };
          if (r.beat.kind === "act") proposals.push({ atMs: r.at - startMs, actor: r.beat.actor, verb: r.beat.verb, ...(r.beat.with ? { with: r.beat.with } : {}), decision, ...(r.outcome === "dropped" ? veto : {}) });
          else cuts.push({ atMs: r.at - startMs, outcome: r.outcome, why: r.why });
        },
      })
    : undefined;
  script?.start();

  // The beat sheet (Contract A), on the sim's clock: the same player a run builds, its stage hooks answered by the grid.
  const stage: NonNullable<SimResult["sheet"]>["stage"] = [];
  const sheetReports: NonNullable<SimResult["sheet"]>["reports"] = [];
  let silentUntil = 0;
  const sheetCtx = (actor: string, beat: string) => {
    const view = space.view(actor, grid.now());
    const room = view?.room;
    if (!room || body.isDead(actor)) return undefined;
    return { room, self: actor, rng, tileOf: (ref: string) => room.occupants.find((p) => p.ref === ref)?.tile, isPerson: (ref: string) => actorRefs.includes(ref), now: grid.now(), plan: `drama:sheet:${beat}` };
  };
  const sheet = dramaOn && config.sheet && (config.beats?.length ?? 0) === 0
    ? new SheetPlayer({
        clock,
        port: () => port,
        sheet: config.sheet,
        drama: resolveRunDrama({ ...(config.drama ? { drama: config.drama } : {}), ...(config.dramaMode ? { drama_mode: config.dramaMode } : {}) }),
        ...(config.tuning ? { tuning: config.tuning.beats } : {}),
        wireOf: (ref) => space.avatarId(ref),
        walkCloser: (actor, target) => {
          const cmds = body.approach(actor, target, space.view(actor, grid.now())?.room, rng);
          if (cmds.length > 0) send(cmds);
          return cmds.length > 0;
        },
        stage: {
          block: (b) => {
            const ctx = sheetCtx(b.actor, b.id);
            const cmds = ctx ? planBlock(b.to, b.how, ctx) : undefined;
            stage.push({ atMs: grid.now() - startMs, kind: "block", beat: b.id, detail: cmds === undefined ? "nowhere" : `${cmds.length} cmd` });
            if (cmds === undefined) return false;
            if (cmds.length > 0) send(cmds);
            return true;
          },
          prop: (b) => {
            const ctx = sheetCtx(b.actor, b.id);
            const cmds = ctx ? planProp(b.op, b.prop, b.to, ctx) : undefined;
            stage.push({ atMs: grid.now() - startMs, kind: "prop", beat: b.id, detail: `${b.op} ${b.prop}` });
            if (cmds === undefined) return false;
            if (cmds.length > 0) send(cmds);
            return true;
          },
          expression: (actor, face) => {
            if (body.isDead(actor)) return false;
            stage.push({ atMs: grid.now() - startMs, kind: "expression", beat: actor, detail: face });
            send(planFace(actor, face));
            return true;
          },
          camera: (intent, b) => void stage.push({ atMs: grid.now() - startMs, kind: "camera", beat: b.id, detail: `${intent.shot}${intent.move ? `+${intent.move}` : ""}` }),
          pause: (ms, b) => {
            silentUntil = Math.max(silentUntil, grid.now() + ms);
            stage.push({ atMs: grid.now() - startMs, kind: "pause", beat: b.id, detail: `${ms} ms` });
          },
        },
        onReport: (r) => {
          sheetReports.push({ atMs: r.at - startMs, beat: r.beat.id, kind: r.beat.kind, outcome: r.outcome, why: r.why, ...(r.late ? { late: true } : {}) });
          const rep = r.report;
          if (rep && r.beat.kind === "act") {
            const decision = rep.outcome === "played" ? `authored:${rep.decision?.kind ?? "cut"}` : `authored:${rep.decision?.kind ?? "dropped"}`;
            const detail = rep.detail ?? (rep.decision?.kind === "veto" ? rep.decision.detail : undefined);
            const veto = rep.decision?.kind === "veto" ? { reason: rep.decision.reason, ...(detail !== undefined ? { detail } : {}) } : { reason: rep.why };
            proposals.push({ atMs: r.at - startMs, actor: r.beat.actor, verb: r.beat.verb, ...(r.beat.with ? { with: r.beat.with } : {}), decision, ...(rep.outcome === "dropped" ? veto : {}) });
          } else if (rep && r.beat.kind === "cut") cuts.push({ atMs: r.at - startMs, outcome: rep.outcome, why: rep.why });
        },
      })
    : undefined;
  sheet?.start();

  const talk = [...(config.dialogue ?? [])].sort((a, b) => a.atMs - b.atMs);
  /** One line of the seam: on the wire as chat, and in the ledger as a committed line (names found in the words are who it is about). */
  function say(l: NonNullable<SimConfig["dialogue"]>[number], cut = false, shown: string = l.text): void {
    if (body.isDead(l.actor)) return;
    const folded = (t: string): string => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const text = folded(l.text);
    const mentioned = actorRefs.filter((r) => r !== l.actor && new RegExp(`(^|[^a-z0-9])${folded(nameOf(r))}($|[^a-z0-9])`).test(text));
    speech.push({ atMs: grid.now() - startMs, actor: l.actor, text: shown });
    log("in", { t: "actor_cmd", cid: ++cid, run: RUN, lease: LEASE, actor: slotOf.get(l.actor)!, cmd: { k: "chat", mode: "say", text: shown, ...(l.to ? { to: slotOf.get(l.to) ?? space.avatarId(l.to) } : {}) } });
    void grid.dispatch([{ agentId: l.actor, cmd: "chat", mode: "say", text: shown, ...(l.to ? { to: l.to } : {}) }]);
    if (hl?.appraise) {
      const kind = readHostility(l.text).own;
      if (kind) {
        const at = grid.now();
        heat.set(l.actor, [...(heat.get(l.actor) ?? []), { at, ar: 0.25, val: -0.15, shame: 0 }]);
        if (l.to) heat.set(l.to, [...(heat.get(l.to) ?? []), { at, ar: 0.35, val: -0.35, shame: kind === "accusation" || kind === "blackmail" ? 0.35 : 0.1 }]);
      }
    }
    hb?.onLine({ speaker: l.actor, ...(l.to ? { to: l.to } : {}), text: shown, ...(l.lie !== undefined ? { lie: l.lie } : {}), ...(l.reveal !== undefined ? { reveal: l.reveal } : {}), ...(cut ? { cut: true } : {}) });
    recorder.say(nameOf(l.actor), l.text, grid.now() - startMs);
    if (dramaOn && l.read !== false) body.noteSpoken({ speaker: l.actor, content: l.text, addressees: l.to ? [l.to] : [], mentioned });
    if (l.read !== false) escalation?.onLine(grid.now());
    if (!escalation) spineScene?.advance(grid.now());
  }

  // The dialogue plays on a film when asked: the real shot planner times each line's typing bubble and its release.
  const flagsOf = new Map<string, NonNullable<SimConfig["dialogue"]>[number]>();
  const film = hl?.film
    ? new SimFilm({
        now: () => grid.now(),
        setTimer: (fn, ms) => clock.setTimer(fn, ms),
        room: ROOM,
        world: {
          avatarId: (ref) => space.avatarId(ref),
          nameOf: (ref) => nameOf(ref),
          roleOf: () => undefined,
          tileOf: (ref) => grid.model().rooms.get(String(ROOM))?.occupants.get(ref)?.tile,
          roomOf: () => ROOM,
          occupants: () => actorRefs,
          members: () => actorRefs,
          roomName: () => party.name,
          moodOf: (ref) => {
            const st = appraised(ref);
            return st ? moodOfState(st) : undefined;
          },
        },
        config: { ...(hl.likeness > 0 ? { human: { likeness: hl.likeness, seed: hl.seed ?? config.seed } } : {}), ...hl.cine },
        typing: (ref, on) => void grid.dispatch([{ agentId: ref, cmd: "typing", on }]),
        beforeLine: (l) => {
          const ap = hb?.approach(l.ref, l.to);
          if (!ap) return undefined;
          send(ap.cmds);
          return ap.delayMs;
        },
        release: (r) => {
          const src = flagsOf.get(`${r.ref}\u0000${r.full}`);
          say({ atMs: 0, actor: r.ref, text: r.full, ...(r.to ? { to: r.to } : {}), ...(src?.read !== undefined ? { read: src.read } : {}), ...(src?.lie !== undefined ? { lie: src.lie } : {}), ...(src?.reveal !== undefined ? { reveal: src.reveal } : {}) }, r.cut, r.text);
        },
      } satisfies SimFilmDeps)
    : undefined;
  /** Lines reach the film this long before they would have landed: the engine finishes a line before the audience sees it. */
  const FILM_LEAD_MS = 1000;
  const lastTurnAt = new Map<string, number>();
  const sweepEvery = config.sweep?.everyMs ?? 0;
  let sweepAt = sweepEvery > 0 ? startMs + 1000 + sweepEvery : Infinity;
  const grants = [...(config.grants ?? [])].sort((a, b) => a.atMs - b.atMs);

  const settleMs = 12_000;
  const stopAt = end + settleMs;
  const traceEvents: TraceEvent[] = [];
  const lastPos = new Map<string, string>();
  const sampleTrace = (): void => {
    for (const p of grid.model().rooms.get(String(ROOM))?.occupants.values() ?? []) {
      const key = `${p.tile[0]},${p.tile[1]},${p.dir},${p.state}`;
      if (lastPos.get(p.ref) === key) continue;
      lastPos.set(p.ref, key);
      traceEvents.push({ t: grid.now() - startMs, kind: "pos", ref: p.ref, tile: [p.tile[0], p.tile[1]], dir: p.dir, state: p.state });
    }
  };
  while (grid.now() < stopAt) {
    grid.advance(50);
    const now = grid.now();
    if (config.trace) sampleTrace();
    clock.runDue();
    acts.advanceTo(now);
    while (controls.length > 0 && startMs + controls[0]!.atMs <= now) {
      const c = controls.shift()!;
      if (c.calm !== undefined) acts.setCalm(c.calm);
      if (c.enabled !== undefined) acts.setEnabled(c.enabled);
      if (c.optIn) acts.setOptIn(c.optIn.human, c.optIn.on);
    }
    if (script && now >= end) script.stop();
    if (sheet && now >= end) sheet.stop();
    while (talk.length > 0 && startMs + talk[0]!.atMs - (film ? FILM_LEAD_MS : 0) <= now && now < end) {
      const l = talk.shift()!;
      if (!film) {
        say(l);
        continue;
      }
      flagsOf.set(`${l.actor}\u0000${l.text}`, l);
      film.enqueue({ ref: l.actor, ...(l.to ? { to: l.to } : {}), text: l.text });
    }
    if (config.wander && now >= wanderAt && now < end) {
      const w = config.wander;
      wanderAt = now + w.everyMs;
      const to = w.tiles[wanderStep++ % w.tiles.length]!;
      if (!body.isDead(w.actor)) void grid.dispatch([{ agentId: w.actor, cmd: "walk", to, plan: `wander:${wanderStep}` }]);
    }
    walkers.forEach((w, i) => {
      if (now >= ownAt[i]! && now < end) {
        ownAt[i] = now + ownGap(w);
        consult(w.actor, true);
      }
    });
    while (grants.length > 0 && startMs + grants[0]!.atMs <= now && now < end) {
      const g = grants.shift()!;
      body.grant(g.aggressor, g.target, g.level, `grant at ${g.atMs / 1000} s`);
    }
    if (now < end) for (const ref of actorRefs) if ((next.get(ref) ?? Infinity) <= now) {
      next.set(ref, now + consultMs);
      lastTurnAt.set(ref, now);
      consult(ref);
    }
    if (now >= sweepAt && now < end) {
      sweepAt += sweepEvery;
      for (const ref of actorRefs) if (now - (lastTurnAt.get(ref) ?? -Infinity) >= sweepEvery / 2) consult(ref, false, true);
    }
  }

  // ---- what the frames say ---------------------------------------------------------------------------------
  const frames = lines.map((l) => normalizeFrame(l)).flatMap((f) => (f ? [f] : []));
  const events = extractDramaEvents(frames);
  const probes = runDramaProbes({ events, actorIds: actorRefs, durationMs: stopAt - startMs, ...(config.humansTargetable === true ? { chiplessHumans: true } : {}) });
  dramaLog.close();
  hb?.dispose();
  let trace: HumanTrace | undefined;
  if (config.trace) {
    const events: TraceEvent[] = [...traceEvents];
    for (const f of grid.frameLog().frames) {
      const t = f.atMs - startMs;
      const d = f.data;
      if (f.kind === "typing" && f.dir === "in") events.push({ t, kind: "typing", ref: String(d["ref"]), on: d["on"] === true });
      else if (f.kind === "chat" && f.dir === "in") events.push({ t, kind: "chat", ref: String(d["agentId"]), text: String(d["text"] ?? ""), mode: String(d["mode"] ?? "say"), ...(typeof d["toRef"] === "string" ? { to: d["toRef"] as string } : {}) });
      else if (f.kind === "avatar_action" && f.dir === "in") {
        const a = String(d["a"] ?? "");
        if (a.startsWith("face:")) events.push({ t, kind: "expression", ref: String(d["agentId"]), face: a.slice(5) });
        else if (["wave", "thumbs", "laugh", "sign", "blow", "dance"].includes(a)) events.push({ t, kind: "gesture", ref: String(d["agentId"]), a, ...(typeof d["style"] === "number" ? { style: d["style"] as number } : {}) });
      } else if (f.kind === "actor_cmd" && f.dir === "out") {
        const cmd = String(d["cmd"] ?? "");
        events.push({ t, kind: "cmd", ref: String(d["agentId"]), cmd: cmd === "gesture" ? `action:${String(d["a"])}` : cmd });
      }
    }
    events.sort((a, b) => a.t - b.t);
    const firstChat = events.find((e) => e.kind === "chat")?.t ?? 0;
    const lastAt = events.reduce((m, e) => Math.max(m, e.t), 0);
    trace = {
      run: config.title,
      source: "sim",
      sceneStartMs: firstChat,
      durationMs: Math.max(0, lastAt - firstChat),
      actors: config.actors.map((a) => ({ ref: a.ref, name: a.name, human: false })),
      events,
      arm: `h=${hl?.likeness ?? 0}`,
    };
  }
  return { bodyLog, ...(trace ? { trace } : {}), ...(film ? { film: film.played } : {}), title: config.title, seed: config.seed, run: RUN, durationMs: stopAt - startMs, actors: actorRefs, lines, events, probes, proposals, speech, offDeviations, droppedBodies, droppedActs, cuts, bodyBlocked, stats: { ...acts.stats }, counters: body.counters(), dramaLog: dramaLines.map((l) => JSON.parse(l) as DramaLogLine), ...(sheet && config.sheet ? { sheet: { sheet: config.sheet, summary: sheet.summary(), stage, reports: sheetReports } } : {}), ...(spineScene ? { spine: { step: spineScene.step, advances: spineScene.advances.map((a) => ({ step: a.step, atMs: a.atMs, via: a.via })), ...(escalation ? { unlocks: escalation.manifest(startMs) } : {}) } } : {}) };
}
