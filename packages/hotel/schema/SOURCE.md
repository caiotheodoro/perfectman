# director.schema.json

Vendored, do not edit by hand.

- Origin repo: Tilehouse (`general/habbo`)
- Origin path: `docs/perfectman/schema/director.schema.json` (proto 1)
- Generated there by `cargo test -p tilehouse-sim director_schema`, from `crates/sim/src/director.rs`.
- Vendored from worktree branch `feat/perfectman-contracts`.

Refresh whenever Tilehouse's schema changes: copy the file over, then run
`pnpm --filter @perfectman/hotel gen:director` and commit both the schema and
`src/director/generated.ts`. `pnpm --filter @perfectman/hotel check:director`
(also part of `pnpm test:gate`) fails if `generated.ts` is stale against this file.
