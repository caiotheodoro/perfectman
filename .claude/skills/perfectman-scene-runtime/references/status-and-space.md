# Status and space

Keith Johnstone: status is something a person does, moment by moment, not something they have. A scene gets its tension from status transactions.

## Reading status from the room

| | High status | Low status |
|---|---|---|
| Eyes | Holds eye contact, breaks it last | Looks away, comes back late |
| Body | Still, expansive, takes the central tile | Small, shifts, touches own face, stays near a wall |
| Voice | Slow, short, leaves silences, interrupts without apology | Fast, trailing, hedged, apologises |
| Space | Others come to them | They go to others |
| Perfectman body block | `move: stay`, `face` the other person, `posture: stand` | `move: approach` or `leave`, `expression: sad` or `surprised`, `posture: sit` |
| Verbs | `glare`, `turn_back`, `insult` | `recoil`, `freeze_gasp`, `cry`, `storm_off`, `faint` |

Status is relative. The same person is high status with one character and low with another. Track it per pair when it matters.

## Status transactions

| `status_transaction` | What happens | Typical beats |
|---|---|---|
| `RAISE_STATUS` | The speaker takes space or power from the other | `glare`, `insult`, `turn_back`, a refusal, a silence held a second too long |
| `LOWER_STATUS` | The speaker gives it away, or loses it | A plea, an apology, `recoil`, `cry` |
| `MAINTAIN_STATUS` | A tactic fails to move anyone | A deflection, a joke, a change of subject |
| `COLLAPSE_STATUS` | High to low in one beat, involuntarily | `faint`, `die` (in the victim's own beat), `cry`, `freeze_gasp`, exposure of a secret |

A good scene has at least one shift in who is high. A beat that does not change status or tactic is not a beat: merge it into the previous one.

## Status in the persona numbers

`baseline_status` has no field of its own. It shows up in the existing ones:

| Baseline | `social` | `mood` |
|---|---|---|
| 0.7 to 1.0 | `desireForStatus` 0.6 to 0.8, `pride` 0.5 to 0.7, `contempt` as needed, `socialAnxiety` at most 0.1 | `stability` 0.7 to 0.9 |
| 0.4 to 0.7 | middling, `affection` or `suspicion` carry the colour | `stability` 0.5 to 0.7 |
| 0.0 to 0.4 | `socialAnxiety` 0.4 to 0.7, `fearOfExclusion` or `shame` 0.3 to 0.6, `neediness` as needed | `stability` 0.3 to 0.5, `arousal` higher |

## Stage frame (`plan.json` `stage_frame`)

A tile room has no front. A scene gets one by naming `audience_edge`, the room edge nearest the spectate camera (`N`, `E`, `S`, `W`, default `S`). Downstage is the row against that edge, upstage the row opposite. Stage left and right are from the point of view of a person facing the audience. Take the compass as the room's own map shows it and check the spectate camera (`docs/perfectman/spectate-and-audience.md`, `camera-and-audio.md` in Habbo) before trusting the default.

The frame lives only in `plan.json` and in the prose of `First Move`. Perfectman never reads it, and unlike `setting` and `props` it is not a scenario key. It guides how `First Move` is written and how a staged beat is read. Use it to tell the actors where to stand in words, not to assign coordinates.

Nine zones: `downstage_left`, `downstage_center`, `downstage_right`, `mid_left`, `center`, `mid_right`, `upstage_left`, `upstage_center`, `upstage_right`.

| Zone | Visibility and status | Use for |
|---|---|---|
| `downstage_center`, `center` | Highest. Everyone sees the face | The person who runs the scene, or the one about to lose it in public |
| `downstage_left`, `downstage_right` | High, off the axis | The challenger |
| `mid_left`, `mid_right` | Middle | Witnesses with a stake |
| `upstage_center` | Low from the camera, strong when the others look back at them | Someone who watches, then speaks |
| `upstage_left`, `upstage_right` | Lowest. The corners | The person who wants to disappear, the chorus |

Rules:

- Move people through zones as status moves. A character who falls in status gives up centre, and one who rises takes it. Say so in prose, not in coordinates.
- Contact verbs need two people within one tile, not walking, and standing or sitting. The zone before a contact beat must put them next to each other, and a person who will be knocked down starts standing.
- Dense casts: no more than three people in `center` and the two `downstage` zones at once. Chorus characters hold `upstage_*` and `mid_*`.
- Camera: a death, a kiss or a collapse should happen in `downstage_*` or `center`, where the spectate camera looks. A scene cut moves nobody and not the camera. It resets rung, spacing and the kill count.
