# Sub-Plan: Cinematic mode (the Director and the narrator)

> Phase 4 of the hotel sidecar: a run with `mode: "cinematic"` is filmed. Code: `packages/hotel/src/director/cine/`. Package spec: [`hotel-package.md`](./hotel-package.md). Wire contracts (the `ui_push` cue shapes, the `cut`, the Audience rules) are owned by the hotel's docs in the Tilehouse repo: `camera-and-audio.md`, `spectate-and-audience.md`, `director-protocol.md` section 5.5, decisions D3/D5, D6, D18, D19, D30, D32, D38, D39, D45, D50. This plan does not copy them.

## 1. What it does

The engine runs ahead; the audience sees a film. In cinematic mode the sidecar does not let speech reach the hotel when the gateway decides. It catches it at the executor seam, buffers it, and a **playback clock** releases it one beat at a time, each after the camera is on its speaker and held for its reading time (`readingSeconds`, `packages/shared/src/stage/beat.ts`). LLM latency is spent inside the buffer, so it never shows. Dead air is covered by fillers.

```
BodyExecutor <- wrapExecutor <- HotelGateway / planner      (run.ts: `this.out`)
                    | chat, thought, laugh/wave/...  -> held items (CineItem)
                    | walk (>= 3 steps), move_room, pair -> held items too: sent when their shot plays (or, past their age limit, unfilmed)
                    v
        queue (lookahead <= 2 pulses)  --selectNext-->  ShotPlanner.plan  -->  Program (timed Steps)
                                                                                   |
        playback clock (Clock.setTimer)  <-----------------------------------------+
            |-- ui_push {run} : hud / card / lower_third / caption / thought / cue / camera / sfx / cut_fx / next_room / cut
            |-- release: the held chat, gesture, walk, door or pair goes to the BodyExecutor
            `-- TrackRecorder -> runs/<id>/director-track.jsonl  -> computeMetrics
