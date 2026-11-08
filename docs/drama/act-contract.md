# Act contract v1: the frozen spec for the drama verbs

Status: **FROZEN CONTRACT SPEC, revision 1, for parallel implementation.** Docs only: no code, no schema file and no wire change ships with this document. The hotel (Rust, repo `general/habbo`, "Tilehouse") and perfectman (TypeScript, this repo) are built against it at the same time, so every name, number and id below is exact. Owner decisions are settled and are not reopened here. Where [verb-bible.md](verb-bible.md) and this file disagree, **this file wins** (section 14.2 lists every bible rule it amends). The machine-readable verb table is `docs/drama/verb-vocab.draft.json`; it is the source of truth for timings, gates and step lists, and Appendix A is generated from it.

Anchors read for this revision: hotel `drama-base` at `517ae35` (`crates/sim/src/director.rs`, `perfectman.rs`, `actions.rs`, `protocol.rs`, `crates/server/src/perfectman/*.rs`, `world/actors.rs`, `web/pair.js`, `docs/perfectman/*`); perfectman `docs/drama-verb-bible` plus the provisional drama events (`feat/drama-grading-core`), probes (`feat/drama-probes`) and judge rubric (`feat/drama-judge`) worktrees. Hotel facts below were checked in that code; where I could not check something it is marked **unverified**.

## 0. How to read this

### 0.1 Conventions

- **Normative words.** MUST, MUST NOT, MAY are normative. A rule with an id (`NEG-3`, `GATE-6`) is normative and has exactly one row in the test matrix (section 9). Ids that already exist in the bible (`LAD-*`, `REA-*`, `CHIP-*`, `DEATH-*`) are reused with the same meaning unless section 14.2 says they are amended.
- **JSON.** Examples are literal wire JSON. `seq` is the per-connection counter of `director-protocol.md` section 2 and is shown because probes read it. Ids on the Director wire are integers: actors are negative (`-701` is run 7 slot 1), humans positive. Times `at` are epoch milliseconds from the hotel clock.
- **Dialect.** "v1 session" is a Director connection that negotiated `proto` 1. "v2 session" negotiated `proto` 2 and the `drama.v1` capability (section 1).
- **Real primitives only.** Every step in the verb table uses a primitive that exists today (an `Action`, `Face`, sign style 11, 13 or 16, a catalog effect, a `PerfectmanUi` kind, a cue-vocab name), or is marked as needing one of: `b` (new client procedural motion), `sfx` (one of the five new sounds), `overlay` (client overlay of a catalog effect on any avatar), `verify` (a primitive whose behaviour is unverified, section 5.9).

### 0.2 The nine identifier sets (single source)

These are used identically everywhere. The JSON file repeats them under `enums`.

| Set | Members |
|---|---|
| Verbs (18) | `glare`, `insult`, `shove`, `slap`, `punch`, `kill`, `die`, `recoil`, `freeze_gasp`, `hug`, `kiss`, `turn_back`, `cry`, `storm_off`, `tableau`, `restrain`, `faint`, `tend_fallen` |
| Ladder (rung 1 to 6) | `glare` 1, `insult` 2, `shove` 3, `slap` 4, `punch` 5, `kill` 6 |
| Physical beats | `shove`, `slap`, `punch`, `kill` |
| Origins | `model`, `director`, `scenario` |
| Outcomes (`act_done.outcome`) | `landed`, `dodged`, `blocked`, `declined`, `timeout`, `aborted` |
| Chip answers | `take`, `dodge`, `push_back`, `timeout` |
| Blocked reasons (`outcome=blocked`) | `kill_switch`, `calm_room`, `consent_off`, `ladder`, `budget`, `cooldown`, `too_far`, `dead_target`, `no_scenario_gate`, `rate_limit` |
| Abort reasons (`outcome=aborted`) | `target_moved`, `target_gone`, `actor_gone`, `actor_dead`, `scene_cut`, `run_end`, `kill_switch`, `calm_room` |
| Impact classes | `L`, `M`, `H`, `F` |

### 0.3 Constants and configuration (single table)

Generated from `verb-vocab.draft.json` `constants`. Environment variables are in section 6.1.

| Name (JSON `constants`) | Value | Used by |
|---|---|---|
| `chip_ttl_ms` | `4000` | Consent chip lifetime (existing `PAIR_TTL_MS`). |
| `chip_windup_ms` | `150` | After a `take`, contact comes this long after the answer (TBL-3). |
| `chip_cooldown_ms` | `60000` | A human who dodged, pushed back or timed out a violent chip is left alone this long (CHIP-9). |
| `target_deadline_ms` | `1500` | REA-1: the target's reaction, from `Tc`. |
| `witness_deadline_ms` | `3000` | REA-1: a witness's reaction, from `Tc`. |
| `earshot_tiles` | `6` | Witness radius, Chebyshev (`SAY_CLEAR_TILES`). |
| `physical_spacing_ms` | `20000` | LAD-3: between physical beats in a room. |
| `kills_per_scene` | `1` | LAD-4. |
| `same_verb_target_cooldown_ms` | `60000` | GATE-10: same actor, verb, target. |
| `ladder_open_rung` | `2` | LAD-1: a scene may open with a verb up to this rung (glare, insult). |
| `zero_witness_cap_rung` | `3` | LAD-11: autonomous acts above this rung need a witness. |
| `deescalate_to_rung` | `2` | LAD-7. |
| `no_reward_ms` | `5000` | LAD-8: the killer is locked from celebration verbs. |
| `tableau_hold_ms` | `2500` | TBL-11. |
| `tableau_radius_tiles` | `6` | TBL-11. |
| `human_down_ms_default` | `5000` | DEATH-6 default of `PERFECTMAN_DRAMA_HUMAN_DOWN_MS`. |
| `scene_body_max_s_default` | `600` | SCENE-5 default of `PERFECTMAN_DRAMA_SCENE_BODY_MAX_SECS`. |
| `harm_max_default` | `3` | SAFE-4 default of `PERFECTMAN_DRAMA_HARM_MAX` (N). |
| `harm_window_s_default` | `300` | SAFE-4 default of `PERFECTMAN_DRAMA_HARM_WINDOW_SECS`. |
| `pause_s_default` | `600` | SAFE-4 default of `PERFECTMAN_DRAMA_PAUSE_SECS`. |
| `act_id_pattern` | `"^[A-Za-z0-9_.:-]{1,32}$"` | ACT-2. |
| `text_max_chars` | `200` | ACT-2 (`insult` text). |
| `hit_stop_ms` | `{"L": 50, "M": 100, "H": 150, "F": 175}` | TBL-4, per impact class. |
| `class_bounds` | `{"L_below": 0.34, "M_to_inclusive": 0.67}` | TBL-4: `L` below 0.34, `M` up to and including 0.67, `H` above. |
| `witness_stagger` | `{"base_ms": 600, "per_tile_ms": 150, "jitter_ms": 200, "cap_ms": 2800}` | REA-4. |

## 1. PROTO negotiation

### 1.1 What exists today (checked)

- The hotel sends `hello{proto: director::PROTO, ...}` (`world/actors.rs` `fn hello`). The sidecar answers `hello_ack{proto, resume, sidecar}`.
- The hotel accepts `hello_ack.proto` equal to `PROTO` or `PROTO - 1` and closes `4002` otherwise (`perfectman/director.rs`, the `HelloAck` arm). `PROTO` is 1 today, so `1` is accepted (and `0`, which no sidecar sends).
- The perfectman sidecar closes `4002` when `hello.proto > PROTO` (`packages/hotel/src/director/director-client.ts`, `onHello`). **A PROTO 1 sidecar therefore cannot be sent `hello.proto = 2`.** This is why the offer cannot ride in `hello.proto`.
- `hello` and `hello_ack` are parsed without a runtime schema check on the sidecar (`JSON.parse` then a cast); unknown fields are ignored on both ends (`director-protocol.md` section 2). The `director.schema.json` hash only warns.
- Closed enums in the generated schema (`ActorErrorCode`, `ActorGoneReason`, `ActorCmd`) are re-typed by this contract. `director-protocol.md` section 14 says re-typing bumps `proto`. That is why this contract is PROTO 2 and not an additive change.

### 1.2 Rules

| Id | Rule |
|---|---|
| NEG-1 | The hotel binary defines `PROTO = 2` (highest it speaks) and `PROTO_BASE = 1` (the dialect `hello.proto` carries). `hello.proto` MUST stay `1` in every `hello`, so a PROTO 1 sidecar never sees a value it refuses. The hotel keeps accepting `hello_ack.proto` in `[PROTO_BASE, offered_max]` (the existing `PROTO` and `PROTO - 1` rule, now `2` and `1`; `0` is no longer accepted). |
| NEG-2 | The offer is additive fields on `hello`, sent **only when `PERFECTMAN_DRAMA` is on** (section 6.1): `proto_max: 2`, `caps: ["drama.v1"]`, and `drama` (below). With the switch off the hotel sends a `hello` byte-for-byte equal to today's, and `offered_max` is 1. |
| NEG-3 | A v2 sidecar answers `hello_ack.proto = min(2, hello.proto_max ?? hello.proto)`. It adds `caps: ["drama.v1"]` and `sidecar.verb_vocab` only when its own `PERFECTMAN_DRAMA` is on, `hello.caps` contains `drama.v1`, and `hello.drama.verb_vocab.version` equals its vendored `verb-vocab.json` `version` (section 10). Otherwise it answers `proto: 1` with no `caps`, which is a plain PROTO 1 session. |
| NEG-4 | The session dialect is 2 iff `hello_ack.proto == 2` and `hello_ack.caps` contains `drama.v1` and the hotel offered it. Anything else is dialect 1. A `hello_ack.proto` above `offered_max` closes `4002`. The dialect is per connection and is renegotiated on every reconnect. |
| NEG-5 | The hotel MUST NOT emit any frame, field, enum member or error code introduced here to a dialect 1 session, and MUST NOT run the verb table for it. In a dialect 1 session `actor_cmd{k:"act"}` is an unknown `k` and answers `actor_error{bad_message}` exactly as today (`director-protocol.md` section 2). |
| NEG-6 | `ActorCmd::Pair`, `pair_reaction` and `pair_prompt` stay frozen and keep working in both dialects. In a v2 session `hug` and `kiss` SHOULD be sent as `act` (they then emit act frames and use `act_prompt`); `pair` remains accepted and unchanged. Neither path emits the other's frames. |
| NEG-7 | The verb vocabulary handshake: `hello.drama.verb_vocab` and `hello_ack.sidecar.verb_vocab` carry `{version, rev, sha256}` of the published `verb-vocab.json` bytes. A `version` mismatch makes the sidecar answer dialect 1 (drama off for the session, a notice is logged). A `rev` or `sha256` mismatch with an equal `version` is a warning only, as with `schema_sha256`. |
| NEG-8 | Acts are hotel-run: a socket loss does not stop an act in flight. Frames emitted while no link is attached are dropped (existing `link_send` behaviour). On the next dialect 2 `hello` the hotel lists actors that are `dying` or `body` in `hello.drama.dead` so a resumed sidecar does not plan for them. |

`hello` when the switch is on (new fields only; the rest is `director-protocol.md` section 6.1):

```json
{"t":"hello","seq":1,"proto":1,"proto_max":2,"caps":["drama.v1"],"session":"b2f1","hotel":{"build":"517ae35","tick_ms":300,"max_chat":200,"max_actions_per_5s":8,"join_interval_ms":200,"human_reserve":10,"max_avatars_per_room":50},
 "drama":{"enabled":true,"verb_vocab":{"version":1,"rev":1,"sha256":"3f1c9a5e7b2d40688a1c0e94f5d27b3a6c8e1d0f9b4a7c25e83d6f0a1b9c4d72"},"chip_ttl_ms":4000,"harm_max":3,"harm_window_s":300,"dead":[-702]},
 "runs":[],"untrusted_text":["runs[].room_name","rooms[].name"],"actors":[]}
```

`hello_ack` from a v2 sidecar (and the PROTO 1 answer a v1 or degraded sidecar gives):

```json
{"t":"hello_ack","seq":1,"proto":2,"caps":["drama.v1"],"resume":[7],"sidecar":{"version":"0.9.0","build":"a41c7e2","schema_sha256":"9d2e...","verb_vocab":{"version":1,"rev":1,"sha256":"3f1c9a5e7b2d40688a1c0e94f5d27b3a6c8e1d0f9b4a7c25e83d6f0a1b9c4d72"}}}
{"t":"hello_ack","seq":1,"proto":1,"resume":[7],"sidecar":{"version":"0.8.3","build":"77be10c"}}
```

Compatibility matrix:

| Hotel | Sidecar | Result |
|---|---|---|
| old (PROTO 1) | new | hello has no `proto_max`; the sidecar answers `proto:1`; no drama. |
| new, switch off | old or new | hello identical to today's; `proto:1`; no drama. |
| new, switch on | old | hello has `proto:1`, `proto_max:2`; the old sidecar ignores the extras and answers `proto:1`; no drama, nothing breaks. |
| new, switch on | new, switch on, same vocab version | dialect 2. |
| new, switch on | new, vocab version differs | sidecar answers `proto:1`; no drama; warning. |

## 2. ActorCmd::Act

### 2.1 Shape

```json
{"t":"actor_cmd","seq":41,"cid":31,"run":7,"lease":3,"actor":-701,
 "cmd":{"k":"act","act_id":"a17","verb":"slap","with":9,"intensity":0.6,"origin":"director"}}
```

| Field | Type | Required | Range and meaning |
|---|---|---|---|
| `k` | `"act"` | yes | Discriminator. New `ActorCmd` variant `Act`. |
| `act_id` | string | yes | Matches `^[A-Za-z0-9_.:-]{1,32}$`. Chosen by the sidecar. Unique within the run for its whole life (a reuse is `bad_message`). Echoed on every act frame. |
| `verb` | string | yes | One of the 18 verbs (section 0.2). |
| `with` | integer | per verb | Avatar id in the **same room** as the actor. Required, optional or forbidden per the verb's `target` mode (table below). Never the actor itself, never a narrator (slot 0). |
| `intensity` | number | no | `0 <= x <= 1`, finite. Absent means the verb's `intensity.default`. The effective value is echoed in `act_started`. It selects the impact class (TBL-4). |
| `origin` | string | no | `model`, `director` or `scenario`. Default `director`. `model` and `director` are autonomous; `scenario` is authored. |
| `authored_skip` | boolean | no | Default `false`. Honoured only with `origin:"scenario"` (GATE-5). |
| `text` | string | `insult` only | At most 200 characters; links, markdown and HTML are stripped like `chat` (`filter::strip_bot_output`). Spoken as a `shout` at contact. Any other verb with `text` is `bad_message` (`detail:"act.text"`). |

