---
name: perfectman-scene-runtime
description: "Run a drama scene in Habbo through perfectman: read a scenario and its plan.json, track each character's tactic and status beat by beat, choose only the 18 drama verbs, and treat blocked or declined acts as story. Use whenever you are directing, steering, replaying or reviewing a live perfectman scene, writing or reviewing the in-prompt drama hint, or judging whether a scene's tactic, status and physical beats hold together. Not for drafting new characters or scenarios (use perfectman-cast-and-scenario-drafting)."
---

# Perfectman scene runtime

How to run a scene that perfectman plays in a Habbo room: who wants what, who is above whom, which verb fits the beat, and what to do when the hotel says no.

Two audiences:

- **You, the operator or director** (an agent or a person reading a run, steering it, or judging it): this file.
- **The characters' own prompts**: `digest.en.md` and `digest.pt-BR.md` next to this file. They are short, in-world text that the drama hint injects when drama is on (`digest-compact.*.md` is the shorter one for the compact prompt). `digest-notes.md` says how the files and the code are kept equal.

Sources of truth, in order: `docs/drama/act-contract.md` (frozen, rev 2), `docs/drama/verb-bible.md`, `packages/hotel/schema/verb-vocab.json` (rev 3, sha-pinned), `docs/drama/judge.md`. This skill summarises them. If it disagrees, they win.

## Inputs

1. `<scene>.scenario.md`: cast, `drama:` block, scripted `beats:`, hidden objectives.
2. `plan.json` next to it (optional): per character a status, a goal, an obstacle and a start zone; per beat a tactic, an emotion, a status transaction and a delivery. Schema: `perfectman-cast-and-scenario-drafting/references/plan.schema.json`. No plan: derive the same four things from hidden objectives and priorEvents, and say so.
3. The live frames of the run: outcomes, `blocked` reasons, who is where.

## The beat loop

A beat is a stretch where a character keeps one tactic toward one person. It ends when the tactic succeeds, fails, or new information arrives. Then the verb of action changes.

For each beat, in order:

1. **Goal.** What does this character want from that person right now? (Stanislavski: goal, obstacle, tactic, expectation.)
2. **Tactic.** One active infinitive aimed at a person: to intimidate, to plead, to disarm, to dismiss. Never an emotion ("to be angry") and never a result ("to win").
3. **Status move.** Raise, lower, maintain or collapse? Does it change who is high with this person?
4. **Words, then body.** The line goes in the chat as usual: the words always count. The body (a move, a posture, a gesture, an expression, or an act) carries what the words cannot, and sometimes moves first when the feeling is too big to wait.
5. **Verb, only if the body must act.** Pick the lowest step of the family that carries the feeling (below). If the feeling fits a gesture or a look, use that instead of a verb.
6. **Read the outcome.** `landed`, `dodged`, `blocked`, `declined`, `timeout`, `aborted` (below). The next beat starts from what happened, not from what you planned.

Silence is a valid beat. A person who has nothing to do with the tactic right now says and does nothing.

## Picking the verb

| Feeling | Verbs | Rule |
|---|---|---|
| Anger, contempt, jealousy | `glare` (1), `insult` (2), `shove` (3), `slap` (4), `punch` (5), `kill` (6) | One rung per beat toward the same person. A scene may open at 2. Coming down is always fine. |
| Fear, shock | `recoil`, `freeze_gasp` | No target. For the person it happens to or in front of. |
| Love, relief, making up | `hug`, `kiss` | Target required. Both still, within one tile. |
| Shame, grief, being done | `turn_back` (aimed), `cry`, `storm_off` | `cry` and `storm_off` take no target. |
| After something big | `tableau`, `faint`, `die`, `restrain`, `tend_fallen` | `faint` and `die` are your own body going down. `restrain` pulls an actor back. `tend_fallen` kneels by someone down and only hurries a `faint`: a body stays until a scene cut. |

Constants: a physical beat (`shove`, `slap`, `punch`, `kill`) is at least 20 s after the last one in the scene. One `kill` per scene. The same verb on the same person has a 60 s cooldown. An actor cannot target themself. Chat is at most 200 characters.

Violence is stylized telenovela: a slap is a hand across the face and a gasp, a death is a swoon and a fall. No blood, no weapons, never use a verb on someone lying on the floor except `tend_fallen`.

## Gates and the scenario's block

