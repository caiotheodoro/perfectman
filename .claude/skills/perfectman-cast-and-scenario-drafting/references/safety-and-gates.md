# Safety and gates

Sources: `docs/drama/act-contract.md` (frozen, rev 2) sections 2, 6, 7, and `docs/drama/verb-bible.md` section 5. HB-side: `docs/perfectman/drama-consent-safety.md`. If this file and the contract disagree, the contract wins and this file is the bug.

## The `drama:` block

Written in scenario frontmatter. Free play (no block) equals `{max_rung: 3, may_target: [], may_die: [], permadeath: false}`.

| Key | Rule for the author |
|---|---|
| `max_rung` | The highest ladder rung any act may reach. 0 to 6, or a ladder verb. Set it to the highest rung the story actually uses. An affection-only scene uses 0. |
| `may_target` | Ordered pairs `[aggressor, victim]` for rung 4 and above (slap, punch, kill). Only the pairs the story needs. |
| `may_die` | Victims of a `kill` or a standalone `die`. Only who the story kills. |
| `permadeath` | Whether the killed person stays gone after the scene cut. |
| unknown key | Compile error. The hotel drops the whole block and runs free play. |

Refs are cast names or agent ids. `@human` exists as a pseudo-ref. **This skill never writes `@human`** in `may_target`, `may_die` or a beat. Putting a real visitor in a scene's violence list is a consent decision that belongs to the hotel and its chip flow, not to a scene author. The compiler also rejects `@human` as an aggressor and as a beat target.

## Rules a beat plan must obey

| Id | Rule | What to do |
|---|---|---|
| LAD-1 | An autonomous act at rung `r` is legal when `r <= max(current, 1) + 1`. A scene opens at rung 2 at most. Moving down is always legal. | Climb one rung per beat, or use an authored skip. |
| LAD-2 | An authored skip (`skip: true`) needs a `drama` block with `max_rung >=` the verb's rung. | Use only for the climax. List why in `subtext_prompt`. |
| LAD-3 | Physical beats (shove, slap, punch, kill) are at least 20 s apart in a scene. | Space them. |
| SCENE-3 | A scene cut resets every pair's rung, the 20 s spacing, the kill count, open chips, acts in flight and bodies. Cooldowns survive. | After a cut, a scripted ladder beat needs its own `skip: true` or must restart at rung 2. |
| LAD-4 | One `kill` per scene. | Never plan two. |
| LAD-5 | `kill` needs the victim in `may_die`. | Declare it. |
| LAD-8 | The killer cannot celebrate for 5 s after a kill. | Do not plan a gesture for them in that window. |
| LAD-11 | An unscripted (model or director) act of rung 4 or above is blocked `ladder` (`zero_witness`) when no avatar besides the two principals is within 6 tiles. Scripted acts are exempt. A human counts as a witness. | Script the peak of a duet. For a steered slap, punch or kill, cast at least three. |
| GATE-7, LAD-9 | Glare reaches 8 tiles, insult 6, contact verbs 1. Contact needs both people not walking and standing or sitting. A lying person makes it `blocked too_far` (posture). | Put them adjacent and standing in `First Move`. A scripted contact beat gets the pair walked together for up to 30 s (`BeatPlayer.walkCloser`), but do not rely on it. |
| DEATH-3 | A victim on a seat tile stays seated: the halo and state apply but the fall is downgraded. | Stand the victim of a kill. |
| SCN-6 | A scenario with a non-empty `may_die` must author at least one scene cut, or the body stays until the run ends. | Add a cut after the death. |
| GATE-6 | A violent act aimed at a human needs that human's opt-in and a chip. | Not this skill's concern: it never targets humans. |
| calm room | A calm room blocks contact verbs. | Treat `blocked` as story (see the runtime skill). |

Other limits: `at` from 0 to 3600 s, at most 40 scripted beats, a cut reason of at most 40 characters, chat of at most 200 characters, an actor never targets themself, a targeted verb always names a target and an untargeted verb never does.

## Checks the drafting skill runs on its own plan before emitting files

1. Every `act` is in the 18. Every targeted act has a target and no untargeted act has one.
2. No `@human` anywhere.
3. `max_rung` equals the highest rung used. Pairs for rung 4 and above are in `may_target`.
4. At most one `kill`. If there is one, the victim is in `may_die` and at least one cut exists.
5. Physical beats are at least 20 s apart.
6. Every contact beat has an earlier beat or First Move that puts the two people adjacent and still.
7. Cast size is 2 to 12.
8. A `STEERED` beat has no `act`-dependent promise in the prose. It can happen or not.
9. A steered rung 4 or above beat only exists in a cast of three or more. In a duet, the peak is `SCRIPTED`.
10. The victim of a kill starts standing, and never sits before the kill.

## Tone

The violence is stylized (the verb bible calls it telenovela): a slap is a hand across the face and a gasp, a death is a swoon and a fall. No blood, no weapons, no gore in prose either. Keep the camera on the status shift and the aftermath, not on the harm.