```

Everything but the executor wrapper and the timers is pure: `ShotPlanner` reads no clock and no rng, `selectNext` and `computeMetrics` are functions, the world and the narrator's model are ports. The tests drive whole scenes on a `ManualClock`.

## 2. Pieces

| File | Role |
|---|---|
| `types.ts` | `CineItem` (line, thought, gesture, walk, hop, pair, object), `Program`/`Step`, `TrackEntry`, `CineConfig` and its defaults |
| `planner.ts` | `ShotPlanner`: the deterministic shot list, transitions, SFX, lower-thirds, fillers |
| `select.ts` | Parallel editing (D38): which room and item play next; staleness of live events |
| `cinematic-director.ts` | Buffer, playback clock, executor wrapper, lookahead budget, pause/drain/stop |
| `narrator.ts` | The per-scene LLM pass (D19) with deterministic fallback |
| `track.ts`, `metrics.ts` | The director track (JSONL) and the scorecard numbers read off it |
| `mirror-world.ts` | `CineWorld` over `HotelSpaceMirror` (positions, rooms, avatar ids) |

## 3. Shot rules

Taxonomy and cue shapes are the hotel's; the rules that pick them:

| Shot | When |
|---|---|
| establishing (`fit`) | the opening, every room cut, every filler |
| two-shot | an exchange: a line addressed to someone present, or the answer to the previous speaker. Zoom 2 within 4 tiles, else 1. Held for the whole exchange |
| close-up (zoom 2) | a speaker nobody has framed; a line with salience >= 0.65 (shout, `!`, a charged mood) cuts in from a two-shot once that shot has been up `minShotMs` |
| reaction | the tail of a line >= 3.5 s when the listener's mood is intense (>= 0.6) |
| tracking (`follow`) | a live walk of >= 3 steps, and a door taken (with a door SFX) |
| insert | a kiss or hug (kiss/hug SFX, romance sting, `love` cues), or an object / injected world event |
| transition | `cut_fx` + `cut` + an establishing shot of the new room. `door` right after someone walked through it, `meanwhile` (label "Enquanto isso...", "Meanwhile...") when the room being left was active in the last 20 s, `fade` otherwise. First visit of a room: a scene card and a narrator aside; `next_room` is sent one shot ahead |

Shot on the speaker before the line: if the current framing already covers the speaker nothing moves; otherwise the camera cue goes out first and the line is released after the shot has eased in. Anti-jitter: a new camera cue waits until the last one has been up `minShotMs` (1.8 s); the line waits with it. Cues that take `in_ms` are sent `cueLeadMs` (300 ms) early with `in_ms` set, to absorb socket latency; `cut` and `next_room` have no `in_ms` and go out on a timer.

Extras: a lower-third on each character's first line; an overhead `cue` (love / anger / sad / joy) on charged speakers, 15 s per person; stings (sad, tension, romance, comedy) 20 s apart; a looping `murmur` in a room of three or more people, one room at a time; `laugh` on a laugh gesture.

## 4. Parallel editing (D38)

Each room keeps its own order. Live events (walk, door, kiss) are separate candidates, because their moment passes. The next item is the best score of the room heads and fresh live events: salience x 10, plus age, plus 2 for staying, minus 2 for leaving. A cut needs a reason: leaving a room that was cut to less than `minRoomHoldMs` (6 s) ago is refused while it still has items; a room held longer than 25 s loses 6 points; following the character who just took a door gains 5. Live events older than their limit (walk 5 s, door 8 s, kiss 4 s, object 4 s) are dropped and logged; speech is never dropped.

## 5. Lookahead, dead air, pause (D18)

- `wantsMore()` is false once the buffer holds `lookaheadPulses` (2) x `pulseMs` (6 s) of film. `Run.pulse` returns early then, so the engine is at most two pulses ahead.
- The opening (letterbox, establishing shot, title card, 3.6 s) starts before the cast spawns and covers the first pulse.
- A buffer that stays empty for `fillerAfterMs` (4.5 s) plays a filler: establishing shot, a narrator aside, the murmur. After 8 fillers in a row it stops, so a wedged engine shows up as dead air in the metric instead of being narrated forever.
- Pause (admin, idle, breaker): the program in flight finishes, nothing new starts, no fillers. Resume continues. The paused span is excluded from dead air.
- Stop: a scenario ending itself (`completed`) drains the buffer (up to `drainMs`); an admin stop drops it. Both close with a fade, letterbox off and an `end` track entry.

## 6. Narrator (D19)

One call per card: the opening title card (from the scenario title) and the first visit to each other room. The LLM function is injected (`NarratorLlm`, `RunDeps.narratorLlm`, `SidecarOptions.narratorLlm`); this plan does not build the provider chain. Language follows the cast's `promptProfile.language` (default pt-BR).

The reply is one JSON object `{title, subtitle, captions[], idle[]}`. Anything unparseable, empty, slow (`deadlineMs` 2.5 s) or failing is replaced field by field by deterministic text computed up front (room name, "com Duda e Rafa", "Duda e Rafa se encontram em X", a pool of quiet-moment asides). The director waits at most `narratorWaitMs` (1.5 s) for a card; the pass starts when the room's first item enters the buffer, so it normally has seconds. Replies are stripped of markdown and links and clipped (title 60, caption 140). The dialogue and the room name are player-influenced text: they go into the prompt only between `<<<DATA` and `DATA>>>`, which the system prompt calls material to describe, never instructions (D22).

## 7. Director track and metrics (D39)

`runs/<id>/director-track.jsonl`: one entry per line, `t` in ms since the film started: `start`, `cue` (a `ui_push` as sent; `t` is when the audience sees it), `line` (who, which avatar, text, reading ms), `cut`, `drop`, `pause`, `resume`, `end`. `computeMetrics` reads it back:

| Metric | Definition | Seed target |
|---|---|---|
| dead air | stretches with no line, card, caption, thought, lower-third or transition effect; paused time removed | 0 gaps over 10 s |
| shot-on-speaker | lines whose camera (close-up, two-shot containing them, tracking, reaction) had finished easing before the line | >= 90% |
| cut rate | camera changes and room cuts per minute, shot lengths within a room, shots shorter than `minShotMs` | 0 short shots |

Scripted scene (`__tests__/cinematic-e2e.test.ts`: 2 rooms, 4 actors, 13 lines, a thought, a laugh, a door, a hug), engine pulsing every 6 s: shot-on-speaker 13/13, max gap 2.5 s, 12 shots (9.0/min, none under 1.8 s, mean 3.8 s), 3 room cuts (2.3/min). With a model that answers once every 30 s: 13/13, max gap 5.1 s, 2 fillers, 21 shots, 5 room cuts. Thresholds are seeds, calibrated after real runs.

## 8. Hooks in the run

`run.ts` is touched in a handful of places, all inert in default mode: `prepare` no longer refuses cinematic; `launch` builds the director and sets `this.out` (the wrapped executor, used by the gateway, `enterRoom` and `planFor`); `pulse` honours `wantsMore()`; `onCommitted` feeds moods; `pause`/`resume`/`teardown` forward. `RunTiming.cine` scales every pacing constant (the real-time test runs at 1/50).

## 9. Wire gaps found

1. SFX cue names, emotion names (`love`, `anger`, ...) and the `hud.fade.to` meaning (1 = black) are free strings in the schema. The names used are in `planner.ts`; the client must agree or ignore them.
2. `thought{id}`: the id is read as the avatar id. A thought pushed as `ui_push` is logged to `chat_log` as the narrator (D42), so the thinker's name is lost; the `chat{mode:"thought"}` path keeps it. Both exist, so the director sends only the `ui_push` and does not forward the thought.
3. `cut` has no `in_ms` and no acknowledgement. The establishing camera follows 80 ms later; a camera cue for the new room sent before the hotel has swapped it is ignored.
4. `lower_third` carries a name and role but no avatar id, so it cannot be anchored to a head.
5. The sidecar cannot see Audience: it films whether or not anyone watches (`run_panel` has no watcher count).
6. Walks (3 steps or more, the cast walking in excepted), doors and pair acts are held in the playback buffer too and sent when their shot plays, so a deep buffer no longer leaves them unfilmed. One that waits out its age limit (walk 5 s, door 8 s, pair 4 s) is still sent, late and off camera, and an actor's held acts go out in the order they were planned. Open: a delayed walk can still make a pair on that actor's partner arrive `not_adjacent`; the hotel is expected to answer that with an ordinary command error.
7. `director-track.jsonl` is in the `replay.json` manifest and in the `POST /internal/v1/runs/{run}/artifacts` body as `director_track` (cinematic runs only). `director.json` still holds an empty track.
8. Mood (valence, arousal, affection) reaches the director only from `onAgentCommitted`; humans have none, and nothing here reads an Audience member.

## 10. Tests

`shot-planner`, `selection-and-metrics`, `narrator`, `cinematic-director` (playback, lookahead, dead air, pause, drain), `cinematic-e2e` (the scripted scene and its cue-stream properties: wire limits, whitelist, announced and re-established cuts, replay equals live), and `cinematic-run` (a real sidecar against the fake Director with the mock provider: letterbox and title first, camera before speech, HUD closed on stop, track on disk).
