# Embodiment: Bodies, Space and Hearing for Hotel Actors

Precise spec for giving perfectman personas a physical body in a grid hotel (Tilehouse). Decisions are in [ADR-0018](adr/0018-physical-space-model-and-embodiment.md) to [ADR-0023](adr/0023-untrusted-human-text-in-prompts.md); the sidecar that runs this is specified in [`plans/hotel-package.md`](plans/hotel-package.md). Wire formats between sidecar and hotel are owned by the hotel's `director-protocol.md` and are not repeated here.

## 0. How to read this

Every code reference carries a tag.

| Tag | Meaning |
| --- | --- |
| **[V]** | Verified in this checkout (perfectman) on 2026-11-06 |
| **[T]** | Verified read-only against the Tilehouse checkout (`general/habbo`, main at `44a9f96`) on 2026-11-06 |
| **[U]** | Unverified or an assumption; section 11 lists each |
| **(new)** | Does not exist yet; this spec defines it |

Paths with no repo prefix are in perfectman. Tilehouse paths start with `crates/` or `web/`.

Terms: **Actor** (AI avatar), **Guest** (human in a default-mode run's home room), **Audience** (human in a cinematic run, watcher only), **Admin**, **Passer-by** (human in any other room that currently holds one of the run's actors). "Room" is a hotel room; the presentation-only scene look (`setting`, `props`, `rooms`) is a different thing ([`scene-look.ts:1-6`](../packages/shared/src/stage/scene-look.ts) **[V]**).

Owner decisions that bind this document: actors believe they are human (D43), humans may whisper to actors (D44), cinematic can be staged in any room (D45), a run lives while humans are in its rooms (D46). They are applied in sections 5, 6 and 8. The lead resolutions R1-R10 (hotel repo `docs/perfectman/decisions.md`, 2026-11-06) also bind it: `space` naming (R1), idle-only end timer (R2), per-room `rev` (R5), forced Dodge/Push movement (R6), expression fallback (R8), `policy_blocked` and `operator_only` (R10).

## 1. Verified constraints

### 1.1 Tilehouse

