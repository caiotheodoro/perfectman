# director.schema.json

Vendored, do not edit by hand.

- Origin repo: Tilehouse (`general/habbo`)
- Origin path: `docs/perfectman/schema/director.schema.json` (proto 1)
- Generated there by `cargo test -p tilehouse-sim director_schema`, from `crates/sim/src/director.rs`.
- Vendored from the Tilehouse worktree branch `feat/pm-integration` (0b83094): adds the optional `rooms` list on `hello` (`HelloRoom {id, name, official, section?}`: every official room, the Perfectman wing included, and each room a live run is in), on top of the optional `lease` on `ui_push` (when present it must be current) and the optional `llm_p50_ms` / `llm_p95_ms` on `run_status`; `lag_ms` is event-loop lag.

Refresh whenever Tilehouse's schema changes: copy the file over, then run
`pnpm --filter @perfectman/hotel gen:director` and commit both the schema and
`src/director/generated.ts`. `pnpm --filter @perfectman/hotel check:director`
(also part of `pnpm test:gate`) fails if `generated.ts` is stale against this file.

# cue-vocab.json

Vendored, do not edit by hand.

- Origin path: `docs/perfectman/schema/cue-vocab.json` (version 1), prose in `docs/perfectman/camera-and-audio.md` section 8.
- The client accepts exactly the canonical names plus the aliases; the sidecar emits **canonical names only**.
- `pnpm --filter @perfectman/hotel gen:director` turns it into `src/director/cue-vocab.generated.ts`; `check:director` fails when that file is stale. `src/director/cine/cue-vocab.ts` holds the helpers and `src/director/cine/__tests__/cue-vocab.test.ts` checks every cue the Director can emit against it.
