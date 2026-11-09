# Action tag to verb, and what to do when no verb exists

The vocab is `packages/hotel/schema/verb-vocab.json` (version 1, rev 3, sha-pinned in perfectman and Habbo). It has 18 verbs. This skill never adds one, never renames one and never edits the file.

## What an actor and a scenario can express today

- **An actor's turn** (`hotel-body-hint.ts`, `hotel-drama-hint.ts`): a chat line plus an optional `body` block with `move` (approach, go_to, follow, leave, stay), `posture` (stand, sit, lay), `gesture` (wave, kiss, laugh, thumbs, dance, sign, stop), `expression` (neutral, smile, angry, sad, surprised, sleepy), `face`, `order`. With drama on, `body.act` takes one of the 18 verbs and replaces `gesture` and `posture`.
- **A scenario file** can script only two things: an act `{at, actor, verb, with?, skip?}` and a scene cut `{at, cut}`. Step primitives such as `forced_step`, `motion`, `camera` and `effect` live inside each verb's timeline. An author cannot compose them.

So "staging" means steering the actors toward body-block moves, or picking the nearest verb. It never means writing new steps.

## Framework tag to verb

| `physical_action_tag` | `act` | Notes |
|---|---|---|
| `NONE` | `null`, or a verb that is not a contact or collapse action (`glare`, `insult`, `recoil`, `freeze_gasp`, `tableau`) | No physical-action tag. `act` null means the beat is `STEERED`. |
| `KILLING` | `kill` | Rung 6. Needs `max_rung: 6`, the pair in `may_target`, the victim in `may_die`, and a scene cut. Stylized: a swoon and a fall, no blood, no weapon. |
| `KISSING` | `kiss` | Affection. Target required. Both still and adjacent. Chip only for a human target. |
| `HUGGING` | `hug` | Same as kiss. A human's silence counts as the initiator's steps only. |
| `CRYING` | `cry` | No target. May happen lying down. |
| `VIOLENT_PUSH` | `shove` | Rung 3. Allowed in free play between actors. |
| `VIOLENT_STRIKE` | `slap` or `punch` | Rung 4 or 5. Needs a block with `max_rung` and the pair in `may_target`. Added to the framework's tags, which had none for these. |
| `PHYSICAL_RETREAT` | `turn_back` (aimed at someone) or `storm_off` (leaves, no target) | Use `turn_back` for a snub, `storm_off` for an exit. |

Other verbs and when to reach for them:

| Verb | Use for |
|---|---|
| `glare` (rung 1), `insult` (rung 2) | Opening of conflict. A scene may open at rung 2. A scripted `insult` is silent (an authored beat has no text field); a steered one carries a line of at most 200 chars. |
| `slap` (4), `punch` (5) | Needs a `drama` block with `max_rung` and the pair in `may_target`. |
| `recoil`, `freeze_gasp` | A witness's shock. No target. |
| `faint` | A body going down without death. `tend_fallen` brings the get-up forward by 1.5 s. It does nothing for a death. |
| `die` | Standalone death. The actor must be in `may_die`. |
| `restrain` | Pull someone back from a blow. Target must be another actor. |
| `tend_fallen` | Kneel by someone who is down. |
| `tableau` | Every actor inside a 6-tile radius holds the picture for 2.5 s. A human is never held. |

## Gaps and recipes (`staged_as`)

When the story needs something no verb renders, do not invent a verb. Pick the first recipe that fits. Set `act` to the verb you chose or to `null`. Fill `staged_as` with what you steer, and keep the original wish in `ideal_action`.

| Wish | Recipe |
|---|---|
| Stab, shoot, strangle, poison | `kill` for the death, or `punch` or `slap` for the blow. Say in `ideal_action` what the story wanted. No weapon is ever shown. |
| Hold hands, stroke a cheek, comfort touch | `hug` if the story can bear a hug. Otherwise `move.approach` + `face` + `expression: smile` or `sad`, steered in the persona's Triggers. |
| Sit beside someone | `move.approach` then `posture: sit`. |
| Chase | `move.follow`, then the physical verb when adjacent. Contact verbs need both principals still and within one tile. |
| Whisper a threat | `move.approach` + `face` + `glare`, with the line in chat. |
| Slam a door, throw an object | Not renderable. Use `storm_off` and a scene cut. |
| Laugh in someone's face | `gesture: laugh` + `expression: smile`. |
| A person falls but does not die | `faint` on that person, written as their own beat. A beat cannot make someone else faint. |
| Revive a death | Only a scene cut revives a body. `tend_fallen` just hurries a `faint`. |
| Applaud, point, toast | `gesture: thumbs` or `sign`. |

Rules:

- `render_mode: staged` (default): every beat must be playable. `act` is a verb or `null` with a `staged_as` block.
- `render_mode: ideal`: a beat may carry only `ideal_action`. Mark it so a human can see what is waiting for engine work. The runtime skill ignores `ideal_action`.
- Never present a staged beat as the original in the prose. The reader of the script should not be told the engine could not do it.
