# Drama cross-check fixtures (act-contract.md section 9.1)

JSON lines, one `{given?, in, expect}` per line. `in` is the sidecar's frame (`null` means the
connection was just opened). `expect` are the hotel's frames in order, compared **ignoring `seq` and
`at`** (and `session` in a `hello`). The same lines are checked in under perfectman's
`packages/hotel/fixtures/drama/`, byte-identical, and perfectman feeds `expect` to its extractor and
probes.

`given` is the hotel side's addition (section 9.1 does not say how a row gets its world). It sets the
model world for this row and the following rows until the next `given`; perfectman ignores it. Keys:
`run`, `lease`, `room`, `dialect` (1 or 2), `now_ms`, `switch` (`on`/`off`, the runtime switch), `calm`,
`paused`, `harm_in_window`, `harm_max`, `actors` and `humans` (id to `{ref?, pos, posture, moving,
opt_in?, chip?, bot?}`), `witnesses` (avatars in earshot besides the principals), `drama` (the
scenario block, or `null` for free play), `ladder` (the pairs' history, oldest first: `{verb, actor,
with, ago_ms}`; absent means the pair stands one rung below the verb) and `fallen` (ids).

| File | Written by | What it pins |
|---|---|---|
| `hello-offer.jsonl` | contract-derived (H1 wrote it; P1's copy had not landed) | the PROTO 1 hello with the switch off, and the offer with it on |
| `act-validation.jsonl` | contract-derived (same) | ACT-1 to ACT-13 codes and details |
| `blocked-all-reasons.jsonl` | contract-derived (same) | every blocked reason and detail, one `act_done` each (FRM-2) |
| `slap-human-take.jsonl`, `slap-human-timeout.jsonl`, `kill-actor-revive.jsonl`, `down-human-abort.jsonl` | behaviour-derived: recorded from the hotel sequencer by packet H2 (`world/drama/tests_fixtures.rs`; `DRAMA_RECORD=1 cargo test -p tilehouse-server --lib fixtures_` re-records them), P1 vendors them | the order of frames inside an act (FRM-1), the chip (`shown`, `answered`, the 150 ms wind-up), the death and revive, the down window and an abort that leaves it alone |

The recorded rows keep every frame's `at` (the test's clock is deterministic; `seq` is not recorded) and their `given` says how the run was staged: `world` (`human`: three actors and user 9, who has opted in; `actors`: the three actors), `script` (`{at_ms, act_reply:{act_id, choice}}` and `{at_ms, calm:true}` events after the `in` frame), `after_ms` (how long the world ran). Rows of one file continue one world (the revive row follows the kill row). Only the Director frames of the contract are listed: the mirrored deltas are left out.

`hello-v1.json` is the golden `hello` of a hotel with `PERFECTMAN_DRAMA` off, byte for byte, with the
session id masked as `SESSION` (recorded before the contract landed; `e2e.rs` compares it).

The replayer is `crates/server/tests/drama_fixtures.rs`, over the pure rules. Packet HI replays the
same rows against the real sequencer.
