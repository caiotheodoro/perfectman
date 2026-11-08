# Verb bible v0: physical drama for AI actors

Status: **draft v0 for the owner cut.** Docs only. No code, no schema change and no wire change ships with this file. Everything the owner has already settled is listed in section 1.2 and is not reopened here. Everything this document recommends but the owner has not settled is a numbered open question in section 7.

Anchors checked for this draft: perfectman branch `feat/spite-hold-spot-from-server` at `10cbce1`; hotel repo `general/habbo` at `61b3d3c` (read-only, working tree had unrelated local edits that I did not touch).

## 1. Purpose and how to read

### 1.1 Purpose

Our actors can talk, face a speaker, sit, smile, wave and, when a goal text names it, kiss or hug. They cannot show a feeling with their bodies. The evidence is in section 2 and in research report 07: 12 of 15 social emotions and all 15 action tendencies are never read by the embodiment planner, `angry` and `sad` expressions were sent 0 times across 10 recorded runs, and a run with 1 gesture and 0 expressions scored 5/4/5/5/5/5 from the judge.

This document is the contract for fixing that on the **body channel**. It defines:

- a vocabulary of verbs (what an actor can physically do to a person, to a room, or alone);
- for each verb, how it is gated, how long each beat lasts, which existing primitives render it, and what is missing;
- an escalation ladder and a witness/reaction contract in terms a probe or a judge can test;
- a recommended first cut (section 8) and the questions only the owner can answer (section 7).

The tone is stylized telenovela and slapstick. No blood, no gore, no wounds.

### 1.2 Settled decisions this document honors

These are inputs, not proposals.

| # | Decision |
|---|---|
| S1 | Register: stylized telenovela and slapstick. No blood or gore. |
| S2 | Actors may act on actors and on humans. |
| S3 | Humans: a per-session drama opt-in (default **off**) gates every violent verb that targets them. Then a **4 s chip** (Take it / Dodge / Push back). Timeout = Dodge. |
| S4 | Affection verbs on a human need only the chip (no opt-in). |
| S5 | Death: the victim falls, lies with a death effect and stays a body until the scene cuts. The victim leaves the speaker pool. The death is written to memory. Scenarios mark who may die. An optional thought-only ghost voice exists in cinematic mode. A killed human regains control after a few seconds. |
| S6 | Rendering order: (a) compose from existing primitives (effects, postures, sounds, camera, forced steps, timing); (b) procedural client motion (lunge, knockback, shake, fall to lying, recoil); (c) new sprites only for 2 to 3 signature moves, later. |
| S7 | Escalation ladder: glare, insult, shove, slap, punch, kill. One rung per beat. Budget: at most one physical beat per 20 s and one kill per scene. Scenarios may author skips. |
| S8 | Mandatory reactions: the target within 1.5 s, witnesses within earshot within 3 s. |
| S9 | All choreography runs on the hotel server from a data table keyed by verb, entered through `ActorCmd::Act { verb, with?, intensity, act_id }`. |

`ActorCmd::Act` does not exist yet. I checked the current `ActorCmd` enum in `crates/sim/src/director.rs` (hotel repo): `Walk, Sit, Chat, Action, Expression, Face, MoveRoom, Typing, Pair, Appearance, Carry`. `Carry` is reserved and the hotel answers `bad_message` (decision D33).

### 1.3 How to read this document