Target modes (the table's `target`): `required`: glare, insult, shove, slap, punch, kill, hug, kiss, restrain, tend_fallen. `optional` (the target is a facing or cause): die, recoil, freeze_gasp, turn_back, storm_off, tableau. `none` (self only): cry, faint.

### 2.2 With a target, without a target, solo verbs

- **With a target.** `with` names another avatar in the room. The target kind is checked against the verb's `target_kinds` (`restrain` takes actors only). A human target engages the consent rules of section 6. `tend_fallen` additionally requires a fallen target (section 2.3).
- **Without a target.** Allowed only for `optional` and `none` verbs. `optional` verbs skip their target-relative steps (for example `recoil` without `with` leans away from nothing and shows only the expression, cue and sound; `turn_back` without `with` turns 180 degrees from the current facing; `tableau` is centred on the actor).
- **Self-directed verbs** (`cry`, `faint`, `storm_off`, `recoil`, `freeze_gasp`, `turn_back`, `tableau`, `die`: no contact and no consent profile) never put a chip in front of anyone and never touch anyone else's avatar.
- **Facing target on a solo verb.** For `optional` verbs `with` is a facing or cause only. It does not make the act a contact act and is never consent-gated.

### 2.3 Validation and error codes

Validation runs in this order and stops at the first failure. Every failure answers `actor_error{cid, actor, code, detail}` (`director-protocol.md` section 9). Codes marked new exist only in v2 sessions and extend `ActorErrorCode`.

| Id | Check | Code | `detail` |
|---|---|---|---|
| ACT-1 | Frame is a dialect 2 session, `k` is `act` | `bad_message` | omitted (v1 session: unknown `k`) |
| ACT-2 | Field types and ranges: `act_id` pattern, `intensity` in `[0,1]`, `with` integer, `text` string at most 200, `origin` and `authored_skip` types, no unknown value in a closed field | `bad_message` | the field path, for example `act.intensity`, `act.act_id`, `act.text`, `act.origin` |
| ACT-3 | `act_id` already used in this run | `bad_message` | `act_id_reused` |
| ACT-4 | `verb` not in the 18 | `unknown_verb` (new) | the verb as sent, cut to 40 chars |
| ACT-5 | Target mode: `required` verb without `with` | `target_required` (new) | the verb |
| ACT-6 | Target mode: `none` verb with `with` | `target_forbidden` (new) | the verb |
| ACT-7 | `with` equals the actor, is a narrator, or is a Tilehouse bot; or the target kind is not allowed (`restrain` on a human); or `tend_fallen` target is not fallen | `bad_target` (new) | `self`, `narrator`, `bot`, `kind` or `not_fallen` |
| ACT-8 | `with` is not an avatar in the actor's room | `target_gone` (existing) | the id |
| ACT-9 | The actor is `dying` or `body` | `actor_dead` (new) | the actor's death `act_id` if known |
| ACT-10 | The actor is busy: it is the initiator of an open act, is inside one of its own reaction or hold steps, or is locked (REA-9) | `act_busy` (new) | the busy `act_id`, or `no_reward` |
| ACT-11 | The actor's posture is not in the verb's `actor_posture`, or the action would be refused by `Room::act` (lying, walking for a gesture) | `action_not_here` (existing) | the posture |
| ACT-12 | The 8 commands per 5 s budget of the actor (shared with every `k` except `typing` and `chat`) | `slow_down` (existing) | omitted |
| ACT-13 | `run` or `lease` stale or unknown, `actor` not held by the run | `stale_lease`, `no_such_run`, `run_ended`, `unknown_actor` (existing) | as today |

ACT-1 to ACT-13 are the only validation outcomes. A command that passes all of them is **accepted**: the hotel then evaluates the gates (section 2.4). An accepted command that fails a gate is not an error: it answers one `act_done{outcome:"blocked"}` frame and nothing else.

### 2.4 Gates, in order

| Id | Gate | Blocks when | `reason` (and `detail`) |
|---|---|---|---|
| GATE-1 | Global switch | The runtime switch is off (section 6.2) | `kill_switch` |
| GATE-2 | Calm | The room's calm switch is on and the verb's `gates.calm_blocks` is true (shove, slap, punch, kill, hug, kiss, restrain) | `calm_room` |
| GATE-3 | Harm rate | The verb is violent, the target is a human, and the room's harm window already holds `harm_max` landed acts, or the room is auto-paused (SAFE-4) | `rate_limit` |
| GATE-4 | Dead target | The verb's target is `required` (and the verb is not `tend_fallen`) and the target is `dying`, `body` or a human who is `down` | `dead_target` |
| GATE-5 | Scenario | See section 7: rung above `max_rung`; a slap, punch or kill without the scenario block or the pair; a kill or standalone `die` on someone not in `may_die`; `authored_skip` without `origin:"scenario"` and a block | `no_scenario_gate` (`detail`: `max_rung`, `may_target`, `may_die`, `free_play`, `skip`) |
| GATE-6 | Consent opt-in | The verb's `gates.consent` is `violent_chip`, the target is a human, and that human's session `drama_opt_in` is off | `consent_off` |
| GATE-7 | Distance | Chebyshev distance exceeds the verb's `gates.max_dist` (glare 8, insult 6, contact verbs 1), or a contact verb's principals are not both still (not walking) and standing or sitting | `too_far` (`detail`: `distance`, `moving`, `posture`) |
| GATE-8 | Ladder | LAD-1, LAD-9 or LAD-11 (section 2.5) refuses | `ladder` (`detail`: `rung`, `zero_witness`) |
| GATE-9 | Budget | LAD-3 or LAD-4 refuses | `budget` (`detail`: `physical`, `kill`) |
| GATE-10 | Cooldown | The same actor used the same verb on the same target less than 60 000 ms ago (verbs with `gates.cooldown`), or the human target is inside its chip cooldown or has a chip open (CHIP-9) | `cooldown` (`detail`: `verb`, `chip_cooldown`, `chip_busy`) |

GATE-1 to GATE-10 are evaluated in the order of the table (`enums.gate_order` in the JSON); the first one that blocks decides. The ordering is safety first (switch, calm, harm), then consent and scenario, then geometry, ladder, budget, cooldown.

### 2.5 Ladder rules the hotel enforces

| Id | Rule |
|---|---|
| LAD-1 | One rung per beat. Let `r` be the verb's rung and `cur = rung_cur(actor to target, scene)`, 0 when none. An act on the ladder is legal iff `r <= max(cur, 1) + 1`: a scene opens with `glare` or `insult`, and from there one rung at a time. Moving down is always legal. Off-ladder verbs have no rung. |
| LAD-2 | An authored skip is legal only with `origin:"scenario"`, `authored_skip:true` and a scenario block with `max_rung >=` the verb's rung. `act_started.skipped_rungs` lists the ladder verbs jumped. |
| LAD-3 | Physical spacing: the start of a physical beat (`shove`, `slap`, `punch`, `kill`) must be at least 20 000 ms after the start of the previous physical beat **in the same scene**, any actors and any room of the run (owner decision S7: per scene). Refused beats do not consume the budget. A scene cut starts a fresh scene, so it resets the spacing. |
| LAD-4 | At most one `kill` per scene. A new scene resets the count. |
| LAD-7 | De-escalation: when `restrain` lands on an aggressor, or an aggressor uses `turn_back` toward its target, `rung_cur(aggressor to victim)` becomes `min(rung_cur, 2)` at once. (The bible's extra "for 20 s" is dropped: the 20 s physical spacing already holds.) |
| LAD-8 | After a `kill` lands the killer is locked from `dance`, `thumbs` and `laugh` for 5000 ms (`act_busy`, `detail:"no_reward"`). |
| LAD-9 | Contact verbs need both principals still and standing or sitting (a lying principal is `too_far` with `detail:"posture"`, GATE-7). A seated or dancing target is never displaced: `forced_step` steps are skipped, the target's face jolt replaces them, and `act_done.downgraded` lists `forced_step`. |
| LAD-11 | Zero-witness cap: an **autonomous** act (`origin` `model` or `director`) of rung 4 or above is refused (`reason:"ladder"`, `detail:"zero_witness"`) when no avatar other than the principals is within earshot (6 tiles) at the start. Authored acts (`origin:"scenario"`) are exempt. Humans count as witnesses. |

`rung_cur(a to b, scene)` is updated at the start (`act_started`) of every accepted act with a rung, whatever its outcome. LAD-5 (mortality is authored) is enforced by GATE-5. LAD-6 (motive gate) and LAD-10 (contagion cap) are director policy on the sidecar side and are not hotel-enforced.

## 3. Frames

### 3.1 Inventory

New `HotelMsg` variants (hotel to sidecar, dialect 2 only; section 3.3 to 3.10), the one new `SidecarMsg` variant, and the public messages the browser exchanges with the hotel (section 3.11). Every Director frame carries `t` and `seq`; every new `HotelMsg` also carries `run` (so the frame log can file it) and `room` where one applies.

| Frame | Direction | Purpose |
|---|---|---|
| `actor_cmd{k:"act"}` | sidecar to hotel | Start an act (section 2). |
| `scene_advance` | sidecar to hotel | The sidecar's script advanced: cut the scene. |
| `act_started` | hotel to sidecar | An act was accepted and began. |
| `act_beat` | hotel to sidecar | Contact happened (the clock for REA-1 and REA-2). |
| `act_reaction` | hotel to sidecar | The target or a witness visibly reacted. |
| `act_done` | hotel to sidecar | The act ended, or was blocked or aborted. |
| `drama_consent` | hotel to sidecar | A consent chip was shown or answered (human target). |
| `actor_death` | hotel to sidecar | An actor started dying. |
| `actor_revive` | hotel to sidecar | An actor was restored after a scene cut. |
| `human_down` | hotel to sidecar | A killed human is down for a few seconds. |
| `scene_cut` | hotel to sidecar | The scene changed. |
| `drama_state` | hotel to sidecar | Opt-in, calm, pause and switch state of a room. |

Justification for `act_beat` (the one frame the brief asked me to judge). Reaction deadlines are measured from contact (REA-1, REA-2, REA-7), and contact is not `act_started`: an unchipped act has 250 to 500 ms of wind-up and a chipped act waits up to 4000 ms for the human. Without a contact frame a probe cannot separate the wind-up or the chip wait from the reaction latency, and the sidecar cannot learn the witness set it must remember (REA-8). It carries only `beat:"contact"`; no other per-beat frame is defined, because the later beats are either cosmetic (client timeline) or are already frames of their own (`act_reaction`, `actor_death`, `act_done`).

### 3.2 Order of frames inside one act (FRM-1)

| Id | Rule |
|---|---|
| FRM-1 | For one `act_id` the hotel emits in this order: `act_started`, then (human target with a chip) `drama_consent{shown}` and `drama_consent{answered}`, then `act_beat`, then zero or more `act_reaction`, `actor_death` or `human_down`, then exactly one `act_done`. `act_done` is the last frame of the act and is emitted at `max(end of the table, contact + 3000 ms)` when any reaction was owed, so no `act_reaction` follows it. |
| FRM-2 | A blocked command emits exactly one `act_done{outcome:"blocked"}`, with no `act_started` and no other frame. It is self-describing (`verb`, `actor`, `with`). It is not an act for the ladder, the budget or the cooldown. |
| FRM-3 | An aborted act (`outcome:"aborted"`) has an `act_started` and no `act_beat` when it aborted before contact. After an abort no further `act_reaction` is emitted for it. |
| FRM-4 | Every frame below carries `run`. A frame about a room carries `room`. Frames inherit `seq` from the connection; the frame log wrapper is unchanged (section 3.12). |

### 3.3 `act_started`

```json
{"t":"act_started","seq":201,"run":7,"room":12,"act_id":"a17","verb":"slap","actor":-701,"with":9,"intensity":0.6,"impact":"M","origin":"director","scene":"7.2","rung":4,"skipped_rungs":[],"authored_skip":false,"target_opt_in":true,"chip":true,"contact_in_ms":null,"at":1730000123456}
```

| Field | Type | Meaning |
|---|---|---|
| `act_id`, `verb`, `actor`, `with?`, `intensity` | as the probes' provisional type | `intensity` is the effective number. `with` is omitted for a verb without a target. |
| `impact?` | `L`/`M`/`H`/`F` | The impact class (TBL-4). Omitted for verbs with no class. |
| `origin` | string | As sent (default `director` filled in). |
| `scene` | string | `"<run>.<n>"` (section 8.2). |
| `rung?` | 1 to 6 | The verb's rung; omitted off the ladder. |
| `skipped_rungs` | array of verbs | Ladder verbs jumped by an authored skip, else `[]`. |
| `authored_skip` | boolean | Always present. |
| `target_opt_in?` | boolean | Present only when `with` is a human: that human's session flag at the start. It is `true` for every started violent act (GATE-6). |
| `chip` | boolean | A consent chip will be shown. |
| `contact_in_ms` | integer or null | Planned `Tc - T0` when there is no chip; `null` when the chip decides. |

### 3.4 `act_beat`

```json
{"t":"act_beat","seq":204,"run":7,"room":12,"act_id":"a17","beat":"contact","at":1730000124010,"witnesses":[-702,-703,11],"owed":[{"who":-702,"role":"witness","due_at":1730000127010},{"who":-703,"role":"witness","due_at":1730000127010}]}
```

`beat` is always `"contact"` in this revision (the field exists so a later revision can add beats without a new frame). `witnesses` is every avatar in the witness set (REA-2), humans included, ascending ids. `owed` lists the **actors** that owe a reaction, with the absolute deadline. For a target that is an actor it also lists `{"who":<id>,"role":"target","due_at":...}` at 1500 ms. `Tc` for non-contact verbs is the moment the signal lands (table `contact_at_ms`).

### 3.5 `act_reaction`

```json
{"t":"act_reaction","seq":205,"run":7,"room":12,"act_id":"a17","who":-702,"role":"witness","reaction":"freeze_gasp","source":"table","at":1730000124790}
```

`role` is `target` or `witness`. `reaction` is a label from `enums.reaction_labels` when `source` is `table` (`die`, `freeze_gasp`, `head_snap`, `hug_back`, `kiss_back`, `look_back`, `stagger`, `struggle`, `surprised`, `watch`) and `cmd:<k>` (for example `cmd:face`) when `source` is `planner`. Humans never get an `act_reaction` (they are not driven and owe nothing).

### 3.6 `act_done` and outcome semantics

```json
{"t":"act_done","seq":209,"run":7,"room":12,"act_id":"a17","verb":"slap","actor":-701,"with":9,"outcome":"landed","answer":"take","owed_missed":[],"downgraded":[],"at":1730000127011}
{"t":"act_done","seq":212,"run":7,"room":12,"act_id":"a18","verb":"punch","actor":-701,"with":9,"outcome":"blocked","reason":"consent_off","owed_missed":[],"downgraded":[],"at":1730000140002}
{"t":"act_done","seq":215,"run":7,"room":12,"act_id":"a19","verb":"slap","actor":-701,"with":-702,"outcome":"blocked","reason":"no_scenario_gate","detail":"free_play","owed_missed":[],"downgraded":[],"at":1730000150101}
```

| Field | Meaning |
|---|---|
| `outcome` | One of the six outcomes. |
| `answer?` | The chip answer, present iff a chip was shown: `take`, `dodge`, `push_back`, `timeout`. |
| `reason?` / `detail?` | A blocked reason (outcome `blocked`) or an abort reason (outcome `aborted`), plus optional detail. |
| `owed_missed` | `[{who, role}]` reactions still owed at the end of the window; **empty for every table-driven act** (REA-10). |
| `downgraded` | Table steps that were skipped or replaced: `forced_step`, `face`, `walk_to`, `gesture`, `posture`. |

Outcome semantics:

| Outcome | Meaning |
|---|---|
| `landed` | The act reached contact on its target as designed. Actor to actor: always when the act started and was not aborted. Human target: the chip answer was `take`, or the act was `hug` and the chip timed out. The victim of a landed `kill` dies (DEATH-1). |
| `dodged` | A human target dodged, or the chip timed out for a violent verb or for `kiss`. Nothing struck them. |
| `blocked` | Refused before any step ran (section 2.4). No `act_started`. |
| `declined` | A human target answered `push_back`: the act is cancelled and the actor stumbles. |
| `timeout` | Used only for `hug` on a human who did not answer: the act completes with the initiator's steps (D31, unchanged). |
| `aborted` | The act had started and could not finish: `target_moved`, `target_gone`, `actor_gone`, `actor_dead`, `scene_cut`, `run_end`, `kill_switch`, `calm_room`. |

Human chip answer to outcome (CHIP-4 to CHIP-6):

| Verb | `take` | `dodge` | `push_back` | `timeout` |
|---|---|---|---|---|
| violent (`shove`, `slap`, `punch`, `kill`, `insult` at a human) | `landed` | `dodged` | `declined` | `dodged` |
| `kiss` | `landed` | `dodged` | `declined` | `dodged` |
| `hug` | `landed` | `dodged` | `declined` | `timeout` |

### 3.7 `drama_consent` (sidecar visibility of the chip)

The hotel to browser messages are in section 3.11. The sidecar also needs to see the chip, because today no frame carries an act-scoped answer: `pair_reaction` carries only `accept|timeout|dodge|push|aborted|done` for a `pair` id, and a violent act's `take` has no frame at all.

```json
{"t":"drama_consent","seq":202,"run":7,"room":12,"act_id":"a17","phase":"shown","actor":-701,"with":9,"verb":"slap","family":"violent","ttl_ms":4000,"at":1730000123470}
{"t":"drama_consent","seq":203,"run":7,"room":12,"act_id":"a17","phase":"answered","actor":-701,"with":9,"verb":"slap","family":"violent","answer":"take","at":1730000123860}
```

`family` is `violent` or `affection` (the chip label set). `answer` is one of the four chip answers, and a timeout is reported as `answer:"timeout"` at `shown.at + 4000 ms`. A chip is only ever shown for an act whose target is a human (section 6.4). An `answered` frame precedes `act_beat` and `act_done`; for a `take` the beat follows within `chip_windup_ms`.

### 3.8 `actor_death`, `actor_revive`, `human_down`

```json
{"t":"actor_death","seq":230,"run":7,"room":12,"actor":-702,"cause":"kill","act_id":"a20","killer":-701,"scene":"7.2","at":1730000200180}
{"t":"actor_revive","seq":251,"run":7,"room":12,"actor":-702,"scene":"7.3","prev_scene":"7.2","x":5,"y":6,"effect":"","at":1730000260000}
{"t":"human_down","seq":231,"run":7,"room":12,"human":9,"act_id":"a21","ms":5000,"scene":"7.2","at":1730000210180}
```

- `actor_death` is emitted when the victim starts `dying` (contact plus the hit-stop), once. `cause` is `kill` or `die`. `killer` and `act_id` are the causing act. Humans never produce it.
- `actor_revive` is emitted for each dead actor restored by a scene cut. `x`,`y` is where it stands up; `effect` is the effect it had before it died (empty string for none).
- `human_down` is emitted when a killed human is laid down. `ms` is `PERFECTMAN_DRAMA_HUMAN_DOWN_MS`.
- A permadeath actor gets `actor_gone{reason:"died"}` instead of `actor_revive` (DEATH-7); `died` is a new member of `ActorGoneReason`.

### 3.9 `scene_cut` and `scene_advance`

```json
{"t":"scene_advance","seq":88,"run":7,"lease":3,"reason":"scenario_beat_4"}
{"t":"scene_cut","seq":250,"run":7,"scene":"7.3","prev":"7.2","reason":"sidecar","revived":[-702],"removed":[],"at":1730000260000}
```

`scene_advance.reason` is free text, at most 40 characters, logged only. `scene_cut.reason` is `sidecar` (a `scene_advance`), `cut_ui` (a `ui_push{k:"cut"}`), or `timeout` (SCENE-5). `revived` and `removed` list the actors restored or retired. Order on the wire: `scene_cut`, then one `actor_revive` per revived actor (or `actor_gone` per removed one).

### 3.10 `drama_state`

```json
{"t":"drama_state","seq":120,"run":7,"room":12,"enabled":true,"calm":false,"paused":false,"opt_in":[9],"at":1730000100000}
{"t":"drama_state","seq":300,"run":7,"room":12,"enabled":true,"calm":false,"paused":true,"paused_until":1730000900000,"opt_in":[9],"at":1730000300000}
```

Sent at run start for each room of the run, and whenever the room's calm, paused, runtime switch or opt-in set changes, and when a human enters or leaves. `opt_in` lists the human ids in the room whose session flag is on. The sidecar MUST use it to avoid proposing violent verbs against humans who are not in it (the hotel blocks them anyway, GATE-6), and MUST NOT put the flag in any model-visible text.

### 3.11 Public messages (browser and hotel)

The chip is a public message because only the human can answer it. New `ServerMsg` and `ClientMsg` variants (the browser build ships with the hotel, so no negotiation is needed):

```json
{"t":"act_prompt","act":"a17","from":-701,"name":"Duda","verb":"slap","family":"violent","ttl_ms":4000,"timeout_as":"dodge","choices":["take","dodge","push_back"],"default":"dodge"}
{"t":"act_prompt_close","act":"a17","reason":"answered"}
{"t":"act_timeline","act":"a17","verb":"slap","actor":-701,"with":9,"class":"M","phase":"pre","steps":[{"at":0,"p":"cue","on":-701,"emotion":"angry","ms":1500}]}
{"t":"act_timeline","act":"a17","verb":"slap","actor":-701,"with":9,"class":"M","phase":"post","steps":[{"at":-50,"p":"motion","name":"lunge","who":-701,"toward":9,"px":10,"in_ms":50,"back_ms":150},{"at":0,"p":"sfx","cue":"slap"},{"at":0,"p":"motion","name":"hit_stop","who":"both","ms":100}]}
{"t":"drama_status","enabled":true,"opt_in":false,"calm":false,"paused":false}
```

```json
{"t":"act_reply","act":"a17","choice":"push_back"}
{"t":"drama_opt_in","on":true}
```

- `act_prompt`: one open prompt per human at a time (CHIP-9). `family` picks the label set (`violent`: Take it / Dodge / Push back; `affection`: Accept / Dodge / Push), the wire names are the same. `default` is the focused button and the Escape answer: always `dodge`. `timeout_as` is what the timeout means (`dodge` or `take`; only `hug` uses `take`).
- `act_prompt_close.reason`: `answered`, `timeout`, `aborted`.
- `act_timeline`: the compiled cosmetic steps (TBL-8). `phase:"pre"` at the start; `phase:"post"` at the chip answer for chipped acts (offsets are from the answer). An unchipped act sends one frame with `phase:"all"`. `at` is ms from the phase base and may be negative (wind-up). Not mirrored to the Director.
- `act_reply` answers the chip; `choice` is `take`, `dodge` or `push_back`. A reply for an act that is not open answers the existing notice `nothing_to_dodge`.
- `drama_opt_in` toggles the session flag. `drama_status` is sent on join, on change, and when calm or the pause changes. `enabled:false` hides the control.
- New notice codes (additive to `NOTICE_CODES`): `drama_opt_in_on`, `drama_opt_in_off`, `drama_calm_on`, `drama_calm_off`, `drama_paused`, `drama_resumed`, `drama_disabled`.
- Chat aliases: `:take`, `:dodge`, `:pushback` answer the open act prompt (the existing `:dodge` and `:push` keep answering a `pair_prompt`); `:drama on|off` toggles the flag.

### 3.12 How the frames appear in `frames.jsonl`

Every Director frame is logged by the existing wrapper (`perfectman/framelog.rs`, `director-protocol.md` section 12): `{"ts_ms","conn","dir","run","frame"}`. `run` is the frame's `run` (the log files it under that run). `dir` is `out` for every hotel frame in section 3 and `in` for `actor_cmd{k:"act"}` and `scene_advance`.

```json
{"ts_ms":1730000123456,"conn":4,"dir":"in","run":7,"frame":{"t":"actor_cmd","seq":41,"cid":31,"run":7,"lease":3,"actor":-701,"cmd":{"k":"act","act_id":"a17","verb":"slap","with":9,"intensity":0.6,"origin":"director"}}}
{"ts_ms":1730000123459,"conn":4,"dir":"out","run":7,"frame":{"t":"act_started","seq":201,"run":7,"room":12,"act_id":"a17","verb":"slap","actor":-701,"with":9,"intensity":0.6,"impact":"M","origin":"director","scene":"7.2","rung":4,"skipped_rungs":[],"authored_skip":false,"target_opt_in":true,"chip":true,"contact_in_ms":null,"at":1730000123456}}
```

Because every frame carries `run`, the existing `frame_run` helper files them with no change. The probes' `normalizeFrame` maps `frame.t` to `BodyFrame.kind` and `frame` to `BodyFrame.data`, so the new `t` values need no loader change; only the extractor (section 12) does. Public messages (`act_prompt`, `act_timeline`, `drama_status`) are not Director frames and are not in this log. The cosmetic effect of a landed act is still visible as ordinary mirrored deltas (`moves`, `avatar_action`, `appearance_changed`, expression).

### 3.13 Reconciliation with the probes' provisional types

The provisional types are in `packages/eval/src/drama/events.ts` (core branch, probes branch adds `authored_skip` and `target_opt_in`).

| Provisional | Final | Note |
|---|---|---|
| `act_started{act_id, verb, actor, with?, intensity, authored_skip?, target_opt_in?, run?, seq?}` | same names and types, plus `room, impact?, origin, scene, rung?, skipped_rungs, chip, contact_in_ms, at`; `authored_skip` always present; `target_opt_in` present only for human targets | Wire ids are integers; the extractor already maps them to refs. |
| `act_reaction{act_id, who, role, reaction}` | same, plus `run, room, source, at` | `reaction` is a label or `cmd:<k>`. |
| `act_done{act_id, outcome}` with `landed, dodged, blocked, declined, timeout` | same names; adds the outcome `aborted`; adds `verb, actor, with?, answer?, reason?, detail?, owed_missed, downgraded, run, room, at` | A blocked act has an `act_done` and no `act_started`. |
| `actor_death{actor, cause?}` | same, plus `run, room, act_id, killer?, scene, at`; `cause` is `kill` or `die`; actors only | A killed human is `human_down`. |
| consent chip `answered` with `accept, decline, timeout, take`, keyed by `pairId`, linked to an act by an optional `actId` | `drama_consent{phase, act_id, answer}` with `take, dodge, push_back, timeout` | The act-scoped `take` finally has a frame (section 12). |

## 4. Reaction obligation protocol

| Id | Rule |
|---|---|
| REA-1 | Contact time `Tc` is the `at` of `act_beat`. The target (an actor) MUST show a visible response within **1500 ms** of `Tc`; every witness actor within **3000 ms** of `Tc`. Visible means an executed step or an accepted command from the qualifying list (REA-3). For a non-contact verb `Tc` is the moment the signal lands (`contact_at_ms`). |
| REA-2 | The witness set is computed once at `Tc`: every avatar in the room that is not a principal, within Chebyshev **6** tiles of either principal, alive, standing or sitting, not a Tilehouse bot, and not already a principal or locked reactor of another open act. **Owed** are the witness **actors** only; humans watch and owe nothing. The target is owed iff it is an actor and the verb's `owed.target_ms` is set. The verb's `owed.witness_when` can switch witness debts off (`never`), on (`always`), or make them conditional (`scene_rung_ge_2`: the pair is at rung 2 or above; `standalone_only`: only when the verb was not nested). |
| REA-3 | Reactions are authored by the verb table, not the model (100 % with no LLM). A **qualifying command** is an accepted `actor_cmd` with `k` in `face`, `expression`, `action` (any), `sit`, `walk`, `move_room`, `appearance` or `act` (a solo verb), arriving after `Tc` from an owed actor whose reaction label is replaceable (`look_back`, `watch`, `freeze_gasp`, `surprised`). The hotel then emits `act_reaction{source:"planner", reaction:"cmd:<k>"}` and skips that reactor's table step. Labels `die`, `stagger`, `head_snap`, `struggle`, `hug_back` and `kiss_back` are never replaceable (they are state changes or the target's half of a contact). |
| REA-4 | Witness steps use the stagger of `constants.witness_stagger`: start offset `base_ms + per_tile_ms * distance + jitter` with the jitter drawn from a seeded stream (seed = hash of run, `act_id` and the witness id) in `[0, jitter_ms]`, never above `cap_ms` (2800), so a witness's first visible step is at most 2800 ms after `Tc` and the 3000 ms deadline holds with slack. |
| REA-7 | A target's extreme pose (`hs: true` steps) starts at `Tc + hit_stop` of the class, never before `Tc`. The sound is at `Tc`. |
| REA-8 | Memory (sidecar): every principal and every id in `act_beat.witnesses` gets a tone-labelled event at `act_done` of a `landed` act, using the verb's `memory` entry (event and tone); the weight for a witness scales with its affection to the victim. `dodged` and `declined` give the actor an `aggressor` event for violent verbs and nothing to the target; `blocked` and `aborted` write nothing. Death is the strongest event (DEATH-4). |
| REA-9 | Act lock. From `act_started` to `act_done` the **initiator** of an act is locked, and the target and every witness are locked from the start of their own table step to the end of that step (so an owed reactor may still send a qualifying command between `Tc` and its step, REA-3): any body command from a locked actor (`walk`, `sit`, `action`, `expression`, `face`, `move_room`, `appearance`, `pair`, `act`) answers `actor_error{act_busy}`. `chat` and `typing` are never locked. The planner holds its own body commands for the initiator from `act_started` and for every id in `act_beat.owed` from `act_beat` until `act_done`, except a qualifying reaction command before `due_at` (REA-3), and the planner face lock, the 30 s reversal lock and the withdrawal rule MUST NOT cancel a table step. The table's own steps and forced steps do not count against the 8 per 5 s budget. |
| REA-10 | Satisfaction is tracked by the hotel sequencer, which is the single authority. It keeps a ledger `owed[(act_id, who)]` filled at `Tc` from the witness set. An entry is satisfied the moment an `act_reaction` is emitted for it. A reactor that dies, leaves the room, or is removed before its step is dropped from the ledger. At `Tc + 3000 ms` (or `Tc + 1500 ms` for the target) any remaining entry goes into `act_done.owed_missed`. The planner knows an obligation is met from the same facts: `act_beat.owed` (what is owed and until when), each `act_reaction` (what was met), and `act_done.owed_missed` (what was not). The planner never has to guess. |

## 5. The choreography table

### 5.1 Where it lives and how it is used

The table is data, keyed by verb, in `verb-vocab.draft.json` (published as `verb-vocab.json`, section 10). The hotel sequencer compiles an act into a timeline from the table, executes the server-side steps itself, and sends the cosmetic steps to clients as `act_timeline` (TBL-8). The sidecar never executes steps; it reads frames. Each entry validates against the `table_schema` embedded in the JSON file (JSON Schema draft-07).

### 5.2 Entry shape

```
verb entry = {
  id, rung|null, family, violent, contact, target: required|optional|none, target_kinds: [actor|human], text,
  gates: {calm_blocks, consent: violent_chip|affection_chip|affection_chip_dodge|null,
          budget: physical|kill|null, cooldown, scenario: free_ok|needs_block|needs_block_and_may_die|needs_may_die,
          max_dist, still, actor_posture[], target_state?: fallen},
  intensity: {default, class: null | {min, max}},
  timeline: {contact_at_ms},
  roles: {actor[], target[]?, witnesses[], room[], camera[]},
  owed: {target_ms, witness_ms, witness_when},
  memory: {actor, target, witnesses}: {event, tone},
  ladder: {deescalates},
  follow_ups?: [{verb:"tableau", at:"end"}], notes?
}
step = { t: {a: T0|Tc|Tarr, ms, hs?, stagger?, plus?}, p: <primitive>, ...params, reaction?, optional?, human?, only?, needs?, when? }
```

Roles: `actor` (the verb's actor), `target` (the `with` avatar), `witnesses` (each avatar of the witness set, each with its own stagger), `room` (sfx, cue, caption: client-side), `camera` (cinematic runs only). `restrain` also uses the role reference `victim` (RES-1).

### 5.3 Rules

| Id | Rule |
|---|---|
| TBL-1 | Every entry validates against `table_schema`; the hotel and the sidecar both load the published `verb-vocab.json` and refuse (hotel: refuse to start with the switch on; sidecar: answer dialect 1) a table that does not. |
| TBL-2 | Time anchors. `T0` is the instant `act_started` is emitted. `Tc` is the contact instant. `Ta` is the instant of the chip answer (only in the consent profiles). `Tarr` is the instant the walk started by `walk_to` ends (the `arrived` of its plan `act:<act_id>`). `ms` is added to the anchor and may be negative only against `Tc` and only up to `-contact_at_ms`. `hs:true` adds the hit-stop of the impact class. `stagger:true` adds the witness stagger (REA-4). `plus:"human_down"` adds the human down time (human-only steps). Steps with the same instant run in table order, role order `actor`, `target`, `witnesses`. |
| TBL-3 | Contact. Without a chip: `Tc = T0 + contact_at_ms`. With a chip (human target, `gates.consent` set): at `T0` the actor holds the threat pose (`face` toward the target, plus `expression angry` for the violent profile) while the chip is open; on `take`, `Tc = T_answer + chip_windup_ms` (150) and every `Tc` step with a negative offset is clamped to `-chip_windup_ms`, keeping its table order; `dodge`, `push_back` and `timeout` follow the profiles below and never reach `Tc`. A chip applies only to a human target. |
| TBL-4 | Impact class from intensity: `L` if `intensity < 0.34`, `M` if `0.34 <= intensity <= 0.67`, `H` if `> 0.67`; then clamped to the verb's `intensity.class` `[min, max]` (`kill` is always `F`). Hit-stop: `L` 50, `M` 100, `H` 150, `F` 175 ms. |
| TBL-5 | Hit-stop freezes the actor's and the target's procedural motion clocks on the client (`motion hit_stop`). On the server the same value is only the offset added by `hs:true`. Effect overlays keep running. |
| TBL-6 | A `verb` step runs the nested verb's `actor` role steps on the reactor, with that verb's `Tc` re-based to the step's instant and its `target` set to the act's actor. Nesting is one level deep: a nested verb's own `verb` steps are not run. Nested `witnesses` steps are ignored. |
| TBL-7 | **HUM-1.** A human's avatar is touched by a server step only when the step has `human:true`, which the table gives to exactly these: `forced_step` as the target mover (violent chip answers dodge and push_back, shove and punch contact), `posture lay` and `state` for a killed human, the affection reciprocal gesture and `effect` overlays on a `take`. `face`, `expression`, `gesture` (other than the affection reciprocal), `walk_to` and `chat` are never run on a human. Cosmetic client primitives (`cue`, `sfx`, `caption`, `motion`) may show on a human's avatar. `only:"actor"` and `only:"human"` filter a step by the kind of its subject. |
| TBL-8 | One table, two executors. The sequencer compiles each act once into a list of absolute steps. Steps with `exec: server` are run by the hotel at their instants. Steps with `exec: client` (`cue`, `sfx`, `caption`, `motion`) go into `act_timeline` with the same offsets, so a 100 ms hit-stop and the server's reaction step come from the same line of the table (bible Q12). A test MUST compile one act and check that every client step has the instant of the equal server step (section 9, TBL-8). |
| TBL-9 | The hotel runs an act scheduler with **50 ms** resolution, separate from the 300 ms sim tick (the existing `Inner.later` queue is drained once per tick and cannot place a 50 ms hit-stop). A server step runs no earlier than its due instant and at most 100 ms after it on an idle loop; order is preserved. A forced step's movement still animates on the 300 ms move tick, as today. |
| TBL-10 | `effect` on an actor: `Appearance{effect}` with the previous effect saved and restored when `ms` ends (`null` means until the scene cut, DEATH-3). On a human: a client overlay that never touches `Avatar.effect` (needs `overlay`). Catalog effects used: `Love`, `Raincloud`, `TrippyHalo`, `Twinkle` (all present in `web/assets/habbo/catalog.json`). |
| TBL-11 | `hold` and `lock` are server-side locks (REA-9, LAD-8). `tableau` holds every actor within `tableau_radius_tiles` of its actor (and its target) that is standing or sitting and alive for `tableau_hold_ms`; humans are never held. A `follow_ups` entry runs the named verb at the end of the parent act and extends the parent's `act_done`. |
| TBL-12 | `camera` and `cut_fx` steps are sent as `PerfectmanUi::Camera` and `CutFx` to the run's Audience only when the run is cinematic. In default mode legibility comes from the client timeline: `cue`, `caption` and `sfx` in `act_timeline` play for every human in the room regardless of mode (so default mode does not depend on `ui_push` delivering `sfx`, bible Q13). |
| TBL-13 | `caption` text is per language; the run's language picks it (`pt-BR` default). Placeholders are `{actor}` and `{target}` only, replaced by the avatars' names (untrusted text: inserted as plain text). Captions are overlay text and are not chat. |
| TBL-14 | No verb depends on the angry, sad or surprised face art: every `expression` step is paired with a cue, a sign or a posture so the verb reads without it (bible X11). |
| RES-1 | `restrain`'s `victim` is the aggressor's most recent act target in this scene if that avatar is within 2 tiles of the aggressor, else the nearest other avatar within 2 tiles of the aggressor, else the rescuer (the aggressor then steps away from the rescuer). |

### 5.4 The consent profiles (human target only)

A chip applies only when the target is a human and the verb's `gates.consent` names a profile. The profiles are in the JSON under `consent_profiles` (steps anchored at `T0` for the hold and at `Ta`, the answer instant, for the outcomes; the same step schema as a verb). Timeline: `T0` the hold steps run while the chip is open; at the answer the matching outcome list runs; on `take` the verb's own steps run from `Tc = Ta + chip_windup_ms`.

| Profile | Verbs | Hold (steps at `T0`) | `dodge` (steps at `Ta`) | `push_back` (steps at `Ta`) | `timeout` |
|---|---|---|---|---|---|
| `violent_chip` | insult, shove, slap, punch, kill | actor `face` toward target, `expression angry`, cue `angry` | human `forced_step` away from the actor (R6); actor whiffs: `motion lunge`, `expression neutral`, `hold` 1000 ms | actor `forced_step` away from the human, `expression surprised`, cue `surprised` | `dodge` |
| `affection_chip` | hug | actor `face` toward target | human `forced_step` away; actor `face` away from the target | as the `violent_chip` `push_back` | `initiator_only` (D31): the verb's actor steps run, no target steps |
| `affection_chip_dodge` | kiss | as `affection_chip` | as `affection_chip` | as `affection_chip` | `dodge` |

An insult at a human speaks its `text` only on `take`. On `dodge`, `push_back` and `timeout` no line is spoken.

### 5.5 Per-verb summary

Generated from the JSON (`contact_at_ms` is the wind-up before contact for an unchipped act; the owed columns are the reaction deadlines).

| Verb | Rung | Family | Target | Chip profile | `contact_at_ms` | Class | Target owed (ms) | Witness owed | New motions | New sounds | Follow-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `glare` | 1 | conflict_noncontact | required | - | 0 | - | 1500 | if rung>=2 | `lunge` | - | - |
| `insult` | 2 | conflict_noncontact | required | violent_chip | 300 | - | 1500 | yes | `shake` | - | - |
| `shove` | 3 | conflict_contact | required | violent_chip | 250 | L-M | 1500 | yes | `hit_stop`, `knockback`, `lunge` | `thud`, `whoosh_short` | - |
| `slap` | 4 | conflict_contact | required | violent_chip | 300 | M-H | 1500 | yes | `hit_stop`, `lunge`, `recoil`, `tint_flash` | `slap` | tableau |
| `punch` | 5 | conflict_contact | required | violent_chip | 350 | M-H | 1500 | yes | `hit_stop`, `knockback`, `lunge`, `shake`, `tint_flash` | `thud`, `whoosh_short` | tableau |
| `kill` | 6 | climax | required | violent_chip | 500 | F | 1500 | yes | `fall`, `hit_stop`, `knockback`, `lunge`, `shake`, `tint_flash` | `thud` | tableau |
| `die` | - | climax | optional | - | 0 | - | - | standalone | `fall`, `knockback` | `thud` | - |
| `recoil` | - | solo | optional | - | 0 | - | - | no | `recoil` | `gasp` | - |
| `freeze_gasp` | - | solo | optional | - | 0 | - | - | no | - | `gasp` | - |
| `hug` | - | affection | required | affection_chip | 0 | - | 1500 | no | - | - | - |
| `kiss` | - | affection | required | affection_chip_dodge | 0 | - | 1500 | no | `lunge` | - | - |
| `turn_back` | - | solo | optional | - | 0 | - | - | no | - | - | - |
| `cry` | - | solo | none | - | 0 | - | - | no | `shake` | `sob` | - |
| `storm_off` | - | solo | optional | - | 400 | - | - | no | `shake` | - | - |
| `tableau` | - | director | optional | - | 0 | - | - | no | - | - | - |
| `restrain` | - | conflict_contact | required | - | 200 | L | 1500 | no | `hit_stop`, `lunge` | `whoosh_short` | - |
| `faint` | - | climax | none | - | 800 | - | - | yes | `fall`, `shake` | `thud` | tableau |
| `tend_fallen` | - | affection | required | - | 0 | - | - | no | - | - | - |

### 5.6 Gate matrix

| Verb | Calm blocks | Chip / opt-in | Scenario (GATE-5) | `max_dist` | Still | Budget | Cooldown | Dead target (GATE-4) | Actor posture |
|---|---|---|---|---|---|---|---|---|---|
| `glare` | no | - | `free_ok` | 8 | no | - | yes | yes | stand/sit |
| `insult` | no | violent_chip + opt-in | `free_ok` | 6 | no | - | yes | yes | stand/sit |
| `shove` | yes | violent_chip + opt-in | `free_ok` | 1 | yes | physical | yes | yes | stand/sit |
| `slap` | yes | violent_chip + opt-in | `needs_block` | 1 | yes | physical | yes | yes | stand/sit |
| `punch` | yes | violent_chip + opt-in | `needs_block` | 1 | yes | physical | yes | yes | stand/sit |
| `kill` | yes | violent_chip + opt-in | `needs_block_and_may_die` | 1 | yes | kill | yes | yes | stand/sit |
| `die` | no | - | `needs_may_die` | - | no | - | no | no | stand/sit/lay |
| `recoil` | no | - | `free_ok` | - | no | - | no | no | stand/sit |
| `freeze_gasp` | no | - | `free_ok` | - | no | - | no | no | stand/sit |
| `hug` | yes | affection_chip | `free_ok` | 1 | yes | - | yes | yes | stand/sit |
| `kiss` | yes | affection_chip_dodge | `free_ok` | 1 | yes | - | yes | yes | stand/sit |
| `turn_back` | no | - | `free_ok` | - | no | - | no | no | stand/sit |
| `cry` | no | - | `free_ok` | - | no | - | no | no | stand/sit/lay |
| `storm_off` | no | - | `free_ok` | - | no | - | no | no | stand/sit |
| `tableau` | no | - | `free_ok` | - | no | - | no | no | stand/sit/lay |
| `restrain` | yes | - | `free_ok` | 1 | yes | - | no | yes | stand/sit |
| `faint` | no | - | `free_ok` | - | no | - | no | no | stand/sit |
| `tend_fallen` | no | - | `free_ok` | 1 | no | - | no | needs fallen | stand/sit |

`insult` is violent for consent when its target is a human (opt-in and chip); against an actor it has no chip. `gates.scenario`: `free_ok` any run; `needs_block` the scenario `drama` block with `max_rung` and `may_target` (SCN-3); `needs_block_and_may_die` also `may_die`; `needs_may_die` (standalone `die`) the actor in `may_die`.

### 5.7 New things the table needs

| Kind | Items | Owner |
|---|---|---|
| (b) client procedural motion (7) | `lunge`, `hit_stop`, `tint_flash`, `knockback`, `shake`, `recoil`, `fall`; parameters per class or per verb in the JSON `motions` | hotel packet H4 |
| New sounds (5) | `slap`, `thud`, `gasp`, `sob`, `whoosh_short`; added to `cue-vocab.json` as version 2 (canonical names plus aliases) and to `web/sfx.js` | hotel packet H4 |
| Client overlay of a catalog effect on any avatar | steps flagged `overlay` (`Love`, `Raincloud`, `TrippyHalo`, `Twinkle` on a human) | hotel packet H4 |
| Hotel act scheduler (50 ms) and sequencer | TBL-9 | hotel packet H2 |
| Verify before relying on them | see 5.9 | hotel packet H2 |

### 5.8 Motion primitives

Parameters live in `motions` in the JSON. A step `motion` resolves its parameters as `by_verb[verb]` when present, else `by_class[class]`; a motion with neither for the act is a table error (the JSON check covers every verb and class).

| Motion | What the client does | Parameters |
|---|---|---|
| `lunge` | offset the avatar toward `toward`, then back | `px`, `in_ms`, `back_ms` |
| `hit_stop` | freeze actor and target motion clocks, overlays keep running | `ms` = hit-stop of the class |
| `tint_flash` | white tint on the struck avatar | `frames`, `frame_ms` 33 |
| `knockback` | decaying slide away from `away_from`; cosmetic, never changes the tile | `px`, `ms`, `curve` decay |
| `shake` | translation shake with a small rotation, decays | `px`, `rot_deg`, `ms` |
| `recoil` | lean away and settle with a small overshoot | `px`, `overshoot_px`, `ms` |
| `fall` | drop to the lying pose and bounce | `drop_px`, `bounce_px`, `ms` |

### 5.9 Primitives with unverified behaviour (flagged `verify`)

| Primitive | Question | Fallback if it fails |
|---|---|---|
| `gesture stop` ending a `wave` after about 300 ms (arm swing in `slap`, `punch`, last gesture in `die`) | Does `Action::Stop` cleanly end a gesture? The room code stops a dance or doze; a wave ending early is not verified. | The steps are `optional:true`; the `lunge` motion and the sound carry the swing and `act_done.downgraded` lists `gesture`. |
| Stopping a walking witness | No walk-cancel primitive exists. | `freeze_gasp` still shows `expression surprised` and the cue, which count (REA-2). |
| `posture lay` | Refused while walking, on a seat, or with no room to lie. | `fallback:"sit_floor"` then the effect; `act_done.downgraded` lists `posture`. |
| `posture stand` from a seat | `Refusal::NotHere` lists situations (a chair in a game) where standing is refused. | `optional:true`; the avatar stays. |

## 6. Consent state machine and safety switches

### 6.1 Environment variables (hotel binary)

| Variable | Default | Values | Meaning |
|---|---|---|---|
| `PERFECTMAN_DRAMA` | `off` | `on`, `1`, `true`, `yes` (case-insensitive) mean on; anything else, including unset, empty, `off`, `0`, `false` and a typo, means off | The ceiling of the whole feature. Fail-closed: an unrecognised value logs a warning at start and stays off. Ignored (with a warning) unless `PERFECTMAN_ENABLED` is on. |
| `PERFECTMAN_DRAMA_HARM_MAX` | 3 | integer 0 to 50; out of range falls back to 3 with a warning | N: landed violent acts on humans allowed per room per window. `0` blocks every violent act on a human. |
| `PERFECTMAN_DRAMA_HARM_WINDOW_SECS` | 300 | 30 to 3600 | The window. |
| `PERFECTMAN_DRAMA_PAUSE_SECS` | 600 | 30 to 86400 | How long an auto-pause lasts. |
| `PERFECTMAN_DRAMA_HUMAN_DOWN_MS` | 5000 | 1000 to 15000 | How long a killed human is down. |
| `PERFECTMAN_DRAMA_SCENE_BODY_MAX_SECS` | 600 | 60 to 3600 | SCENE-5: the longest a body lasts without a scene cut. |

The perfectman sidecar reads its own `PERFECTMAN_DRAMA` with the same parsing and the same default (`off`): it offers `drama.v1` only when it is on (NEG-3). Both sides must be on for drama to run.

### 6.2 SAFE rules

| Id | Rule |
|---|---|
| SAFE-1 | `PERFECTMAN_DRAMA` is read once at start and is the ceiling. Off: no `proto_max`, no `caps`, no `drama` in `hello`, no table, no chip, no frames, no `drama_status` with `enabled:true`, and the admin switch of SAFE-2 cannot turn it on. |
| SAFE-2 | Runtime switch. `POST /api/admin/perfectman/drama/switch {"on":bool}` lowers or restores the runtime state below the ceiling. Off at runtime: every new `act` answers `act_done{blocked, kill_switch}`, every act in flight ends `aborted` with `reason:"kill_switch"` at its next step boundary, open chips close (`act_prompt_close{reason:"aborted"}`), and `drama_state`/`drama_status` carry `enabled:false`. The negotiated v2 session stays open. On: restores up to the ceiling; `409 drama_env_off` when the ceiling is off. Audited (SAFE-7). |
| SAFE-3 | Calm. A per-room switch, persisted in SQLite (`perfectman_room_calm`), loaded at start. On: GATE-2 blocks every contact verb and `kill` in that room (shove, slap, punch, kill, hug, kiss, restrain), acts in flight abort with `calm_room`, humans see a `drama_status{calm:true}` banner. It blocks regardless of opt-in. Humans who have not opted in may still watch actor-on-actor violence when calm is off (bible Q9). |
| SAFE-4 | Auto-pause. Per room, count the acts with outcome `landed`, a violent verb (shove, slap, punch, kill, or insult) and a human target, in the last `HARM_WINDOW_SECS`. When a new such act would be the `(HARM_MAX + 1)`th, GATE-3 blocks it with `rate_limit` and the room is paused for `PAUSE_SECS`: while paused every violent act on a human is blocked `rate_limit`; actor-to-actor acts continue. A pause ends on its own or by `POST /api/admin/perfectman/rooms/{room}/drama/resume`. Entering and leaving a pause sends `drama_state` and the notices `drama_paused` and `drama_resumed`. |
| SAFE-5 | Opt-in. The flag is per session (per connection): default off, set by `drama_opt_in{on}` or `:drama on|off`, not persisted, reset on reconnect, toggles limited to one per 2 s. An admin cannot set it for someone else. Humans who opt out while a chip is open answer it as `dodge`. |
| SAFE-6 | Humans are never frozen, muted, removed or driven (HUM-1). A killed human is down for `HUMAN_DOWN_MS` and may still chat; movement and action messages in that time answer the existing public `error{action_not_here}`. |
| SAFE-7 | Audit. Every act with a human target, every blocked act, every switch change and every pause writes: (a) the Director frames (which are in `frames.jsonl`, retention as the frame log), (b) a `chat_log` row with `kind="drama"`, `room`, `user_id` the actor, `name` the actor's name, `at`, and `text` a JSON string of at most 200 characters, for example `{"act":"a17","verb":"slap","to":9,"out":"landed","ans":"take","scene":"7.2"}` (`"rsn"` replaces `"ans"` on a blocked or aborted act; `to` is the target id), and (c) for switch and pause changes a `chat_log` row of kind `drama_switch` and an `audit` row (forms below). |

Switch audit forms. `chat_log` `kind="drama_switch"`: `{"sw":"calm","room":12,"on":true,"by":9}`; `{"sw":"runtime","on":false,"by":9}`; `{"sw":"pause","room":12,"on":true,"until":1730000900000}`. `audit(actor, action, target, detail)` rows use action `pm_drama_calm` (target `room:12`, detail `on` or `off`), `pm_drama_switch` (target `drama`, detail `on` or `off`), `pm_drama_resume` (target `room:12`) and `pm_drama_pause` (target `room:12`, detail `harm_max`), with the existing admin actor string (`admin:<name>`).

### 6.3 Admin endpoints

All under `/api/admin/perfectman` and guarded like the other perfectman admin routes (`admin::require_admin`: admin session or `ADMIN_TOKEN`). Errors use `ApiError`: `{"error":"<code>"}`.

| Method and path | Body | Answer |
|---|---|---|
| `POST /rooms/{room}/calm` | `{"on":true}` | `200 {"room":12,"calm":true,"changed":true}`; `404 no_such_room`; `503 perfectman_disabled`; `409 drama_env_off` |
| `GET /rooms/{room}/drama` | none | `200 {"room":12,"enabled":true,"calm":false,"paused":false,"paused_until":null,"harm_in_window":1,"harm_max":3,"harm_window_s":300,"opt_in":[9]}` |
| `POST /rooms/{room}/drama/resume` | `{}` | `200 {"room":12,"paused":false,"changed":true}` |
| `POST /drama/switch` | `{"on":false}` | `200 {"enabled":false,"ceiling":true,"changed":true}`; `409 drama_env_off` when asked to turn on above an off ceiling |

A chat alias exists for the same code paths: `:pm calm on|off` in the admin's room.

### 6.4 The consent state machine (human target)

Chip rules (CHIP ids reused from the bible, amended):

| Id | Rule |
|---|---|
| CHIP-1 | A violent act (`shove`, `slap`, `punch`, `kill`, and `insult` aimed at a human) whose target is a human requires that human's `drama_opt_in` on. If off the command is blocked `consent_off` before any step, and the sidecar MUST NOT retry against that human until `drama_state` lists them. Non-contact `glare` and `turn_back` are not gated. `hug` and `kiss` are gated only by the chip. |
| CHIP-2 | With opt-in on, `act_started` is emitted, the actor holds the threat pose, and the hotel sends `act_prompt` to the human and `drama_consent{shown}` to the sidecar. The chip lasts `chip_ttl_ms` (4000). The labels are Take it / Dodge / Push back (violent) and Accept / Dodge / Push (affection). |
| CHIP-3 | Timeout is `dodge` for every violent verb and for `kiss`; for `hug` the act completes as today (D31). |
| CHIP-4 | `take`: contact at `T_answer + chip_windup_ms`. `dodge`: the human's avatar steps back one tile (existing R6 forced step) and the actor whiffs. `push_back`: the actor stumbles one tile (existing R6). REA-1 starts at the resolution. |
| CHIP-5 | `hug` completes on timeout; `kiss` does not (bible Q2 resolved by the owner). |
| CHIP-6 | A human may be moved only by the chip-gated forced step and, for `kill`, a forced lying posture (HUM-1). |
| CHIP-8 | State machine of one chip: `shown` is closed by exactly one `drama_consent{answered}` whose `answer` is `take`, `dodge`, `push_back` or `timeout`, or the act ends `aborted` (target left the room, run ended, switch off, calm on, scene cut) with no `answered` frame. A human who turns opt-in off while a chip is open answers it as `dodge`. |
| CHIP-9 | One open chip per human. A second act that targets the same human while one is open is blocked `cooldown` (`detail:"chip_busy"`). After `dodge`, `push_back` or a violent timeout the human has a chip cooldown of 60 000 ms against every actor (`detail:"chip_cooldown"`), the same as `pair_cooldown`. |

(The bible's CHIP-7, a standoff distance for `square_up`, is moot: `square_up` is not in v1.)

## 7. The scenario `drama` block

### 7.1 Place in the scenario schema

There are two layers in the perfectman repo and the hotel stores only the second.

- **Authoring form** `ScenarioForm` (`packages/hotel/src/authoring/scenario-form.ts`, the JSON `source` of `validate` and `compile`): a new optional top-level key `drama`. Refs are cast names.
- **Compiled body** `ScenarioBody` (`packages/hotel/src/run/scenario-body.ts`, stored by the hotel in `scenario_versions.body`, the object the sidecar reads from `GET /internal/v1/scenario-versions/{id}`): a new optional top-level key `drama`. Refs are agent ids (`person-N`), which are the Director `ref`s. `SCENARIO_BODY_VERSION` stays **1**: the key is optional and additive, and `parseScenarioBody` already keeps unknown top-level keys out, so it gains a `cleanDrama` step like `cleanStage`.
- **Not touched.** `packages/shared/src/scenarios` (`RoleplayScenario`, the eval library) is a different schema for seeded eval scenes and gets no `drama` key; the presets list converts library scenes to forms and may add a `drama` block there.
- **Hotel side.** The hotel treats `body` as opaque JSON (`director-protocol.md` 11.2). To enforce GATE-5 it reads only `body.drama` at `run_start`, from the stored version, with a strict parser (`deny_unknown_fields` inside the block, unknown top-level keys ignored). A block that fails to parse is treated as absent and the admin gets the notice `drama_block_invalid`; the compile step makes this unreachable for saved versions. The hotel needs no new column.

### 7.2 Schema

```json
{"drama": {"max_rung": 4, "may_target": [["person-1", "person-2"], ["person-3", "@human"]], "may_die": ["person-2"], "permadeath": false}}
```

The key sits at the top level of the compiled body next to `stage` and `arrivals`; in the form, refs are cast names (`"may_die": ["Ana Clara"]`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `max_rung` | integer 0 to 6 | 3 | The highest ladder rung any act in this scenario may reach. `0` forbids even `glare`. The form also accepts a ladder verb id (`"slap"` means 4); compile writes the integer. |
| `may_target` | array of `[aggressor, victim]` pairs | `[]` | The ordered pairs that may be the target of a rung 4 or higher act (`slap`, `punch`, `kill`). Rungs 1 to 3 need no pair. |
| `may_die` | array of refs | `[]` | Who a `kill`, or a standalone `die`, may kill. |
| `permadeath` | boolean | `false` | When true, a killed actor is not restored at the scene cut. |

`@human` is a reserved pseudo-ref valid as the **second** element of a `may_target` pair and as an element of `may_die`; it means "any human in the room, who has opted in and answered the chip". An actor ref is a cast name (form) or agent id (body). A human has no ref.

### 7.3 Defaults and gate semantics

| Id | Rule |
|---|---|
| SCN-1 | **No block (free play).** Equivalent to `{"max_rung":3,"may_target":[],"may_die":[],"permadeath":false}` **and** no authored skips: `glare`, `insult` and `shove` between actors are allowed; `slap`, `punch`, `kill` and standalone `die` answer `blocked no_scenario_gate` (`detail:"free_play"`). Free play has no kills. |
| SCN-2 | **Block present.** Omitted keys take the defaults above. `drama:{}` therefore behaves as free play plus the ability to author skips (SCN-4). |
| SCN-3 | GATE-5 for a ladder verb of rung `r`: `r > max_rung` blocks (`detail:"max_rung"`); for `r >= 4` also `[actor, victim]` must be in `may_target` (a human victim: `[actor, "@human"]`), else `may_target`; for `kill` also the victim (or `@human`) must be in `may_die`, else `may_die`; a standalone `die` needs the actor in `may_die`. |
| SCN-4 | `authored_skip` is honoured only with `origin:"scenario"` and a block (even `drama:{}`) whose `max_rung` is at least the verb's rung; otherwise `no_scenario_gate` (`detail:"skip"`). |
| SCN-5 | Compile validation errors (`{path, message}`): `drama.max_rung` not an integer 0 to 6 or a ladder verb id; `drama.may_target[i]` not a pair; an unknown cast name or id in `may_target` or `may_die`; `@human` as an aggressor; `drama.permadeath` not a boolean; any unknown key. A `drama` block while the sidecar's `PERFECTMAN_DRAMA` is off is a **warning** (`drama.disabled`), not an error. |
| SCN-6 | A scenario for which `may_die` is non-empty SHOULD also author scene cuts (`scene_advance`); otherwise SCENE-5 revives bodies after `PERFECTMAN_DRAMA_SCENE_BODY_MAX_SECS`. |

## 8. Memory and the death state machine

### 8.1 States

```
actor:  alive --kill lands, Tc+hit_stop--> dying --die steps, +2000 ms--> body --scene cut--> alive (actor_revive)
                                                                              \-- permadeath --> removed (actor_gone{died})
human:  alive --kill lands--> down (human_down) --PERFECTMAN_DRAMA_HUMAN_DOWN_MS--> alive
```

| Id | Rule |
|---|---|
| DEATH-1 | The state machine above. `actor_death` is emitted on entering `dying`. A `die` act (standalone) enters `dying` at its `Tc`. A `kill` is the only way a human goes `down`. |
| DEATH-2 | While `dying` or `body`: the actor is out of the speaker pool and every `actor_cmd` it sends (including `chat`, `thought` and `typing`) answers `actor_error{actor_dead}`; it is never owed a reaction and is never a witness. After a restart of the link the hotel lists such actors in `hello.drama.dead`. |
| DEATH-3 | The body is a lying avatar with effect `TrippyHalo` (the previous effect is saved). A faint uses `Twinkle` instead, so `die` and `faint` are told apart. No weapon, no blood: the only signifiers are the lying pose, the halo, the cue `sad` and the sound `sting_sad`. |
| DEATH-4 | The death is the strongest memory event (the verb's `memory.target.event` `death`): the sidecar writes it for the victim and the killer and for every `witnesses` id, **kept after revive**. For a permadeath actor the memory is kept and the actor is retired for the run. |
| DEATH-6 | A killed human is `down` for `HUMAN_DOWN_MS` (5000), lying with the `TrippyHalo` overlay, may still chat; afterwards the hotel stands them up and clears the overlay. |
| DEATH-7 | At a scene cut every `body` actor is restored (`Stand`, the saved effect back, same tile or the nearest free tile) and `actor_revive` is emitted, unless the scenario sets `permadeath`, in which case the avatar is removed and `actor_gone{reason:"died"}` is emitted. |
| MEM-1 | The sidecar, not the hotel, writes memory. The hotel guarantees the frames the writes derive from: `act_done` (landed, with `with`), `act_beat.witnesses`, `actor_death`, `actor_revive`. |

### 8.2 Scenes

| Id | Rule |
|---|---|
| SCENE-1 | A scene id is `"<run>.<n>"`, `n` from 1, assigned by the hotel. A run starts in scene 1. Free play has scenes too (they matter for the ladder and the kill budget). |
| SCENE-2 | A scene cut happens on: a `scene_advance` from the sidecar (`reason:"sidecar"`), a `ui_push{k:"cut"}` (`cut_ui`, so a cinematic Director needs to send nothing extra), or SCENE-5 (`timeout`). Hotel-initiated cuts are the only way `scene` changes; the sidecar always learns the new id from `scene_cut`. |
| SCENE-3 | A cut resets: `rung_cur` for every pair, the kill count, open chips (`aborted`), acts in flight (`aborted`, `scene_cut`), bodies (DEATH-7). It does **not** reset: the same-verb cooldown, the chip cooldown, the harm window and any pause, calm, or opt-in. Because a cut resets the budget, only the sidecar and the timeout (SCENE-5) can cut, never a human, and the harm window (SAFE-4) still bounds violence against humans across cuts. |
| SCENE-4 | The sidecar learns a cut only from `scene_cut` (and the `actor_revive` or `actor_gone` that follow it). It must not assume a cut from its own `scene_advance` until the frame arrives. |
| SCENE-5 | A body that has lasted `PERFECTMAN_DRAMA_SCENE_BODY_MAX_SECS` without a cut triggers a cut with `reason:"timeout"`. |

## 9. Test matrix

One row per normative rule. "Hotel" is a `cargo test` name in `crates/server` (module `drama`) or `crates/sim`; "perfectman" is a vitest title in `packages/hotel` or `packages/eval`. Both sides run the **same** fixture frames (section 9.2) so independent implementations can be cross-checked.

Naming: the hotel test is `drama::<id>` with the id lower-cased and `-` as `_` (for example `drama::gate_6`); the perfectman test title starts with the id in brackets (for example `[GATE-6] ...`). Rows marked n/a have no counterpart on that side.

| Id | Hotel (cargo) observable | Perfectman (vitest) observable |
|---|---|---|
| NEG-1 | `hello.proto` is 1 in every hello; `PROTO` is 2; `hello_ack.proto` 1 and 2 are accepted, 0 and 3 close 4002. | Client given `hello{proto:1,proto_max:2}` does not close 4002; given `hello{proto:2}` it still closes 4002 (old rule kept). |
| NEG-2 | Switch off: the hello JSON equals the golden `hello-v1.json` byte for byte; switch on: it has `proto_max:2`, `caps:["drama.v1"]` and `drama`. | Parser accepts both hellos and ignores unknown fields; fixture `hello-offer.jsonl`. |
| NEG-3 | Hotel stores `caps` and `sidecar.verb_vocab` from the ack. | Ack proto is `min(2, proto_max ?? proto)`; `caps` omitted when own env is off, when hello lacks `drama.v1`, or when the vocab version differs. |
| NEG-4 | Dialect 2 only for ack proto 2 with the cap while offered; ack proto 2 when not offered closes 4002; a reconnect renegotiates. | After a reconnect whose hello has no offer the client answers proto 1 and stops sending acts. |
| NEG-5 | A recorded dialect 1 session (acts forced through the table by a test hook) emits none of the new `t` values; `k:"act"` answers `bad_message`. | With a dialect 1 link `sendAct` and `sendSceneAdvance` are refused before the socket. |
| NEG-6 | `pair` works in both dialects and emits `pair_reaction` only; `act` hug emits act frames only. | Planner picks `act` for hug and kiss on dialect 2, `pair` on dialect 1. |
| NEG-7 | `hello.drama.verb_vocab.sha256` equals the sha256 of the published `verb-vocab.json`. | Version mismatch gives an ack with proto 1; same version with another sha gives proto 2 and a logged warning. |
| NEG-8 | Drop the link mid-act: the act finishes, frames are dropped; the next dialect 2 hello lists the dying actor in `drama.dead`. | A resumed run marks the ids in `hello.drama.dead` as dead and does not plan for them. |
| ACT-1 | dialect 2 session accepts `k:"act"`; dialect 1 answers `bad_message` with no detail. | Encoder output for a valid act parses under the generated type. |
| ACT-2 | Each bad field (act_id pattern, intensity -0.1 and 1.1, `with` as string, text 201 chars, origin `x`) answers `bad_message` with the field path. | The director never emits a value outside the ranges (property test over random acts). |
| ACT-3 | A second `act_id` in the run answers `bad_message` `act_id_reused`. | `act_id` generator is unique per run across 10 000 draws. |
| ACT-4 | Verb `bite` answers `unknown_verb`. | `BodyIntentSchema` rejects a verb outside the 18; the generated union equals `enums.verbs`. |
| ACT-5 | `shove` without `with` answers `target_required`. | Body validator drops an `act` of a required-target verb with no `target`. |
| ACT-6 | `cry` with `with` answers `target_forbidden`. | Body validator drops an `act` of a `none` verb that has a `target`. |
| ACT-7 | `with` equal to self, narrator, a Tilehouse bot, `restrain` on a human, `tend_fallen` on a standing actor each answer `bad_target` with the detail. | Director never targets itself or a human with `restrain`. |
| ACT-8 | `with` in another room answers `target_gone`. | Director re-checks the mirror room before sending. |
| ACT-9 | A dying actor sending an act answers `actor_dead`. | Dead ids are filtered from commands. |
| ACT-10 | A principal sending `walk` during its act answers `act_busy` with the act id; `chat` is accepted. | Planner holds body commands for ids in `act_started` until `act_done`. |
| ACT-11 | A lying actor sending `slap` answers `action_not_here`. | Director checks posture from the mirror. |
| ACT-12 | The 9th command in 5 s answers `slow_down`; table steps do not count. | Planner budget stays at 4 per 5 s including acts. |
| ACT-13 | Stale lease, unknown run, ended run and foreign actor answer the existing codes for `act`. | Existing lease tests extended to `act`. |
| GATE-1 | Runtime switch off: every act is `blocked kill_switch`, no `act_started`. | Handles `blocked kill_switch` by pausing proposals. |
| GATE-2 | Calm room blocks shove, slap, punch, kill, hug, kiss, restrain with `calm_room`; glare is not blocked. | Director does not propose contact verbs while `drama_state.calm`. |
| GATE-3 | With `harm_max` landed violent acts on humans in the window the next is `rate_limit`; actor-to-actor still runs. | Director stops proposing violence at humans while `drama_state.paused`. |
| GATE-4 | `slap` on a body, on a dying actor and on a down human are `dead_target`; `tend_fallen` is not. | Director excludes bodies as targets; `tend_fallen` targets them. |
| GATE-5 | Free play slap, punch, kill; rung above `max_rung`; pair not in `may_target`; kill victim not in `may_die`; skip without scenario: each `no_scenario_gate` with its detail. | Director's gate function equals the hotel's over the shared table of cases. |
| GATE-6 | Violent act on a human with opt-in off is `consent_off` and no chip is shown; `glare` and `hug` on that human are not blocked. | Director never targets a human absent from `drama_state.opt_in` with a violent verb. |
| GATE-7 | Slap from 2 tiles, glare from 9, insult from 7, slap on a walking target: `too_far` with the detail. | Director approaches (planner `afterArrival`) before a contact act. |
| GATE-8 | Shove as the first act, insult then punch, a zero-witness slap by `director`: `ladder`. | Veto function equals the hotel's over the shared cases. |
| GATE-9 | Two physical beats 19 s apart: the second is `budget`; a second kill in a scene is `budget`. | Director schedules the next physical beat at least 20 s later. |
| GATE-10 | Same verb same target twice in 60 s, a second chip on a human with one open, a chip inside the chip cooldown: each `cooldown` with its detail. | Director keeps the 60 s same-verb memory. |
| LAD-1 | Glare then insult then shove then slap succeeds; insult as first act succeeds; shove first is `ladder`; moving down is always legal. | Veto function reproduces the same truth table (shared fixture). |
| LAD-2 | `authored_skip` with scenario origin and a block passes and fills `skipped_rungs`; the same flag with origin `director` is `no_scenario_gate` `skip`. | Scenario beats set `authored_skip` only with `origin:"scenario"`; probe `ladder-compliance` lets it through. |
| LAD-3 | Beats at 0 s and 19.9 s in one scene: second `budget`; at 20 s: allowed; after a `scene_cut` a beat is allowed at once. | Probe `ladder-compliance` flags 19 s spacing inside one scene and not across a `scene_cut`. |
| LAD-4 | Two kills in one scene: second `budget`; after a `scene_cut` a kill is allowed. | Probe counts kills per `scene`, not per room. |
| LAD-7 | Aggressor at rung 5, `restrain` lands: next legal rung is at most 3; `turn_back` by the aggressor does the same. | Director mirrors the reset when `act_done` of restrain lands. |
| LAD-8 | After a kill lands, the killer's `dance` and `laugh` answer `act_busy` `no_reward` for 5 s, `chat` is accepted. | Planner suppresses celebration for the killer for 5 s. |
| LAD-9 | Shove a seated target: no forced step, a face jolt instead, `downgraded:["forced_step"]`. | Probe reads `downgraded`. |
| LAD-11 | Autonomous slap with no avatar within 6 tiles of the principals: `ladder` `zero_witness`; the same with `origin:"scenario"` passes; a human in range counts. | Director asks the mirror for witnesses before an autonomous rung 4 act. |
| FRM-1 | Record one chipped slap: frames arrive in the order of FRM-1 and `act_done` is last, no `act_reaction` after it. | Extractor yields the events in that order for the fixture. |
| FRM-2 | Blocked act: exactly one `act_done`, nothing else for that `act_id`. | Probes do not count a blocked act in `actRate`, `verbDiversity` or the ladder. |
| FRM-3 | Abort a chipped act by calm on: `act_started`, `drama_consent{shown}`, `act_done aborted calm_room`, no `act_beat`. | Extractor reads an aborted act with no contact. |
| FRM-4 | Every new frame has `run`; the frame log wrapper `run` equals it. | `frame_run`-equivalent in the loader files the new frames under the run. |
| REA-1 | For a slap on an actor the target's first `act_reaction` is at most 1500 ms after `act_beat.at`, every witness at most 3000 ms. | Probe p100 over the fixture measures from `act_beat`; wind-up does not count. |
| REA-2 | Witness set: 6-tile radius, lying, walking-out, bot and busy avatars excluded as specified; `act_beat.owed` lists only actors; a human is in `witnesses` only. | Memory writes iterate `act_beat.witnesses`. |
| REA-3 | A table reaction fires with no sidecar present; a planner `face` after `Tc` from an owed witness yields `source:"planner"` and skips the table step; the target of a punch cannot be replaced. | Planner reaction after `act_beat` is not duplicated by a second command. |
| REA-4 | With 5 witnesses the start instants differ, are seeded (same seed, same instants) and never exceed `Tc + 2800`. | Probe `witness-latency` p100 at most 3000. |
| REA-7 | The target's `head_snap` and `stagger` steps run at `Tc + hit_stop` of the class, never before `Tc`. | Probe reads no target reaction before `act_beat`. |
| REA-8 | `act_beat.witnesses` and `act_done` carry what the memory write needs for a landed act. | A landed slap writes aggressor, victim and witnessed events with the table's tones; blocked writes none. |
| REA-9 | A reactor in its step answers `act_busy` to `walk`; `chat` passes; table steps do not use the 8 per 5 s budget. | Planner lock is held for owed reactors; the face lock and reversal lock do not cancel a step. |
| REA-10 | `act_done.owed_missed` is empty for 200 random table acts; a witness removed before its step is dropped from the ledger. | Probe `owed-missed-empty`; planner stops waiting on an id that left. |
| TBL-1 | The embedded `table_schema` validates every verb; a bad table refuses to start with the switch on. | A table failing the schema makes the client answer proto 1. |
| TBL-2 | Compile a slap: anchors, negative `Tc` offsets, `hs` and `stagger` resolve to the expected absolute instants; a negative offset below `-contact_at_ms` is a table error. | `verb-vocab: every step time is valid` over the JSON. |
| TBL-3 | Chipped slap: contact is `answer + 150`; a wind-up step of -300 is clamped to -150; dodge and timeout never reach `Tc`. | Probe: `act_beat.at - drama_consent(answered).at` is 150 ms for a take. |
| TBL-4 | Intensity 0.33 gives L, 0.34 M, 0.67 M, 0.68 H; shove 0.9 clamps to M; kill is F; the hit-stops are 50, 100, 150, 175. | Same table asserted on the TypeScript constant. |
| TBL-5 | The only server effect of hit-stop is the `hs` offset. | n/a (client). Vitest asserts only that the JSON `hit_stop_ms` equals the contract constants. |
| TBL-6 | Kill nests `die` on the target: the target dies at `Tc + 175`; a nested verb's own `verb` steps do not run. | Fixture `kill-actor-revive.jsonl` passes the extractor. |
| TBL-7 | Over 1000 random acts on a human, only `human:true` steps touch it; `face`, `expression`, `chat` never do. | Probe `human-untouched-without-take`. |
| TBL-8 | Compile one act: every client step has the same instant as the equal server step; `act_timeline` contains only `cue`, `sfx`, `caption`, `motion`. | n/a (client packets). Perfectman asserts nothing here. |
| TBL-9 | A scheduled step runs no earlier than due and at most 100 ms later under a fake clock; order is stable. | n/a. |
| TBL-10 | `effect` saves and restores the actor's own effect; a human gets no `appearance_changed`. | Probe: no `appearance` command from the sidecar during an act (the table owns effects). |
| TBL-11 | Tableau holds actors within 6 tiles for 2500 ms and never a human; a slap's `act_done` waits for it. | Planner holds commands for held ids. |
| TBL-12 | In a default run no `PerfectmanUi::Camera` is sent; in a cinematic run the audience gets the camera steps. | n/a. |
| TBL-13 | Caption placeholders are replaced with plain text; a name containing `{target}` is not re-expanded. | n/a. |
| TBL-14 | Every `expression` step has a cue, sign or posture step at the same instant or within 100 ms (table check). | `verb-vocab: no verb depends on face art` over the JSON. |
| RES-1 | `restrain` picks the victim as specified in three layouts (recent target near, nearest other, rescuer). | Director sends `restrain` only with an aggressor that has a recent target. |
| SAFE-1 | `PERFECTMAN_DRAMA` values `on`, `1`, `true`, `yes`, `ON` are on; `off`, ``, `0`, `treu` are off (with a warning for the typo); ignored without `PERFECTMAN_ENABLED`. | Sidecar env parse equals the same table. |
| SAFE-2 | Runtime off aborts an in-flight act with `kill_switch`, closes chips, keeps the session; `on` above an off ceiling is `409 drama_env_off`. | Director resumes proposals when `drama_state.enabled` returns true. |
| SAFE-3 | Calm persists across a restart; contact verbs are blocked even for an opted-in human; actor-on-actor glare still runs; a non-opted-in human receives the actor-on-actor beats. | Director consumes `drama_state.calm`. |
| SAFE-4 | N=3: three landed slaps then the fourth is `rate_limit` and the room is paused; `PAUSE_SECS` later it resumes; admin `resume` ends it early. | Probe flags more than N landed violent acts on humans in a window. |
| SAFE-5 | Opt-in defaults off, resets on reconnect, toggles limited to one per 2 s; opting out with a chip open answers `dodge`. | `drama_state.opt_in` is never placed in prompt text (prompt-leak test). |
| SAFE-6 | A down human can chat and gets `error{action_not_here}` for walk and action; is never frozen or muted. | n/a. |
| SAFE-7 | Each human-target act, blocked act, switch change and pause writes the specified `chat_log` and `audit` rows. | Judge/probe tooling can read the audit rows (fixture). |
| CHIP-1 | Violent act on an opted-out human: `blocked consent_off`, no `act_prompt`, no `drama_consent`; insult at a human likewise. | Probe `consent-violation` flags a landed violent act on a human without `take`. |
| CHIP-2 | Opted-in: `act_started`, `act_prompt`, `drama_consent{shown}` with `ttl_ms` 4000 in that order. | Extractor reads `shown` with `ttlMs` 4000. |
| CHIP-3 | Timeout: slap, insult and kiss end `dodged` with `answer:"timeout"` at `shown + 4000`; hug ends `timeout`. | Probe `chip-timeout-dodge`. |
| CHIP-4 | `take`: contact at answer + 150; `dodge`: the human steps back one tile and the actor whiffs; `push_back`: the actor steps back. | Outcome table of section 3.6 over the fixtures. |
| CHIP-5 | Hug timeout completes with the initiator's steps only; kiss timeout does not. | Same. |
| CHIP-6 | A human is moved only by forced steps and the kill lie-down. | Probe `human-untouched-without-take`. |
| CHIP-8 | Every `shown` is closed by exactly one `answered` or an `aborted` `act_done`. | Extractor pairs `shown` and `answered` by `act_id`. |
| CHIP-9 | A second act on a human with a chip open is `cooldown chip_busy`; after dodge, 60 s `chip_cooldown` against every actor. | Director keeps the 60 s memory per human. |
| SCN-1 | No block: shove allowed, slap, punch, kill, die blocked `free_play`. | Mock free-play run never proposes a rung 4 act. |
| SCN-2 | `drama:{}` equals defaults and permits `authored_skip`. | Compile of `drama:{}` gives max_rung 3, empty lists. |
| SCN-3 | Matrix of max_rung, may_target, may_die, `@human` over the shared cases. | Same cases through the director's gate function. |
| SCN-4 | `authored_skip` with and without block and origin. | Same. |
| SCN-5 | Hotel parser: unknown key in the block is a parse failure, run starts without the block and emits `drama_block_invalid`. | Compile errors for each case listed; `drama.disabled` is a warning. |
| SCN-6 | A body with no cut for the configured time triggers `scene_cut timeout`. | Scenario validator warns on `may_die` with no authored scene cut. |
| DEATH-1 | Kill lands: `actor_death` at `Tc + 175`, state `body` at `+2000`; a human goes `down` with `human_down` and no `actor_death`. | Probe `dead-speech` uses `actor_death` and ignores humans. |
| DEATH-2 | A dying and a body actor answer every command, `chat`, `thought` and `typing` with `actor_dead`; the dead are not in `witnesses`. | Probe `dead-speech`: zero speech after `actor_death`; the arbiter drops the speaker. |
| DEATH-3 | The body has lying posture and `TrippyHalo`; a faint has `Twinkle`. | n/a (visual); the judge anchor reads both. |
| DEATH-4 | `act_done` of the kill and `actor_death` are enough to write the memory (fields present). | Death memory is written for victim, killer and witnesses and kept after revive. |
| DEATH-6 | Down human: 5000 ms default, env override, chat allowed, stands up afterwards. | n/a. |
| DEATH-7 | Scene cut: `scene_cut` then `actor_revive` with tile and saved effect; with permadeath `actor_gone{died}` instead. | Probe `scene-cut-revive`; an actor speaking after revive is not flagged. |
| MEM-1 | The frames MEM-1 lists are present with the fields the sidecar reads. | Memory write is derived only from those frames. |
| SCENE-1 | Run starts in scene `<run>.1`; ids increase by one per cut. | Extractor keys scenes by `scene`. |
| SCENE-2 | `scene_advance`, `ui_push cut` and the body timeout each cause a cut with the matching reason. | Cinematic director sends no extra frame for a cut. |
| SCENE-3 | A cut resets rung, physical spacing, kill count, chips and in-flight acts; cooldowns, harm window, pause, calm and opt-in survive. | Probe applies ladder, spacing and kill count per scene. |
| SCENE-4 | `scene_cut` is emitted before the `actor_revive` it causes. | The client does not change its own scene before `scene_cut`. |
| SCENE-5 | 600 s default, env override. | n/a. |
| VV-1 | `docs/perfectman/schema/verb-vocab.json` exists beside `cue-vocab.json`. | Vendored file byte-equal to the hotel's; `SOURCE.md` records origin. |
| VV-2 | Changing a verb id without bumping `version` fails `drama::vocab_matches_enums`. | Same in the TS test. |
| VV-3 | hello carries `{version, rev, sha256}` of the file. | ack carries the vendored file's triple. |
| VV-4 | `drama::vocab_matches_enums` and `vocab_sha_is_pinned`. | `verb-vocab: matches the generated ids` and `verb-vocab: sha is pinned`. |
| VV-5 | `cue-vocab.json` version 2 lists the five new sounds; the browser cue test passes. | Sidecar cue test accepts version 2 and emits canonical names only. |
| VV-6 | A PROTO 1 sidecar fixture connects to a PROTO 2 hotel with the switch on and off and runs a normal scenario unchanged. | A PROTO 2 client connects to a PROTO 1 hotel fixture and runs unchanged. |

### 9.1 Cross-check fixtures

Both repos check in the same JSON-lines fixtures under `fixtures/drama/` (hotel: `crates/server/tests/fixtures/drama/`, perfectman: `packages/hotel/fixtures/drama/`): `hello-offer.jsonl`, `act-validation.jsonl` (one command per row with the expected `actor_error` or `act_done`), `slap-human-take.jsonl`, `slap-human-timeout.jsonl`, `kill-actor-revive.jsonl`, `blocked-all-reasons.jsonl`. A row is `{in: <frame>, expect: [<frames>]}`. The hotel replays `in` and compares `expect` ignoring `seq` and `at`; perfectman feeds `expect` to the extractor and the probes. The first implementation to land commits the fixtures; the other must pass them unchanged.

## 10. Versioning

| Id | Rule |
|---|---|
| VV-1 | The verb table is published as `docs/perfectman/schema/verb-vocab.json` in the hotel repo **next to `cue-vocab.json`**, and vendored byte-for-byte as `packages/hotel/schema/verb-vocab.json` in this repo (same discipline as the director schema and cue vocab: `SOURCE.md` records the origin; `gen:director` reads it; `check:director` fails when the generated TypeScript is stale). The draft in this repo, `docs/drama/verb-vocab.draft.json`, becomes that file when the hotel publishes it (the `draft`, `$comment` and `contract` keys are dropped and `table_schema` stays). |
| VV-2 | `version` is an integer bumped for any change that alters a verb id, an enum member, a gate rule, or the table schema. `rev` is an integer bumped for tunable data (timings, px, `ms` values, captions) that does not change meaning. The `sha256` of the published bytes covers both. |
| VV-3 | The hotel computes the sha256 of the published file at start and sends `{version, rev, sha256}` in `hello.drama.verb_vocab`; the sidecar sends its own in `hello_ack.sidecar.verb_vocab` (NEG-7). |
| VV-4 | Cross-check tests: the hotel test `drama::vocab_matches_enums` loads the JSON and asserts it equals the Rust verb list, the blocked-reason list, the abort-reason list and the sound list; the perfectman test `verb-vocab: matches the generated ids` asserts the same against the TypeScript unions and `BodyIntentSchema`'s verb enum; and one shared test in each repo (`vocab_sha_is_pinned`, `verb-vocab: sha is pinned`) fails when the vendored bytes differ from a hash recorded in `SOURCE.md`. |
| VV-5 | `cue-vocab.json` becomes `version 2`: `sfx.canonical` gains `slap`, `thud`, `gasp`, `sob`, `whoosh_short` (aliases `smack`, `thump`, `gasp`, `sob`, `swish_short` are optional). The sidecar emits canonical names only and does not emit the five itself (the hotel table does); the vendoring keeps the two repos' cue tests in step. |
| VV-6 | `proto` 2 is the first bump since Phase 1. The next bump to 3 drops dialect 1 (the hotel supports `PROTO` and `PROTO - 1` for one deploy window only, `director-protocol.md` section 14): until then dialect 1 sidecars keep working. Deploy order is unchanged: hotel first, then sidecar. |

## 11. Work split

Eight packets. Paths are the files each packet owns; `(new)` is a new file.

### 11.1 Hotel (Rust, repo `general/habbo`)

| Packet | Owns | Files |
|---|---|---|
| **H1 schema + sim** | The wire types and pure logic: `PROTO`/`PROTO_BASE`, `hello` additions, `ActorCmd::Act`, `SidecarMsg::SceneAdvance`, the ten new `HotelMsg` variants, the new `ActorErrorCode` and `ActorGoneReason::Died`, `ServerMsg`/`ClientMsg` additions, `Verb` enum, the table loader and compile function (`compile_act`: table plus intensity plus roles to a timeline, TBL-2 to TBL-8), the gate evaluator (GATE-1..10 as a pure function), the ladder state, the scenario `DramaBlock` parser, schema regeneration. | `crates/sim/src/director.rs`, `crates/sim/src/protocol.rs`, `crates/sim/src/perfectman.rs`, `crates/sim/src/drama.rs` (new), `docs/perfectman/schema/director.schema.json`, `docs/perfectman/schema/verb-vocab.json` (new) |
| **H2 sequencer** | The act scheduler (50 ms), step executors over the real primitives, forced step reuse, nested verbs, reaction ledger and `act_*` emission, death and revive, scene state, `scene_cut`, `hello.drama.dead`, `Act` dispatch in `director_in`, planner-command accounting (REA-3, REA-9). | `crates/server/src/world/actors.rs`, `crates/server/src/world/drama.rs` (new), `crates/server/src/perfectman/director.rs` (negotiation, dialect per link) |
| **H3 consent + safety** | Session opt-in, `act_prompt`/`act_reply`, chip state machine, harm window and auto-pause, calm persistence, runtime switch, env parsing, admin endpoints, audit rows, notices, `drama_state` and `drama_status`. | `crates/server/src/world/consent.rs` (new), `crates/server/src/perfectman/admin.rs`, `crates/server/src/db.rs` (`perfectman_room_calm`), `crates/server/src/perfectman/db.rs` |
| **H4 client motion** | `act_timeline` playback, the seven motions, hit-stop on the client clock, overlay of catalog effects, the chip UI (`act_prompt`), captions and cue icons in default mode, the five sounds and `cue-vocab.json` version 2. | `crates/client/src/render.rs`, `web/pair.js` (or `web/drama.js` new), `web/sfx.js`, `web/strings.js`, `docs/perfectman/schema/cue-vocab.json`, `tests/browser/cue_vocab.mjs` |

### 11.2 Perfectman (TypeScript, this repo)

| Packet | Owns | Files |
|---|---|---|
| **P1 schema + validator** | Vendor the new `director.schema.json`, `verb-vocab.json` and `cue-vocab.json`, regenerate `generated.ts`; negotiation in `director-client.ts` (`hello.proto_max`, `caps`, `verb_vocab`, the degraded answer); the body `act` key in `BodyIntentSchema` and its validator (section 11.4); scenario `drama` block parse and compile validation. | `packages/hotel/schema/*`, `packages/hotel/src/director/director-client.ts`, `packages/hotel/src/director/generated.ts`, `packages/shared/src/space/body-intent.schema.ts`, `packages/shared/src/space/body.types.ts`, `packages/hotel/src/authoring/scenario-form.ts`, `packages/hotel/src/run/scenario-body.ts` |
| **P2 director** | The drama director: approve or veto model proposals against the ladder, budget and scenario gates, start beats when the model is passive, own the sidecar copy of `rung_cur`, scene and budget state, send `act` and `scene_advance`, consume `drama_state`, `scene_cut`, `actor_death`, `actor_revive`. | `packages/hotel/src/director/drama-director.ts` (new), `packages/hotel/src/run/run.ts`, `packages/hotel/src/gateway/hotel-gateway.ts` |
| **P3 planner + engine** | Plumb `actionEmotions` into `PlanInput` and the tendency readings (as tunable data), the act lock (REA-9 on the sidecar side), planner exemptions, memory writes from act frames, speaker-pool exclusion of the dead, perception of bodies. | `packages/hotel/src/embodiment/plan.ts`, `packages/hotel/src/embodiment/body-executor.ts`, `packages/hotel/src/embodiment/constants.ts`, `packages/hotel/src/embodiment/types.ts`, `packages/engine/src/perception/*`, `packages/hotel/src/run/player-memory.ts` |
| **P4 prompts + mock + scenarios** | The `act` key in the body prompt (`renderBody`), the compact prompt, the mock body provider that proposes acts, starter presets that carry a `drama` block, the fixtures of section 9.1, and the probes and judge learning the fields of section 12. | `packages/server/src/agent/action-intent-prompt-builder.ts`, `packages/server/src/agent/hotel-compact-prompt.ts`, `packages/hotel/src/llm/mock-body.ts`, `packages/hotel/src/authoring/authoring-service.ts` (presets), `packages/hotel/fixtures/drama/` (new), `packages/eval/src/drama/events.ts`, `packages/eval/src/probes/drama.ts`, `packages/eval/src/drama/rubric.ts` |

### 11.3 What blocks what

```
H1 ─┬─> H2 ─┬─> H3 (chip needs the sequencer's contact and outcome hooks)
    │       └─> H4 (timeline compile is H1; playback needs H1's act_timeline type only)
    └─> P1 (vendors H1's schema, verb-vocab, cue-vocab) ─┬─> P2 ─> P4 (scenarios, mock)
                                                         └─> P3
H4 (sounds, cue-vocab v2) ──> P1 (vendors cue-vocab v2)
```

- **H1 and P1 can start the same day**: P1 may begin against this document and the draft JSON, and re-vendors when H1 publishes `verb-vocab.json` and the schema. The shared fixtures (section 9.1) are the handshake.
- **Blocking edges.** H1 blocks everything hotel-side and P1's vendoring. H2 blocks H3 and the end-to-end tests. P1 blocks P2 and P3. P2 and P3 block P4's mock and scenarios. H4 blocks P1 only for `cue-vocab.json` version 2 and is otherwise parallel to H2.
- **What can ship dark.** All of it: with `PERFECTMAN_DRAMA` off on both sides the system is byte-identical to today (NEG-2).

### 11.4 The body `act` key (perfectman, packet P1)

`BodyIntentSchema` gains one strict optional key, so the model may propose any verb while the director keeps authority:

```ts
act: z.object({
  verb: z.enum(ACT_VERBS),                 // the 18 ids, generated from verb-vocab.json
  target: BodyRefSchema.optional(),        // a p# handle; required for `required` verbs, forbidden for `none` verbs
  intensity: z.number().min(0).max(1).optional(),
}).strict().optional()
```

The block-level rule: `act` excludes `gesture` and `posture` (a body block with both is dropped, never the speech half, as today). A handle that is not a `p#` person is dropped. The director then **approves or vetoes** (ladder, budget, scenario gates, LAD-6, LAD-10) and may **start** a beat itself when the model proposed nothing; an approved proposal becomes `actor_cmd{k:"act", origin:"model"}`, a director start `origin:"director"`, a scenario beat `origin:"scenario"`. The prompt MUST list the verb ids and say that the model may propose any, and MUST NOT say that violence needs permission, since the director decides.

## 12. What the existing probes and judge must still learn

Against `packages/eval/src/drama/events.ts` and `packages/eval/src/probes/drama.ts` (the probes worktree), and the judge worktree's `rubric.ts`.

1. **New frames.** `act_beat`, `drama_consent`, `human_down`, `actor_revive`, `scene_cut`, `drama_state` are unknown to the extractor (it ignores unknown kinds, so nothing breaks, but nothing is read).
2. **Contact time.** Read `act_beat` into an event with `witnesses` and `owed`; measure REA-1 and REA-2 from contact, not from `act_started` (`reactionsByAct` and `reactionLatencyP90` use `act.atMs`); fall back to `act_started` when no beat exists.
3. **`act_started` fields** not read today: `room` (as the numeric room), `scene`, `impact`, `origin`, `rung`, `skipped_rungs`, `chip`, `contact_in_ms`. `target_opt_in` is present only for human targets.
4. **`scene` replaces `room` as the scene key** (`sceneOf`). The ladder rule (LAD-1), the 20 s physical spacing (LAD-3) and the kill count (LAD-4) are all per scene, and a scene cut resets them; the current probe keys them by room and will flag a legal beat or a legal second kill right after a cut.
5. **`act_done`**: a new outcome `aborted` (extend `ACT_OUTCOMES`); fields `answer`, `reason`, `detail`, `verb`, `actor`, `with`, `owed_missed`, `downgraded`. An `act_done` with no `act_started` is a blocked act: it must not be dropped, must not count as an act for `actRate`, `verbDiversity` or the ladder, and should feed a new blocked-reason metric.
6. **Chip frames.** Parse `drama_consent` into `consent_chip` events keyed by `act_id` (`ConsentChipShownEvent` needs `actId`); map the answer to the existing `ConsentAnswer` as `take` to `take`, `dodge` and `push_back` to `decline`, `timeout` to `timeout`, and keep the raw value. This closes the known gap that no wire frame carried an act-scoped `take`; today `consentViolation` only finds a `take` when the extractor already has an `actId` on the answered event, which no frame supplies.
7. **`consentViolation`** must treat `insult` aimed at a human as violent (it judges `rung >= shove` only, so a gated insult is invisible), and must use `outcome === "landed"` plus a `take` for that act; `hug`'s outcome `timeout` is a completed, non-violent act.
8. **Death.** `deathsOf` marks a kill victim dead through `act_done landed`. A human victim is not dead (`human_down` is the frame): restrict that path to actor victims, otherwise a human who chats after being killed is flagged `D4` wrongly. `actor_revive` ends a death, so `deadSpeech`, `witnessCoverage` and `reactionLatencyP90` must treat an actor as alive again from its revive; `actor_death.cause` is `kill` or `die`.
9. **Reactions.** Count `source:"planner"` reactions like table ones; ignore humans (they never emit one).
10. **New probes** this contract makes checkable: `owed-missed-empty` (every `act_done.owed_missed` is empty), `blocked-reason-audit` (every blocked reason is in the enum), `chip-timeout-dodge` (CHIP-3), `human-untouched-without-take` (no landed violent act on a human without `take`), `dead-silent` (DEATH-2, already the `dead-speech` probe), `scene-cut-revive` (DEATH-7).
11. **Judge** (`rubric.ts`): the reaction-integrity not-applicable rule lists only `declined` and `timeout`; it must also list `dodged`, `blocked` and `aborted`. "A dead actor stays silent and still" holds until its `actor_revive`. The escalation anchor "starts a scene with a slap" is consistent with LAD-1 only for authored skips: the scenario's `authored_skip` must exempt it.

## 13. Where the hotel's frozen contract constrains this spec

| Frozen rule (source) | Effect here |
|---|---|
| Additive changes do not bump `proto`; removing or **re-typing** bumps it; the hotel supports `PROTO` and `PROTO - 1` for one deploy window (`director-protocol.md` section 14, `director.rs` `PROTO`) | New members of the closed enums `ActorErrorCode`, `ActorGoneReason` and the new `ActorCmd` variant are re-typings, so this contract is PROTO 2 (NEG-1). Dialect 1 keeps working until PROTO 3. |
| Negotiation (README freeze checklist 7, frozen): `hello` carries the hotel's `PROTO`, the sidecar echoes the version it speaks | The sidecar closes 4002 on `hello.proto > PROTO`, so the offer cannot be `hello.proto = 2`; it is `proto_max` and `caps` (NEG-1, NEG-2). `hello.proto` stays 1. |
| Deploy order hotel first, then sidecar (`director-protocol.md` 14) | A new hotel meets an old sidecar for a while; the compatibility matrix in section 1 covers it. |
| Unknown fields ignored; unknown `t` from the hotel ignored by the sidecar; unknown `k` from the sidecar answers `bad_message` | Used on purpose: NEG-5 relies on it for dialect 1, and every new frame is safe for a PROTO 1 reader that never receives it. |
| `director.schema.json` is generated by Tilehouse and vendored; `schema_sha256` only warns; `check:director` is part of `test:gate` (README, D13 schema bridge) | H1 regenerates it, P1 re-vendors it; a mismatch cannot break a link. |
| The frozen `pair` act and D31: kiss and hug on a human complete on timeout, forced Dodge and Push (R6) | `ActorCmd::Pair` is untouched (NEG-6). The act `hug` keeps D31's timeout semantics; `kiss` changes to Dodge on timeout by the owner's decision, and only on the new path. |
| Forced movement is a one-tile `Room::request_walk`; no teleport or slide primitive (R6, `director-protocol.md` 8) | A multi-tile knockback is cosmetic (`motion knockback`) and never changes the tile (TBL, section 5.8). |
| Actors are exempt from `maintain()` and `doze_off`; 8 commands per 5 s per actor (`ACTOR_CMDS_PER_WINDOW`, R10) | `act` counts against the 8 (ACT-12); table steps and forced steps do not (REA-9). |
| D43: `ai` and `Chat.ai` are never on a Director payload; the sidecar never puts the id sign or the word actor into model text | Act frames carry no `ai`. Negative ids appear only as ids; `drama_state.opt_in` must not reach a prompt (section 3.10). |
| D42: all actor text is logged to `chat_log` | The insult line is a `chat` at contact and is logged like any other; the audit row (SAFE-7) is additional. |
| D30: whispers and thoughts are hidden in default mode; D40: no consent toggle for actors entering rooms | Unchanged. The consent here is only for acts that target a human. |
| `ui_push` kinds are whitelisted and text-capped at 2 KiB and 200 characters; `Cut` is sidecar to hotel only | The table's `camera` and `cut_fx` steps are hotel-built `PerfectmanUi` for the Audience; a sidecar `ui_push{k:"cut"}` implies a scene cut (SCENE-2). |
| `cue-vocab.json` is the closed list of sound and emotion names (`camera-and-audio.md` section 8) | Five new sounds mean `cue-vocab.json` version 2 in both repos (VV-5). |
| The 20 s physical budget and one kill per scene are owner decisions (S7) | Enforced by the hotel (LAD-3, LAD-4) and again by the director; the hotel is authoritative. |
| The frame log is a bounded queue that drops oldest lines (`frames_dropped`, an S2 signal) | Act frames are low rate (a few per act); no change. |

## 14. Self-review

### 14.1 Inconsistencies found and fixed while writing

Pass 1, while drafting (each was a real conflict between two sources or two of my own sections, and is fixed in the text):

1. **The offer cannot ride in `hello.proto`.** The first draft said "the hotel sends `proto: 2`". The sidecar closes `4002` on `hello.proto > PROTO` (`director-client.ts` `onHello`), so that would have broken every deployed PROTO 1 sidecar. Fixed: `hello.proto` stays 1, the offer is `proto_max` and `caps` (NEG-1, NEG-2).
2. **The hotel's accept rule is `PROTO` or `PROTO - 1`, which today is `{1, 0}`.** My first description said "exactly 1". Corrected in 1.1.
3. **Reaction latency was measured from the wrong instant.** The bible measures from contact, the probes from `act_started`, and a chipped act waits up to 4000 ms. Added `act_beat` and made `Tc` its `at` (REA-1, section 3.1).
4. **`timeout` meant two things.** The probes' outcome list has one `timeout`; a hug that completes and a violent act that was dodged by silence are different. Fixed: `timeout` is only the hug; a violent or kiss timeout is `dodged` with `answer:"timeout"`. `aborted` was missing and is added.
5. **Bible codes versus the owner's blocked-reason list.** The bible had `actor_error act_budget`, `drama_off`, `dead` and a frame `act_refused`. The owner's list is the blocked reasons of `act_done`. Unified: `actor_error` is only for malformed commands and busy or dead actors (ACT-1 to ACT-13); every policy refusal is `act_done{blocked}`.
6. **LAD-1 and the probes disagreed on how a scene opens.** The bible allowed only `glare` first; the probe allows `glare` or `insult`. Aligned to the probe (`max(cur, 1) + 1`, constant `ladder_open_rung`).
7. **A killed human would have been marked dead by the probes.** `deathsOf` turns a landed kill into a death for any victim, so a human who chats after being killed (allowed) would be a `D4`. Fixed with `human_down` and no `actor_death` for humans; listed in section 12.
8. **The spacing key.** I first made the 20 s spacing room-scoped to match the probe's "scene is a room". That contradicts the owner's "per scene". Restored to per scene (LAD-3, LAD-4) and the probe is told to key by `scene`.
9. **`hug` anticipation.** The bible gives 300 ms of converge; the shipped pair act plays at once. The table uses `contact_at_ms` 0 for `hug` and `kiss` for parity with `play_pair` (the converge is the planner's walk).
10. **Chip timeout versus `answered`.** CHIP-8 first listed `timeout` as a separate close of a chip while `drama_consent` reports it as an `answered` frame. CHIP-8 rewritten.
11. **Example frames.** The first draft of the section 3 examples reused `seq` 203 for two frames and put the contact 8 ms after the chip answer where the spec says 150 ms. Fixed, and the check script now validates the field lists of every example.

Pass 2, with scripts over the final files (all checks pass on the committed files):

12. `verb-vocab.draft.json` validates against its own `table_schema`; `enums.verbs` has 18 members; every effect used (`Love`, `Raincloud`, `TrippyHalo`, `Twinkle`) is in `web/assets/habbo/catalog.json`; every sound is in `cue-vocab.json` or one of the five new names, and all five are used; all seven motions are used; sign styles are only 11, 13, 16.
13. The table check found that `shake` had no parameters for class `M`, which `punch` can reach: added. Reading the generated table I found steps flagged `human:true` on actor-only self steps (`cry`, `faint`, the actor's own `Love` overlay): removed, and the check now enforces that `human:true` only appears on target-role steps and the nested `die`. I found the nested `die` and `freeze_gasp` and the standalone `recoil` carrying their own `reaction` labels on top of the parent's: removed, so the ledger emits one `act_reaction` per owed reactor. The consent chip's hold, dodge and push_back steps existed only in prose: moved into `consent_profiles` with a new anchor `Ta`.
14. 105 rule ids are defined in sections 1 to 10 and each has exactly one row in the test matrix; no rule id is referenced without a definition (the bible ids amended in 14.2 are the only external ones).
15. Every example frame in section 3 matches the field list of its frame (required and optional keys), every enum value used in an example is in the enums of section 0.2, and every reason token in the prose is a blocked reason, an abort reason, or a documented `scene_cut` or prompt-close reason.

### 14.2 Bible rules this file amends

| Bible id | Bible text | Amended here |
|---|---|---|
| LAD-1 | `r <= rung_cur + 1`, scene starts at 0 | `r <= max(rung_cur, 1) + 1` so `insult` can open a scene, as the probes already assume (LAD-1) |
| LAD-3 | A refused beat returns `actor_error act_budget` | A refused beat is `act_done{blocked, reason:"budget"}`; the budget stays per scene as the owner decided (LAD-3, FRM-2) |
| LAD-7 | De-escalation caps `rung_cur` at 2 for 20 s | Immediate `min(rung_cur, 2)`; the 20 s spacing holds anyway (LAD-7) |
| LAD-8 | No reward after a kill for 5 s | Kept, enforced as `act_busy` `no_reward` (LAD-8) |
| LAD-6, LAD-10 | Motive gate, contagion cap | Director policy on the sidecar; not hotel-enforced |
| REA-1 | The clock starts at `T_c` | `T_c` is `act_beat.at` (REA-1) |
| REA-3 | The planner may replace a reaction with equal or greater visibility | Only the replaceable labels, only by a qualifying command after `Tc` (REA-3) |
| REA-5 | The table picks roles from relationships | The hotel does not know relationships; every owed witness gets the table's reaction and the sidecar's director adds rescuer or gossip as its own follow-up acts |
| REA-6 | Zero-witness cap, Q4 | LAD-11: autonomous acts of rung 4 or above, `reason:"ladder"` `detail:"zero_witness"` |
| CHIP-1 | A refused violent beat returns `drama_off` | `act_done{blocked, reason:"consent_off"}`; `insult` aimed at a human is now gated (CHIP-1) |
| CHIP-5 | `kiss` timeout is open question Q2 | `kiss` times out to dodge, `hug` completes (CHIP-3, CHIP-5) |
| CHIP-7 | `square_up` standoff distance | Moot: `square_up` is not in v1 |
| DEATH-2 | New code `dead` | `actor_dead` |
| DEATH-5 | `ghost_voice` | Not in v1; the dead cannot send even a `thought` |
| DEATH-6 | A killed human is down a few seconds | 5000 ms, configurable; a human gets `human_down`, not `actor_death` |
| DEATH-7 | Restored after the cut unless permadeath | `actor_revive`; permadeath is `actor_gone{died}` |
| Section 6.3 | Frames `act_start`, `act_contact`, `act_end`, `act_refused` | `act_started`, `act_beat`, `act_done` (with `blocked`); `act_refused` does not exist |
| Section 8 | v1 cut of 16 verbs | 18 verbs (owner decisions block in section 8 of the bible) |

## Appendix A: the verb table, rendered

Generated from `verb-vocab.draft.json`. Times are `anchor+ms`; `+hs` adds the hit-stop of the class, `+stagger` the witness stagger, `+down` the human down time. `[needs]` marks `b` (client motion), `sfx`, `overlay`, `verify`; `{human}` marks a step allowed on a human avatar.

#### `glare`

rung 1; conflict_noncontact; target required (actor/human); `contact_at_ms` 0; class -, default intensity 0.4; owed target 1500 ms, witnesses if rung>=2 (3000 ms); chip -; calm ok; budget -; cooldown 60 s; memory actor `aggressor`, target `victim`, witnesses `witnessed`.

Note: Table end = Tc + 2000. Witnesses owe a reaction only when the pair already reached rung 2 in this scene.

```text
actor:
  T0            face        toward=target
  T0            expression  face=angry
  Tc            motion      name=lunge toward=target  [b]
  Tc            hold        ms=2000
  Tc+2000       expression  face=neutral
target:
  Tc+400        face        toward=actor  reaction:look_back
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  T0            cue         on=actor emotion=angry ms=1500
  T0            sfx         cue=sting_tension once=true
  T0            caption     ms=2000 text=* {actor} glares at {target} *
camera:
  T0            camera      shot=two_shot target=pair zoom=1 ease_ms=0 hold_ms=600
  Tc+600        camera      shot=close_up target=actor zoom=2 ease_ms=0 hold_ms=700
  Tc+1300       camera      shot=reaction target=target zoom=2 ease_ms=0 hold_ms=1000
```

#### `insult`

rung 2; conflict_noncontact; target required (actor/human); `contact_at_ms` 300; class -, default intensity 0.5; owed target 1500 ms, witnesses yes (3000 ms); chip violent_chip; calm ok; budget -; cooldown 60 s; memory actor `aggressor`, target `victim`, witnesses `witnessed`.

Note: Against a human the line (act.text) is spoken only after the chip answer is take. Dodge and push_back speak nothing.

```text
actor:
  Tc-300        face        toward=target
  Tc-300        expression  face=angry
  Tc            chat        mode=shout text_from=act.text
  Tc            gesture     action=sign style=16  optional
  Tc            motion      name=shake  [b]
  Tc            hold        ms=900
  Tc+900        expression  face=neutral
target:
  Tc+300        expression  face=surprised  reaction:surprised
  Tc+500        face        toward=actor
witnesses:
  Tc+stagger    face        toward=actor  reaction:watch
room:
  Tc-300        cue         on=actor emotion=angry ms=1500
  Tc            sfx         cue=sting_tension once=true
  Tc            caption     ms=2000 text=* {actor} shouts at {target} *
camera:
  T0            camera      shot=close_up target=actor zoom=2 ease_ms=0 hold_ms=800
  Tc+800        camera      shot=reaction target=target zoom=2 ease_ms=0 hold_ms=1500
```

#### `shove`

rung 3; conflict_contact; target required (actor/human); `contact_at_ms` 250; class L-M, default intensity 0.25; owed target 1500 ms, witnesses yes (3000 ms); chip violent_chip; calm blocks; budget physical; cooldown 60 s; memory actor `aggressor`, target `victim`, witnesses `witnessed`.

Note: A target that is not standing and still is not moved: the face jolt replaces the forced step and act_done lists downgraded:[forced_step].

```text
actor:
  Tc-250        face        toward=target
  Tc-250        expression  face=angry
  Tc-100        motion      name=lunge toward=target  [b]
  Tc            motion      name=hit_stop who=both  [b]
  Tc+100+hs     forced_step mover=actor into_vacated=target  when:target_moved
  Tc+400        expression  face=neutral
target:
  Tc+hs         forced_step mover=target away_from=actor  reaction:stagger {human}
  Tc+hs         expression  face=surprised
  Tc+hs         face        toward=actor offset=1  when:target_not_moved
  Tc+hs         motion      name=knockback away_from=actor  [b]
  Tc+1200       expression  face=neutral
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  Tc-100        sfx         cue=whoosh_short once=true  [sfx]
  Tc            sfx         cue=thud once=true  [sfx]
  Tc+hs         cue         on=target emotion=surprised ms=1200
  Tc            caption     ms=2000 text=* {actor} shoves {target} *
camera:
  Tc-250        camera      shot=two_shot target=pair zoom=2 ease_ms=0 hold_ms=600
  Tc+350        camera      shot=reaction target=target zoom=2 ease_ms=0 hold_ms=1000
```

#### `slap`

rung 4; conflict_contact; target required (actor/human); `contact_at_ms` 300; class M-H, default intensity 0.5; owed target 1500 ms, witnesses yes (3000 ms); chip violent_chip; calm blocks; budget physical; cooldown 60 s; memory actor `aggressor`, target `victim`, witnesses `witnessed`; follow-up tableau.

Note: Against a human only cosmetic client steps run on the target (no face, no expression).

```text
actor:
  Tc-300        face        toward=target
  Tc-300        expression  face=angry
  Tc-300        gesture     action=wave  optional [verify]
  Tc-50         motion      name=lunge toward=target  [b]
  Tc            gesture     action=stop  optional [verify]
  Tc            motion      name=hit_stop who=both  [b]
  Tc+1500       expression  face=neutral
target:
  Tc            motion      name=tint_flash  [b]
  Tc+hs         face        toward=actor offset=1  reaction:head_snap
  Tc+hs         expression  face=surprised
  Tc+hs         motion      name=recoil away_from=actor  [b]
  Tc+1200       face        toward=actor
  Tc+2000       expression  face=neutral
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  Tc            sfx         cue=slap once=true  [sfx]
  Tc+hs         cue         on=target emotion=surprised ms=1500
  T0            cue         on=actor emotion=angry ms=1500
  Tc            caption     ms=2000 text=* {actor} slaps {target} *
camera:
  Tc            camera      shot=close_up target=target zoom=2 ease_ms=0 hold_ms=1500
  Tc+1500       camera      shot=two_shot target=pair zoom=1 ease_ms=0 hold_ms=800
```

#### `punch`

rung 5; conflict_contact; target required (actor/human); `contact_at_ms` 350; class M-H, default intensity 0.8; owed target 1500 ms, witnesses yes (3000 ms); chip violent_chip; calm blocks; budget physical; cooldown 60 s; memory actor `aggressor`, target `victim`, witnesses `witnessed`; follow-up tableau.

```text
actor:
  Tc-350        face        toward=target
  Tc-350        expression  face=angry
  Tc-350        gesture     action=wave  optional [verify]
  Tc-60         motion      name=lunge toward=target  [b]
  Tc            gesture     action=stop  optional [verify]
  Tc            motion      name=hit_stop who=both  [b]
  Tc+1800       expression  face=neutral
target:
  Tc            motion      name=tint_flash  [b]
  Tc            motion      name=shake  [b]
  Tc+hs         forced_step mover=target away_from=actor  reaction:stagger {human}
  Tc+hs         expression  face=surprised
  Tc+hs         motion      name=knockback away_from=actor  [b]
  Tc+300+hs     face        toward=actor offset=2
  Tc+300+hs     effect      name=Twinkle ms=1500 restore=true  {human} [overlay]
  Tc+2000       expression  face=neutral
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  Tc-150        sfx         cue=whoosh_short once=true  [sfx]
  Tc            sfx         cue=thud once=true  [sfx]
  Tc+hs         cue         on=target emotion=surprised ms=1500
  T0            cue         on=actor emotion=angry ms=1500
  Tc            caption     ms=2000 text=* {actor} punches {target} *
camera:
  Tc            camera      shot=close_up target=target zoom=2 ease_ms=0 hold_ms=600
  Tc+600        camera      shot=reaction target=target zoom=2 ease_ms=0 hold_ms=1200
```

#### `kill`

rung 6; climax; target required (actor/human); `contact_at_ms` 500; class F, default intensity 1.0; owed target 1500 ms, witnesses yes (3000 ms); chip violent_chip; calm blocks; budget kill; cooldown 60 s; memory actor `aggressor`, target `death`, witnesses `witnessed`; follow-up tableau.

Note: The victim half is the nested die verb. Victim becomes dying at Tc + hit_stop; actor_death follows in the same tick. A human victim is down for human_down_ms and gets no actor_death.

```text
actor:
  Tc-500        face        toward=target
  Tc-500        expression  face=angry
  Tc-60         motion      name=lunge toward=target  [b]
  Tc            motion      name=hit_stop who=both  [b]
  Tc            motion      name=shake  [b]
  Tc+hs         lock        ms=5000 forbid=["dance", "thumbs", "laugh"]
  Tc+600+hs     expression  face=surprised
  Tc+1500+hs    expression  face=neutral
  Tc+1500+hs    hold        ms=1000
target:
  Tc            motion      name=tint_flash  [b]
  Tc+hs         verb        verb=die  reaction:die {human}
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  Tc            sfx         cue=thud once=true  [sfx]
  Tc+hs         sfx         cue=sting_tension once=true
  Tc+hs         caption     ms=2500 text=* {target} collapses *
camera:
  Tc            camera      shot=close_up target=target zoom=2 ease_ms=0 hold_ms=600
  Tc+600        camera      shot=reaction target=target zoom=2 ease_ms=0 hold_ms=1500
```

#### `die`

rung -; climax; target optional (actor/human); `contact_at_ms` 0; class -, default intensity 1.0; owed target - ms, witnesses standalone (3000 ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `death`, witnesses `witnessed`.

Note: Standalone die is authored: needs the actor in may_die. Nested under kill it is gated by kill. The state step 'dying' emits actor_death (actors) or human_down (humans). Table end = Tc + 2300 for actors; humans end after the down time.

```text
actor:
  Tc            state       to=dying  {human}
  Tc            expression  face=surprised
  Tc            forced_step mover=actor away_from=target  {human}
  Tc            motion      name=knockback away_from=target  [b]
  Tc+300        hold        ms=600
  Tc+300        cue         on=actor emotion=surprised ms=600
  Tc+900        gesture     action=wave  optional [verify]
  Tc+1400       gesture     action=stop  optional [verify]
  Tc+1400       posture     pose=lay fallback=sit_floor  {human}
  Tc+1400       motion      name=fall  [b]
  Tc+1450       sfx         cue=thud once=true  [sfx]
  Tc+1750       expression  face=neutral
  Tc+2000       effect      name=TrippyHalo ms=null restore=true  {human} [overlay]
  Tc+2000       state       to=body  only:actor
  Tc+2000       cue         on=actor emotion=sad ms=1500
  Tc+2000       sfx         cue=sting_sad once=true
  Tc+2000+down  posture     pose=stand  {human} only:human
  Tc+2000+down  state       to=normal  {human} only:human
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
camera:
  Tc+1400       camera      shot=close_up target=actor zoom=2 ease_ms=0 hold_ms=1500
```

#### `recoil`

rung -; solo; target optional (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`.

Note: Also the nested reaction verb. 'target' is the thing recoiled from; absent means no face step.

```text
actor:
  Tc            face        toward=target offset=2
  Tc            expression  face=surprised
  Tc            motion      name=recoil away_from=target  [b]
  Tc            cue         on=actor emotion=surprised ms=1200
  Tc            sfx         cue=gasp once=true  [sfx]
  Tc            hold        ms=500
  Tc+1200       expression  face=neutral
```

#### `freeze_gasp`

rung -; solo; target optional (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`.

Note: Also the default nested witness reaction. A walking actor cannot stop mid-walk (no primitive): the expression and cue still count as the visible response.

```text
actor:
  Tc            face        toward=target
  Tc            expression  face=surprised
  Tc            cue         on=actor emotion=surprised ms=1500
  Tc            gesture     action=sign style=13  optional
  Tc            sfx         cue=gasp once=true  [sfx]
  Tc            hold        ms=1200
  Tc+1500       expression  face=neutral
```

#### `hug`

rung -; affection; target required (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target 1500 ms, witnesses no (- ms); chip affection_chip; calm blocks; budget -; cooldown 60 s; memory actor `affectionate`, target `receiver`, witnesses `witnessed`.

Note: Parity with the existing pair act: initiator blow at Tc, partner sign 11 at Tc+300. Against a human the target steps run only on take; a timeout completes with the initiator steps only.

```text
actor:
  Tc            face        toward=target
  Tc            gesture     action=blow
  Tc            effect      name=Love ms=2400 restore=true  [overlay]
  Tc            hold        ms=1500
target:
  Tc+300        gesture     action=sign style=11  reaction:hug_back {human}
  Tc+300        effect      name=Love ms=2100 restore=true  {human} [overlay]
witnesses:
  Tc+stagger    face        toward=actor  reaction:watch
room:
  Tc            sfx         cue=hug once=true
  Tc            cue         on=actor emotion=love ms=1500
  Tc            caption     ms=2000 text=* {actor} hugs {target} *
camera:
  Tc            camera      shot=two_shot target=pair zoom=2 ease_ms=0 hold_ms=2000
```

#### `kiss`

rung -; affection; target required (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target 1500 ms, witnesses no (- ms); chip affection_chip_dodge; calm blocks; budget -; cooldown 60 s; memory actor `affectionate`, target `receiver`, witnesses `witnessed`.

Note: Cheek or air kiss with a heart. The staging never shows lip contact: the lunge is 4 px and the heart carries it. A human who does not answer is treated as dodge.

```text
actor:
  Tc            face        toward=target
  Tc            gesture     action=blow
  Tc            motion      name=lunge toward=target  [b]
  Tc            effect      name=Love ms=2000 restore=true  [overlay]
  Tc            hold        ms=1500
target:
  Tc+300        gesture     action=blow  reaction:kiss_back {human}
  Tc+300        effect      name=Love ms=1700 restore=true  {human} [overlay]
witnesses:
  Tc+stagger    face        toward=actor  reaction:watch
room:
  Tc            sfx         cue=kiss once=true
  Tc            cue         on=actor emotion=love ms=1500
  Tc            caption     ms=2000 text=* {actor} kisses {target} on the cheek *
camera:
  Tc            camera      shot=two_shot target=pair zoom=2 ease_ms=0 hold_ms=2000
```

#### `turn_back`

rung -; solo; target optional (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`; de-escalates.

Note: offset 4 = 180 degrees from the direction toward the target (opposite). A seated actor snaps to an even direction; a lying actor cannot turn (act_done lists downgraded:[face]). Without a target the actor turns 180 degrees from the current facing. When the actor is the aggressor toward the target this lowers rung_cur(actor to target) to at most 2.

```text
actor:
  Tc            face        toward=target offset=4
  Tc            hold        ms=3000 override_face_lock=true
```

#### `cry`

rung -; solo; target none (none); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`.

Note: Sadness stays slow: the shake is 1 px over 4 s (motions.shake.by_verb.cry).

```text
actor:
  Tc            expression  face=sad
  Tc            effect      name=Raincloud ms=4500 restore=true
  Tc            motion      name=shake  [b]
  Tc            hold        ms=4500
  Tc+4500       expression  face=neutral
room:
  Tc            cue         on=actor emotion=sad ms=2000
  Tc            sfx         cue=sob once=true  [sfx]
camera:
  Tc            camera      shot=close_up target=actor zoom=2 ease_ms=0 hold_ms=2500
```

#### `storm_off`

rung -; solo; target optional (actor/human); `contact_at_ms` 400; class -, default intensity 0.6; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`.

Note: Ends at Tarr + 500 (Tarr is the walk's arrived frame). The hotel stops at the door tile; leaving the room is the sidecar's move_room after act_done, when the scenario allows travel. With no route to the door the walk step is skipped, the act ends at Tc + 400 and act_done lists downgraded:[walk_to].

```text
actor:
  T0            posture     pose=stand  optional
  T0            face        toward=target offset=4
  T0            expression  face=angry
  Tc            walk_to     dest=door
  Tc            motion      name=shake  [b]
  Tarr          expression  face=neutral
room:
  T0            cue         on=actor emotion=angry ms=1500
  Tarr          sfx         cue=door_close once=true
  Tarr          caption     ms=1500 text=* {actor} storms off *
camera:
  T0            camera      shot=tracking target=actor zoom=1 ease_ms=300 hold_ms=3000
  Tarr          cut_fx      kind=door ms=600
```

#### `tableau`

rung -; director; target optional (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`.

Note: Every actor within tableau_radius_tiles of the actor (and of the target when given), standing or sitting and alive, holds: body commands answer act_busy, chat stays allowed. Humans are never held. Also the follow_up of slap, punch, kill and faint.

```text
actor:
  Tc            hold        ms=2500
witnesses:
  Tc            hold        ms=2500
room:
  Tc            sfx         cue=sting_tension once=true
camera:
  Tc            camera      shot=two_shot target=pair zoom=1 ease_ms=0 hold_ms=2500
```

#### `restrain`

rung -; conflict_contact; target required (actor); `contact_at_ms` 200; class L, default intensity 0.3; owed target 1500 ms, witnesses no (- ms); chip -; calm blocks; budget -; cooldown -; memory actor `none`, target `none`, witnesses `none`; de-escalates.

Note: Actor to actor only. The victim is the aggressor's most recent act target in this scene if still within 2 tiles, else the nearest other avatar, else the actor (RES-1). rung_reset lowers rung_cur(aggressor to victim) to at most 2.

```text
actor:
  Tc-200        face        toward=target
  Tc-100        motion      name=lunge toward=target  [b]
  Tc            motion      name=hit_stop who=both  [b]
target:
  Tc+hs         forced_step mover=target away_from=victim  reaction:struggle
  Tc+hs         expression  face=angry
  Tc+200+hs     face        toward=actor offset=1
  Tc+400+hs     face        toward=actor offset=-1
  Tc+1400       expression  face=neutral
  Tc+hs         state       to=rung_reset
room:
  Tc-100        sfx         cue=whoosh_short once=true  [sfx]
  Tc            caption     ms=2000 text=* {actor} holds {target} back *
camera:
  Tc-200        camera      shot=two_shot target=pair zoom=2 ease_ms=0 hold_ms=1200
```

#### `faint`

rung -; climax; target none (none); `contact_at_ms` 800; class -, default intensity 0.7; owed target - ms, witnesses yes (3000 ms); chip -; calm ok; budget -; cooldown -; memory actor `none`, target `none`, witnesses `witnessed`; follow-up tableau.

Note: Alive marker is Twinkle (die uses TrippyHalo). WAKE-1: a tend_fallen act that starts on the fainted actor shortens the lying phase to end 1500 ms after the tender's contact. Lying is refused while walking or with no room to lie: posture falls back to sit_floor.

```text
actor:
  T0            expression  face=sad
  T0            motion      name=shake  [b]
  Tc            posture     pose=lay fallback=sit_floor
  Tc            motion      name=fall  [b]
  Tc+50         sfx         cue=thud once=true  [sfx]
  Tc+400        effect      name=Twinkle ms=7200 restore=true
  Tc+400        cue         on=actor emotion=confused ms=3000
  Tc+400        sfx         cue=sting_sad once=true
  Tc+400        hold        ms=7600
  Tc+7600       posture     pose=stand
  Tc+7600       expression  face=neutral
witnesses:
  Tc+stagger    verb        verb=freeze_gasp  reaction:freeze_gasp
room:
  Tc            caption     ms=2000 text=* {actor} faints *
camera:
  Tc            camera      shot=close_up target=actor zoom=2 ease_ms=0 hold_ms=1500
```

#### `tend_fallen`

rung -; affection; target required (actor/human); `contact_at_ms` 0; class -, default intensity 0.5; owed target - ms, witnesses no (- ms); chip -; calm ok; budget -; cooldown -; memory actor `affectionate`, target `receiver`, witnesses `none`.

Note: Target must be a body: a faint actor, a dying or body actor, or a human who is down. Otherwise actor_error bad_target detail not_fallen. The kneel is sit_floor (no real kneel pose exists).

```text
actor:
  Tc            face        toward=target
  Tc+200        posture     pose=sit_floor
  Tc+200        expression  face=sad
  Tc+200        hold        ms=6000
  Tc+6200       posture     pose=stand
  Tc+6200       expression  face=neutral
room:
  Tc+200        cue         on=actor emotion=sad ms=2000
  Tc+200        sfx         cue=sting_sad once=true
camera:
  Tc            camera      shot=two_shot target=pair zoom=2 ease_ms=0 hold_ms=2000
```

#### Consent profiles

```text
violent_chip (timeout: dodge)
  hold      actor   T0        face        toward=target
  hold      actor   T0        expression  face=angry
  hold      room    T0        cue         on=actor emotion=angry ms=1500
  dodge     target  Ta        forced_step mover=target away_from=actor  {human}
  dodge     actor   Ta        motion      name=lunge toward=target  [b]
  dodge     actor   Ta+300    expression  face=neutral
  dodge     actor   Ta        hold        ms=1000
  push_back actor   Ta        forced_step mover=actor away_from=target
  push_back actor   Ta        expression  face=surprised
  push_back actor   Ta+1200   expression  face=neutral
  push_back room    Ta        cue         on=actor emotion=surprised ms=1200
affection_chip (timeout: initiator_only)
  hold      actor   T0        face        toward=target
  dodge     target  Ta        forced_step mover=target away_from=actor  {human}
  dodge     actor   Ta+300    face        away_from=target
  push_back actor   Ta        forced_step mover=actor away_from=target
  push_back actor   Ta        expression  face=surprised
  push_back actor   Ta+1200   expression  face=neutral
  push_back room    Ta        cue         on=actor emotion=surprised ms=1200
affection_chip_dodge (timeout: dodge)
  hold      actor   T0        face        toward=target
  dodge     target  Ta        forced_step mover=target away_from=actor  {human}
  dodge     actor   Ta+300    face        away_from=target
  push_back actor   Ta        forced_step mover=actor away_from=target
  push_back actor   Ta        expression  face=surprised
  push_back actor   Ta+1200   expression  face=neutral
  push_back room    Ta        cue         on=actor emotion=surprised ms=1200
```
