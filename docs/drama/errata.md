# Drama act contract: errata and readings

Revision 2 of `docs/drama/act-contract.md` is frozen and is not edited here. This page is the single list of what the packets found
wrong, missing or ambiguous in it, and of what integration (packet PI-a) found when the sidecar met the hotel's real output. Each row
has the rule id, who found it, and how it was resolved. A later revision of the contract should absorb the rows marked **open**.

Sources: the hotel's `docs/perfectman/decisions.md` D55 (H1) and the section headed "Act contract: what packet H2 (the sequencer)
decided" in the same file, `docs/perfectman/drama-consent-safety.md` (H3), the bodies of pull requests 255 to 258 (E, P1, P2, P3), and
the reports of those packets. The hotel's files were read at `drama/h1-contract` f71dad2, `drama/h2-sequencer` e1ba025 and
`drama/h3-consent-safety` d1e3a90.

Resolution words:

- **fixed**: code or test changed in the integration branch; the test named pins it.
- **agreed**: the hotel and the sidecar made the same reading; a test on the vendored fixtures pins it.
- **hotel-internal**: no frame, field or probe on this side depends on it.
- **open**: the contract text still needs an answer, or the sidecar keeps a documented stand-in.

## 1. Found by PI-a, against the hotel's real output

| Id | Rule | Found by | Defect | Resolution |
| --- | --- | --- | --- | --- |
| PI-01 | SCENE-2, section 3.9 | PI-a, `tsc` on the real schema | The hotel's `scene_advance` requires `reason` (a Rust `String` with no default); section 3.9 calls it free text and the sidecar omitted it when its caller gave none. A frame without it does not parse. | **fixed**: `sendSceneAdvance` always sends one (`DEFAULT_ADVANCE_REASON`, cut at 40 characters). Test in `drama-negotiation.test.ts`. |
| PI-02 | ACT-4 | PI-a, reading `act_fields` in the hotel's `crates/sim/src/drama.rs` | The hotel reads `null` as absent for `with`, `intensity`, `origin`, `authored_skip` and `text` (its schema types them `T or null`); the sidecar's pre-send check refused `null`. | **fixed**: `validateActCmd` reads `null` as absent. Test in `drama-hotel-act-edges.test.ts`. |
| PI-03 | ACT-4 | PI-a, same reading | The hotel counts the 200 characters of `text` as characters; the sidecar counted UTF-16 units, so 200 emoji were refused. | **fixed**, same test. |
| PI-04 | ACT-6 | PI-a, same reading | The hotel cuts an `unknown_verb` detail at 40 characters; the sidecar cut at 40 UTF-16 units and could split a character. | **fixed**, same test. |
| PI-05 | LAD-1, GATE-8 | PI-a, running the hotel's `blocked-all-reasons` rows b21 and b25 through the director | The act ledger pruned finished acts older than the harm window (300 s), so the pair's rung fell to 0 in a scene that lasted longer than five minutes and the director vetoed an escalation the hotel allows. LAD-1 says the rung is the highest used in the scene, with no time limit. | **fixed**: `ledger.prune` keeps every act of the current scene. Tests `[LAD-1]` in `drama-hotel-gates.test.ts` (and rows b21 and b25 there). |
| PI-06 | section 11.2, FRM-4 | PI-a | P2 and P3 each wired a run: P2 with `Run.dramaPort` and the hub, P3 with a `dramaPort` factory on `ManagerOptions` and `Sidecar`, a second frame route and a vendored `embodiment/drama-port.ts`. Both would have fed the planner side twice. | **fixed** in the merge: one mechanism, the hub attaches `composeDramaSinks(director, planner side)` per run; the vendored port is deleted and its imports point at `director/drama/ports.ts`; the planner reads the director through a getter because the run builds the director after it. Test `drama-planner-e2e.test.ts` and `drama-director-run.test.ts` pass unchanged. |
| PI-07 | NEG-2, VV-3 | PI-a | The three stand-in files were hand-authored from the contract. The real schema names things differently: `Verb`, `Origin`, `BlockedReason`, `ActReason` (blocked and abort reasons in one enum, `kill_switch` and `calm_room` in both), `Outcome2`, `Owed`, `OwedMissed`, `Downgrade`, `ReactionRole`, `BeatKind`, `DeathCause`. | **fixed**: vendored the real files, regenerated, renamed the hand-written imports, `drama-vocab.test.ts` reads the real names and checks `ActReason` is the blocked reasons followed by the abort-only ones. The stand-in VV-1 test is deleted and the verb table pin is `002fa380...1263`. |
| PI-08 | NEG-2, FRM-3 | PI-a | Optionality differs from the stand-in: `hello.drama.dead` and `act_started.contact_in_ms` are optional in the real schema (required in the stand-in). | **fixed**: `negotiate` reads `dead ?? []`; no reader of `contact_in_ms` required it. |
| PI-09 | ACT-4 | PI-a | The real schema carries no `pattern` for `act_id` and no bounds for `intensity`, `rung` or `contact_in_ms` (the stand-in had them); `act_id`'s pattern and the intensity range live only in the verb table constants and the hotel's hand reader. | **agreed**: `validateActCmd` stays the sidecar's guard; `drama-hotel-fixtures.test.ts` checks it against the hotel's own rows. The schema is not a validator for these fields. |
| PI-10 | section 9.1 | PI-a | The hotel's README says its fixtures are checked in under `packages/hotel/fixtures/drama/` here, byte-identical. They are not: P1's files were written from the spec first and differ in rows and in perspective. | **fixed**: the hotel's files are vendored under `fixtures/drama/hotel/` with a provenance page and pinned hashes; the differences are asserted in `drama-hotel-diff.test.ts` (section 4). |
| PI-11 | section 9.1 | PI-a | The hotel's contract-derived rows leave out `seq`, `at` and a `hello`'s `session` (it compares ignoring them), so they are not wire frames and fail the schema as they stand. | **agreed**: `asWire` puts neutral values back before a check. Recorded rows keep their own `at`. |
| PI-12 | RES-1, GATE-2 | PI-a | The director declines a `restrain` at someone who has used no rung (RES-1) before it reaches the calm gate, so for the hotel's row `calm-restrain` it passes with `no_drive` where the hotel answers `calm_room`. Nothing is sent either way. | **agreed**: documented, test `[RES-1]` in `drama-hotel-gates.test.ts`. |
| PI-13 | REA-1, DEATH-7, DOWN-3 | PI-a, corrupting the real lifecycles | Probe gaps found by corruption: dropping only a kill target's `die` reaction passes (its death counts as the reaction); a second `act_done` for one act and a `human_up` that never comes are not flagged. | **fixed** by P4 in `drama-probe-gaps.test.ts`: a death excuses a target's missing reaction only when this act caused it (so a dropped reaction on a non-lethal act is `D1` whatever else died); the new probe `kill-victim-die-reaction` wants the victim's `die` after contact; the new probe `single-act-done` flags a repeated `act_done`; a missing `human_up` is `down-window-exact`'s once the run is known to have lasted past the window (a stream that ends before the window is due is open, not lost, and cannot say more). Each has a fixed mutation of a vendored lifecycle that the probe must catch. |
| PI-14 | NEG-1 | PI-a, from H1's note | The hotel refuses a `hello_ack.proto` outside `[1, offered max]` (`PROTO_BASE` is 1), so 0 is no longer accepted. | **agreed**: the sidecar only ever answers 1 or 2 (`negotiate`, `drama-negotiation.test.ts`) and the fake hotel implements the refusal (`acceptAck`); no test sends a 0, so the refusal itself is unpinned on this side. |