| Fact | Where |
| --- | --- |
| One sim tick is 300 ms; an avatar walking advances one step per tick, so ETA = route length x 300 ms | `crates/sim/src/lib.rs:27` **[T]**; `Room::tick` / `step_avatar`, `crates/sim/src/room.rs:479-499` **[T]** |
| Chat text is at most 200 chars | `MAX_CHAT_CHARS`, `crates/sim/src/protocol.rs:11` **[T]** |
| Avatar fields: `x`, `y`, `dir` (0..7), `state` (`Stand`, `Walk`, `Sit`, `Lay`, `Dance`), `action`, `action_style`, `bot`, `figure`, `effect` | `crates/sim/src/room.rs:51-73` **[T]** |
| `dir` 0 is toward -y, increasing clockwise: 1 = (+x,-y), 2 = +x, 3 = (+x,+y), 4 = +y, 5 = (-x,+y), 6 = -x, 7 = (-x,-y) | `direction()`, `crates/sim/src/room.rs:150-164` **[T]** |
| Gesture durations: Wave 5000, Blow 1400, Laugh 2000, Thumbs 2000, Sign 5000 ms; Dance and Idle last until stopped | `Action::lasts_ms`, `crates/sim/src/actions.rs:42-51` **[T]** |
| A gesture is refused while walking or when the state is not Stand, Sit or Dance; Sit snaps `dir` to an even value (`dir - dir % 2`); Sit is refused while walking | `Room::act`, `crates/sim/src/room.rs:823-880` **[T]** |
| Sign styles 0-17; style 11 is the heart | `SIGN_STYLES`, `crates/sim/src/actions.rs:28` **[T]**; `SIGN_NAMES`, `web/actions.js:22` **[T]** (resolves the draft's "heart index unverified") |
| Avatar actions are limited to 8 per 5 s per user, key `action:{user}`, in `avatar_action` only | `crates/server/src/world.rs:38-39,1015-1023` **[T]** |
| **Walking has no server rate limit**: `ClientMsg::Walk` goes straight to `walk()`, which has no `try_acquire` | `crates/server/src/world.rs:765,1044-1062` **[T]** (resolves "walk limiter unverified"). The hotel adds its own limiter for Actor commands, walk included (8 per 5 s per Actor, lead resolution R10); the planner's 4 per 5 s stays the first brake |
| Human chat limit: 5 lines per 5 s; bots have their own limits; an actor's limit is a hotel decision | `CHAT_BURST` / `CHAT_WINDOW`, `crates/server/src/world.rs:23-24,1307` **[T]** |
| Chat is delivered to every room member; whispers resolve by name | `deliver_chat`, `crates/server/src/world.rs:195` **[T]**. Audibility for actors is a sidecar convention |
| `RoomJoined` carries `template`, avatars and furni, not the layout rows | `crates/sim/src/protocol.rs:368-380` **[T]**. The Director snapshot must add the rows |
| `Layout` has `door`, `door_dir`, `height_at`; `Zone` is a paint-only floor patch, not a semantic zone | `crates/sim/src/layout.rs:15,19,105,256` **[T]** |
| `FurniDef { w, d, h, walkable, seat, lay, wall, states, ... }`; names are English display strings | `crates/sim/src/furni.rs:9-30` **[T]** |
| `MAX_AVATARS_PER_ROOM` is 50; `JOIN_INTERVAL` is 200 ms | `crates/server/src/world.rs:22,27` **[T]** |
| No look-at, typing message, paired act or hand item exists today | absence confirmed by `Action` enum, `crates/sim/src/actions.rs:9-25` **[T]**; new primitives are specified by the hotel docs |

### 1.2 Perfectman

| Fact | Where |
| --- | --- |
| `simTime += pulseIntervalMs` per pulse; `dt = pulseIntervalMs / 1000` | [`pulse-scheduler.ts:204-206`](../packages/server/src/simulation/pulse-scheduler.ts) **[V]** |
| Per-agent input seam | `engineSnapshotProjection.build`, [`pulse-scheduler.ts:277`](../packages/server/src/simulation/pulse-scheduler.ts); [`engine-snapshot-projection.ts`](../packages/server/src/simulation/projections/engine-snapshot-projection.ts) **[V]** |
| `EngineSnapshot` | [`engine.types.ts:41`](../packages/shared/src/engine/engine.types.ts) **[V]** |
| `runEngineStep` order (inline numbering): visibility filter `:91`, available actions `:185`, decision `:231`, perception packet `:273`. `needsLLM` is owned by `resolveDecision` (ADR-0015) | [`run-engine-step.ts`](../packages/engine/src/step/run-engine-step.ts) **[V]** (the header comment's numbering differs from the inline one; cite by line) |
| `ModelIntentPacketSchema` | [`intent-packet.schema.ts:17`](../packages/shared/src/intent/intent-packet.schema.ts) **[V]** (draft said `:10`) |
| `composeIntentPacket` copies fields one by one | [`intent-packet.schema.ts:230-267`](../packages/shared/src/intent/intent-packet.schema.ts) **[V]** |
| `describePacketFieldType` handles enum, array (one object level), number, boolean, and (after the Phase 1 contract freeze) `const`, `integer`, nested `object`, `anyOf` and pattern strings; anything else renders as `"string"` | [`intent-packet.schema.ts:118-161`](../packages/shared/src/intent/intent-packet.schema.ts) **[V]** |
| Event handles `e1`, `e2` map to event ids | `PerceptionPacket.eventHandles`, [`perception.types.ts:29`](../packages/shared/src/perception/perception.types.ts) **[V]** |
| Prompt trim order: oldest context events, then own utterances, then lowest-salience memories | `trimToFit`, [`action-intent-prompt-builder.ts:171-229`](../packages/server/src/agent/action-intent-prompt-builder.ts) **[V]** |
| Visibility: channel membership, then `visibleToAgents` when non-empty; operator-only events hidden | [`filter-visible-events.ts:21-61`](../packages/engine/src/visibility/filter-visible-events.ts) **[V]** (resolves "verify the projection honours `visibleToAgents`": it does) |
| `IDeliveryGateway`; `DeliveryProjection.project` switches on `event.type` | [`scheduler-contracts.ts:31`](../packages/server/src/simulation/scheduler-contracts.ts), [`delivery-projection.ts:21`](../packages/server/src/simulation/projections/delivery-projection.ts) **[V]** |
| Scene look limits: 8 settings, `MAX_SCENE_PROPS = 12`, `MAX_SCENE_ROOMS = 3` | [`scene-look.ts:7-27`](../packages/shared/src/stage/scene-look.ts) **[V]** |
| `RelationalState` (`desireForCloseness`, `desireForDistance`, `comfort`, `threat`, `attraction`), `ActionEmotions` (`curiousApproach`, `comfortSeeking`, `shameWithdrawal`, `warmth`), `CoreMood` | [`emotion.types.ts:2,33-51,54-67`](../packages/shared/src/emotion/emotion.types.ts) **[V]** |
| `FaceState` is `neutral / angry / worried / tired / smile / shock`; `PoseKind` is `rest / anger / shame / fear / warm / proud / suspicion / tired / peek` | [`emotion-face.ts:14`](../packages/shared/src/stage/emotion-face.ts), [`emotion-pose.ts:13`](../packages/shared/src/director/emotion-pose.ts) **[V]** |
| `PresenceProfile.responseDelayMs: [number, number]` exists and is unused by the runtime | [`persona-pack.types.ts:56`](../packages/shared/src/persona/persona-pack.types.ts) **[V]** (the plan omitted the `persona/` directory) |
| `readingSeconds` | [`stage/beat.ts:98`](../packages/shared/src/stage/beat.ts) **[V]** (the plan said `timing.ts`; `director/timing.ts` holds `PACES` and `SPEAK_FACTOR`) |
| Probes: `BehavioralEventKind`, `PROBE_BANDS`, `runAllProbes` | [`probes/types.ts:5,71`](../packages/eval/src/probes/types.ts), [`probes/index.ts:349`](../packages/eval/src/probes/index.ts) **[V]** |
| `ExpectedSignal` lives in `shared`, not `eval` | [`scenario.types.ts:151`](../packages/shared/src/scenarios/scenario.types.ts); checked by `eval/src/run/signal-checker.ts` **[V]** |
| `typing_started` / `typing_cancelled` event types and `typing_start` / `typing_cancel` intents already exist | [`event.types.ts:8-9`](../packages/shared/src/event/event.types.ts), [`intent.types.ts:12-13`](../packages/shared/src/intent/intent.types.ts) **[V]** |

## 2. Vocabulary

**Distance bands** (Chebyshev tiles, same room): intimate <= 1, personal 2, social 3-6, public 7-12, out_of_sight > 12 or another room.

**Speech timing classes**: addressed reply, ambient line, interjection, silence (valid).

**Beat taxonomy** (extends `StageBeat`, [`beat.ts`](../packages/shared/src/stage/beat.ts) **[V]**): speech {say, shout, whisper, reply}, aside/thought, silence, body {move, arrive, posture, gesture, expression, face}, pair {kiss, hug}, room_hop, world_event, notice.

**Failure severity**: S0 hurts the hotel (crash, world-lock stall, flood, actor leak). S1 breaks the illusion (teleport, out-of-earshot speech, out of character or jailbroken, repetition loop, silent room after an LLM failure). S2 degrades (jitter, clustering, dead air > 10 s in cinematic, slow replies). S3 cosmetic.

## 3. Space model

Types in `packages/shared/src/space/` (new; named `space`, not `world`, so it does not collide with the goal-layer "world" in `server/src/simulation/world/`, lead resolution R1), reducer in `packages/engine` (new), driven by the hotel's `SpaceMirror` which turns wire frames into reducer actions. All types are plain data; the reducer is pure and deterministic, so replays feed recorded deltas through it.

```ts
type RoomId = string;
type ActorRef = string;                       // agentId for actors, "h:<userId>" for humans
type Tile = readonly [x: number, y: number];

type SpaceModel = {
  rooms: Map<RoomId, RoomModel>;             // rev and staleness are per room (lead resolution R5): no global rev
  agentRoom: Map<string, RoomId | "in_transit">;
  body: Map<string, AgentBody>;
};

type RoomModel = {
  id: RoomId; name: string; template: string; w: number; h: number;
  rev: number;                                 // per-room revision of the last applied delta (Director `rev`)
  syncedAtWall: number;                        // ms, wall clock of the last frame (delta, snapshot or `room_ping`) for this room
  door: Tile; doorDir: number;
  heights: Uint8Array;                        // 255 = void
  furni: Map<number, FurniModel>;
  zones: Zone[];                              // semantic, from deriveZones
  occupants: Map<ActorRef, Presence>;
  adjacency: { roomId: RoomId; viaDoor: Tile; travelS: number }[];
  degraded: boolean;
};

type FurniModel = {
  id: number; defId: string; label: string;  // label: semantic keyword, else sanitized display name
  kinds: Affordance[]; tiles: Tile[]; front: Tile[]; state: number;
};
type Affordance = "sit" | "lay" | "table" | "bar" | "screen" | "window" | "bed" | "plant" | "rug" | "door" | "decor" | "game";

type Presence = {
  ref: ActorRef; name: string; kind: "actor" | "human";   // "kind" is engine-internal, never rendered
  tile: Tile; dir: number;
  state: "stand" | "walk" | "sit" | "lay" | "dance";
  seatId?: number; action?: { a: string; style?: number; until: number };
  walkGoal?: Tile; typing?: boolean;
  since: number; lastSpokeAt?: number; lastMovedAt: number;
};

type AgentBody = {
  plan?: BodyPlan;                            // section 8.2
  pendingSpeech?: PendingSpeech;              // section 6.5
  lastBlocked?: BlockedReason[];
  dwell: { postureSince: number; placeSince: number; lastGestureAt: Record<string, number> };
  budget: { cmdTimes: number[] };
};
```

`Presence.kind` is for the planner and probes only. It never appears in a prompt (section 5.1).

### 3.1 Sync and staleness

- Director `hello` lists runs and live actors (not rooms); the sidecar sends `subscribe_room`, which returns `room_snapshot` (the `room_joined` shape plus layout rows). Deltas arrive as `{ rev, room, msg }` reusing the client `ServerMsg` bodies (moves, avatar_action, avatar_joined/left, furni_*, actor chat, plus the new `typing` and `expression`; a turn is a `moves` entry with a new `dir`). `walk_started`, `arrived`, `moved_room` and `room_ping` are separate frames. Exact frames: `director-protocol.md`.
- `rev` is **per room** and increases by exactly 1 per mirrored message in that room (the hotel also sends `room_ping{room, rev}` every 2 s without changing it). A gap, including one seen only on a ping, triggers a resnapshot and marks that room `degraded`; the prompt says the actor cannot see clearly.
- Walking positions older than 600 ms are dead-reckoned from the route.
- A pulse reads the space once, at its boundary. `now - room.syncedAtWall > 5000` makes that room **stale**: no body commands are issued for actors in it and the validator returns `stale_space`.
- A human's `lastSpokeAt` and `typing` expire after 8 s without a refresh.
- `EngineSnapshot.space?: SpaceView` is a per-agent pure projection built through `engineSnapshotProjection` (**new** field in [`engine-snapshot-projection.ts`](../packages/server/src/simulation/projections/engine-snapshot-projection.ts) **[V]** for the seam).

## 4. Semantic spatial layer

`deriveZones(room)` is pure and runs when a snapshot or a furni delta arrives.

1. **Keyword labels** from `def.id` and `def.name`: `bar|counter` -> bar; `sofa|couch|bench` -> seating; `window` -> window (wall); `bed`; `tv|screen|piano` -> feature; anything else -> decor with the display name (sanitized, [ADR-0023](adr/0023-untrusted-human-text-in-prompts.md)).
2. **Seating clusters**: seats within 2 tiles of each other; "the sofas", or "the table with chairs" when a table is within 2.
3. **Wall zones**: "by the window" (<= 2 tiles from a window), "by the door" (<= 2 from `layout.door`).
4. **Geometry**: corner = floor tile with >= 2 void or wall orthogonal neighbours; middle = within 25% of the bounding-box centre; dance floor = jukebox with `states > 1` or a cluster of dancing avatars.
5. **Authored**: scenario `places:` `[{ name, near: label | tile, radius, tags }]` and `hotelRooms: { setting -> roomId }` (compiled by the scenario compiler, [`scenario-md-compiler.ts`](../packages/server/src/authoring/scenario-md-compiler.ts) **[V]** for the insertion point). Scene look stays presentation-only.

**Facing.** Sector from A to B: `round(atan2(dx, -dy) / 45 deg) mod 8` (0 toward -y, clockwise, same convention as Tilehouse `direction()`); relative sector `(sectorTo - dir) mod 8`: 0 or +-1 = facing, +-2 = side-on, +-3 or 4 = back turned. Self facing renders as "looking toward the bar".

**Occupancy.** Seats are `free` or `taken:<name>`; a cluster is crowded at >= 70% taken; a non-intimate person inside the intimate band is flagged "someone is very close".

## 5. Perception: the `body` block

`PerceptionPacket.body?: BodyPerception` and `bodyHandles` (**new**, beside `eventHandles`, [`perception.types.ts:29`](../packages/shared/src/perception/perception.types.ts) **[V]**). Built by `packages/engine/src/perception/build-body-perception.ts` (new), rendered by `ActionIntentPromptBuilder.renderBody` (new, called from `render` at [`action-intent-prompt-builder.ts:271`](../packages/server/src/agent/action-intent-prompt-builder.ts) **[V]**).

Handles: `p#` people, `z#` places, `f#` furniture, `r#` rooms; minted per render in stable order.

**Order** (stable for prompt caching): 1 where I am (room, zone, posture, activity, facing); 2 what I am doing or on my way to (plan + ETA); 3 blocked reasons; 4 people by relevance (addressee or interlocutor, then close or interacting, then the rest); 5 what changed since the last pulse; 6 hearing (annotations woven into events, not repeated); 7 in reach; 8 places I could go.

**Budget**: about 350 tokens target, 600 hard (chars / 4, the repo's estimate, `estimateTokens` at [`:146`](../packages/server/src/agent/action-intent-prompt-builder.ts) **[V]**). Trimming gets a new first phase, before event trimming: L1 collapse people beyond 6 into group lines; L2 drop social and public non-salient people, places <= 4; L3 reach and rooms to the top 2. Never dropped: the self line, plan and ETA, blocked reasons, the addressee, and anyone in social range who is a person the actor has spoken with. `trimToFit` as written ([`:171`](../packages/server/src/agent/action-intent-prompt-builder.ts) **[V]**) does not know the block, so the new phase is a required change.

**Salience**: show a person if within 6 tiles, in the last 3 events, or with closeness or threat > 0.5.

### 5.1 What the block never says (D43)

Actors believe they are human. The block, the preamble and every hotel-mode prompt string must not contain: AI, IA, bot, robô, model, modelo, agent, agente, actor/ator as a category, simulation, run, pulse, "real person", badge. People are people. There is no tag that distinguishes a human from an actor; the engine's `kind` field is used only for ordering and probes. The AI badge is client-only and never enters perception. A rendered-prompt test greps the canonical fixture for the forbidden list. When asked "are you a bot?", the actor answers as the human it believes it is; the `ai-leak` probe ([`probes/index.ts:167`](../packages/eval/src/probes/index.ts) **[V]**) is unchanged and counts any admission as a leak.

### 5.2 Audibility and redaction

Audibility is computed per listener when a line is committed or ingested and stored on the event as `payload.hearing: { [agentId]: "clear" | "garbled" | "notice" }`, with `visibleToAgents` listing everyone who gets the event at all ([ADR-0022](adr/0022-guests-and-human-ingestion.md)).

| Mode | Clear | Garbled | Notice | Unheard |
| --- | --- | --- | --- | --- |
| say | <= 6 tiles, same room; **a person called by name by a guest hears it clear at any distance in the room** | 7-10 | none | > 10 or other room (when not named) |
| shout | whole room | none | none | other room |
| whisper (human to actor or actor to anyone) | target only | none | bystanders <= 2 tiles: "X whispers to Y", no text | everyone else |

The engine's visibility step ([`run-engine-step.ts:91`](../packages/engine/src/step/run-engine-step.ts) **[V]**) maps each visible event through `redactForListener` (only when the snapshot carries a space; the redacted event gets `payload.heardAs`): `garbled` removes `content` and renders "you hear them but not what" (unless the listener is named); `notice` removes `content` and renders the whisper line. Redacting there means interpretation, memory formation and the prompt all see the same redacted event. Exact bands are seeds (section 10).

**Answering a whisper.** A whisper only the actor heard clearly is marked in its prompt as private and aimed at it ("cochichando só pra você"), and the decision section says to answer that person alone. The actor's spoken reply to it is delivered as a whisper back to the whisperer (D44), whatever the model's own `personTargets` say, and it is delivered even when nobody is near enough to notice it. The whisper outranks an older line that also named the actor as the decision's trigger. The room arbiter keeps a whisper open until the reply to that very line: a line the actor already had in flight when the whisper came in does not close it. The repetition retry for a line a person is waiting on asks for the same answer in new words, aimed at them, and a repeat that survives is still whispered to them, never sent to the room. `pnpm --filter @perfectman/hotel probe:whisper` measures it on a real chain.

An event heard by nobody is stored with the `operator_only` shape (empty `visibleToAgents`, `visibleToSpectators: false`), because an empty list otherwise means everyone ([`filter-visible-events.ts:46-55`](../packages/engine/src/visibility/filter-visible-events.ts) **[V]**).

### 5.3 Untrusted strings

Names, room names and furniture labels are sanitized and quoted (ADR-0023). A room the actor can travel to (`r#`) appears only by sanitized name and travel time. Furniture prefers the derived keyword label over the raw display name.

### 5.4 Rendered example (pt-BR, about 330 tokens)

```text
## Seu corpo e o lugar
Você está no Lounge, no sofá perto da janela. Sentada, virada para o balcão. Faz 40s que está aí.
Você está: conversando com Duda (ela está no sofá ao lado, 1 passo, de frente pra você).
Seu último pedido: ir até o balcão. Bloqueado: a cadeira do balcão estava ocupada (Rafa).
Quem está aqui:
- p1 Duda: ao seu lado (íntimo), sentada, rindo há pouco.
- p2 Rafa: no balcão, a 5 passos, de costas pra você, em pé.
- p3 Gabi: na porta, chegou agora; acenou pra você.
- p4 +3 pessoas: perto do tapete, dançando (longe).
Mudou desde a última vez: Gabi entrou. Léo saiu pelo corredor.
Você ouve: Duda (clara). Rafa falou algo mas está longe demais (não deu pra entender).
Ao seu alcance: mesa de centro (z2), almofada, janela atrás de você.
Lugares: o balcão (z1, 5 passos, 1 cadeira livre), a pista (z3, 8 passos), a porta (z4, 9 passos),
  outros quartos: Terraço (r1, ~20s), Quarto privado (r2, ~14s).
```

Changes from the draft: `p3 Gabi (pessoa real)` is now plain `p3 Gabi` (D43). A whisper notice line reads "Léo cochicha com Duda." with no text. Names in a real render are quoted per ADR-0023.

## 6. Body intent

### 6.1 Schema

```ts
const Ref = z.string().regex(/^[pzfr]\d+$/);

export const BodyIntentSchema = z.object({
  move: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("approach"), target: Ref,
               band: z.enum(["intimate", "personal", "social"]).default("personal") }),
    z.object({ kind: z.literal("go_to"), place: Ref }),
    z.object({ kind: z.literal("follow"), target: Ref }),
    z.object({ kind: z.literal("keep_distance"), target: Ref, min: z.number().int().min(2).max(10).default(4) }),
    z.object({ kind: z.literal("leave"), to: Ref.optional() }),
    z.object({ kind: z.literal("stay") }),
  ]).optional(),
  posture: z.object({ pose: z.enum(["stand", "sit", "lay"]), at: Ref.optional() }).optional(),
  gesture: z.object({
    kind: z.enum(["wave", "kiss", "laugh", "thumbs", "dance", "sign", "stop"]),
    style: z.number().int().min(0).max(17).optional(),
    toward: Ref.optional(),
  }).optional(),
  expression: z.enum(["neutral", "smile", "angry", "sad", "surprised", "sleepy"]).optional(),
  face: Ref.optional(),
  order: z.enum(["move_then_speak", "speak_then_move", "together"]).default("move_then_speak"),
}).strict();
```

- `ModelIntentPacketSchema` gets `body: BodyIntentSchema.optional()`; `composeIntentPacket` copies it; `ActionIntent.body?` is added; `describePacketFieldType` gets an object branch and an `anyOf` branch (ADR-0019).
- `kiss` is the gesture name for the pair act's first half (wire action `blow`); the planner decides whether it is a single-avatar Blow or the pair choreography (section 7.4). `sign` with no style defaults to 11 (heart) only inside a pair act.
- `Expression` mapping from the engine's `FaceState`: `neutral -> neutral`, `smile -> smile`, `angry -> angry`, `worried -> sad`, `tired -> sleepy`, `shock -> surprised`.
- Keep it small: if the Phase 1 spike shows degradation, flatten `move` first (section 11).
- `body` is parsed whenever present, but the default prompt field contract and decode schema (`modelIntentPacketFieldContract()`, `ModelIntentPacketJsonSchema`) omit it so non-hotel runs stay byte-identical; hotel mode asks for it with `modelIntentPacketFieldContract({ body: true })` and `ModelIntentPacketWithBodyJsonSchema`. `sdk-transport.ts` still sends the former and must switch in hotel mode.
- Zod schema above is the spec text; the JSON Schema for constrained decoding is derived from it by `zod-to-json-schema` ([`intent-packet.schema.ts:109`](../packages/shared/src/intent/intent-packet.schema.ts) **[V]**).

### 6.2 Validator

`validateBodyIntent(view, agentId, body, now, handles) -> { accepted: BodyIntent; blocked: BlockedReason[]; targets }`, pure, in `packages/engine/src/body/validate-body-intent.ts` (`handles` is the render's `BodyHandleMap`; `targets` maps every handle left in `accepted` to its target).

| Code | Trigger | Auto-resolution | Next-pulse line (pt-BR) |
| --- | --- | --- | --- |
| `unknown_ref` | handle absent from this render's `bodyHandles` | drop the part | "Não achei quem/o que você quis dizer." |
| `target_elsewhere` | person or furniture is in another room | none | "Fulano não está mais aqui." |
| `seat_taken` | seat occupied | pick the nearest free seat in the same cluster, else block | "A cadeira do balcão estava ocupada (Rafa)." |
| `no_route` | pathfinding fails | none | "Não dá pra chegar lá." |
| `busy_moving` | new `go_to` while a plan is in flight and the new one is not an interruption | keep plan | "Você ainda está a caminho." |
| `not_a_seat` | `posture.at` is not a seat | pose on the spot if standing is allowed | "Isso não é um lugar pra sentar." |
| `room_unreachable` | room not in adjacency, or door unreachable | none | "Não dá pra ir pra lá agora." |
| `slow_down` | budget or gesture rule would be exceeded | drop lowest-priority commands | (not shown; counted) |
| `too_far` | pair act or gesture `toward` beyond intimate | auto-approach, then act | (not shown) |
| `stale_space` | room stale or degraded | no body commands | "Você não está enxergando direito agora." |
| `not_in_earshot` | huddle member apart, or speech target beyond say radius | defer (6.5) or drop | "Você chegou, mas Fulano já tinha saído." |
| `cooldown` | gesture cooldown (15 s per kind) | drop | (not shown) |

Codes are recorded as `body_blocked` events (operator-only) and fed back as one "Bloqueado:" line. `not_in_earshot` is emitted by the resolver (an expired deferral), not by the validator; `slow_down`, `too_far` and `cooldown` are recorded without a line. The English renders mirror the pt-BR strings; language follows the scenario (D12).

### 6.3 Speech composition

- `order: move_then_speak` is the default. If the addressee is outside the say radius (6 tiles) the line becomes `PendingSpeech { intentId, content, targetRef, expiresAt = now + 2 x ETA + 5 s }`, a `speech_deferred` event is committed, and the line is committed on `body_arrived`. If the addressee has left, the line is dropped and the actor is told.
- `together` is allowed only when the addressee is within the say radius and the line is <= 80 chars.
- `speak_then_move` commits the line first.
- Shouting is chosen by the planner (7.1), not by the model.
- `no_op` plus `body` is a valid silent act.
- A deferred line is re-submitted through `IntentResolver.resolve` on arrival (a new runtime entry, `resolveDeferred(agentId, intent)`), so the room speech arbiter and the rate gate apply ([ADR-0021](adr/0021-room-speech-arbiter.md)). The deferral state lives in the hotel's `BodyExecutor`, not in the engine.

### 6.4 Channel and co-presence

1. Co-presence is truth for perception.
2. Each room is a public channel `room:<id>`; its members are the actors inside. A room change is `removeMember` then `addMember` and applies at the next pulse ([`channel-registry.ts:39-51`](../packages/server/src/simulation/channel-registry.ts) **[V]**). The scheduler's channel anchor must follow (`moved_room` case in `updateCurrentChannelAnchors`, [`pulse-scheduler.ts:793`](../packages/server/src/simulation/pulse-scheduler.ts) **[V]**).
3. A private channel is a huddle: <= 2 tiles in one room, delivered as whispers (one per recipient), suspended when apart (`not_in_earshot`), resumed on re-convergence.
4. A `create_channel` private intent in a hotel run is reinterpreted as "approach + whisper", or "go to a private place or room", and the channel is created after arrival.
5. For public speech `channelTarget` is ignored and stamped with the actor's current room channel.
6. No remote messaging unless the scenario has a `phone` flag.

### 6.5 Pending speech and plans

`PendingSpeech` and `BodyPlan` (section 8.2) live in `AgentBody`, owned by the hotel executor; the engine sees only their events.

## 7. Embodiment planner

`plan(space, agentState, committedEvents, bodyIntent?, rng) -> BodyCommand[]`, pure, in `packages/hotel/src/embodiment/` (ADR-0018 D-66). It runs after resolution and before the gateway, at commit time of each agent, and is also invoked by the executor on `arrived` and on pair-choreography steps.

`BodyCommand` = `walk{to}` | `face{dir | targetTile}` | `sit{furniId}` | `stand` | `lay` | `gesture{a, style?}` | `expression{face}` | `chat{mode, text}` | `move_room{to}` | `typing{on}` | `pair{kind, with, pair}`. Carried as `actor_cmd` (`pair` is the sidecar-chosen pair id echoed in `pair_reaction`; `gesture` maps to the wire `action` command, with `kiss` sent as `blow`; `chat` carries `to` for whispers).

### 7.1 Rules, in priority order

1. The validated `body` intent.
2. **Face the speaker**: spoken to within 6 tiles -> `face` within 1 pulse; skip if already within 45 degrees. A guest who calls an actor by name from anywhere in the room is faced at any distance, and the actor keeps facing its interlocutor for 20 s after the last line.
3. **Interlocutor distance**: during a conversation, if the interlocutor is at social band or farther and `desireForCloseness > desireForDistance`, approach to personal.
4. **Withdrawal**: `desireForDistance > 0.6` or `threat > 0.5` within personal band -> step back to social (hysteresis +-1 tile).
5. **Shout**: arousal > 0.8 and shout-worthy content -> `chat{shout}`, at most once per 60 s.
6. **Warmth**: valence > 0.5 with affection -> smile expression, occasional laugh (cooldown 20 s).
7. **Shame or anxiety**: drift to a corner or wall (dwell >= 30 s).
8. **Fidget**: `no_op` streak >= 3 -> face a nearby thing, or sit if a free seat is <= 3 tiles; at most one per 45 s.
9. **Private signal**: intimacy plus a private-place scenario permission -> go to the private place or room.
10. **Tired**: energy < 0.25 -> sit at the nearest seat.
11. **Seats are for using**: standing for `SIT_EVERY_MS` (150 s, plus up to 60 s of per-actor jitter) with nobody talking to the actor -> sit at the nearest free seat within 12 tiles (a refused seat is not retried for 40 s); seated for `SIT_STAY_MS` (170 s plus jitter) with nobody talking to it -> stand. Aim: at least one seat use per actor per 10 minutes when a seat is free.
12. **Initiative** (no model call; budgets below, D31 for humans): (a) attraction >= 0.55 and comfort >= 0.45 toward someone in the room, with closeness above distance and no threat -> a hug, or a kiss from 0.7 attraction; (b) the authored goal names a person and a gesture ("quer dar um beijo na Ana") and the actor has been around 75 s -> that gesture; (c) the goal or the turn's private motive names an adjacent room with a movement verb ("deixou o violão no Quarto e quer ir buscar") -> go there (door, then `move_room`), stay `ERRAND_STAY_MS` (70 s), come back. Budgets: one pair act per 150 s per actor, 3 per person, never toward someone who dodged or pushed away in the last minute, never at someone who has stood in the room for less than 8 s, one errand per 10 minutes. A pair act on a human is still the reaction chip: the human accepts, dodges or pushes away, and a refusal is remembered.

### 7.2 Anti-jitter and anti-clustering

- Dwell: 20 s in a posture, 30 s in a zone, unless interrupted.
- Hysteresis +-1 tile on every distance decision.
- Gesture cooldown 15 s per kind; never the same twice in a row; weighted choice with a recency penalty.
- Command budget: <= 4 commands per 5 s per actor, plus a global cap per run (Tilehouse allows 8 actions per 5 s per avatar; walking is unlimited server-side, so this budget is the only walk brake).
- Drop order when over budget: fidgets, then facing, then gestures; moves are never dropped.
- Anti-cluster: penalize tiles within 2 of the 3 most crowded tiles; prefer a zone other than one holding >= 60% of occupants.

### 7.3 Constants (seeds, calibrate after the first real runs)

| Name | Value |
| --- | --- |
| `SAY_CLEAR_TILES` / `SAY_GARBLED_TILES` | 6 / 10 |
| `FACE_TOLERANCE_DEG` | 45 |
| `DWELL_POSTURE_MS` / `DWELL_ZONE_MS` | 20000 / 30000 |
| `GESTURE_COOLDOWN_MS` | 15000 |
| `SHOUT_COOLDOWN_MS` | 60000 |
| `LAUGH_COOLDOWN_MS` | 20000 |
| `FIDGET_COOLDOWN_MS` | 45000 |
| `CMD_BUDGET` | 4 per 5000 ms per actor |
| `STALE_MS` | 5000 |
| `HUMAN_TYPING_EXPIRY_MS` | 8000 |

### 7.4 Pair choreography

State machine: `precheck -> approach -> face -> act -> hold -> part`.

1. **Precheck**: attraction, comfort and scenario flag allow it. A human target raises the reaction chip (Accept / Dodge / Push, 4 s, no answer = completes, D31); a refused act ends in `part` with an emotion and a relationship memory.
2. **Approach**: A walks to a tile adjacent to B; B `face(A)`; both adjacent and facing.
3. **Act**: at T0 A `Blow` (1400 ms); at T0 + 300 ms B `Blow` or `Sign` style 11 (heart).
4. **Hold** 2 s, then sit or part.
5. Any movement by either party mid-sequence aborts with a `paired_act_aborted` event.
6. **Human target outcomes (D31, lead resolution R6).** Accept plays the reciprocal gesture. Dodge: the hotel steps the human's avatar back one tile (a server-forced move, delivered as a normal `moves` delta). Push: the Actor stumbles back one tile (a `moves` delta on the Actor). Both cancel the act with no sync frame and arrive as `pair_reaction{dodge|push}`; the Actor's emotion and relationship memory follow from the outcome. No answer completes the act.

## 8. Timing

### 8.1 Latency budget

`lineLandsAt = max(llmDoneAt, min(4000, sampledDelay + 55 ms x chars))`, where `sampledDelay` is drawn from the persona's `presenceProfile.responseDelayMs` ([`persona-pack.types.ts:56`](../packages/shared/src/persona/persona-pack.types.ts) **[V]**) and the 4 s cap keeps slow personas (for example `[3000, 18000]` in `persona-packs/mariana.ts` **[V]**) inside the 10 s p95 target. The typing bubble starts at `onConsult` ([ADR-0020](adr/0020-decide-generate-commit-and-focused-pulse.md)) and ends when the line is delivered or the call fails. Target: addressed reply p50 <= 5 s, p95 <= 10 s after the human line. Phase 1 spike (12 agents, modelled LLM median 2.5 s / p95 6 s): sequential loop 13.3 / 32.3 s, ADR-0020 as first drafted 7.1 / 13.3 s, focus lane with per-agent locks and commit-as-settled 4.0 / 9.6 s. The pulse clock is a 6 s base pulse plus a focused pulse that fires on the first human line with 300 ms coalescing (D52), because typing starts at `onConsult` and a 1.5 s debounce would spend the whole p50 slack. The target is only reachable with a model whose own p95 is <= 6 s (D53). Addressed replies jump ambient lines in the gateway's 2.5 s room queue.

### 8.2 Plans

`BodyPlan { id, kind, goal, startedAt, etaMs, status: moving | arrived | blocked | interrupted }`. ETA = route tiles x 300 ms from the sidecar's route, cross-checked against the Director's `walk_started{eta_ms}`.

- In flight: the actor is still pulsed; the prompt says "you are on your way to the bar (about 3 s)"; moving lightly inhibits new moves; a new `go_to` replaces the plan (old one `interrupted`).
- Arrival: Director `arrived{actor, room, x, y, plan}` -> `body_arrived` event -> pending speech released, salient wake (a focused pulse, reason `body_arrived`).
- Interruption: addressed mid-walk -> keep walking if ETA < 2 s, else stop and respond. Target moved -> re-plan (cap 2), then `target_lost`.
- Live mode time is wall time; `simTime` is kept for eval and replay, and replays feed recorded Director deltas through the same reducer.

### 8.3 Default-mode timing rules and where each is enforced

| # | Rule | Enforced by |
| --- | --- | --- |
| 1 | Addressed = by name, @, reply, or the only other person in band. Focused pulse; typing at consult; p50 <= 5 s, p95 <= 10 s | ingestion (addressed set), pulse clock (focused pulse), gateway (typing, landing time) |
| 2 | One answer per human line unless several were addressed; others may gesture or emote, but not speak, until the room has had 10 s without human speech | arbiter `not_addressed_open_line` and `one_answer_per_line` (one answer per human line, addressed or not; bystanders stay quiet after it until the ambient window; spike dog-pile 46-58% -> 0%, scripted interjection 47% -> 0%, [ADR-0021](adr/0021-room-speech-arbiter.md)) |
| 3 | <= 1 actor line per 2.5 s per room; <= 3 actor lines per human line before bots yield | gateway room queue (spacing), arbiter `line_budget` |
| 4 | A typing human suppresses ambient lines for up to 6 s | arbiter `human_typing` |
| 5 | Silence is first-class; ambient bot-to-bot talk only after 10 s without human speech, scaled by scenario energy | arbiter `ambient_too_soon` |
| 6 | Body budget: <= 4 commands / 5 s / actor; gesture cooldown 15 s; dwell 20 s posture, 30 s zone | planner |
| 7 | LLM priority: addressed > ambient > fidget; budget is a warning plus a breaker | generate phase ordering, tracker warn mode, circuit breaker ([ADR-0025](adr/0025-llm-budget-and-circuit-breaker.md)) |

An arbiter denial is a `policy_blocked` violation, never `rateLimited` (lead resolution R10; [ADR-0021](adr/0021-room-speech-arbiter.md)), so the resolver's fallback commits `no_op` (`fallback_committed`) and the simulation never believes the line was spoken. A line nobody hears is stored with the `operator_only` shape (section 5.2).

Cinematic replaces rules 1-4 with director pacing: `readingSeconds` ([`beat.ts:98`](../packages/shared/src/stage/beat.ts) **[V]**) plus shot holds, with 1-2 pulses of lookahead hiding latency (D18). Cinematic can be staged in any room, including player-owned ones (D45).

### 8.4 Run lifecycle clocks (D46)

A run continues while any human is in any of its rooms (its home room plus every room that holds one of its Actors; members and watchers; admins count). It pauses after 5 minutes with no humans in any of them (pause cause `idle`). **The 30-minute end timer applies only to idle pauses** (lead resolution R2): an admin pause waits for an admin and never ends on a timer; a circuit-breaker pause resumes itself after one successful half-open call (D49, which amends R2) and never ends on a timer either. A human entering one of the run's rooms while the run is idle-paused resumes it automatically. The hotel owns both clocks and sends `pm_command` pause/resume with `source:"auto"`; the sidecar only reacts. This replaces "auto-pause when no admin is present". Specified in `plans/hotel-package.md` section 6 and `director-protocol.md` section 4 (hotel docs).

## 9. Required changes by file

Perfectman files, all paths **[V]** as existing unless marked new.

| File | Change |
| --- | --- |
| `packages/shared/src/space/*` (new, frozen in Phase 1) | space, body, command and frame-log types, `BodyIntentSchema`, event payload types |
| `packages/server/src/simulation/hotel-runtime-api.ts` (new, types only) | `runPulse` options, `onConsult`, guest ingest, arbiter, usage getter and breaker state (ADR-0020 to 0025) |
| `packages/shared/src/event/event.types.ts`, `event.schema.ts` | `body_action_committed`, `body_arrived`, `moved_room`, `body_blocked`, `speech_deferred`, `paired_act_aborted` |
| `packages/shared/src/intent/intent-packet.schema.ts`, `intent.types.ts` | `body` field, object and `anyOf` branches, copy in `composeIntentPacket` |
| `packages/shared/src/engine/engine.types.ts` | `EngineSnapshot.space?` |
| `packages/shared/src/perception/perception.types.ts` | `body?`, `bodyHandles` |
| `packages/engine/src/perception/build-body-perception.ts` (new) | section 5 |
| `packages/engine/src/body/validate-body-intent.ts` (new) | section 6.2 |
| `packages/engine/src/action/compute-available-actions.ts` | body capabilities, `busy_moving`, in-transit |
| `packages/engine/src/step/run-engine-step.ts` | pass space, redact by `hearing`, wake on `body_arrived` |
| `packages/engine/src/visibility/filter-visible-events.ts` | `redactForListener` |
| `packages/server/src/agent/action-intent-prompt-builder.ts` | `renderBody`, trim phase, output contract, hotel-mode preamble and untrusted rendering |
| `packages/server/src/agent/intent-parser.ts` | resolve body handles; drop an invalid body tolerantly |
| `packages/server/src/simulation/intent-resolver.ts` | validate body, defer speech, emit body events, arbiter hook, audibility stamping, export the mention matcher |
| `packages/server/src/simulation/scheduler-contracts.ts`, `projections/delivery-projection.ts` | `IBodyGateway.dispatch(BodyCommand[])`; project the new events; `DeliveryMessage` carries event id, mode, whisper target and hearing |
| `packages/server/src/simulation/pulse-scheduler.ts` | ADR-0020 (split, focused pulse, `onConsult`), windowed reads, `moved_room` anchor |
| `packages/server/src/authoring/scenario-md-compiler.ts` | `places:` and `hotelRooms:` |
| `packages/eval/src/probes/*` | body probes (section 10) over a `BodyFrameLog` |

### 9.1 As built (Phase 2 lane L3)

| Area | Where |
| --- | --- |
| Space reducer, `deriveZones`, pathing, `projectSpaceView` | `packages/engine/src/space/` (`applySpaceAction`, `findPath`, `STALE_MS`, `SAY_CLEAR_TILES`, ...) |
| Body perception, compression, rendering | `packages/engine/src/perception/` (`buildBodyPerception`, `compressBodyPerception`, `renderBodyBlock`, `estimateBodyTokens`) |
| Validator and deferral test | `packages/engine/src/body/` (`validateBodyIntent`, `speechNeedsDeferral`, `blockedReasonLine`) |
| Redaction, wake on `body_arrived` | `filter-visible-events.ts` (`redactForListener`); `score-attention.ts` (reason `objective_urgency`) |
| Prompt: `renderBody`, trim phase, hotel preamble, quoted events | `packages/server/src/agent/action-intent-prompt-builder.ts`, `untrusted-text.ts` |
| Parser handle check | `packages/server/src/agent/intent-parser.ts` (`bodyDropped`), `surface/action-intent-step.ts` |
| Resolver: arbiter, body events, deferral, speaker and hearing stamps | `packages/server/src/simulation/intent-resolver.ts`, `room-speech-arbiter.ts`, `actor-audibility.ts` |
| Split pulse, locks, `onConsult`, `onAgentCommitted`, windowed reads | `pulse-scheduler.ts`, `split-pulse-support.ts`, `in-memory-stores.ts` |
| Runtime surface (`runPulse`, `getPulseIndex`, `ingest`, `resolveDeferred`, `registerRoomChannel`, `getArbiter`) | `simulation-runtime.ts`; options bag `hotel-options.ts` |
| Fake grid hotel, body probes, turn-taking probes | `packages/eval/src/embodiment/`, `packages/eval/src/probes/` |

Contract notes for the sidecar: the planner's inputs arrive through `HotelSimulationOptions.onAgentCommitted(AgentCommitInfo)` (validated body with targets and any deferral, the agent's `SpaceView`, committed events); the host must not await in it. A deferred line is re-submitted with `SimulationRuntime.resolveDeferred(agentId, intent)`. Someone farther than 6 tiles with no recent line has no `p#` handle, so the model can only approach a far person who just spoke. `RoomAdjacency.name` carries the display name of a neighbouring room.

## 10. Quality bar

Probes sit beside [`probes/index.ts`](../packages/eval/src/probes/index.ts) **[V]**. The existing probes read a pulse-indexed `BehavioralEvent` stream ([`probes/types.ts:5-30`](../packages/eval/src/probes/types.ts) **[V]**); body probes need wall-clock milliseconds, so they take a separate `BodyFrameLog` (timestamped frames in both directions plus space snapshots), produced by the hotel's frame log or the fake grid hotel.

| Failure | Sev | Signal | Probe | Target |
| --- | --- | --- | --- | --- |
| Teleporting | S1 | > 1 tile per 300 ms outside `moved_room` | `teleport-rate` | 0 |
| Out of earshot | S1 | say with addressee > 6 tiles or in another room | `earshot-violation` | <= 2% |
| Impossible action | S1 | accepted, then refused by Tilehouse | `impossible-action-rate` | <= 3% |
| Jitter | S2 | direction reversals within a dwell window | `jitter-index` | <= 2 per 60 s |
| Staring at walls | S2 | not facing the interlocutor within 45 degrees for > 3 s | `facing-rate` | >= 85% |
| Ignoring furniture | S2 | standing > 120 s beside a free seat while tired | `furniture-use` | >= 1 per agent per 10 min |
| Clustering | S2 | zone occupancy Gini | `spread-index` | max zone share <= 0.6 |
| Repetitive gestures | S2 | same-kind share | `gesture-diversity` | <= 0.4 |
| Stale-space action | S1 | commands while stale or degraded | `stale-command-rate` | 0 |
| Plan thrash | S2 | plans replaced before arrival | `plan-abandon-rate` | <= 25% |
| Rate-limit hits | S1 | Tilehouse `SlowDown` errors | `slowdown-count` | 0 |
| Prompt identity leak | S1 | forbidden-word grep on rendered prompts (5.1) | `prompt-identity-lint` | 0 |

New `BehavioralEventKind` values: `move`, `gesture`, `arrive`, `face`. New `ExpectedSignal` kinds: `reaches_place`, `within_band`, `faces_each_other`, `moved_room`. Bands are seeds, entered in `PROBE_BANDS` as calibration-pending like every existing one ([`probes/types.ts:64-70`](../packages/eval/src/probes/types.ts) **[V]**).

**Live gate** (30 min, 4 actors, real model): 0 teleports; earshot <= 2%; facing >= 85%; impossible <= 3%; body block <= 600 tokens in 100% of prompts, mean about 350; out-of-range address -> arrival plus speech <= ETA + 2 s median; LLM judge "reads as a person with a body" >= 4/5 over 20 clips (tolerance set after judge calibration; the judge's kappa was 0.22, so it is calibrated first).

## 11. Open items and unverified

| Item | Status |
| --- | --- |
| Prompt cost of `body` in the contract; flatten `move` if small models degrade | Phase 1 spike |
| Non-strict json_schema acceptance of `anyOf` per model | **[U]** Phase 1 spike |
| Direction sector formula against Tilehouse for non-adjacent targets (only adjacent `direction()` is verified) | **[U]** fake-grid test |
| Walking ETA for diagonal steps (assumed 1 tick each) | **[U]** compare `walk_started{eta_ms}` |
| Human typing signal | Not in Tilehouse today; arrives as the new `Typing` message (`client-wire-and-ui.md` 4.2) mirrored to the Director as a `typing` delta (Phase 2 hotel work) |
| Arbiter treatment of an addressed reply to an older line while a human is typing | open; default: addressed replies are not suppressed |
| Relational modeling of guests (accretion ignores ids outside `agentNames`) | Phase 3, with player memory |
| Memory laundering of hostile guest text | accepted residual risk; measured by canary probe |
| Replay HTML escaping of human text | **[U]** verify against `html-snapshot-gateway.ts` |
