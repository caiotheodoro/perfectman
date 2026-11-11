# director.schema.json

Vendored, do not edit by hand.

- Origin repo: Tilehouse (`general/habbo`)
- Origin path: `docs/perfectman/schema/director.schema.json` (proto 2, see the drama section below)
- Generated there by `cargo test -p tilehouse-sim director_schema`, from `crates/sim/src/director.rs`.
- Vendored from the Tilehouse worktree branch `feat/pm-start-modal`: adds the optional `model` (`RunModel {id, context?, price_in?, price_out?, reasoning?}`) on `run_start`, on top of what `feat/pm-integration` (f091d90) had: adds the optional `layer` on a placed item and the `not_layered` rejection (rug and wall piece draw order), on top of the optional `rooms` list on `hello` (`HelloRoom {id, name, official, section?}`: every official room, the Perfectman wing included, and each room a live run is in), on top of the optional `lease` on `ui_push` (when present it must be current) and the optional `llm_p50_ms` / `llm_p95_ms` on `run_status`; `lag_ms` is event-loop lag.

- Also carries the additive `camera_fx` `PerfectmanUi` kind (habbo branch `feat/cine-b4-camera`: `dolly`, `shake`, `slowmo`, `vignette`, `hitstop`, `grade`).

Refresh whenever Tilehouse's schema changes: copy the file over, then run
`pnpm --filter @perfectman/hotel gen:director` and commit both the schema and
`src/director/generated.ts`. `pnpm --filter @perfectman/hotel check:director`
(also part of `pnpm test:gate`) fails if `generated.ts` is stale against this file.

# cue-vocab.json

Vendored, do not edit by hand.

- Origin path: `docs/perfectman/schema/cue-vocab.json` (version 1), prose in `docs/perfectman/camera-and-audio.md` section 8.
- The client accepts exactly the canonical names plus the aliases; the sidecar emits **canonical names only**.
- `pnpm --filter @perfectman/hotel gen:director` turns it into `src/director/cue-vocab.generated.ts`; `check:director` fails when that file is stale. `src/director/cine/cue-vocab.ts` holds the helpers and `src/director/cine/__tests__/cue-vocab.test.ts` checks every cue the Director can emit against it.

# Drama act contract (docs/drama/act-contract.md revision 2): the hotel's real output

The stand-ins packet P1 carried (a hand-authored delta, each marked `STAND-IN` in a `$comment`) were replaced by the hotel's own published files.

- Origin repo: Tilehouse (`general/habbo`), branch `drama/h1-contract` (the finished H1 packet), commit `f71dad289a8918b34af929cbdc1cf46183b7fa59`.
- `director.schema.json`: `docs/perfectman/schema/director.schema.json` at that commit (proto 2: the drama frames, `ActorCmd::Act`, `hello.drama`, `scene_advance`, and the browser messages `act_prompt`, `act_timeline`, ...). Generated there by `cargo test -p tilehouse-sim director_schema`.
  Its type names differ from the stand-in's: `Verb`, `Origin`, `BlockedReason`, `ActReason` (the blocked and the abort reasons in one enum), `Outcome2`, `Owed`, `OwedMissed`, `Downgrade` (six labels, `chat` included), `ReactionRole`, `BeatKind`, `DeathCause`. The differences found against P1's reading are listed in `docs/drama/errata.md`.
- `verb-vocab.json`: `docs/perfectman/schema/verb-vocab.json` at that commit (`version` 1, `rev` 2). Same table as the draft in `docs/drama` apart from the dropped `$comment`.
- `cue-vocab.json`: `docs/perfectman/schema/cue-vocab.json` at that commit, version 2.

## verb-vocab.json

Vendored, do not edit by hand.

- Origin path: `docs/perfectman/schema/verb-vocab.json` (`version` 1, `rev` 3), next to `cue-vocab.json`; prose in `docs/drama/act-contract.md` sections 5 and 10.
- `rev` 3 (habbo branch `fix/drama-faint-effect`, errata P5-12): the `faint` has no `effect` step (Twinkle read as sparkles on a lying body) and its confused `?` cue runs from contact for 7600 ms; the `camera` and `cut_fx` `maps_to` notes say what a default run sends. `version` stays 1, so a sidecar vendored at `rev` 2 only logs a warning (NEG-7).
- `pnpm --filter @perfectman/hotel gen:director` validates it against its own embedded `table_schema` (TBL-1) and turns it into `src/director/verb-vocab.generated.ts`
  (ids, enums, constants, and the `{version, rev, sha256}` that `hello_ack.sidecar.verb_vocab` carries); `check:director` fails when that file is stale.
- Pinned sha256 of the bytes of `verb-vocab.json`: `36dce0430fb7bbea6c8d724532c8bdba87f066f79a18c84bec98b64cf0e32762`. The test `verb-vocab: sha is pinned` fails when the file differs from it.