## 2. Hotel packets

### H1 (D55, 14 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| H1-01 | section 3.6, REA-9 | `downgraded` has a sixth label, `chat` | **agreed**: `Downgrade` has six members; P1-04 is the same finding. |
| H1-02 | section 9.1 | `{in, expect}` rows cannot set the world; the hotel adds `given` | **agreed**: the sidecar side reads it (`hotel-given.ts`), see PI-10. |
| H1-03 | ACT-9, ACT-10 | `bot`, `kind`, `not_fallen` need the avatar, so `self` and `narrator` are checked first, then `target_gone` | **agreed**: P1 decides only `self` and `narrator`; the hotel's rows for the rest pass the sidecar's check untouched. |
| H1-04 | GATE-9 | Both budgets refuse: `physical` first, then `kill` | **agreed**: P2-02; rows b21 and b22. |
| H1-05 | GATE-10 | Detail order `verb`, `chip_cooldown`, `chip_busy` | **agreed**: rows b23 to b25. |
| H1-06 | DOWN-1, section 14.1 | The down window starts at the nested `die`'s `Tc`, so the stand-up is exact | **agreed**: `down-window-exact` passes at 5000 ms on `down-human-abort`. |
| H1-07 | TBL-14 | Compares absolute instants, `T0` resolved to 0 and `Tc` to `contact_at_ms` | **agreed**: P1-09. |
| H1-08 | TBL-3 | A chipped act lists the `T0` cue twice (verb and hold); `pre` lists it once | hotel-internal. |
| H1-09 | RES-1 | `restrain` compiled without a victim uses the actor | hotel-internal. |
| H1-10 | CHIP-10, TBL-8 | `act_timeline` caption and sfx step shapes are not in an example | hotel-internal (not on the Director wire). |
| H1-11 | NEG-2, SAFE-2 | `hello.drama.enabled` is the runtime switch (off until an admin turns it on); the contract's example shows `true` | **agreed**: P1-03; asserted in `drama-hotel-diff.test.ts`. |
| H1-12 | ACT-4 | `intensity` is an `f64`, so a sidecar's `1` is written back `1.0` | **agreed**: no effect through JSON. |
| H1-13 | section 9 | Rust test names carry the rule id as a prefix, not `drama::<id>` | hotel-internal. |
| H1-14 | VV-3 | The table is embedded from `crates/sim/data` because the Docker build copies `crates`, not `docs`; a test pins the two equal | hotel-internal. |