- **Tags.** `[F]` = a fact from a cited source or a fact I verified in code or assets. `[I]` = inference (mine, or the research author's, flagged as such in the source). `[U]` = unverified, flag inherited from research or raised by me. `[M]` = the research author recalled it from memory and did not re-verify it in session. Tags on a number mean the number carries that status.
- **Sources.** The seven research reports are cited as `[R01]` to `[R07]`. They live outside this repository, in the author's research workspace, so I cite them as code paths and not as links (the docs lint, check L1, fails on a relative link to a file outside the repo).

| Tag | Report |
|---|---|
| `[R01]` | `research/01-habbo-rp-culture.md` |
| `[R02]` | `research/02-telenovela-melodrama.md` |
| `[R03]` | `research/03-social-sim-drama-systems.md` |
| `[R04]` | `research/04-stage-combat-slapstick.md` |
| `[R05]` | `research/05-animation-readability.md` |
| `[R06]` | `research/06-body-language-science.md` |
| `[R07]` | `research/07-own-failure-history.md` |

- **Timings.** Beat columns are `A` anticipation, `C` contact (t = 0), `H` hit-stop, `R` reaction, `Rec` recovery, all in ms. No source gives a stopwatch number for a stage slap, faint or kiss `[R04]` `[R02]`. Where I write a number without `[F]`, it is a starting value to tune by playback, stored as data, not a finding.
- **Legibility risk** is 1 to 5 where **5 = very likely unreadable**. (Report 01 scores legibility the other way round, 5 = best. I flip it so a high number is a warning.)
- **Real names.** Field names come from `packages/shared/src/emotion/emotion.types.ts`, `packages/shared/src/space/body-intent.schema.ts` and `packages/hotel/src/embodiment/plan.ts`. Wire names come from `crates/sim/src/actions.rs`, `director.rs` and `perfectman.rs` (hotel repo). Effect ids are the `fx<N>` in the asset file names under `web/assets/habbo/effects/`.

### 1.4 Verified engine reality (what we can compose from today)

| Primitive | Real name and limits | Source |
|---|---|---|
| Turn to a target | `ActorCmd::Face { dir? \| target? \| tile? }`. `Action::Turn` is refused while walking or lying. A seated avatar turns only to even directions (sit art has 4 facings). A lying avatar has 2 facings (+x or +y). | `room.rs` `Room::act` `[F]` |
| Expression | `ActorCmd::Expression { face }` with `Face` = `neutral, smile, angry, sad, surprised, sleepy`. Works in any posture, even walking. TTL `FACE_TTL_MS` = 15 000. Art for angry, sad, surprised exists on only 13 of 183 face libs. Fallback cue: angry = sign 16 (red card), sad = `Raincloud` effect, surprised = sign 13 (exclamation). | `perfectman.rs`, decision R8, `client-wire-and-ui.md` 3.2 `[F]` |
| Gestures | `Action::Wave` 5000 ms, `Blow` 1400, `Laugh` 2000, `Thumbs` 2000, `Sign` 5000 (style 0 to 17). Refused while walking and while lying. `Dance` styles 1 to 4 and `Idle` last until `Stop`. | `actions.rs`, `room.rs` `[F]` |
| Sign styles | 11 = heart (planner `SIGN_HEART`, hug partner), 13 = exclamation, 16 = red card (docs). Styles 12 (skull), 14 and 15, 17 (yellow card) are from general Habbo knowledge and `[R01]` ("heart, skull, !"). | `plan.ts`, `client-wire-and-ui.md` `[F]` for 11, 13, 16; `[U]` for the rest |
| Posture | `Sit { furni? \| floor }`, `Stand`, `Lay`. Lay needs room to lie along x or y, is refused while walking or on a seat. Sit-on-floor is the only kneel/crouch proxy. | `room.rs`, `director.rs` `[F]` |
| Forced step | One-tile `Room::request_walk` to a neighbour: opposite of the attacker-to-target direction, then the two neighbours; none free means nobody moves. Ordinary 300 ms `moves` delta. Used by Dodge and Push. A sitting, lying or dancing human is not moved. No teleport, no multi-tile slide. | `director-protocol.md` section 8 `[F]` |
| Pair act | `PairKind` = `Kiss, Hug` only. Both avatars must be within Chebyshev 1, still. Initiator `blow` at T0, partner `blow` (kiss) or sign 11 (hug) at T0 + 300 ms. Human target: chip `PairPrompt`, ttl 4000 ms, `PairChoice` = `Accept, Dodge, Push`; no answer completes the act (D31). Outcomes to the sidecar: `accept, timeout, dodge, push, aborted, done`. | `director-protocol.md` section 8, `actors.rs` `play_pair` `[F]` |
| Timed sequencing | A hotel-side `later` queue exists (`Later::Gesture`, `PARTNER_DELAY` 300 ms). Only a gesture variant exists today. | `actors.rs:112,1747` `[F]` |
| Effects | `ActorCmd::Appearance { effect }`, restored by the sidecar. Changes `Avatar.effect`, so on a human it would overwrite the effect they chose. | `director.rs`, `camera-and-audio.md` `[F]` |
| Camera | `PerfectmanUi::Camera { shot, target, zoom, ease_ms, hold_ms, follow, in_ms }`. `shot` = `establishing, two_shot, close_up, tracking, reaction, insert, transition`. Rest zoom is discrete (0.5, 1, 2, `fit`). **Cinematic mode only**; in default mode the player owns the camera. Fractional zoom rebuilds the floor surface (perf impact `[U]`). | `perfectman.rs`, `camera-and-audio.md` section 2 `[F]` |
| Sound | `PerfectmanUi::Sfx { cue, at?, gain?, in_ms }`. Canonical cues: `footsteps, door_open, door_close, kiss, hug, laugh, crowd_murmur, sting_tension, sting_romance, sting_comedy, sting_sad, transition_whoosh, ui_tick`. No slap, thud, gasp, sob or short whoosh. Whether `sfx` reaches players in default mode is `[U]` (the doc scopes it to cinematic). | `cue-vocab.json` `[F]` |
| Emotion icon | `PerfectmanUi::Cue { id, emotion, ms }` with 8 icons: `love, joy, sad, angry, surprised, confused, afraid, thinking`. | `cue-vocab.json` `[F]` |
| Other UI | `Caption`, `Thought` (7 s default; hidden in default mode, D30), `CutFx { fade, door, meanwhile }`, `Hud { letterbox, fade }`. | `perfectman.rs` `[F]` |
| Walk speed | Fixed 300 ms per tile. "Tempo" can only be expressed through pauses and stop-start, not speed. | `embodiment.md` 1.1 `[F]` |
| Rate limits | Hotel backstop 8 commands per 5 s per actor (`ACTOR_CMDS_PER_WINDOW`). Planner budget 4 per 5 s (`CMD_BUDGET`). | `director.rs`, `constants.ts` `[F]` |

### 1.5 Effect assets that matter here

Ids come from file names (`<Name>_h_std_fx<N>_...`). "Looked at" means I viewed one frame, not the animation.

| Name | `fx` | Use in this document | Art status |
|---|---|---|---|
| `Love` | 9 | hearts, emotion cue (hotel docs say present) | frame size seen; semantics from name |
| `Raincloud` | 113 | sad cue (seen working per hotel docs, direction-0 art only) | `[F]` per docs |
| `TrippyHalo` | 222 | death signifier candidate (halo) | one frame looked at: a purple halo ring `[F]`; 64 frames, animation not reviewed |
| `Twinkle` | 4 | dizzy stars / "alive" marker candidate | one frame looked at: sparkles `[F]`; meaning is `[I]` |
| `GhostVille` | 681 | ghost candidate | one frame looked at: a dark round blob, unclear `[U]` |
| `Splash` / `SplashEvil` | 28 / 184 | drink-throw hit | one frame looked at: cyan splash blob, 103 x 98 `[F]` |
| `ProtectShield1` | 228 | block reaction | one frame looked at: cyan shield `[F]` |
| `AmongUsDeathRD` (and 8 colours) | 892 | cartoon body marker | one frame looked at: a red cartoon body, no visible blood `[F]` |
| `Headless`, `Headless2` | 93, 133 | what the Habbo emulator kill uses `[R01]` | **not recommended**, reads as gore-adjacent `[I]` |
| `BackKnife` | 89 | same, emulator kill | **not recommended**, same reason `[I]` |
| `Pie` | 104 | slapstick pie | frame 3 of 8 looked unclear; `[U]` |
| `Spotlight` / `GoldSpotlight` | 1 / 137 | pride stage light | 2 files each; `[U]` |
| `StrongArms` | 114 | muscle flex, comic dominance | not viewed `[U]` |

## 2. Evidence summary

At most 25 bullets. Every bullet links back to a report by tag. Where a report flags something unverified, the flag is kept.

### 2.1 What the research says

1. `[F]` `[R01]` Habbo emulator pair verbs are mostly a bubble line plus a status. Hug and kiss send `* Hugs X tightly *` with a HEARTS bubble. Kill forces `lay` and a random effect (community list: 93 "Headless", 89 knife) plus lines. None of the code read asks the target; kill has no distance check or cooldown. I confirmed locally that `Headless` is `fx93` and `BackKnife` is `fx89` in our asset names.
2. `[F]` `[R01]` Unconsented displacement is abused; hotels add per-room kill switches (`:desativar`), cooldowns, energy costs and safe zones. VRChat and Second Life require mutual permission. `[I]` repeatable verbs get spammed.
3. `[F]` `[R01]` Official Habbo bans "roleplaying extreme violence", harassment and sexual roleplay, and its keyword filters over-flag fiction. This is a platform policy of a different service, not our rule, but it argues for stylization.
4. `[I]` `[R01]` On a tiny avatar a verb reads through three channels: posture change, a prop or effect silhouette, or displacement. Face detail does not survive. The best verbs are asymmetric: the reaction is the joke.
5. `[F]` `[R02]` Telenovela physical beats are chains, not single blows. Soraya in *Maria la del Barrio* runs a screaming tirade, shaking, slap, head bash and a stab. Slap lands after an insult or a refusal to retract. In *Celebridade* the sarcastic dialogue before the beating was called "perhaps even better" than the beating. `[I]` ladder R1 insinuation, R2 accusation, R3 threat, R4 explosion, R5 aftermath.
6. `[F]` `[R02]` The beat is not complete until the target and a witness have reacted (melodramatic pause; collective gasp; hard-frozen tableau at act end). `[I]` hold the tableau 2 to 3 s; assign witness roles (shocked, rescuer, gossip, passive); a beat with zero witnesses should be capped. `[U]` staging for door slam, kneel-and-beg, reunion and villain laugh has no source.
7. `[F]` `[R02]` Globo chapters run about 45 min and 34 to 40 scenes; every scene ends on a hook. No source gives a stopwatch number for a physical beat; all per-rung durations are `[I]`.
8. `[F]` `[R03]` The Sims split socials into friendly, funny, romantic, mean and fight, unlocked by relationship; autonomous fights need a very negative relationship; the fight is a smoke cloud and the loser is "dazed". The mod *Deeper Social Autonomy* exists because vanilla autonomy produced unmotivated violence.
9. `[F]` `[R03]` Comme il Faut and Prom Week: initiator volition is a weighted sum, the responder accepts or rejects, events are stored with a tone label and queried later (grievance memory). Versu: a norm violation spawns a response practice (disapprove, forgive, get angry, evict). Left 4 Dead: Sustain Peak 3 to 5 s, Relax 30 to 45 s.
10. `[F]` `[R03]` Dwarf Fortress shows a tantrum spiral (runaway contagion) and Crusader Kings 3 makes murder a slow, risky scheme. `[I]` the numeric budgets in `[R03]` (cooldown 5 to 10 sim-minutes, kill 1 to 3 per session) are unsourced starting values. No source gives a violence-frequency target. `[U]`
11. `[F]` `[R04]` Stage slap: the sound lands at apparent contact, the reaction comes after the sound, the victim controls the action and its safety, the hit body part moves first, and reaction size matches attack size. `[U]` no published ms for stage slap, faint or kiss; all stage ms are `[I]`.
12. `[F]` `[R04]` A faint reads better when the character fights it. Melodramatic death is two beats: realization and the final exhale; over-explicit death draws laughs. Pixel death holds the final pose 200 to 300 ms.
13. `[F]` `[R04]` Comic, fantastical, consequence-free violence is rated less serious; the same authors warn that never showing consequences normalizes it. `[I]` no blood, no wounds; stars, halo or ghost as the death signifier; the aggressor is never rewarded after a death-level hit.
14. `[F]` `[R05]` Hit-stop: Street Fighter 6 about 9/11/13 frames (150/183/217 ms); Celeste 3/6/9 frames (50/100/150 ms); indie guides 2 to 10 frames. Freeze both parties, keep effects running. First reaction frame extreme with zero blend; knockback is a decaying slide, not a teleport. `[I]` 50 to 150 ms for us.
15. `[F]` `[R05]` Knockdown and death must be different states; a fall to `lay` needs an alive marker (`[I]`). Reaction shot 1 to 3 s quick, 4 to 8 s major (film convention). Crash zoom 0.07 / 0.2 / 0.07 s comes from a single repo; shake is trauma squared. Perceptual minimum 120 to 240 ms is a 1970 paper `[F]` applied by `[I]`.
16. `[F]` `[R06]` At peak intensity the face alone is near chance for valence and the body discriminates; mismatched body and face flip perception (Aviezer 2012; Meeren 2005). Face is a disambiguator, not the carrier. Posture recognition varies by emotion and viewing angle (Coulson 2004); disgust and surprise are the least body-recognisable.
17. `[F]` `[R06]` Activation (arousal) explains much of the body difference (Wallbott 1998); most emotions have several body patterns (Dael 2012), so vary, do not hard-code; exaggeration helps except for sadness (Atkinson 2004).
18. `[F]` `[R06]` Touch carries emotion (Hertenstein 2006; sympathy touch about 7.6 s). `[I]` no source for hug norms, "turning your back", or a jealousy display. Hall's proxemic zones are US norms; make them per-character.
19. `[F]` `[R07]` `plan.ts` reads 3 of 15 social emotions (`shame`, `affection`, `socialAnxiety`), 2 of 8 core mood fields directly, 5 of 16 non-key relational fields, and **0 of 15** action tendencies (they are not even in `AgentState`).
20. `[F]` `[R07]` Ten recorded runs: gestures were `wave` 80, `thumbs` 53, `laugh` 38, `blow` 3; expressions `smile` 51, `neutral` 8, `surprised` 6, `angry` 0, `sad` 0. Listener body reaction within 6 s to a line: 16 to 25 %. Longest per-actor stretch with no body command: 546 s. All counts are commands sent, not renders.
21. `[F]` `[R07]` Gates reward stillness: the scene gate's "Places" binary requires people to be at the same spot at 8 s and 110 s; the human rubric anchor 3 contains "occasional odd stand-and-stare"; run 10 had 1 gesture and 0 expressions and the judge scored 5/4/5/5/5/5.
22. `[I]` `[R07]` The judge may be blind to body events: re-rendered transcripts had 0 walk, sit or gesture lines because `frames.jsonl` lines were rejected as "no kind or t". `[U]` flagged by the author as needing confirmation against the deployed build.
23. `[F]` `[R07]` Structural ceilings in the planner: gesture cooldown 15 s per kind and 30 s for a repeat; anti-jitter forbids a reversal inside 30 s (so no pacing); a facing lock of 7 s (human) and 20 s (interlocutor) overrides looking away; withdrawal (rule 4) suppresses approach, so a hot relationship has no confrontational option. I re-read `plan.ts` and `constants.ts` and confirm each.
24. `[F]` `[R07]` Big physical beats so far came from authored goal text (kiss, room trip) or admin whispers; the 13B models "never choose to leave a room"; only 2 pair acts per run, both scripted.
25. `[I]` `[R01]` `[R03]` Make consent data, not UI: a per-character accept list, motive gating on emotion plus a recorded grievance, per-verb repeat penalty, a room-level calm switch, and a replay log of every verb.

### 2.2 Explicit conflicts between sources and how I resolved them

Settled decisions (section 1.2) win over any source. Where two sources disagree and nothing is settled, the resolution is stated, with a reason, and the value is stored as tunable data.

| # | Conflict | Resolution and reason |
|---|---|---|
| X1 | **Hit-stop 10 to 20 ms** (Vlambeer blog, `[R05]`) vs **100 to 200 ms** (other blog; neither confirmed in the talk) vs **50/100/150 ms** (Celeste, a primary wiki) vs **150 to 217 ms** (SF6). | Use three classes: **L 50 ms, M 100 ms, H 150 ms**, plus a finisher at 150 to 200 ms for `kill` only. Reasons: Celeste is the only source with a stated table; 10 to 20 ms is below the 120 to 240 ms perceptual floor of `[R05]` (dated, but the only number we have) and below one 120 ms overlay frame; our figures have no hitbox timing to protect. Values are data (`hold_ms`), tuned by the ablation test in section 6. |
| X2 | **Habbo emulator kill: no consent, no distance check, no cooldown** `[R01]` vs **S3/S7: opt-in plus chip for humans, ladder, budget, mortality list**. | Settled decisions win. We take only the emulator's good parts: the asymmetric killer/victim lines, the `lay` plus effect read, and the `* action *` caption fallback. We drop its permission model. |
| X3 | **Wind-up length.** `[R04]` slap 250 to 400 ms; `[R05]` 80 to 120 ms (4 to 6 px pull-back) for a hit, with the remark that player-initiated acts get 0 to 50 ms and observed acts 150 to 400 ms. | Our acts are **observed** (spectators, a human with a chip). Anticipation is **300 ms** for slap and punch (shove 250), containing a 100 ms pull-back. For a human target the attacker holds the threat pose while the 4 s chip is open (this is also the RP norm "attempts to hit" before "hits", `[R01]`). |
| X4 | **Reaction timing.** `[R04]` "reaction after the sound, never on the swing" vs the stage teaching of a simultaneous knap and reaction vs `[R05]` "freeze both, then pop to the extreme pose". | Sound and visual contact at t = 0. Both freeze for `H`. The victim's extreme pose starts when hit-stop ends, never before contact. Reaction deadline (S8) is measured from `C`, so it includes `H`. |
| X5 | **Visual leads sound by 1 to 2 frames** (`[R05]`, one aggregator, unverified) vs **sound at the exact instant of contact** (`[R04]`, stage fact). | Default `sfx_offset_ms = 0`. The field exists so a playtest can try -33 ms. The lead is `[U]` and not adopted. |
| X6 | **Camera punch-in 0.07 / 0.2 / 0.07 s** (`[R05]`, one repo) vs **our camera spec**: discrete rest zoom, fractional zoom only while easing (perf `[U]`), user controls disabled only in cinematic. | For v1 use a **hard cut** (`ease_ms` 0) to zoom 2 on the contact, hold 600 to 1500 ms, then a `reaction` shot. No fractional kick. Reason: avoids the surface-rebuild risk. A real punch-in is deferred to (b)/(c). In default mode there is no directed camera, so legibility there must come from overlays and captions. |
| X7 | **Kill budget.** `[R03]` (inference) kill 1 to 3 per session and violence cooldown 5 to 10 sim-minutes vs **S7: one physical beat per 20 s and one kill per scene.** | S7 wins as the hard rule. The `[R03]` numbers stay only as open question Q5 (extra per-pair repeat penalty), not as a rule. |
| X8 | **"Do not skip rungs"** (`[R02]`: Celebridade) vs **S7: scenarios may author skips.** | Both hold at different layers. Autonomous escalation is one rung per beat (testable, section 5). A skip is legal only when the scenario authors it, and it is logged (`skipped_rungs`) so the judge and probes can tell authored drama from drift. |
| X9 | **Cap lethality, downed plus revive** (`[R01]` rec 6; `[R01]` RP hotels) vs **S5: death is a body until the scene cuts.** | S5 wins. The revive loop is not adopted. What we keep from `[R01]` and `[R04]`: a clear alive/dead signifier and a reversible final pose (next scene restores the actor, Q8). |
| X10 | **Hug hold.** `[R04]` 800 to 1500 ms (inference) vs `[R06]` "adjacent, 3 s or more" (inference; `[R06]` found no peer-reviewed hug norm) vs the shipped pair act (two blows 300 ms apart, no hold). | No evidence resolves it. v1 default **hold 1500 ms**, up to 3000 ms in cinematic, stored as data. Test by playback. |
| X11 | **Face as carrier.** `[R06]`: face is weak, body first. Our art: angry, sad, surprised faces on only 13 of 183 libs (`[R07]`, decision R8). | Body and displacement carry every verb. The `Expression` is always paired with a cue (sign or effect or icon) and is never the only signal. |
| X12 | **Tempo.** `[R06]` maps emotions to speed ("fast, sudden"). Walk speed is fixed at 300 ms per tile. | Tempo is expressed by stop-start, hold lengths, direct vs wandering paths and (b) procedural motion. We do not ask for variable walk speed. |
| X13 | **Pacing.** `[R06]` prescribes pacing for jealousy and anger. The planner forbids reversal within 30 s (`allowedMove`) and the `jitter-index` probe (<= 2 per minute) counts reversals as jitter (`[R07]`). | Server-authored acts carry a `purposeful` flag that the planner lock and the probe both honor. Until that exists, `pace` stays `could` (section 3). |
| X14 | **Internal count in `[R07]`.** The thesis says "12 of 14 relationship fields"; section 3.2 says "12 of 17". | I recounted from `emotion.types.ts`: `RelationalState` has 16 non-key fields; `plan.ts` reads 5 (`attraction`, `comfort`, `threat`, `desireForCloseness`, `desireForDistance`), so **11 are never read**. I use 11 of 16. |
| X15 | **Witness cap.** `[R02]` (inference): cap a beat with zero witnesses at R3. Not in the settled list. | Recommended, not applied. Open question Q4. |
| X16 | **Humans seeing violence.** S3 gates violent verbs that **target** a human. It says nothing about a human who only watches actors fight. `[R01]` suggests a calm-room switch. | Not decided. Open question Q9. |

## 3. Candidate verb table

### 3.1 Conventions used by every card

**Consent tiers.**

| Tier | Verbs | Gate when the target is a human | Gate when the target is an actor |
|---|---|---|---|
| **A, Affection** | contact: `hug, kiss, rush_embrace, comfort_pat`; non-contact: `blow_kiss, dance_with` | Contact verbs: the existing chip only (S4). Non-contact: none. | Relationship gate. Existing: `pairAllowed` needs `attraction >= 0.4` and `comfort >= 0.4`. |
| **C, Conflict** | non-contact: `glare, square_up, insult, point_accuse`; contact: `restrain` (actor to actor only), `grab, shove, slap, punch, splash, pie` | Contact: drama opt-in on, then the 4 s chip, timeout = Dodge (S3). Non-contact: see Q1. | Ladder (section 5) plus a motive gate (section 4.5) plus scenario permission (Q3). |
| **X, Climax** | `kill, die, faint, fake_faint, tableau, ghost_voice, slap_kiss` | `kill` only: opt-in, chip, then the victim lies for a few seconds (S5). Nothing else forces a human's body. | Scenario marks who may die (S5). The rest are scenario or director authored. |
| **Solo** | the 11 body-language verbs of 3.4, plus `point_accuse` (listed under Conflict) | none (self only; the optional `with` is a facing target) | none |

**Reaction obligations** (S8). Each verb lists what the target must show within **1.5 s** of `C`, and what witnesses within earshot must show within **3 s** of `C`. "Earshot" is Chebyshev distance <= 6 tiles (`SAY_CLEAR_TILES` in `packages/engine/src/space/constants.ts`, `[F]`; garbled up to 10). Because the planner reacts to speech only 16 to 25 % of the time (`[R07]`), the hotel table **authors default reactions itself**; the planner may override with a stronger reaction inside the window. Details in section 5.

**Impact budget.** One `intensity` in [0, 1] picks a class. All values are data.

| Class | `intensity` | Hit-stop `H` | Flash / spark | Shake | Knockback | Sound weight | Used by |
|---|---|---|---|---|---|---|---|
| **L** | < 0.34 | 50 ms `[F]` Celeste class | none | none | slide 14 to 24 px over ~300 ms `[F]` `[R05]` secondary | soft | `shove`, `grab`, `restrain` |
| **M** | 0.34 to 0.67 | 100 ms `[F]` | white tint 1 to 2 frames (33 to 50 ms) `[F]` `[R05]` | none ("skip shake on light hits") | lean 6 to 10 px + 1 to 2 px overshoot, settle 250 to 350 ms `[I]` | medium | `slap`, `splash`, `pie` |
| **H** | > 0.67 | 150 ms `[F]` | tint + 1 to 2 frame spark | 2 to 3 px, translation + small rotation, decays `[I]` | forced step + stagger | heavy | `punch` |
| **F** | fixed | 150 to 200 ms `[U]` (the 100 to 200 ms figure is a blog claim) | tint + spark | camera hard cut, then a short shake | forced step + fall | heaviest | `kill` |

Hit-stop freezes **both** actors' motion clocks and leaves effect overlays running `[F]` `[R05]` (Smash wiki, one aggregator).

**Timing format.** `A / C / H / R / Rec` in ms. `[F]` only where a source states the number for that act class; otherwise `[I]`.

**Render recipe columns.** (a) = compose from existing primitives; (b) = procedural client motion; (c) = new sprite (not before v1.1). "Missing" lists what the card needs that does not exist. Camera and sound lines apply in cinematic mode unless stated.

**Drive fields.** Written as `layer.field`: `core.` = `CoreMood`, `social.` = `SocialEmotions`, `rel.` = `RelationalState` toward the target, `act.` = `ActionEmotions`. **Dependency:** `act.*` is not in `AgentState` and the planner cannot reach it today (`[R07]` 3.2; `emotion.types.ts` says "computed not persisted"). Every `act.*` driver below needs `actionEmotions` passed into the plan input (Q10). The threshold seeds in section 4.5 are `[I]`.

### 3.2 Summary table (26 candidates in three tiers)

Priority: **must** = needed for the ladder and the reaction contract; **should** = in the recommended cut, droppable if the schedule slips; **could** = after v1; **cut** = not recommended (blocked, art-less or risky).

| id | Tier | Rung | One-line meaning | Legibility risk (5 = bad) | v1 |
|---|---|---|---|---|---|
| `blow_kiss` | A non-contact | n/a | Blow a kiss toward someone | 2 | could |
| `hug` | A contact | n/a | Embrace, hold, release | 3 | should |
| `kiss` | A contact | n/a | Cheek or air kiss with heart, not suggestive | 3 | should |
| `comfort_pat` | A contact | n/a | Sit beside and console | 4 | could |
| `rush_embrace` | A contact | n/a | Reunion: direct approach then hug | 3 | could |
| `dance_with` | A non-contact | n/a | Dance beside someone in the same style | 3 | could |
| `tend_fallen` | A non-contact | n/a | Kneel (sit on floor) beside a body | 3 | could (first swap-in) |
| `give_item` | A contact | n/a | Hand over a drink or prop | 2 | cut (blocked: `Carry` reserved) |
| `glare` | C non-contact | 1 | Hold a hard stare | 3 | must |
| `square_up` | C non-contact | 1 to 2 | Step in to 2 tiles, face, hold | 2 | could (fold into `glare`) |
| `insult` | C non-contact | 2 | Shouted accusation with sign and face | 3 | must |
| `point_accuse` | C non-contact | 2 | Point at someone: sign 13 plus face | 4 | could |
| `restrain` | C contact | de-escalation | Pull an aggressor off a victim | 3 | should |
| `grab` | C contact | 3 | Seize by the collar | 4 | cut (no art) |
| `shove` | C contact | 3 | Push, victim stumbles one tile | 2 | must |
| `slap` | C contact | 4 | Open-palm slap, head snaps | 3 | must |
| `punch` | C contact | 5 | Heavy punch, knockback, stars | 3 | must |
| `splash` | C contact | 3 (comic) | Drink thrown in the face | 2 | could |
| `pie` | C contact | 3 (comic) | Pie in the face | 4 | could (art `[U]`) |
| `faint` | X (actor only) | n/a | Collapse and lie, wake or be tended | 2 | could |
| `fake_faint` | X (actor only) | n/a | Faint that ends abruptly | 3 | cut for v1 |
| `kill` | X | 6 | Finisher; victim dies | 3 | must |
| `die` | X (victim side) | n/a | Fall, realization, lie with a halo | 3 | must |
| `tableau` | X (director) | n/a | Everyone in earshot freezes 2 to 3 s | 3 | should |
| `ghost_voice` | X (cinematic) | n/a | Dead actor's thought bubble | 2 | could |
| `slap_kiss` | X (authored) | skip | Kiss that ends in a slap | 3 | cut (trap risk) |

### 3.3 Verb cards: Affection, Conflict, Climax

#### Affection

**`blow_kiss`** (A, non-contact, no rung), v1 could, risk 2
- Meaning: blow a kiss toward a person.
- Drive: `social.affection` high, `rel.attraction` or `rel.affection` high at distance 2 to 6; `act.warmth`. Real planner gap: rule 6 only smiles and laughs.
- Obligations: no target obligation (not a strike). One witness reaction optional.
- Beats: `Face` 300 / `Blow` plays 1400 ms `[F]` (`actions.rs`) / H 0 / R target `smile` or `Turn` away 300 to 600 / Rec 400.
- Render (a): `Face{target}`, `Action::Blow`, emotion cue `love` 1500 ms, `Love` effect (fx9) 1500 ms, sfx `kiss`. Camera: `reaction` zoom 2 on the target, hold 1200.
- Missing: nothing blocking. Legibility: Habbo's native blow-kiss is the clearest affection gesture in `[R01]`.

**`hug`** (A, contact), v1 should, risk 3
- Meaning: two avatars hold, then part. Exists on the wire as `PairKind::Hug`.
- Drive: `social.affection`, `social.desireForIntimacy`, `rel.attraction`, `rel.comfort`, `rel.desireForCloseness > rel.desireForDistance`, `rel.threat < 0.3` (these last four already gate rule 12); `act.warmth`, `act.comfortSeeking`, `act.repairImpulse`.
- Obligations: human target: the chip decides; no answer completes (D31, unchanged). Target within 1.5 s: hug back (`Accept`), step back (`Dodge`), or stumble (`Push`). Witnesses within 3 s: face toward the pair; optional `smile` or cue `love`.
- Beats `[I]`: A 300 (converge, walk by planner; adjacency <= 1 required) / C blow at T0, partner sign 11 at T0 + 300 `[F]` / H 0 / R hold **1500** (up to 3000, X10) / Rec 400.
- Render (a) exists: pair act. Add `Love` effect on both for ~2400 ms, sfx `hug`, camera `two_shot` zoom 2. (b) 1 to 2 px squash at contact, slow converge ease `[I]` `[R05]`.
- Missing: a real hold pose (art), hold duration control (the shipped act has none).
- Risk reason: `[R01]` scores hug 3 because it leans on bubble and hearts; no dedicated pair animation exists.

**`kiss`** (A, contact), v1 should, risk 3
- Meaning: cheek or air kiss with a heart, **not suggestive** (Habbo bans sexual roleplay, `[R01]`; Q15).
- Drive: as `hug` with `rel.attraction >= 0.7` (the planner already picks kiss over hug at 0.7); `act.warmth`.
- Obligations: as `hug`. Q2 asks whether a human's timeout should be Dodge for a kiss.
- Beats `[I]`: A 400 / C two blows, T0 and T0 + 300 `[F]` / H 0 / R lean-in 400 to 600, hold 500 to 1000, separate 300 (`[R04]` inference) / Rec 400. Reaction sells it: blush or swoon `[F]` `[R04]` ("it is the reaction that sells intimacy").
- Render (a): pair act, heart cue, sfx `kiss`. Mask the gap by facing so the lean hides faces `[I]`.
- Missing: lean-in motion, (b).

**`comfort_pat`** (A, contact), v1 could, risk 4
- Meaning: console someone: sit or stand beside, face them, stay.
- Drive: `act.comfortSeeking` of a bystander toward a person with `core.valence` low and `social.shame` or `social.humiliation` high; `rel.affection` and `rel.trust` (both unread by the planner today).
- Obligations: none for the target; the verb is itself a witness response.
- Beats `[I]`: A walk ETA (300 ms per tile) / C adjacency + `Face` / H 0 / R target `Expression` neutral or `sad`, stays / Rec holds until the scene moves on. Sympathy touch was recognised for about 7.6 s `[F]` `[R06]`; do not copy the number as a hold, it is forearm touch between strangers.
- Render (a): `Sit{floor}` or stand adjacent, `Face`, cue `love` or `sad`. No pat pose exists, so risk is high. Missing: contact art.

**`rush_embrace`** (A, contact), v1 could, risk 3
- Meaning: reunion. Direct, un-hesitant approach from 4+ tiles and an immediate hug.
- Drive: `act.warmth` plus `act.anxiousOverreach` or `rel.desireForCloseness`, after a long absence (`rel.lastInteractionAt`, unread today).
- Beats `[I]`: A walk ETA (no stop-start) / C hug as above / R as `hug` / Rec 400. Staging for reunion has **no source** `[U]` `[R02]`.
- Render (a): `walk` straight, `hug`, `Love`. Fixed walk speed (X12) means "rush" reads only through the direct path and the missing hesitation.

**`dance_with`** (A, non-contact), v1 could, risk 3
- Meaning: dance next to someone in the same style (`Action::Dance`, styles 1 to 4: Hab-Hop, Pogo-Mogo, Duck-Funk, The Rollie).
- Drive: `core.valence` and `core.arousal` high, `social.affection`; `act.warmth`, `act.pridefulPerformance`.
- Beats: A 300 / C n/a / R n/a / Rec until `Stop`. Render (a): both `Dance` same style, adjacent; no pair animation exists. Missing: pair choreography.

**`tend_fallen`** (A, non-contact), v1 could, **first swap-in**, risk 3
- Meaning: go to a body (faint or death), crouch beside it. This is the rescuer witness role (`[R02]`: shocked, rescuer, gossip, passive).
- Drive: `act.comfortSeeking`, `act.repairImpulse`, `rel.affection` and `rel.trust` toward the fallen (unread today).
- Beats `[I]`: A walk ETA / C `Sit{floor:true}` adjacent (kneel proxy) / R `Expression sad`, cue `sad` / Rec holds to the scene cut.
- Render (a): `walk`, `Sit{floor}`, `Face{target}`, `Raincloud` optional, sfx `sting_sad`. Sit art faces only 4 directions, so the facing is approximate. Missing: a true kneel pose.

**`give_item`** (A, contact), v1 **cut**
- Blocked: `ActorCmd::Carry` is reserved until hand-item sprites exist (D33). `[R01]` rates hand-item give readable (4), which is why it returns when `Carry` ships. Not specified further.

#### Conflict, non-contact

**`glare`** (C, non-contact, rung 1), v1 **must**, risk 3
- Meaning: a hard, held stare. The first rung.
- Drive: `rel.resentment` or `rel.suspicion` or `rel.threat` above seed; `social.contempt`, `social.jealousy`, `social.envy`; `core.valence` < 0 and `core.arousal` rising; `act.dominanceAssertion`, `act.resentfulColdness`, `act.jealousInspection`.
- Obligations: target within 1.5 s of the start of the hold: look back (`Face`), look away (`turn_back`), or freeze. Witnesses within 3 s only if rung >= 2 already in this scene; otherwise optional.
- Beats `[I]`: A 0 (`Face`) / C n/a / H 0 / R hold 1500 to 2500 / Rec 300. Staggered zoom is three cuts at different distances, about 1 s `[I]` `[R02]`.
- Render (a): `Face{target}` (exact 8-direction match `[I]` `[R06]`), `Expression angry` plus a cue (sign 16 for 5 s, or emotion cue `angry` for 1500 ms), sfx `sting_tension`. Camera: `two_shot` zoom 1, then `close_up` zoom 2 on the aggressor (hold 700), then `reaction` on the target (hold 1000). (b) 3 to 4 px lean toward the target over 150 ms.
- Missing: nothing blocking. The planner face lock (`HUMAN_FACE_HOLD_MS` 7 s, `INTERLOCUTOR_MS` 20 s) must not fight a held glare, and rule 4 (withdrawal) must not cancel it.
- Risk reason: face is the weak channel (X11); angry art exists on 13 of 183 libs.

**`square_up`** (C, non-contact, rung 1 to 2), v1 could (fold into `glare`)
- Meaning: step in to 1 to 2 tiles, face the target, hold (anger approach or standoff at 2 to 3, `[I]` `[R06]`). Never inside 3 tiles of a human whose drama opt-in is off (Q1).
- Beats `[I]`: A walk ETA / C stop at distance 2 / R target holds ground, steps back or answers / Rec 600 hold.
- Render (a): `walk` direct, `Face`, `Expression angry`. Displacement is the strongest channel `[I]` `[R01]`, so risk is 2.

**`insult`** (C, non-contact, rung 2), v1 **must**, risk 3
- Meaning: the body half of a shouted accusation. The words come from the model's `chat`.
- Drive: `social.resentment`, `social.contempt`, `social.humiliation`, `social.jealousy`; `act.impulsiveProvocation`, `act.dominanceAssertion`, `act.contemptuousDismissal`; `core.arousal > 0.8` already selects `shout` in `chooseSpeechMode` (60 s cooldown).
- Obligations: target within 1.5 s: `surprised` or `angry` plus a `Face` back, and a line when the model gives one. Witnesses within 3 s: face toward the pair; a gossip witness may smile.
- Beats `[I]`: A 300 / C the line's `chat` bubble / H 0 / R target 300 to 900 / Rec 600. A melodramatic pause is a unit of three: the line, then the reaction of A, then the reaction of B `[F]` `[R02]`.
- Render (a): `Face`, `Expression angry`, sign 16 for 5 s, `Chat` mode `shout`, sfx `sting_tension`; camera `close_up` aggressor (800) then `reaction` target (1500). (b) 2 to 3 px shake burst on the speaker.
- Missing: an angry face on most figures. Gate for a human target: Q1 (text aimed at a human is the harassment case).

**`point_accuse`** (C, non-contact, rung 2), v1 could, risk 4
- Meaning: point at someone and name them.
- Drive: `act.dominanceAssertion`, `social.suspicion`, `rel.suspicion`; telenovela "accusation" R2 `[F]` `[R02]`.
- Beats `[I]`: A 200 / C sign shown / R 400 / Rec 5000 (the sign lasts 5000 ms `[F]`).
- Render (a): `Face{target}`, `Sign` style 13 (exclamation, `[F]`), `Chat shout`. A sign reads as "!" not "you", so the face and the line carry the target; risk 4.

**`restrain`** (C, contact, de-escalation), v1 **should**, risk 3
- Meaning: a witness steps in and pulls the aggressor one tile away from the victim. Actor to actor only in v1.
- Drive: `act.comfortSeeking` or `act.repairImpulse` toward the victim, `rel.affection` and `rel.trust` toward the victim, `act.strategicPatience`; role "rescuer" `[I]` `[R02]`.
- Obligations: the aggressor reacts within 1.5 s (struggle: two `Turn` jolts, `Expression angry`). Resets the aggressor's `rung_cur` to at most 2 for 20 s (section 5).
- Beats `[I]`: A walk ETA / C forced step of the aggressor one tile away from the victim (`request_walk`, 300 ms `[F]`) / H 50 (class L) / R struggle 600 / Rec 800.
- Render (a): `walk`, `Face`, forced step. Missing: a pull animation (b); the existing forced step only handles the aggressor if the tile behind is free.

#### Conflict, contact

**`grab`** (C, contact, rung 3), v1 **cut**, risk 4
- Meaning: seize by the collar or arm. No hold pose and no art. Without a pose it reads as two avatars standing close. Cut until a signature sprite exists (c).

**`shove`** (C, contact, rung 3), v1 **must**, risk 2
- Meaning: push; the victim stumbles one tile. The cleanest physical verb on a small avatar: displacement is the clearest signal `[F]` `[R01]` (push/pull scores 5 there).
- Drive: `act.impulsiveProvocation`, `act.defensiveness`, `act.dominanceAssertion`; `social.resentment`, `social.jealousy`, `social.humiliation`; `rel.threat`, `rel.resentment`; `core.arousal` high, `core.valence` < 0.
- Obligations: target within 1.5 s of `C`: the forced step itself (a displacement counts as a reaction) plus `Expression surprised`. Witnesses within 3 s: `freeze_gasp` or `recoil`.
- Beats: A 250 `[I]` (`[R04]` 200 to 300) / C 0 / H 50 `[F]` class L / R forced step 300 (one tile at 300 ms per tile, `[F]`) + settle 300 `[I]` / Rec 400 `[I]`.
- Render (a): attacker `Face{target}` and `Expression angry`; at `C` the **push-through**: victim forced one tile away from the attacker and the attacker takes a one-tile forced step into the victim's old tile (both are ordinary 300 ms `moves`), victim `Expression surprised` plus a cue (sign 13), sfx missing (stand-in none; do not use `transition_whoosh`, it is 400 ms). Camera: `two_shot` zoom 2 then `reaction` on the victim, hold 1000. (b) 4 to 6 px pull-back over 100 ms, a decaying slide of 14 to 24 px over ~300 ms, dust puff `[I]` `[R05]`.
- Seated, lying or dancing targets are not moved by a forced step `[F]`. Rule: the verb requires a standing, still target; otherwise the table downgrades to `Turn` jolt plus `Expression` and logs `downgraded`.
- Missing: a shove sound, the push pose (b), a multi-tile slide (b).

**`slap`** (C, contact, rung 4), v1 **must**, risk 3
- Meaning: open-palm slap; the head snaps. The telenovela signature `[F]` `[R02]` (Soraya, the Televisa clip, a long kiss ending in a slap).
- Drive: `social.humiliation`, `social.resentment`, `social.contempt`, `social.jealousy`; `act.impulsiveProvocation`, `act.dominanceAssertion`; `rel.resentment`, `rel.desireForDistance`; `core.arousal` high. Preconditions: rung 2 already used in this scene against this target, **or** a scenario-authored skip (S7). "A slap should land after an insult or a refusal to retract, not from nothing" `[I]` `[R02]`.
- Obligations: target within 1.5 s: head snap (`Turn` one direction in the swing direction), hand to cheek (`Expression surprised` hold), look back. Witnesses within 3 s: `freeze_gasp`, plus a role reaction.
- Beats: A 300 `[I]` (`[R04]` 250 to 400; X3) / C 0 = sound frame `[F]` / H 100 `[F]` class M (slap preset 80 to 100 `[I]` `[R04]`) / R head snap 100 to 150, hold 400 `[I]`, then slow settle / Rec 500 to 800 `[I]`.
- Render (a): attacker `Face{target}` and `Expression angry` (sign 16); a short `Action::Wave` cut by `Stop` after ~300 ms as the arm swing (**`[U]`**: whether `Stop` cleanly ends a wave is not verified; the closest existing arm motion is wave, which is an open hand); victim `Turn` one direction toward the swing at `C + H` (a 45 degree head-snap proxy using the real `Turn` primitive), `Expression surprised`, then `Face` back to the attacker at +1200 ms; sfx missing, stand-in none. Camera: `close_up` zoom 2 on the victim, ease 0, hold 1500, then `two_shot`. (b) lunge 8 to 14 px in ~50 ms, 1 to 2 frame white tint on the victim, 1 to 2 frame spark, a 6 to 10 px lean with 1 to 2 px overshoot, no blend into the pose `[F]` `[R05]`. (c) a real slap arm sprite is the first candidate for a signature move.
- Missing: arm-strike pose, slap sound, tint, spark, hit-stop clock, a hand-to-cheek pose.
- Risk reason: no arm art, and `Wave` as a swing is `[U]`.

**`punch`** (C, contact, rung 5), v1 **must**, risk 3
- Meaning: heavy punch; knockback and stars. Kept so the ladder has all six rungs in v1.
- Drive: as `slap` with higher thresholds (section 4.5): `act.impulsiveProvocation` and `act.dominanceAssertion` very high, `core.arousal` very high; requires rung 4 used in this scene or an authored skip.
- Obligations: target within 1.5 s: stagger (forced step) plus `Turn` jolt of 2 directions; `Twinkle` stars while dazed `[I]`. Witnesses within 3 s: `freeze_gasp`; a rescuer role should `restrain` next beat.
- Beats: A 300 to 400 `[I]` (game telegraph 150 to 400 ms is `[F]` for games, `[R04]`) / C 0 / H 150 `[F]` class H / R knockback 300 (forced step) + dazed hold 1000 to 1500 `[I]` / Rec 600 to 900 `[I]`.
- Render (a): as `slap` plus forced step and effect `Twinkle` (fx4) on the victim for 1500 ms; sfx missing. Camera: `close_up` zoom 2 ease 0, hold 600, then `reaction`. (b) 2 to 3 px shake, a slide of 14 to 24 px, spark. Profile staging (attacker and victim side-on to the camera) is a stage rule `[F]` `[R04]` but the isometric 8-direction grid does not give us that control `[U]`.
- Missing: as `slap`, plus the stars' look in situ (one frame seen).

**`splash`** (C, contact, comic rung 3), v1 could, risk 2
- Meaning: a drink thrown in the face. Classic, comic, no impact.
- Drive: as `slap`, lower thresholds; `act.impulsiveProvocation`, `social.humiliation`.
- Obligations: standard (target 1.5 s, witnesses 3 s). Counts as a physical beat in the 20 s budget.
- Beats `[I]`: A 300 / C effect starts / H 100 class M / R `Turn` jolt 100, `Expression surprised`, hold 800 / Rec 1200 (the `Splash` animation has 10 frames, about 1200 ms at 120 ms each `[I]`).
- Render (a): attacker `Wave` cut at ~300 ms as the throw `[U]`; effect `Splash` fx28 or `SplashEvil` fx184 on the victim; cue `surprised`. Humans: this changes `Avatar.effect` and would overwrite what they wear, so it needs the client-side overlay path (the one expression fallback uses), not `Appearance` (see 3.5). Missing: splash sound, a glass prop (`Carry` reserved).

**`pie`** (C, contact, comic rung 3), v1 could, risk 4
- Same choreography as `splash` with effect `Pie` fx104. The art looked unclear in the frame I viewed `[U]`, so it is a `could` until someone watches the animation.

#### Climax

**`faint`** (X, actor only), v1 could, risk 2
- Meaning: collapse and lie; wake alone or be tended. Telenovela catalogue: faint in shock, emotional faint, fake faint `[F]` `[R02]`.
- Drive: `max(social.shame, social.humiliation, social.fearOfExclusion) >= 0.85` or a scenario-authored faint; `core.energy` very low and a `core.arousal` spike; `act.vulnerableRetreat`, `act.shameWithdrawal`. Never random.
- Obligations: no target reaction (it is self). Witnesses within 3 s: `freeze_gasp`; one rescuer within 6 s may `tend_fallen`.
- Beats `[I]` `[R04]`: A sway 600 to 1000 (visible resistance: the faint reads better when it fights `[F]`) / C `Lay` drop 300 to 400 / H 0 / R hold >= 1000 plus a "…" or dizzy marker / Rec stand after 6 to 10 s or when tended.
- Render (a): `Expression sad` or `surprised`, `Lay` (refused while walking, on a seat or with no room to lie `[F]`; fallback `Sit{floor}`), `Twinkle` fx4 or cue `confused` as the alive marker (`[I]` `[R05]`, Animotion), sfx `sting_sad`. (b) a 4 to 8 px drop with a 1 to 2 px bounce `[I]` `[R05]`. Missing: a sway animation, the drop thud.

**`fake_faint`** (X, actor only), v1 cut, risk 3
- A faint that ends abruptly after 3 to 5 s (`strategicPatience`, `impulsiveProvocation`). Witnesses must react as to a real one. Needs the base `faint` first; no new art; deferred because a fake that fails to read as fake is just a faint.

**`kill`** (X), v1 **must**, risk 3
- Meaning: the finisher. Stylized, no weapon in v1, no blood. The killer lands a heavy blow; the victim goes into `die`.
- Drive: the top of the ladder: rung 5 used in this scene against this victim, or an authored skip; `social.resentment`, `social.humiliation`, `social.jealousy` very high, `core.arousal` very high; `act.impulsiveProvocation` and `act.dominanceAssertion`. Kill is a slower arc in the sources (CK3 scheme, `[R03]`), so the motive gate also requires a recorded grievance (section 4.5). Hard gates: the scenario lists the victim in `may_die` (S5); at most one kill per scene (S7); human victim only with opt-in and chip (S3).
- Obligations: victim within 1.5 s: `die` begins. Witnesses within 3 s: `freeze_gasp` (all) then a role reaction. The killer must **not** be rewarded: no celebration verb in the 5 s after (`[I]` `[R04]`); the killer's own reaction is `freeze_gasp` or `turn_back`, chosen by traits.
- Beats: A 500 `[I]` / C 0 / H 150 to 200 `[U]` class F / R `die` starts at `C + H` / Rec killer holds 1000 to 1500, then `tableau` 2 to 3 s `[I]` `[R02]`.
- Render (a): `punch` skeleton at class F, camera `close_up` zoom 2 hard cut hold 600, `sting_tension` then a brief silence `[F]` `[R05]` (a dip helps), a `Caption` optional. (b) the largest shake and a camera hard cut. (c) a weapon or a signature killing move, later.
- Missing: everything the `punch` card is missing, plus the death state machine (section 5.5), and a human-victim posture lock (3.5).
- Risk reason: over-explicit death draws laughs `[F]` `[R04]`; the halo and silence are what keep it from being a gag.

**`die`** (X, victim side), v1 **must**, risk 3
- Meaning: the victim's half of `kill`, also usable authored alone (poison, "who killed her?").
- Beats (melodramatic death, `[R04]`): impact (forced step) 300 / **realize** (held beat) 600 / **last gesture** 500 / drop to `Lay` 300 to 400 / **relax**: final pose held 200 to 300 ms `[F]` (pixel death) before the signifier / signifier on. Total about 2.5 s `[I]`. No rattle, no thrashing `[F]` `[R04]`.
- Render (a): `Expression surprised`, forced step, `Action::Wave` or `Blow` cut by `Stop` as the last reaching gesture (`[U]`, as `slap`), `Lay` (fallback `Sit{floor}` then the effect), then `TrippyHalo` fx222 as the death effect (halo, one frame viewed `[F]`; final choice is Q6), cue `sad`, sfx `sting_sad`. The body persists until the scene cuts (S5).
- State change: removed from the speaker pool; every actor command is rejected with a new error code (section 5.5); memory write.
- Humans: the avatar lies with the same effect for "a few seconds" (Q7 recommends 5 s), then control returns and the effect clears. Needs forced posture on a human and a client-side effect overlay (3.5).

**`tableau`** (X, director), v1 **should**, risk 3
- Meaning: after any rung >= 4 beat everyone in earshot holds still for a held picture, then the scene cuts on a hook `[F]` `[R02]` (tableau, gancho).
- Drive: not an emotion. Triggered by the table after `slap`, `punch`, `kill`, `faint`.
- Obligations: every actor within 6 tiles of the principals holds (no planner commands) for 2 to 3 s `[I]` (tunable). Humans cannot be frozen.
- Beats `[I]`: A 0 / C n/a / H n/a / R hold 2000 to 3000 / Rec the hook: `CutFx` (`fade`, `door` or `meanwhile`) or a `Caption`.
- Render (a): planner pause flag, camera `two_shot` or `establishing`, `sting_tension` then a short silence, `Caption`. Missing: the pause flag on the planner, a cut-on-hook rule in the scenario.

**`ghost_voice`** (X, cinematic only), v1 could, risk 2
- Meaning: the dead actor speaks as a thought, never as chat.
- Render (a): `PerfectmanUi::Thought { id, text, ms }`, 7 s default. Thoughts are hidden in default mode (D30), which is exactly why this is cinematic only. It must never go through `ActorCmd::Chat` (the dead leave the speaker pool). Missing: nothing, but a rule that blocks `Chat` for the dead while still allowing `Thought`.

**`slap_kiss`** (X, authored), v1 cut, risk 3
- A long kiss that ends in a slap `[F]` `[R02]` (Caray). It is a two-verb composite that skips the ladder on purpose. Cut for v1: on a human it would be a trap (a chip answered "Accept" for a kiss followed by a hit), and on actors it is expressible as `kiss` then `slap` with an authored skip. Revisit with actor-only scope.

### 3.4 Solo body language (11 verbs, plus `point_accuse` in 3.3)

All are self-only. `with?` is only a facing target. All are tier Solo.

| id | Meaning | Drive (real fields) | Beats `A / C / H / R / Rec` | Render (a) then (b) | Missing | Risk | v1 |
|---|---|---|---|---|---|---|---|
| `storm_off` | Turn away, walk out, slam the door | `social.humiliation`, `social.resentment`, `social.shame`; `act.resentfulColdness`, `act.shameWithdrawal`; scenario permits travel (`MoveRoom` limited to the stage rooms by commit `2b7b496`) | A 400 (turn >= 135 degrees away `[I]` `[R06]`) / C walk ETA = tiles x 300 / R door cue / Rec 0 `[I]` | (a) `Face` away, `Expression angry`, `body.move leave`, sfx `door_open` (same voice as `door_close`), camera `tracking` zoom 1 follow, `CutFx door`. (b) 2 to 3 px shake on the first step. `[R07]`: 13B models never leave; the table authors it. | a distinct slam sound; the door's closing is not told apart `[F]` | 2 | should |
| `turn_back` | Rotate >= 135 degrees away from the target and stay | `social.contempt`, `social.shame`, `social.resentment`; `act.resentfulColdness`, `act.contemptuousDismissal`, `act.defensiveness`; `rel.desireForDistance` | A 0 / C `Face{dir}` / R hold 2000 to 5000 `[I]` / Rec 0 | (a) `Face{tile or dir}` away; sit turns only to even directions and lying cannot turn `[F]`. Must override the planner face lock. Closeness raises discomfort: reduce gaze rather than only step back `[F]` `[R06]` (Argyle). | the face-lock override; whether the back sprite reads from the camera angle `[U]` | 3 | should |
| `pace` | Walk back and forth in a short line | `act.jealousInspection`, `act.anxiousOverreach`, `core.stability` low | A 0 / C 2 to 3 legs of 2 to 4 tiles / Rec 600 pause between legs `[I]` | (a) `walk`. **Blocked today** by the 30 s reversal lock and counted as jitter by the probe (X13). | `purposeful` flag honored by planner and probe | 3 | could |
| `cry` | Sad face, rain cloud, slow heavy body | `core.valence` low and `core.energy` low; `social.shame`, `social.humiliation`; `act.vulnerableRetreat`, `act.shameWithdrawal`; grief after a death | A 300 / R hold 3000 to 6000 (quick 1 to 3 s, major 4 to 8 s, `[F]` film convention `[R05]`) / Rec 800 | (a) `Expression sad` (cue fallback is `Raincloud`, `[F]`), effect `Raincloud` fx113, cue `sad`, sfx `sting_sad`, usually with `slump_sit`. Sadness is the one emotion that should **not** be exaggerated and stays slow `[F]` `[R06]`. (b) 1 to 2 px slow shake. | a sob sound | 2 | should |
| `mock_laugh` | Laugh at someone, turned half away | `social.contempt`; `act.contemptuousDismissal`, `act.impulsiveProvocation`; `rel.resentment` | A 200 / C `Laugh` 2000 `[F]` / R target within 1.5 s / Rec 400 | (a) `Face{target}` then `Turn` 45 to 90 degrees off, `Action::Laugh`, `Expression neutral` or `smile` (mismatch reads as irony only with context `[F]` `[R06]`), sfx `laugh`, `sting_comedy`. Villain laugh staging has no source `[U]` `[R02]`. | a contempt-specific cue | 3 | could |
| `kneel_beg` | Kneel to a person and beg | `act.repairImpulse`, `act.vulnerableRetreat`, `social.shame`; `rel.resentment` high on the other side | A walk ETA / C `Sit{floor}` adjacent, `Face` / R hold 3000 / Rec 0 | (a) `Sit{floor}` as kneel proxy (4 facings only), `Expression sad`, cue `sad`. Staging has no source `[U]` `[R02]`. | a real kneel pose | 4 | could |
| `recoil` | Quick step or lean away, small and fast | `rel.threat`, `social.socialAnxiety`; `act.defensiveness`; surprise is event-driven (no emotion field for it) | A 0 / C onset < 300 `[I]` `[R06]` / R hold 500 / Rec 400 | (a) `Turn` 1 to 2 directions away, `Expression surprised` (cue sign 13), optional one-tile forced step when struck; sfx missing. (b) 6 to 10 px lean away with 1 to 2 px overshoot. The default witness and target reaction. | a gasp sound | 3 | **must** |
| `freeze_gasp` | Stop, face the event, hold | `core.arousal` spike; event driven; `act.defensiveness`, `rel.threat`, `social.socialAnxiety` | A 0 / C n/a / R hold 800 to 2000 `[I]` (freeze 0.5 to 2 s `[F]` `[R06]`, `[M]` unverified in session) / Rec 0 | (a) `Face{event}`, `Expression surprised`, cue `surprised` 1500 ms, sign 13 for 5 s as fallback. Stagger witnesses by distance so they do not move in unison. "Stop a walk" has **no known primitive**: walks end by `arrived` (`[U]`). (b) none. | a gasp sound; a walk-cancel primitive `[U]` | 3 | **must** |
| `slump_sit` | Sit down heavily | `core.energy` low; `social.shame`; `act.shameWithdrawal`, `act.vulnerableRetreat` | A 0 / C `Sit` / R hold until moved / Rec 0 | (a) `Sit{furni or floor}`. A sit is an instant pose swap. (b) a 4 to 8 px drop with a 1 to 2 px bounce gives the "heavy" `[I]` `[R05]`. The planner's rule 11 is a **timer**, not an emotion (`SIT_EVERY_MS`). | none | 2 | could |
| `fist_shake` | Shake a fist at someone | `act.dominanceAssertion`, `social.resentment` | A 100 / C 3 shakes over 400 / R 0 / Rec 300 `[I]` | (a) no fist art; (b) 2 to 3 px lateral shake burst, `Expression angry`, sign 16. | fist art | 4 | could |
| `preen` | Pride display | `social.pride`, `social.desireForStatus`; `act.pridefulPerformance` | A 0 / C `Dance` style or `Thumbs` 2000 / R 0 / Rec 0 | (a) `Dance`, `Thumbs`, optional `Spotlight` fx1 or `GoldSpotlight` fx137 as a stage light `[U]`. Pride is posture (head back, expanded, arms up) `[F]` `[R06]`, which we cannot show. | art `[U]` | 3 | could |

### 3.5 What is missing, collected

Composing from existing primitives is enough to **start**, but these gaps decide how good it looks. None is built by this document.

| Gap | Needed by | Rendering rung |
|---|---|---|
| `ActorCmd::Act { verb, with?, intensity, act_id }`, the verb table, a sequencing queue broader than `Later::Gesture`, and `act_*` event frames for probes | all | (a) |
| Drama opt-in session flag, and a chip for violent verbs. `PairKind` only has `Kiss, Hug`; the chip labels are Accept/Dodge/Push, to be shown as Take it / Dodge / Push back, with timeout = Dodge instead of the pair act's timeout-completes | all contact C, `kill` | (a) |
| Forced posture on a human (lay) and a client-side effect overlay that does not touch `Avatar.effect` | `kill` on a human, `splash`, `pie` | (a) |
| Death state machine: reject chat and body commands from the dead, speaker-pool exclusion, memory write | `kill`, `die` | (a) |
| Sounds: `slap`, `thud`, `gasp`, `sob`, `whoosh_short` (the synth engine in `web/sfx.js` makes short voices cheaply) | `slap`, `punch`, `shove`, `die`, `recoil`, `freeze_gasp`, `cry` | (a) |
| Hit-stop on the procedural clock, white tint, spark, shake, lunge offset, lean, slide | C contact verbs | (b) |
| `Stop` semantics for a gesture cut at ~300 ms (verify first) | `slap`, `die`, `splash` | (a) `[U]` |
| A walk-cancel primitive | `freeze_gasp` | (a) `[U]` |
| Planner lock during an act, and exemptions: face lock, anti-jitter reversal, withdrawal rule, gesture cooldown | all | (a) |
| `actionEmotions` in the plan input | every `act.*` driver | (a) |
| Real art for angry, sad, surprised faces beyond 13 of 183 libs; arm-strike, hand-to-cheek, kneel, hold poses | `slap`, `punch`, `grab`, `kneel_beg`, `hug` | (c) |

## 4. Emotion-to-body map

### 4.1 Rules taken from the body-language research

1. **Body first, face second** `[F]` `[R06]`: bodies carry valence and intensity at peak; faces disambiguate. Keep face and body congruent for a strong emotion; mismatch only for masking or irony.
2. **Arousal by valence first** `[F]` `[R06]` (Wallbott): arousal drives amplitude and tempo; valence drives approach versus withdraw and open versus closed.
3. **Effort layer** `[I]` `[R06]` (EMOTE): four parameters on every procedural motion: speed, abruptness, amplitude, smoothness. Anger is strong, sudden, direct and bound; sadness is light, sustained, indirect and low; fear is sudden, bound and withdrawing; joy is light, quick and free. These are the standard reading, not a quoted result.
4. **Approach and withdraw plus facing** are the main acting language: toward, away, off (45 to 90 degrees). With 8 directions we have 45 degree steps.
5. **Freeze before flee** `[M]` `[R06]` (recalled, not re-verified): 0.5 to 2 s of stillness before the action.
6. **Touch is rare and meaningful**: only at distance 1.
7. **Display rules per character** `[F]` `[R06]`: amplify, mask or neutralise. A stoic character smiles while the body leaks withdrawal.
8. **Vary, do not hard-code** `[F]` `[R06]` (Dael): several patterns per emotion; pick by seeded variation.
9. **Exaggerate** `[F]` `[R06]` (Atkinson), except sadness.
10. **Zones are per-character parameters** `[F]` `[R06]`: Hall's distances are US norms. In tiles (Chebyshev, `BAND` in `constants.ts`: `intimate` 1, `personal` 2, `socialMax` 6): 1 touch, 2 arm's length or a standoff, 3 to 4 cool or wary, 5 to 8 shouting or avoidance.

### 4.2 Solo language: emotion to body

Our model has no field named anger, fear, disgust or surprise. Anger is derived (`core.arousal` high, `core.valence` < 0, plus `social.resentment`, `social.humiliation` or `act.dominanceAssertion`). Surprise is event-driven. I do not add fields; the table names the derivation.

| Feeling (derived from) | Distance and facing | Posture | Face and cue | Verbs |
|---|---|---|---|---|
| **Anger** (`core.arousal` up, `core.valence` < 0; `social.resentment`; `act.dominanceAssertion`) | Close to 1 to 2 or hold at 2 to 3; face the target exactly | Stand, never sit; lean in | `angry` + sign 16 / cue `angry` | `glare`, `square_up`, `insult`, `fist_shake`, then ladder |
| **Contempt** (`social.contempt`; `act.contemptuousDismissal`) | 3 to 5, deliberately not closing; body 45 to 90 degrees off, turn away early | Stand or sit relaxed | `neutral` (contempt is cool) `[F]` `[R06]` | `turn_back`, `mock_laugh`, slow dismissive `Wave` |
| **Jealousy** (`social.jealousy`; `act.jealousInspection`; **no validated display**, design not science `[F]` `[R06]`) | Hover 2 to 4 from the pair; alternate facing between beloved and rival | Stiff stand | alternate `angry` and `sad` on a timer | `pace`, `glare`, `square_up` between the pair |
| **Shame** (`social.shame`, `social.humiliation`; `act.shameWithdrawal`) | Increase distance to 4 to 6; edge to walls or corners (rule 7 exists) | Sit, slumped, head down | `sad` | `slump_sit`, `turn_back`, `cry`, `storm_off` |
| **Grief** (`core.valence` low, `core.energy` low) | Withdraw 4+ or stay at 1 beside the loved one | Sit or lie | `sad` + `Raincloud` | `cry`, `tend_fallen`, `slump_sit`; no gestures |
| **Fear** (`rel.threat`; `social.socialAnxiety`; `act.defensiveness`) | Increase distance to >= 4, keep an object between; head toward the threat | Tense stand; freeze then flee | `surprised` + cue `afraid` | `freeze_gasp`, `recoil`, `keep_distance` (existing move kind) |
| **Love** (`social.affection`; `rel.attraction`, `rel.comfort`; `act.warmth`) | Close steadily to 1 to 2; mutual orientation | Stand or sit side by side | `smile` + `Love` | `blow_kiss`, `hug`, `kiss`, `comfort_pat` |
| **Joy** (`core.valence` and `core.arousal` high) | Toward the group at 1 to 3 | Upright, expanded | `smile` | `Dance`, `Laugh`, `Thumbs` (not `lay`) |
| **Surprise** (event) | Brief step back, then hold | Upright | `surprised` + sign 13 | `freeze_gasp`, `recoil` |
| **Disgust** (no field; object-driven) | 3+, pull back from the object | Lean back | nearest face is `angry` | `recoil` plus a text or object cue (least body-recognisable `[F]` `[R06]`) |

Confusable pairs the legibility tests must cover (`[F]` `[R06]`): joy and surprise, disgust and anger, shame and grief.

### 4.3 The 15 action tendencies: how each surfaces

`emotion.types.ts` gives only names, not definitions. The readings below are mine (`[I]`) and the owner should confirm them in the cut. Every row needs `actionEmotions` in the plan input (Q10).

| Tendency | Surfaces as | Verbs | Rung ceiling | Notes |
|---|---|---|---|---|
| `defensiveness` | Back off, turn away, brace | `recoil`, `turn_back`, `keep_distance`; `ProtectShield1` fx228 on a block | shove (a defensive push) | The only tendency that licenses a first strike from fear. |
| `warmth` | Smile, lean in, touch | `blow_kiss`, `hug`, `kiss`, `dance_with` | none | Already half-served by rule 6 (smile, laugh) and rule 12. |
| `jealousInspection` | Shadow a pair at 2 to 4, split gaze | `glare`, `square_up`, `pace` | glare to insult | Needs the face-lock and reversal exemptions. |
| `shameWithdrawal` | Shrink, hide, leave | `slump_sit`, `turn_back`, `cry`, `storm_off`; corner drift (rule 7 exists) | none | |
| `resentfulColdness` | Look away, answer late, say nothing | `turn_back`, withheld `glare` | glare | A visible choice, not a no-op (R07 item 10). |
| `curiousApproach` | Approach to 2 to 3, face, watch | `Face`, `follow` (existing move kind) | none | `rel.curiosity` is unread today. |
| `anxiousOverreach` | Too close, too eager, awkward | early `hug`, `rush_embrace`, fast `Laugh` | none | Produces comic Dodge on humans: chip applies. |
| `pridefulPerformance` | Show off | `preen`, `Dance`, `Thumbs` | none | `Spotlight` fx1 is an optional prop `[U]`. |
| `vulnerableRetreat` | Fold up, cry | `cry`, `slump_sit`, `faint` | none | Feeds `faint` when extreme. |
| `contemptuousDismissal` | Turn the back, laugh | `turn_back`, `mock_laugh`, dismissive `Wave` | insult | |
| `strategicPatience` | Wait, watch, hold | a held `Face` plus stillness; also **raises** the threshold of every escalation | none | The guard against runaway escalation; its absence is the Dwarf Fortress spiral `[F]` `[R03]`. |
| `impulsiveProvocation` | Needle, mock, throw | `insult`, `mock_laugh`, `splash`, `pie`, `shove` | the main rung-skipper (authored) | Autonomously capped at one rung per beat. |
| `comfortSeeking` | Go to a friend and sit close | `comfort_pat`, `hug`, `tend_fallen` | none | |
| `dominanceAssertion` | Stand over, point, intrude | `square_up`, `point_accuse`, `fist_shake`, `shove`, `slap` | punch | Intrusion to distance 1 is a threat only with direct facing and tension `[F]` `[R06]`. |
| `repairImpulse` | Apologise, kneel, go back | `kneel_beg`, `hug`, `tend_fallen`, `restrain` | de-escalation | Any verb that lowers the rung is always legal. |

### 4.4 The 12 social emotions that `plan.ts` never reads

I confirmed in `plan.ts` that only `shame`, `affection` and `socialAnxiety` are read. The other 12 have zero body output today.

| Field | How it should surface | Feeds | Caveat |
|---|---|---|---|
| `social.jealousy` | Shadow the pair; alternate gaze; step between | `jealousInspection`; `glare`, `pace` | No validated display `[F]` `[R06]`. |
| `social.envy` | Stare, then look away when noticed; stand 3 to 4 off | `glare` variant; `rel.envy` | Same caveat. |
| `social.humiliation` | Freeze, slump, leave; or lash out at the humiliator | `freeze_gasp`, `slump_sit`, `storm_off`; slap trigger | The strongest slap and faint driver. |
| `social.pride` | Chest up, show off | `preen`, `Thumbs`, `Dance` | Pride is posture we cannot show. |
| `social.resentment` | Cold shoulder; grievance memory | `turn_back`; gates rungs 2 and above | Pair with `rel.resentment` and `rel.lastNegativeAt`. |
| `social.suspicion` | Watch, keep distance 3 to 4, head toward | `Face`, `keep_distance`, cue `confused` (the vocabulary maps "suspicious" to `confused`) | |
| `social.admiration` | Approach, face, smile, follow | `follow`, `Face`, `smile` | |
| `social.contempt` | Turn away, laugh, slow | `turn_back`, `mock_laugh` | Hardest face to read; contempt is the lowest-recognised "basic" face `[F]` `[R06]`. |
| `social.neediness` | Hover at 1 to 2, repeat approaches | `follow`, repeated `hug` attempts | Bounded by `MAX_APPROACHERS` and the pair-try cap. |
| `social.fearOfExclusion` | Hover at the edge of a group, rush to join, `sad` when left out | `Face`, `walk`, cue `sad` | Feeds `faint` at the extreme. |
| `social.desireForStatus` | Take the centre, dominance poses | `preen`, `square_up` | |
| `social.desireForIntimacy` | Approach to 1, sit beside, whisper | `hug`, `kiss`, `comfort_pat`, `whisper` (existing chat mode) | Already gated through `rel.attraction`/`rel.comfort` for pair acts. |

Core mood and relational fields that should shape **how**, not **whether**:

| Field | Use |
|---|---|
| `core.circumplexRadius`, `core.arousal` | the `intensity` of an `Act` (0 to 1) → impact class (3.1) |
| `core.momentumArousal`, `core.momentumValence` | rising arousal momentum lowers the escalation threshold; falling momentum raises it |
| `core.stability` | low stability allows erratic behavior (fidgets, mood swings) and loosens the anti-jitter lock |
| `rel.resentment`, `rel.trust`, `rel.lastNegativeAt` | the grievance gate: a recorded negative event in a recent window (CiF queried 10 exchanges `[F]` `[R03]`) |
| `rel.curiosity` | `curiousApproach` |
| `rel.interactionCount`, `rel.lastInteractionAt` | reunion scaling; reaction size scaling |

### 4.5 Motive gates (seeds, all `[I]`)

The sources give structure (weighted soft rules, a responder check, a grievance in memory `[F]` `[R03]`) but **no numeric thresholds**. These are starting seeds, stored as data and tuned.

- Volition `v` = max over the verb's listed drivers, each in [0, 1] (for `rel.*` toward the target).
- A verb may fire when `v >= theta(rung)`: seeds rung 1 = 0.35, rung 2 = 0.45, rung 3 = 0.60, rung 4 = 0.70, rung 5 = 0.80, rung 6 = 0.90.
- Rungs >= 2 additionally require a **grievance** toward the target: a recorded negative event within the last N events (seed 10, from the CiF example) or `rel.resentment >= 0.5`.
- `act.strategicPatience` adds up to +0.15 to every `theta`.
- Contagion cap: at most 2 actors, or 1/3 of the cast if smaller, may be at rung >= 3 at the same time (`[F]` Dwarf Fortress spiral `[R03]`; the number is `[I]`).
- Gating must not run on LLM output alone: `[R07]` shows the models rarely choose these on their own, so the engine and the scenario select; the model may add words and may propose rung <= 2 and solo verbs (Q11).

### 4.6 Planner ceilings that must be lifted for any of this to surface

All confirmed in `plan.ts` and `constants.ts` for this checkout.

| Ceiling | Where | Effect on drama | Needed change |
|---|---|---|---|
| `allowedMove` forbids a reversal inside `DWELL_ZONE_MS` (30 s) | `plan.ts` | no pacing, no storming back | `purposeful` act flag (X13) |
| Rule 4: `desireForDistance > 0.6` or `threat > 0.5` withdraws and suppresses approach | `plan.ts` | a hot relationship has no confrontation | act lock: confrontation overrides withdrawal for the act's duration |
| `HUMAN_FACE_HOLD_MS` 7 s and `INTERLOCUTOR_MS` 20 s lock facing onto the interlocutor | `constants.ts`, rule 2 | `turn_back` and look-away are overridden | act lock suppresses rule 2 |
| `GESTURE_COOLDOWN_MS` 15 s per kind, 30 s for a repeat; planner budget 4 commands per 5 s | `plan.ts`, `constants.ts` | a multi-beat act would be dropped | acts run from the server table, outside the planner budget, inside the hotel backstop of 8 per 5 s |
| `if (!bodyIntent?.move) automaticRules` and `initiative()` returns on `bodyIntent.gesture` | `plan.ts` | other rules fire during an act | act lock |
| `actionEmotions` not in `AgentState` | `agent.types.ts` | no `act.*` driver reachable | pass `actionEmotions` in `PlanInput` (Q10) |
| Rule 2 faces a speaker only within 6 tiles | `plan.ts` | far witnesses never turn | server-authored witness reactions (section 5) |
| `committedEvents` is in `PlanInput` but never read | `types.ts` (`[R07]`) | no reaction to arrivals or to another person's body event | act events feed the planner memory |

## 5. Escalation ladder and witness/reaction contract

Written so that each clause can be checked from a frame log. A probe or a judge is a function of `act_*` events (section 6.3) and the existing delta frames.

### 5.1 Definitions

| Term | Definition |
|---|---|
| **Scene** | A scenario stage step. A scene ends on a `cut` (`PerfectmanUi::Cut` or `moved_room`) or when the scenario advances. Free play has no scene; see Q8. |
| **Beat** | One accepted `Act` with an `act_id`. Times: `T_s` start, `T_c` contact (for non-contact verbs the moment the signal lands), `T_e` end. |
| **Physical beat** | A beat whose verb has a rung >= 3 (`shove, slap, punch, kill`, plus `grab, splash, pie` as comic rung 3). |
| **Rung** | 1 `glare`, 2 `insult`, 3 `shove`, 4 `slap`, 5 `punch`, 6 `kill`. `splash` and `pie` count as 3. `square_up` as 1. `point_accuse` as 2. |
| **`rung_cur(a -> b, scene)`** | The highest rung actor `a` used against `b` in this scene, 0 if none. |
| **Principals** | the actor and the target of a beat. |
| **Witness** | Any actor, not a principal, in the same room, Chebyshev distance <= 6 to either principal at `T_c`, not `Lay`, not walking out of the room, and not already in an act. Humans are never forced to react. |
| **Earshot** | Chebyshev <= 6 tiles (`SAY_CLEAR_TILES`); garbled to 10 (`SAY_GARBLED_TILES`). |

### 5.2 Ladder rules

| id | Rule | Check |
|---|---|---|
| LAD-1 | **One rung per beat.** An autonomous beat at rung `r` against `b` is legal only if `r <= rung_cur(a -> b) + 1`. Moving down is always legal. | no autonomous jump > 1 |
| LAD-2 | **Authored skips** are legal only when the scenario lists the skip (`from`, `to`). The beat is logged with `skipped_rungs` = the rungs jumped. | every jump > 1 has a matching scenario entry |
| LAD-3 | **Physical budget.** The start of a physical beat must be >= 20 000 ms after the start of the previous physical beat in the same scene (any actors). A refused beat returns `actor_error` (new code, e.g. `act_budget`) and does not consume the budget. | min spacing of physical beats >= 20 s |
| LAD-4 | **One kill per scene.** A second `kill` in a scene is refused. | count(`kill` per scene) <= 1 |
| LAD-5 | **Mortality is authored.** `kill` is legal only if the victim is listed in the scenario's `may_die`. | no death outside the list |
| LAD-6 | **Motive gate.** Rungs >= 2 need `v >= theta` and a grievance (4.5). An authored beat bypasses the emotion gate, not LAD-1 to LAD-5 except as LAD-2 allows. | log carries `v`, `theta`, `grievance` |
| LAD-7 | **De-escalation resets.** After `restrain`, an apology (`kneel_beg` or an apology line) or a `turn_back` by the aggressor, `rung_cur(a -> b)` drops to at most 2 for 20 s. | |
| LAD-8 | **No reward after a kill.** No celebration verb (`Dance`, `Thumbs`, `preen`, `mock_laugh` toward the body) by the killer for 5 s after `T_c` of a kill. `[I]` `[R04]` | |
| LAD-9 | **Standing, still target.** Contact verbs require both principals still and adjacent (Chebyshev <= 1), as the pair precheck does; a seated, lying or dancing target downgrades to a non-displacing reaction and logs `downgraded`. | |
| LAD-10 | **Contagion cap.** At most 2 actors (or 1/3 of the cast) hold `rung_cur >= 3` toward anyone at once (4.5, seed). | |

### 5.3 Reaction and witness rules

| id | Rule | Check |
|---|---|---|
| REA-1 | **Target deadline.** Within 1500 ms of `T_c` the target shows at least one visible response: a forced step, a `Turn`, an `Expression` change, a gesture or posture change, or the death sequence. For a non-contact verb (`glare`, `insult`) the clock starts when the verb's signal lands (`T_c` = line time). | first target body event after `T_c` <= 1500 ms |
| REA-2 | **Witness deadline.** Within 3000 ms of `T_c` every witness shows at least one visible response: a `Face` toward a principal or the event tile, an `Expression` change, a gesture, a cue, a posture change, or a walk. A passive watcher still faces and changes expression. | every witness has an event in (`T_c`, `T_c` + 3000] |
| REA-3 | **Authored by the table, not the model.** The hotel verb table issues the default target and witness reactions. The planner or model may replace one inside the window only with a reaction of equal or greater visibility. Reason: listener reaction was 16 to 25 % when left to the planner (`[R07]`). | reaction rate 100 % with no LLM call |
| REA-4 | **Stagger.** Witness reactions start at `T_c` + 600 ms plus a per-witness offset by distance (about 150 ms per tile) and a seeded jitter, never exceeding 3000 ms. `[I]` so the cast does not react in unison (`[R05]` perception, `[R02]` collective gasp). | spread of witness start times > 0 |
| REA-5 | **Roles.** The table picks a role per witness from `rel.*` toward the victim and aggressor: *shocked* (default: `freeze_gasp`), *rescuer* (high `rel.affection` and `rel.trust` to the victim: `restrain` or `tend_fallen`), *gossip* (low affection to both: smile, or a whisper after), *passive* (face and expression only). `[I]` `[R02]` `[R03]` | roles logged |
| REA-6 | **Zero-witness cap** (if adopted, Q4). A beat with no witness is capped at rung 3. | |
| REA-7 | **Principal reaction after hit-stop.** The victim's extreme pose starts at `T_c + H`, never before `T_c`. The sound is at `T_c`. `[F]` `[R04]` | victim pose start >= `T_c` + `H` |
| REA-8 | **Memory.** Each principal and each witness gets a tone-labelled memory event stamped at `T_c`: `aggressor`, `victim`, `witnessed`. Witness weight scales with `rel.affection` to the victim (closeness-scaled, `[F]` `[R03]` Sims). Death is written as the strongest event. | event present for every principal and witness |

### 5.4 Human target rules (S3, S4)

| id | Rule |
|---|---|
| CHIP-1 | A violent contact verb whose target is a human requires `session.drama == on` for that human, default **off**. If off the beat is **refused** with a distinct code (`drama_off`) before any anticipation, and the planner marks that human "do not target" for the session. No substitute violent beat is played. |
| CHIP-2 | If on, the attacker plays a threat pose (`glare` hold) and the hotel shows the chip: **Take it / Dodge / Push back**, 4000 ms (`PAIR_TTL_MS`). These map to the existing `PairChoice`: Accept, Dodge, Push. |
| CHIP-3 | **Timeout = Dodge.** (The pair act's timeout completes the act; for violent verbs it does the opposite.) |
| CHIP-4 | **Take it:** contact at once (the pull-back and strike take the remaining A), `T_c` = the answer time. **Dodge:** the human's avatar takes the forced one-tile step back (existing); the attacker whiffs: forward step and a recovery of 800 to 1200 ms `[I]` (comic). **Push back:** the actor stumbles one tile (existing). REA-1 starts at the resolution. |
| CHIP-5 | Affection contact verbs on a human use the existing chip with D31 semantics (timeout completes). Q2 asks whether `kiss` should time out to Dodge. |
| CHIP-6 | A human may be moved by a violent verb only by the chip-gated forced step and, for `kill`, a forced posture. A human is never frozen, muted or removed. |
| CHIP-7 | A human with `drama == off` is not approached inside 3 tiles by a conflict verb (Q1 recommendation). |

### 5.5 Death rules (S5)

| id | Rule |
|---|---|
| DEATH-1 | State machine: `alive` → `dying` (the `die` beats, about 2.5 s) → `body` (lying, death effect on) → removed from `body` at the scene cut. |
| DEATH-2 | While `dying` or `body`: the actor leaves the speaker pool (the room speech arbiter does not give it turns), and any `chat` or body command from it is rejected (a new code such as `dead`). The planner does not plan for it. |
| DEATH-3 | The effect is a signifier that cannot be mistaken for gore. Candidates in 1.5; the final choice is Q6. The death pose must be distinguishable from `faint` and from sleeping (`faint` carries the alive marker, `die` does not; section 6 alive/dead test). |
| DEATH-4 | Memory: victim, killer and witnesses all get the death event (REA-8). Dread and social cost of killing `[F]` `[R03]` (CK3) is a candidate follow-up, not part of v1. |
| DEATH-5 | `ghost_voice`: allowed only in cinematic mode, only as `Thought`, never as `Chat`. |
| DEATH-6 | A killed human keeps the body for a few seconds (Q7 recommends 5000 ms), then regains control and the effect clears. |
| DEATH-7 | After the scene cut the actor is restored for the next scene unless the scenario marks permadeath (Q8). The memory stays. |

### 5.6 Rule to probe map

| Rule | Probe (new unless noted) | Pass seed |
|---|---|---|
| LAD-1 | `ladder-legal` | 100 % of unauthored escalations <= +1 |
| LAD-2 | `skip-authored` | every jump has a scenario entry |
| LAD-3 | `physical-spacing` | min gap >= 20 s |
| LAD-4/5 | `kill-per-scene`, `death-authorized` | <= 1; 100 % |
| REA-1 | `target-reaction-latency` | p100 <= 1500 ms |
| REA-2 | `witness-reaction-rate`, `witness-latency` | 100 %; p100 <= 3000 ms |
| REA-3 | `reaction-without-llm` | 100 % |
| REA-7 | `reaction-after-contact` | 100 % |
| CHIP-1 | `drama-off-respected` | 0 violent beats against an off human |
| CHIP-3 | `chip-timeout-dodge` | 100 % |
| DEATH-2 | `dead-silent` | 0 chat or body commands after `T_c` + `dying` |
| LAD-6 | `unmotivated-violence-rate` (a metric `[R03]` says nobody publishes) | 0 beats without a grievance, unless authored |
| existing, repaired | `gesture-diversity` per actor, not pooled; `body-activity-floor`; `expressive-range` (angry and sad actually sent) | floors, not only ceilings |

## 6. Legibility test ideas

The tests are the reality anchor for section 3: no technique stays unless it moves a number. They extend the list in `[R05]` section 3 and the forced-choice rule in `[R06]` (always offer "none of these").

### 6.1 Human-in-the-loop tests

| id | Test | How | Pass seed (`[I]`) |
|---|---|---|---|
| T1 | **Silhouette** | Render wind-up, contact and aftermath frames flat black at actual size and at 25 % scale; a grader names the act. | >= 80 % correct on `shove`, `slap`, `punch`, `die`, `cry`; `[F]` method `[R05]` |
| T2 | **Freeze-frame** | Pause on the contact frame; grader says who hit whom, which direction, how hard (light/heavy). | direction and ranking correct >= 80 % |
| T3 | **Blind label, sound off then on** | 2 to 3 s clips, forced choice with a "none of these" option; measure label accuracy and time. | >= 80 % with sound off (`[R05]`); higher with sound |
| T4 | **Confusable pairs** | Choose from: slap / punch / shove; faint / die / sleep; hug / kiss / comfort; cry / slump; glare / freeze; storm off / ordinary leave. | each pair separated >= 80 % |
| T5 | **Ablation** | Play each verb with one cue removed (hit-stop, tint, spark, shake, sound, knockback, cue icon, camera). The cue whose removal costs the most accuracy is kept; cues that cost nothing are dropped. | per-verb table |
| T6 | **Dynamic range** | Line up light, heavy and finisher; grader ranks them. | ranking correct |
| T7 | **Alive/dead** | After a fall: "is the character OK?" | `faint` = alive, `die` = dead, >= 90 % |
| T8 | **Crowd** | 4+ avatars, one acting; grader finds actor and target. | < 1 s |
| T9 | **Reaction completeness** | Grader checks that each beat has a target reaction and at least one witness reaction on screen. | 100 % |
| T10 | **Fatigue** | Ten repetitions of the same verb; shake and flash must not become annoying (`[R05]` SECONDARY). | rated tolerable |
| T11 | **Speed** | Clips at 1.25x. | light cues still read |
| T12 | **Default-mode (no camera)** | Same clips with no camera shot (the player-owned view), so overlays, cues and captions must carry the act. | >= 70 % `[I]` |

### 6.2 Automated proxies

1. Contact frame has the largest bounding-box displacement jump per 16 ms, and the effect overlay starts within +/- 2 frames of the sound (`[R05]` automated proxies).
2. Per-verb latency distributions (REA-1/2) from the frame log.
3. Verb mix per actor: share of the top verb, count of distinct verbs, count of `angry` and `sad` expressions. The existing `gesture-diversity` probe pools all actors and returns 0 under 5 gestures (`[R07]`), so it cannot enforce this.

### 6.3 Frames the judge and probes need

`[R07]` item 11 suggests the judge saw no body events. If confirmed, the new verbs would be invisible to the very grader that is supposed to reward them. The `Act` machinery must emit, into the artifact the probes and judge read: `act_start { act_id, verb, actor, with?, intensity, t }`, `act_contact`, `act_reaction { who, role, kind, t }`, `act_end { outcome }`, and `act_refused { code }`, plus the existing `avatar_state`, `avatar_action` and `moves` deltas. Fix the loader warning (`frames.jsonl has a frame with no kind or t`) first, or confirm it does not apply to the deployed build.

### 6.4 Judge

Add one axis, **body_drama**, to the six existing ones, with anchors that reward a visible choice and punish an empty body: 1 = actors stand still through conflict, 3 = reactions present but one gesture dominates, 5 = every strong line has a matching body response and the ladder is legible. It stays advisory until judge calibration works (kappa was 0.129, -0.116 and 0.107, target 0.7, `[R07]`).

## 7. Open questions for the owner cut

Each has my recommendation. None blocks the rest of the document; each says what it blocks.

1. **Are non-contact conflict verbs "violent" for the human opt-in gate?** (`glare`, `square_up`, `insult`, `point_accuse`.) Blocks: S3 wording. *Recommend:* `glare` and `point_accuse` are body-only and not gated; `insult` aimed at a human **is** gated (text at a person is the harassment case that platforms ban `[R01]`); `square_up` never closes inside 3 tiles of an opt-off human.
2. **Affection chip timeout.** The pair act completes on timeout (D31). *Recommend:* keep D31 for `hug`; for `kiss` on a human, time out to Dodge. A silent human has not agreed to a kiss. Blocks: CHIP-5.
3. **Consent model between actors.** *Recommend:* a scenario `drama` block with `max_rung`, `may_target` pairs and `may_die`; no violence between actors outside a scenario that opts in.
4. **Zero-witness cap (X15).** *Recommend:* adopt for autonomous beats only; authored beats may run unwitnessed.
5. **Per-pair repeat and per-actor cooldown beyond S7.** *Recommend:* the same verb on the same target not twice within 60 s (Sims "boring after 3x", `[F]` `[R03]`); keep the `[R03]` per-actor numbers out until a playtest shows spam.
6. **Death effect.** *Recommend:* `TrippyHalo` fx222 on a lying body as `die`, `Twinkle` fx4 for `faint` and for the dazed punch; avoid `Headless` and `BackKnife`. Someone must watch the animations first, I viewed one frame each.
7. **Killed human: how long, and may they chat while down?** *Recommend:* 5000 ms, and chat stays allowed; muting a person is punitive and the point is theatre. Blocks: DEATH-6.
8. **Scene boundary and what happens after the cut.** *Recommend:* free play has no kills (no scene, no `may_die`); after a scene cut the victim is restored with the memory, unless `permadeath` is set. Telenovela deaths that are not final are a genre trope (`[R02]`: "who killed her?").
9. **May humans who did not opt in still watch actor-on-actor violence in their room?** (X16) *Recommend:* yes, with a per-room "calm" switch (a VRChat-style panic button `[F]` `[R01]`) that blocks every contact verb and `kill`.
10. **Plumb `actionEmotions` into the plan input.** *Recommend:* yes, as the first engineering task; without it only core, social and relational fields can drive a verb and the 15 tendencies stay dead (4.3).
11. **Who picks the verb?** `body-intent.schema.ts` is strict and 13B models rarely choose body acts. *Recommend:* the engine and scenario select verbs by the gates in 4.5; the model may propose solo verbs and rungs <= 2 through a new strict `act` key in the `body` block, and it can veto by output only inside the gate window. Contact verbs and `kill` are never model-selected.
12. **Choreography clock: stream or compile?** The server owns state-changing beats (forced steps, `lay`, effects, memory). Sub-300 ms beats (a 100 ms hit-stop) cannot ride the 300 ms sim tick. *Recommend:* send the client a compiled timeline at `T_s` with absolute offsets for cosmetic beats, while the server executes the state-changing beats from the same table at the same offsets. Blocks: all of (b).
13. **Default-mode legibility without a camera.** *Recommend:* for default mode lean on overlays (cue icon, sign, effect) and a `Caption`; verify that `sfx` is delivered in default mode (`[U]`).
14. **Face art.** *Recommend:* do not gate any verb on angry, sad or surprised faces; the 13 of 183 gap stays a known limit (X11).
15. **Kiss staging.** Habbo bans sexual roleplay `[F]` `[R01]`. *Recommend:* cheek or air kiss with a heart, mask the gap, no lingering lip contact.
16. **Verb ids and the vendored schema.** Adding `Act` is additive to the director protocol, but `director.schema.json` is vendored and hashed (`schema_sha256` is warned on mismatch). *Recommend:* version the verb table separately from `PROTO` and publish its ids in a `verb-vocab.json` next to `cue-vocab.json`, with a test that checks both ends.
17. **Which tendencies mean what.** `emotion.types.ts` has only field names (4.3 readings are mine). *Recommend:* the owner confirms or edits the 15 readings in the cut.

## 8. Recommended v1 cut (16 verbs)

**Rationale in one line:** the smallest set that has a full ladder, all three tiers, the reaction contract, a death with a closing tableau, and enough solo language to show something other than a smile, with every verb buildable from existing primitives plus (b) procedural motion.

| # | Verb | Tier | Priority | Why it is in |
|---|---|---|---|---|
| 1 | `glare` | C | must | Rung 1; cheapest drama; tests the planner locks. |
| 2 | `insult` | C | must | Rung 2; the setup a slap needs `[F]` `[R02]`. |
| 3 | `shove` | C | must | Rung 3; clearest signal, forced step already exists. |
| 4 | `slap` | C | must | Rung 4; the telenovela signature. |
| 5 | `punch` | C | must | Rung 5; keeps the ladder whole; reuses the `slap` skeleton at class H. |
| 6 | `kill` | X | must | Rung 6; the single climax verb. |
| 7 | `die` | X | must | The victim half; the only verb that changes state. |
| 8 | `recoil` | Solo | must | Default target and witness reaction (REA-1, REA-2). |
| 9 | `freeze_gasp` | Solo | must | Default witness reaction; the collective gasp `[F]` `[R02]`. |
| 10 | `hug` | A | should | Exists on the wire; the affection counterweight; needs no new gate. |
| 11 | `kiss` | A | should | Exists; telenovela core; subject to Q2 and Q15. |
| 12 | `turn_back` | Solo | should | Cheap; `[R06]`; shows contempt and shame with facing alone. |
| 13 | `cry` | Solo | should | Existing `Raincloud` and `sad` cue; the grief and shame display. |
| 14 | `storm_off` | Solo | should | Displacement is the clearest channel; the table authors it because models do not leave. |
| 15 | `tableau` | X | should | Closes a rung >= 4 beat; the hook; no new art. |
| 16 | `restrain` | C | should | The rescuer role; the only de-escalation verb. |

**What this cut deliberately leaves out, and why.**

- First swap-ins if the schedule allows one more: `tend_fallen` (needed for a rescuer after a death) and `faint` (telenovela signature, cheap, shares `Lay` with `die`).
- Cut for now: `give_item` (blocked by `Carry`), `grab` (no art), `fake_faint`, `slap_kiss` (trap risk on humans), `pie` (art unverified).
- Could later: `blow_kiss`, `comfort_pat`, `rush_embrace`, `dance_with`, `square_up` (folded into `glare`), `point_accuse`, `splash`, `pace` (blocked by the reversal lock), `mock_laugh`, `kneel_beg`, `slump_sit`, `fist_shake`, `preen`, `ghost_voice`.

**What v1 needs underneath (from 3.5, in order):** the `Act` command and verb table; the act lock on the planner; the `act_*` frames and the loader fix; the drama opt-in and violent chip (CHIP-1 to CHIP-4); the death state machine; the five missing sounds; the (b) procedural motion set (lunge, hit-stop, tint, knockback, shake, recoil, fall); then probes (5.6) and the legibility tests (6.1). Items marked `[U]` in 3.5 (`Stop` on a gesture, walk-cancel) should be checked first because several cards lean on them.

**Signature moves for (c), later:** a real slap arm sprite, a hand-to-cheek pose and a hug hold are the three candidates, in that order (S6 allows 2 to 3).

**Recorded value for an eventual tuning pass.** Every number in sections 3 and 5 is a seed stored as data: impact classes, anticipation, hit-stop, reaction deadlines (fixed by S8 at 1500 and 3000 ms), hold lengths, tableau duration, the thresholds in 4.5 and the 20 s budget (fixed by S7). Only the S7 and S8 numbers are decisions; the rest move with playback.
