# Human-likeness: how the cast moves and reacts like people in a room

Cinematic revamp, agent B5. The owner's request: "the interactions need to be a little bit closer to real human interactions. not totally, but more close." This is the layer that makes the actors stand, look, type, gesture and react like people in a room, while staying a stylized Habbo scene. It builds on the body in [`embodiment.md`](embodiment.md) (planner, executor, earshot) and does not replace any of it.

## The dial

`human_likeness`, 0 to 1. **0 is the body as it was**: no rule in `packages/hotel/src/embodiment/human/` runs and a test pins it (the planner's commands, the sim's frames and the gateway's timing are identical). **1** is every behaviour at full strength. **The default is 0.6.**

Resolution order, in `resolveHumanLikeness`: the scene's value (a `human_likeness` key on the scenario body, read when present), then `PERFECTMAN_HUMAN_LIKENESS`, then 0.6. Every behaviour either mixes a number between its old value and its human value (`mix`) or scales the chance of a visible event (`chance`), so the dial moves all of them together.

Every number is in one table, `HT` in `human/tuning.ts`, and every group of numbers has a source line in `HT_SOURCES`: **prior** (literature or judgement, not measured here), **corpus** (read off the cinema-norms from agent E1) or **runs** (measured on runs 55-63). A test checks that no number is left without a source. Today the corpus rows are the dash-cut rate and the walks per minute; everything else is a prior and says so.

## What changed, and how strongly at 0.6

| Area | Behaviour | At 0.6 | Where |
|---|---|---|---|
| Proxemics | Conversation distance by relation and emotion (Hall's bands in tiles: intimate 1, warm 2, neutral 3, cool 4, face-off 2, fear 4); never farther than earshot (5) while talking; never on one tile; a step back after a shove; a ring, not a line, for a group of three; room made for the one holding the floor; a walk up before a first line to someone across the room | window [2 to 5] tiles for a neutral pair (old: 1 to 6); at most one human walk per 23 s per actor, never the reverse of the last move inside 30 s | `human/proxemics.ts`, `human/rules.ts`, `HumanBody.approach` |
| Gaze | Face the addressee or the speaker after a human lag; look away on an authored lie, on shame, or when stung; hold eye contact through a row; glance at a third party being discussed and at a prop that matters (the envelope, the safe); glance away while listening to a long line, and back | speaker faces addressee 80%, a look away in about half the cases that call for one (0.8 x 0.6), break-and-return 3% of lines | `human/reactions.ts` |
| Turn-taking | The typing bubble grows with the line (jitter, an occasional hesitation); a pause by feeling before the next speaker types (heated fast, ashamed slow); the next speaker types while the line before is still on screen; a heated line is talked over and trails off in an em-dash | bubble median 1.4 s (was a constant 0.5 s in a film), 2% of lines cut by a dash (corpus: 2-4%) | `human/turn.ts`, `director/cine/planner.ts` (`line`, `talkOver`), `gateway/hotel-gateway.ts` for a live room |
| Backchannel | A silent answer to a heard line instead of a text filler: a smile-nod, a head tilt (one sector off and back), a raised brow at a reveal, a head-shake. **No text filler is ever sent** (a test checks no `chat` command comes out of a reaction) | 34% of heard lines | `human/reactions.ts` |
| Gesture and face | Emphasis gesture on stressed lines (assert: thumbs; wave-off on hostile lines; the exclamation sign on the heated, at most one per 45 s); the face follows the feeling and decays back to neutral; laughter at laughter; witnesses of a reveal freeze with a surprised face, then look to the accused | 17% of lines carry a gesture, faces held 1.8 to 8 s | `human/reactions.ts`, `HumanBody` |
| Idle life | Sit when tired or beaten, walk to the window, rail or door when avoiding someone, pace when anxious (at most 3 legs a minute), a small step now and then while standing, a stand/sit shift on a human pace, step out of the room after a humiliation and come back | 0.7 walks and 4.9 idle motions per actor-minute (was 0.07 and 0.9 in the sim) | `human/rules.ts` |

## How it runs

- **The planner.** `plan()` calls `humanRules` after the emotion rules when `PlanInput.human` is present with h > 0. The old approach and withdraw rules (3 and 4) stand down for the conversation-distance window. At most one walk comes out of a call. Every walk has a plan id starting `hl:`, so nothing here overrides a walk the model, the director or a beat started, and an arrival of an `hl:` walk does not wake the model.
- **A line lands.** `HumanBody.onLine` reads the line (length, stress, laughter, the hostility lexicon, who it names) and schedules the reactions of everyone in the room as timers on the run's clock (`reactToLine`, pure). Each one is checked again when it fires: dead, held by an act, walking, no view, the target gone, and the human layer's own budget of 3 commands per actor per 5 s (the planner has 4 and the hotel 8) all drop it, logged as `skipped:<why>`. In a cinematic run this happens when the film plays the line (`CinematicDirector.onLine`), not when it leaves the gateway.
- **Turn-taking.** In a live room the gateway owns it (`GatewayHuman`). In a film the planner owns it, because the film serializes speech: the bubble lead before a line is `cineLead`, the next speaker's bubble starts inside the line before (`pretyped`), and a heated line is cut at the last moment by `ShotPlanner.talkOver`, when the answer is queued, which shortens that line's program so the answer lands on top of it. The full text stays in the events and the narrator; the room sees the cut one.
- **Never in the way.** `drama.lock` or an act's busy flag returns no commands at all (REA-9). A hold (`PlanInput.human.hold`: an act lock today, a beat sheet's blocking beat once B1 is merged) silences every movement rule but the unstacking. Sheet blocking beats go through the beat player and the director, not through this layer, so they win.
- **Deterministic.** Every chance is a hash of the seed, the actor, the rule and the line number (`hrand`), not a shared stream, so a scene replays the same and two rules never shift each other's draws.
- **Logged.** `body-log.jsonl` beside `events.jsonl` (registered as `body_log` in `replay.json`; off with `PERFECTMAN_BODY_LOG=0`, absent at h = 0): one line per decision, `{t_ms, actor, kind, rule, line?, to?, tile?, ms?, detail?, skipped?}`, with rules such as `avert:lie`, `approach:cool`, `backchannel:tilt`, `witness:look_to_accused`, `interrupt:cut`, `typing`.
- **The suite.** The hotel package's tests run with `PERFECTMAN_HUMAN_LIKENESS=0` (its vitest config), because they pin the body as it was; the human layer has its own tests.

## Measuring it

`pnpm --filter @perfectman/eval humanlike --run <dir> [--json]` reads a run folder (`frames.jsonl`, `body-frames.json`, `replay.json`) and prints: the distance at each line against the bands, stacking events (same tile for a second or more), gaze to the addressee (speaker, listener, mutual, break-and-return), reaction latency to the first key and line to line, overlap and dash-cut rate, typing against line length, gestures per line, non-verbal backchannel, idle motion, frozen windows, walks per actor-minute, and back-and-forth walks. A 0-100 score comes from the bands in `humanlike/score.ts` (each one marked prior, corpus or runs); the five group scores (proxemics, gaze, turns, gesture, idle) say why it moved. The cinematic score's embodiment group can take `score` as it is.

- Baseline on runs 55-63: [`eval/humanlike-baseline.md`](eval/humanlike-baseline.md), [`.json`](eval/humanlike-baseline.json). Scores 29 to 66; run 63 is 62.
- Offline preview: [`eval/humanlike-preview.md`](eval/humanlike-preview.md): run 63's cast and script on the Terraço, three arms (0, 0.6, 1), the real planner, the real shot planner and the fake grid hotel (`node packages/eval/dist/humanlike/preview.js <dir>`, then `python3 -I packages/eval/scripts/render-humanlike.py <dir>` for the contact sheets).

## What it needs from the client and the hotel

None of this needed a wire change: gaze is `face` (a tile or a direction), faces are `expression`, gestures are the existing `wave`, `thumbs`, `laugh`, `sign`. What would make it better:

- A **nod**, a **head tilt**, a **shrug** and a **point** as short actions (a second or less). Today a nod is a half-smile, a tilt is a one-sector turn and back, a head-shake is the same turn, and an emphasis is a 2 to 5 s arm gesture.
- A `face` that turns **the head only**, so a glance away does not turn the whole body.
- `typing` with a **length hint** so the client can animate the bubble.
- A `human_likeness` key on the scenario body (B1 owns the schema); until then the scene value is read loosely and the environment sets it.
- The beat sheet's blocking beats should set `PlanInput.human.hold` for the actor they move (today only an act lock does).

## Honest gaps

- Every band is a prior except two. The numbers need calibration against clips the owner has graded.
- Lies are only known when authored (a beat sheet note or reveal); there is no lie detector. Shame and being stung (the hostility lexicon) are read from state.
- The preview sim has no model: the cast speaks run 63's script and nothing else, so its h = 0 arm moves less than the real run did (the real model walked the actors around). The sim stands in for the engine's chat-driven mood update with a small appraisal (`appraise`): a hostile line heats whoever it is for. Real runs will differ.
- In a cinematic run the typing lead adds about 1 s per line to the film unless the next line is already queued (then it overlaps the line before). The dial trades pace for naturalness.
- Approach-then-speak is wired for a film through `beforeLine` but not exercised in a live run; the walk goes straight to the hotel, outside the film.