### H2 (17 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| H2-01 | ACT-12, LAD-8 | The no-reward lock refuses only `dance`, `thumbs` and `laugh`, never an `act` | **open**: ACT-12 still lists it as making an actor busy. |
| H2-02 | REA-2, TBL-3 | The witness set is computed at `T0` and re-filtered at `Tc`; nobody is added | **agreed**: `act_beat.witnesses` and `owed` are what the planner reads. |
| H2-03 | SAFE-4 | `DramaPolicy` could not start the auto-pause; the sequencer only blocks `rate_limit` | **open**: the hotel's policy derives it (H3-03). |
| H2-04 | FRM-1 | `act_beat.at` is `Tc`, `human_down.at` the due instant, `human_up.at` that plus the window | **agreed**: the probes use the hotel's own `at` (`hotelAt`). |
| H2-05 | TBL-6 | Chip outcomes other than `take` go out as one `act_timeline{post}` with `base_at` the answer | hotel-internal. |
| H2-06 | CHIP-3, section 3.6 | A hug nobody answered ends `timeout` with no contact (the prose says `landed`) | **agreed**: `chip-timeout-dodge` expects `timeout` for a hug. |
| H2-07 | REA-2, section 3.5 | Witness steps that are not owed still run and emit `act_reaction`; humans get none | **agreed**: only `owed` carries debts; the planner reads nothing else. |
| H2-08 | TBL-4 | Captions are in pt-BR (the hotel does not know a run's language) | hotel-internal. |
| H2-09 | section 7.1 | `drama_block_invalid` is sent as a plain notice code to the admin | hotel-internal. |
| H2-10 | WAKE-1 | A woken actor's act lock ends with its `state normal` step; the act stays open to its table end | hotel-internal. |
| H2-11 | SAFE-2, SAFE-3, DOWN-4 | An abort after landing ends `aborted` but the fall that began goes on | **agreed**: pinned by `down-human-abort` (`aborted` and `calm_room`, then `human_up`). |
| H2-12 | DEATH-7 | `dying` is revived at a cut too; `fainted` is not | **open**: P2-10, the director tracks fainted actors only through `hello.drama.dead`. |
| H2-13 | TBL-7 | A `walk_to` waits for the walk for at most 20 s and `act_done` waits | hotel-internal. |
| H2-14 | REA-3 | A planner reaction skips every table step of that reactor, not only the labelled one | hotel-internal. |
| H2-15 | section 3.10 | `drama_state` is also sent when a human joins or leaves | **agreed**: the director rebuilds from every `drama_state`. |
| H2-16 | CHIP-9, CHIP-10 | The legacy `pair` chip registry is still separate until H3 absorbs it | **agreed**: closed by H3-03. |
| H2-17 | NEG-8 | Kill with the sidecar gone: frames are dropped, the act and the stand-up run on | **agreed**: NEG-9 rebuilds the director from `drama_state` and `hello.drama.dead`. |

### H3 (13 readings in `drama-consent-safety.md`; the packet report said 15)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| H3-01 | SAFE-4 | The harm window counts from accept, a chip's lifetime earlier than the landing: strict | **agreed**: the director's own count is `harmCount` over the same window. |
| H3-02 | SAFE-4 | A pause that ends on its own leaves the window; only an admin `resume` empties it | hotel-internal. |
| H3-03 | CHIP-9, CHIP-10 | `DramaPolicy` lacks `start_pause` and `begin_down`; `ChipRequest` has no room or kind | hotel-internal. |
| H3-04 | CHIP-3 | A late reply is the timeout, never `take` | **agreed**: probe `take-contact-windup`. |
| H3-05 | CHIP-9 | Dodge, push back, a silent violent chip and a silent `kiss` start the cooldown; `take`, a silent `hug` and an abort do not | **agreed**: the ledger starts the cooldown on `dodged` and `declined`; test `[CHIP-9]` in `drama-hotel-lifecycle.test.ts`. |
| H3-06 | CHIP-8, SAFE-5 | Opt-out answers an open chip as `dodge`; opt-in needs drama enabled; a toggle within 2 s is `rate_limited` | hotel-internal. |
| H3-07 | SAFE-5 | The opt-in is tied to the connection's generation | hotel-internal. |
| H3-08 | section 6.3 | Endpoint check order, and `403 admin_only` for `grant-perfectman` accounts | hotel-internal. |
| H3-09 | SAFE-2 | Fail closed twice: the switch row must be exactly `1`; an unreadable calm table keeps the switch off | **agreed**: the sidecar reads `enabled` from the hello and every `drama_state`. |
| H3-10 | SAFE-7 | Audit additions: `det`, the system pause end, `by` on a resume | **open**: E-08, the rows are not in `frames.jsonl`. |
| H3-11 | DOWN-3, DOWN-4 | `begin_down` clamps to 15 000 ms and `is_down` reads false at the due instant | **agreed**: the down window probe. |
| H3-12 | section 3.10, NEG-2 | `drama_status` only with the ceiling on; `drama_state.opt_in` lists humans with an avatar | **agreed**: the director reads `opt_in` from `drama_state`. |
| H3-13 | SAFE-5, SAFE-6 | Two points left as written | hotel-internal. |

## 3. Perfectman packets

### P1 (10 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| P1-01 | GATE-1 to GATE-10 | The brief named a reason `ladder_skip`; the contract's enum is `ladder` | **agreed**: the real `BlockedReason` has `ladder` and `rate_limit`. |
| P1-02 | NEG-3 | The text and the test row disagree on a refused offer (`proto 2` without caps or `proto 1`) | **agreed**: plain `proto 1`, as the hotel's answer to a hello it did not offer. |
| P1-03 | NEG-3, SAFE-2 | `drama.enabled` is the runtime switch, not a condition of the negotiation | **agreed**: same as H1-11. |
| P1-04 | section 3.6, REA-9 | `downgraded` lists `chat` beside the five | **agreed**: same as H1-01. |
| P1-05 | SCN-6 | The form cannot author a scene cut and 7.2 forbids new keys, so every scenario that can kill warns `drama.no_scene_cut` | **open**. |
| P1-06 | section 9.1 | `{in, expect}` cannot carry the world a blocked reason needs | **agreed**: same as H1-02. |
| P1-07 | ACT-4, ACT-6 | Where `act.text` on a non-insult verb is checked is not ordered | **agreed**: the hotel checks it right after the verb is parsed, as P1 does. |
| P1-08 | section 11.2 | `intent-packet.schema.ts` and `body-executor.ts` are not in 11.2 | **agreed**: the default prompt is built from the schema without `act`. |
| P1-09 | TBL-14 | "Same instant" needs `T0` read as `Tc - contact_at_ms` | **agreed**: same as H1-07. |
| P1-10 | NEG-7, VV-3 | The hello fixture carries the contract's example sha | **fixed**: PI-07 vendored the real table; `drama-hotel-diff.test.ts` lists the difference. |

### P2 (11 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| P2-01 | LAD-1 | `rung_cur` is the highest rung used in the scene, not the last | **agreed**, and its ledger bug is PI-05. |
| P2-02 | LAD-3, LAD-4 | A kill is also a physical beat; the kill count is checked first | **agreed**: same as H1-04. |
| P2-03 | LAD-6, LAD-10 | No enum member for the motive, grievance and contagion vetoes: `ladder` with a `detail` | **open**: sidecar-only, never sent. |
| P2-04 | LAD-10 | Contagion cap read as `min(2, max(1, floor(cast/3)))`; scenario beats exempt | **open**. |
| P2-05 | LAD-6 | "Last 10 events" has no counter on the wire; a 300 s window on `lastNegativeAt` stands in | **open**; see P3-07. |
| P2-06 | NEG-9 | `drama_state` carries no scene start or counters; a rebuilt director assumes the worst until the next cut | **agreed**: the hotel sends `drama_state` per room after a resume. |
| P2-07 | ACT-3, ACT-5 | The client consumes an id before a `slow_down` the hotel charged first; the director always takes a new id | **agreed**: the hotel consumes an id once ACT-4 passes (H1 reading, row `act_id_reused`). |
| P2-08 | SCENE-2, SCENE-5 | `scene_advance` has no `cid`, so a refusal is silent; the director waits 3 s before it asks again | **open**: the hotel answers `actor_error` only with a `cid`; PI-01 is the same frame. |
| P2-09 | section 9.1 | `blocked-all-reasons` presumes earlier acts for rows k15, k16, k17, k19 | **fixed**: the hotel's own rows carry a structured `given`, now run through the director. |
| P2-10 | DEATH-7 | A faint has no stand-up frame; the director learns of fainted actors from `hello.drama.dead` | **open**: same as H2-12. |
| P2-11 | section 11.2 | The contract names `drama-director.ts` and `hotel-gateway.ts`; the `drama/` directory was used | **agreed**. |

### P3 (10 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| P3-01 | FRM-1, section 11.5 | The brief says the planner sends approved acts; P2's port says the director does | **fixed**: PI-06, the director sends. |
| P3-02 | DEATH-2, DEATH-5 | The hotel refuses a dead actor's `thought`; the ghost voice stays in the sidecar's frame log | **agreed**. |
| P3-03 | section 11.2 | Run wiring duplicated P2's | **fixed**: PI-06. |
| P3-04 | REA-3 | `turn_back` is not used as a reaction (target mode is required) | **open**. |
| P3-05 | ACT-3 | A planner act counts toward the soft 4 per 5 s; reactions may use the hotel's 8 | **agreed**. |
| P3-06 | REA-1 | The sidecar cannot compare clocks, so a reaction window is `due_at - at` on the sidecar's receive time | **open**. |
| P3-07 | LAD-6 | `lastNegativeAt` and `lastInteractionAt` are in sim-time, the planner's `now` is wall clock | **open**: engine units. |
| P3-08 | gates | `--out out/bench.json` writes under `packages/eval/out`, the gate reads the root `out` | **agreed**: the gate command here uses an absolute path. |
| P3-09 | DEATH-2 | Memory writes can race a pulse that reads the same agent state | **open**. |
| P3-10 | section 11.2 | `Presence.fallen` and `AgentCommitInfo.actionEmotions` were added to shared and server | **agreed**: additive. |

### E (10 findings in the packet report; it counted 9)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| E-01 | section 3.6, section 0.2 | Section 3.6 lists 8 abort reasons, section 0.2 and RSV-2 have 10 | **fixed** by the hotel: the real `ActReason` has all 10. |
| E-02 | DOWN-3, TBL-9 | "Exactly" the window against a scheduler up to 100 ms late; 100 ms is used | **agreed**: the hotel's window was exact on the recorded run. |
| E-03 | CHIP-3, TBL-3 | Exact instants, no tolerance; `chip-timeout-dodge` checks outcomes only | **open**. |
| E-04 | LAD-1 | The `a17` slap example opens scene 7.2 at rung 4 without `authored_skip` | **open**: the example contradicts the rule. |
| E-05 | REA-1 | The example's `owed` order is not the ascending order of `witnesses`; the text does not say whether it matters | **agreed**: the hotel's recorded `owed` is not sorted either and no probe reads the order. |
| E-06 | section 9 | A reference to "section 9.2" for the shared fixtures that are in 9.1 | **open**. |
| E-07 | SAFE-7 | Audit rows are not in `frames.jsonl`, so the probe cannot be built | **open**: see H3-10. |
| E-08 | TBL-10 | The extractor merges the sidecar's `appearance` with the hotel's echo, so a probe cannot tell them apart | **open**. |
| E-09 | section 3.6, section 12 | `dodged` and `declined` are separate outcomes but section 12 maps both chip answers to `decline` | **agreed**: the raw answer is kept next to the mapped one. |
| E-10 | judge | A human target owes no reaction; the spec leaves it unstated for the judge | **agreed**: the hotel never sends an `act_reaction` for a human (H2-07). |

### P4 (prompts, mock, presets, sim and bench: 8 readings)

| Id | Rule | Defect or reading | Resolution |
| --- | --- | --- | --- |
| P4-01 | LAD-5, LAD-6, SCENE-2 | A model's `kill` is always vetoed `ladder` / `motive`: `kill` has no driver in the tuning (pinned by `drama-director-motive.test.ts`), and nothing in the sidecar sends `origin:"scenario"` or calls `Run.advanceScene`, so an authored kill and a scene cut have no player. | **open**: the sim plays the scene's `beats` (frontmatter, read by `drama:sim`) through `DramaDirector.decide` as `origin:"scenario"` and `advanceScene`. The mock proposes a kill when the scenario lets the victim die; the director refuses it, as designed. |
| P4-02 | D6, act-rate | With the director's default tuning a resentful passive actor is offered a beat every 6 s (`origination.minGapMs`), and the verbs include `turn_back`, which has no cooldown: 8.6 acts a minute against the probe's 3. At 30 s the busiest preset still reads 3.8 to 5.7. | **open**: the sim and the bench run with `minGapMs` 60 000 (`SIM_TUNING`) and say so; the default is PI's to set. |
| P4-03 | REA-9, DEATH-7 | An owed witness is locked until `act_done`, which for a `faint` comes after the fainted actor has stood up, so no witness can `tend_fallen` after a faint; after a kill the witnesses kneel from `act_done` on (about 5 s). | **open**: observed in `anuncio-do-desmaio` (witnesses gasp, nobody kneels) and `assassinato-na-festa` (they do). |
| P4-04 | GATE-7, LAD-1 | A `too_far` veto walks the actor closer and asks again once, and is not reported in `body.blocked` (the other vetoes are), so a model cannot tell a blow that never happened from one that did; the next rung is then refused `ladder`. | **agreed**: the mock steps back on a `ladder` veto and only strikes from the `intimate` band. |
| P4-05 | 11.5, ACT-8 | `DramaBody.proposalsOf` reads an `act` with a target on a solo verb as the solo verb without it; 11.5 says the `act` is dropped. | **open**: no frame is affected (the verb is solo either way). |
| P4-06 | 11.5, NEG-2 | The task says the prompt states violence is gated by the scenario; 11.5 says it must not say violence needs permission, since the director decides. | **agreed**: the prompt says how far a scene may go is set by the scene and that a beat that does not happen leaves the words standing, and never uses "permission" (`drama-prompt.test.ts`). |
| P4-07 | section 7.1 | The scene presets are markdown: the compiler ignores unknown frontmatter keys, so `drama` and `beats` ride there. The authoring service reads `drama` for a bundle (`compileSceneDrama`, agent ids or cast names) and compiles it into the body. | **fixed**: `drama-presets.test.ts`. |
| P4-08 | FRM-4, PI-07 | The sim's `run_start` and `actor_spawned` frames are checked against the vendored schema; the hotel's own kit writes `lease`, `mode` and `run` on frames that carry none of them. | **agreed**: the sim writes what the schema says; `drama-sim.test.ts` validates every frame. |

## 4. P1's fixtures against the hotel's

`drama-hotel-diff.test.ts` asserts these lists.

**hello-offer.** The files look from opposite ends: P1's `in` is the hotel's hello and its `expect` the sidecar's `hello_ack` (5 rows); the hotel's `in` is null and its `expect` is its own hello (2 rows). Compared hello to hello, the offering one differs by `drama.enabled` (`true` in the contract's example, `false` in the hotel's, H1-11), `drama.dead` (`[-702]` against `[]`), the vocab sha (`3f1c9a5e...` against the real `002fa380...`) and the build string. The switch-off hello differs only in the build. The vocab in the hotel's hello equals the sidecar's vendored one.

**act-validation.** P1: 32 rows. Hotel: 22 rows. 11 answers are in both. Only P1 wrote: the `authored_skip` type check, the 10 required-target and 6 forbidden-target verbs one by one, a 50-character verb cut at 40. Only the hotel wrote: a dialect 1 link (`bad_message`), `stale_lease`, `no_such_run`, `unknown_actor`, `bad_target` `bot`, `kind` and `not_fallen`, `target_gone`, `action_not_here`, and an accepted act that a closed switch blocks. Every answer P1 expects to a command the hotel also asked is one the hotel gave to it in some world. Reconciled: the hotel's rows are not copied into P1's file; the sidecar's check is run over every one of them and agrees on all 12 it can decide, and lets the other rows through.

**blocked-all-reasons.** P1: 20 rows. Hotel: 32 rows. The 20 reasons and details are the same set. The hotel adds 12 rows: the calm gate on each of its 7 verbs, a paused room (`rate_limit`, SAFE-4), shove and insult against an opted-out human, a glare out of range, and `kill` and `die` in free play. P1 gave the world as a sentence, the hotel as an object. Reconciled: all 32 rows run through the director's gates with the hotel's own world; 31 agree outright and one (`calm-restrain`) agrees once the aggressor RES-1 needs is present (PI-12). The two rows that failed first exposed PI-05.

**Envelope.** P1 states `origin:"director"` on every command, the hotel leaves the default out. The hotel's rows carry no `seq`, `at` or session (PI-11).
