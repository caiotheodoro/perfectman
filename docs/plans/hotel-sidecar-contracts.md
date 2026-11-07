# Sub-Plan: cue vocabulary, entrances, player memory and replay (what the sidecar does, what the hotel owes)

> Last four items of the sidecar's hotel integration. Code: `packages/hotel/src/director/cine/cue-vocab.ts`, `run/run.ts` (entrances), `run/player-memory.ts`, `run/replay-plan.ts`, `run/replay-run.ts`, `run/run-manager.ts`. Package spec: [`hotel-package.md`](./hotel-package.md); cinematic mode: [`hotel-cinematic.md`](./hotel-cinematic.md). Wire and storage contracts are owned by the hotel's docs in the Tilehouse repo (`director-protocol.md` 6.1 and 11, `data-model.md` 2.4 and 3, `camera-and-audio.md` 8; decisions D21, D31, D39, D47, D48). This page records what the sidecar does with them and the exact shapes it relies on.

## 1. Cue vocabulary

`packages/hotel/schema/cue-vocab.json` is vendored from the hotel (see `schema/SOURCE.md`); `gen:director` turns it into `src/director/cue-vocab.generated.ts` and `check:director` (part of `test:gate`) fails when that is stale. The Director emits canonical names only: `crowd_murmur`, `door_open` and `door_close`, `transition_whoosh`, the stings, `laugh`, `kiss`, `hug`; emotions are `love joy sad angry surprised confused afraid thinking`; `hud.fade.to` is 0 (clear) to 1 (black). A safety net in the Director drops a cue with no canonical form and clamps a fade. `cine/__tests__/cue-vocab.test.ts` checks the planner source, a scripted film and the live end-to-end against the vocabulary.

## 2. Pair acts and walks

A pair act waits for the walks it depends on. The Director releases the partner's earlier held walk before the act, and the body executor holds the act until the actor's and the partner's walks have arrived (a walk that is refused or leaves the room releases it; 15 s is the ceiling). The hotel therefore does not answer `not_adjacent` for these.

## 3. Entrances

The cast walks in over time. Each person's time is, in order: the builder's `after N s` (carried by `compile` as `arrivals` in the scenario body), the persona's `arrivalPulse` (6 s a pulse), else a natural trickle of 1 to 3 s after the previous one. The earliest is always at once. The engine has `deferAgent`/`admitAgent`, so someone who has not walked in is never consulted. `on cue` is treated as the natural trickle.

## 4. Player memory (D21, D47)

Rows are `scenario_player_memory`, read and written through the hotel's internal API. The sidecar asks for the people in the run's rooms at start and for anyone who walks in or speaks later, seeds the characters with a relationship memory and up to three quoted notes (the account id never reaches a prompt; what a person said is sanitized and framed as "that is only what was said"), notes lines they heard and the outcome of pair acts on them (D31: accept and timeout warm, dodge and push cool), writes changed rows back every 2 minutes and when the run ends, and stops writing for a person after `wipe_memory`.

What the sidecar relies on:

| Call | Shape |
|---|---|
| `GET /internal/v1/scenario-versions/{id}` | the answer names its scenario: `{id, scenario, body, ...}` (`scenario_id` also read). Without it memory stays off for the run and the sidecar logs why |
| `GET /internal/v1/memory?scenario=&users=1,2` | `{rows: [{user_id, character, body, updated_at}]}` (a bare array also read); `body` is a JSON string or an object |
| `PUT /internal/v1/memory/{scenario}/{user}/{character}` | request `{"body": {...}}`, at most 4 KiB (the sidecar stops at 3.8 KiB); `422 memory_full` is dropped, not retried; other failures keep the row for the next pass |
| `pm_command wipe_memory` | `args` is `<scenario id> <user id or all>`; the hotel deletes the rows first, the sidecar drops its cache and removes the seeded memories |

`character` is the scenario's agent id (`person-1`), `user` the account id (`h:<id>` on the wire, positive only). The body is `{v:1, name, facts[], relationship{warmth, familiarity}, last_interaction{at, run, summary}, notes[]}`.

## 5. Replay (D39)

`:pm replay <recorded> [default|cinematic] [2x]`. The hotel makes a new run row R' for the target room (a normal lease, the mode it wants shown) and sends `pm_command{run: R', room, cmd: "replay", args: "<recorded> <default|cinematic>"}`; it may send `run_start` for R' first, in which case the sidecar claims that start for the replay instead of building a live run (it yields one tick before validating, so the command already on the wire wins). R' needs a lease within 3 s (`lease` frame or `run_start`).

The sidecar reads `runs/<recorded>/` on the shared volume (`replay.json`, `body-frames.json`, `director-track.jsonl`, `events.jsonl`; the manifest now also carries `mode`, `home` and `actors`), spawns fresh actors under R' just before each one first acts, and re-sends the recorded `actor_cmd`s (moves, faces, gestures, lines, thoughts, pair acts, door trips) on their original timing, with no model: `run_status` shows 0 calls. Coordinates, seats and tiles are retargeted when the target room is not the recorded home. A cinematic replay also re-emits the director track's cues and cuts (rewritten for the new avatars and rooms, on R''s lease), so the audience sees the same film; asked for a default recording, it plays the world and says so. It ends with `run_end{completed}` after walking everyone out; pause, resume, stop, the idle pause and the hotel's `run_end` work as for a live run. A live run that ends pushes `replay_ready` to its admin.

The hotel owes: the lease for R'; creating R' with the mode it wants shown (the audience conversion is the hotel's); not pruning `runs/<recorded>/` before the run row (D48); strings for the notice codes `replay_started`, `replay_busy`, `replay_bad_args`, `replay_not_found`, `replay_corrupt`, `lease_missing`, `run_limit`, `wipe_memory_none` and `arrival_failed`. A refused replay ends R' with `run_end{failed}` (or `run_ack{ok:false}` when a `run_start` was sent). The frame log keeps the last 20,000 frames, so a very long run replays from its tail; the events are the fallback for the lines.
