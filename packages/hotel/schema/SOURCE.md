# director.schema.json

Vendored, do not edit by hand.

- Origin repo: Tilehouse (`general/habbo`)
- Origin path: `docs/perfectman/schema/director.schema.json` (proto 1)
- Generated there by `cargo test -p tilehouse-sim director_schema`, from `crates/sim/src/director.rs`.
- Vendored from the Tilehouse worktree branch `feat/pm-start-modal`: adds the optional `model` (`RunModel {id, context?, price_in?, price_out?, reasoning?}`) on `run_start`, on top of what `feat/pm-integration` (f091d90) had: adds the optional `layer` on a placed item and the `not_layered` rejection (rug and wall piece draw order), on top of the optional `rooms` list on `hello` (`HelloRoom {id, name, official, section?}`: every official room, the Perfectman wing included, and each room a live run is in), on top of the optional `lease` on `ui_push` (when present it must be current) and the optional `llm_p50_ms` / `llm_p95_ms` on `run_status`; `lag_ms` is event-loop lag.

Refresh whenever Tilehouse's schema changes: copy the file over, then run
`pnpm --filter @perfectman/hotel gen:director` and commit both the schema and
`src/director/generated.ts`. `pnpm --filter @perfectman/hotel check:director`
(also part of `pnpm test:gate`) fails if `generated.ts` is stale against this file.

# cue-vocab.json

Vendored, do not edit by hand.

- Origin path: `docs/perfectman/schema/cue-vocab.json` (version 1), prose in `docs/perfectman/camera-and-audio.md` section 8.
- The client accepts exactly the canonical names plus the aliases; the sidecar emits **canonical names only**.
- `pnpm --filter @perfectman/hotel gen:director` turns it into `src/director/cue-vocab.generated.ts`; `check:director` fails when that file is stale. `src/director/cine/cue-vocab.ts` holds the helpers and `src/director/cine/__tests__/cue-vocab.test.ts` checks every cue the Director can emit against it.

# STAND-INS for the drama act contract (docs/drama/act-contract.md revision 2)

Packet P1 was built before the hotel's H1 output existed, so the three files below carry a **hand-authored delta** that
follows the contract's sections 1 to 3 and 10. Each is marked `STAND-IN until vendored from habbo H1 output` (a `$comment` in the
JSON). Packet PI replaces them with the real files and re-runs `pnpm --filter @perfectman/hotel gen:director`.

- `director.schema.json`: every new definition, and every property or enum member added to an existing one, has `"$comment": "STAND-IN ..."`. Added: `HotelMsg` variants
  `act_started`, `act_beat`, `act_reaction`, `act_done`, `drama_consent`, `actor_death`, `actor_revive`, `human_down`, `human_up`, `scene_cut`, `drama_state`;
  `hello.proto_max`, `hello.caps`, `hello.drama`; `pair_reaction.reason`; `SidecarMsg` variant `scene_advance`; `hello_ack.caps`; `SidecarInfo.verb_vocab`;
  `ActorCmd` variant `act`; six `ActorErrorCode` members and `ActorGoneReason` `died`. The browser messages (`act_prompt`, `act_timeline`, ...) and `AvatarAction.ms`
  are `ServerMsg`/`ClientMsg` and are not on the Director wire, so P1 does not author them.
- `verb-vocab.json`: a copy of `docs/drama/verb-vocab.draft.json` with the `draft` and `contract` keys dropped and the `$comment` replaced (VV-1).
- `cue-vocab.json`: version 2, with `slap`, `thud`, `gasp`, `sob`, `whoosh_short` added to `sfx.canonical` and the aliases `smack`, `thump`, `swish_short` (VV-5).

When the real files land: copy them over, update the pinned hash below, delete the `STAND-IN` mentions here, and drop the test
`[VV-1] the stand-in verb table is the draft in docs/drama` (it compares against the draft).

## verb-vocab.json

Vendored, do not edit by hand.

- Origin path: `docs/perfectman/schema/verb-vocab.json` (`version` 1, `rev` 2), next to `cue-vocab.json`; prose in `docs/drama/act-contract.md` sections 5 and 10.
- `pnpm --filter @perfectman/hotel gen:director` validates it against its own embedded `table_schema` (TBL-1) and turns it into `src/director/verb-vocab.generated.ts`
  (ids, enums, constants, and the `{version, rev, sha256}` that `hello_ack.sidecar.verb_vocab` carries); `check:director` fails when that file is stale.
- Pinned sha256 of the bytes of `verb-vocab.json`: `1f9d6899dff8b9172f8301b45aac4b14799a2fc7fea784d67a25cf0622f5a56e`. The test `verb-vocab: sha is pinned` fails when the file differs from it.