| Verb | Needs |
|---|---|
| `glare`, `insult`, `shove` | `max_rung` at least the rung (free play counts as 3). With a block, `max_rung: 0` forbids even `glare` |
| `slap`, `punch` | `drama.max_rung` at least the rung, and `[aggressor, victim]` in `may_target` |
| `kill` | `max_rung: 6`, the pair in `may_target`, the victim in `may_die` |
| `die` | The person in `may_die` |
| `hug`, `kiss`, `tend_fallen`, the solo verbs | Nothing |

A scene with no `drama:` block is free play: no slap, punch, kill or die. A scripted beat with `skip: true` jumps the ladder, but only with a block whose `max_rung` is high enough. A scenario that can kill must have a scene cut. A cut resets every pair's rung, the 20 s spacing, the kill count, open chips, acts in flight and bodies, so a scripted ladder beat after a cut needs its own skip. It does not move anyone or the camera.

An unscripted slap, punch or kill is refused when nobody else is within 6 tiles of the two. Scripted beats are exempt. In a duet, the peak is scripted.

This skill never targets a human visitor with a physical verb, never writes `@human`, and never asks the hotel to loosen a gate. A visitor's consent chip (take, dodge, push back, timeout) belongs to them.

## Outcomes are story

| Outcome or reason | What it means | What you do |
|---|---|---|
| `landed` | The beat happened | Read the target's and the witnesses' reactions. Status moved. Start the next beat from there. |
| `dodged`, `declined`, `timeout` | Only a human visitor's chip produces these. Between actors an act always `landed`. A `hug` that times out still completes with the initiator's steps | If you read one in a log, the tactic failed: change the tactic, not the volume. This skill never aims a physical beat at a visitor. |
| `blocked: ladder` | Skipped a rung | Climb one rung first, or the scenario needs an authored skip. |
| `blocked: ladder` (`zero_witness`) | An unscripted rung 4+ with nobody else within 6 tiles | Add a third person nearby, or script the beat. |
| `blocked: budget` | 20 s spacing, or the kill is spent | Wait it out or switch to words. Never retry in a loop. |
| `blocked: cooldown` | Same verb on the same person under 60 s | Change the verb or the target. |
| `blocked: too_far` | Out of range (glare 8 tiles, insult 6, contact 1), someone is walking, or a contact target is lying down | `move: approach` first and wait until both are still, then the verb. A person lying down cannot be touched. |
| `blocked: dead_target` | They are down | Move on. A body stays until a scene cut. |
| `blocked: no_scenario_gate` | The block does not allow it | Drop to a lower verb. Do not edit the scenario mid-run. |
| `blocked: calm_room`, `kill_switch`, `consent_off`, `rate_limit` | The hotel stopped it | Stop pushing. Carry the beat in words and posture. |
| `aborted` | Someone moved, left, a cut or the run ended | The beat did not happen. Resume from where people stand now. |

A `blocked` beat is not an error to fix. It is the scene saying no, and the next line should show that.

## Staged beats

When a plan beat has `act: null` and a `staged_as` block, the story wants something no verb renders. Steer it with the body block the actors already have: `move`, `posture`, `gesture`, `expression`, `face`. A scenario can script only verbs and cuts. Never invent a verb id. `ideal_action` is for humans and later engine work, and is never played. Recipes: `perfectman-cast-and-scenario-drafting/references/tag-to-verb.md`.

## Dense casts

From five characters:

- Each beat has a triangle: the one who acts, the one acted on, and one who watches and whose status or fear changes.
- Every second beat, someone in the background reacts (`recoil`, `freeze_gasp`, a step back, a look). A chorus never speaks twice in a row.
- No more than three people in the central zones. See `references/status-and-space.md`.
- Two people at most hold rung 3 or above toward anyone at the same time.

## Language

Authored lines follow the scenario's language. Keep verb ids, outcome names and JSON keys in English in anything you write for a machine. Never tell a character it is a character, an actor, or in a drama: the hotel's hint teaches the `act` key in the character's own terms, and the digests do the same.

## Checks when judging a run

1. Every beat had a tactic. Name it, aimed at a person.
2. Someone changed status at least once. If not, the scene did not happen.
3. Violence climbed one rung at a time, or an authored skip says why.
4. Every unscripted physical beat came after words between those two people. Scripted beats fire on the clock and are exempt.
5. A `blocked`, `dodged` or `declined` act changed the next beat.
6. A death has a cut after it and a reaction from every witness.
7. Nothing in the lines tells the reader what it is, mentions an id, or says violence "needs permission".
8. No second `kill`, no physical beat inside 20 s of another.

The drama judge (`docs/drama/judge.md`, 6 axes scored 1 to 5, failure codes D1 to D7) must not be an actor model, and is not calibrated yet. Use it as a second opinion, not as proof.
