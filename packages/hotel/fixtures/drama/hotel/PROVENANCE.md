# Vendored from the hotel: read-only

Do not edit these files. They are the hotel's own recorded output, copied byte for byte, and `drama-hotel-fixtures.test.ts` pins every
sha256 below. To refresh, copy the files again from the hotel and update this table in the same commit.

- Origin repo: Tilehouse (`general/habbo`).
- Origin branch and commit: `drama/h2-sequencer` at `e1ba02545bf1843e728bd9de00cf5ac513bb55e4` (H2's final commit, which contains H1's `drama/h1-contract` at `f71dad289a8918b34af929cbdc1cf46183b7fa59`).
- Origin paths: `crates/server/tests/fixtures/drama/*` and `crates/sim/tests/fixtures/drama_wire_examples.json`.
- `HOTEL-README.md` is the hotel's own `README.md` of that directory (the row format, the `given` keys and the packet that wrote each file).
- Why a sub-directory: `../act-validation.jsonl`, `../blocked-all-reasons.jsonl` and `../hello-offer.jsonl` are P1's contract-derived copies, written from the spec before the hotel existed. The hotel's files of the same names are not byte-identical to them (different perspective, different rows). The differences are listed in `docs/drama/errata.md` and asserted in `drama-hotel-diff.test.ts`.

| File | sha256 | Written by |
|---|---|---|
| `hello-offer.jsonl` | `abaa83d4dfa56c8728109a152c37a390f3ca8bb98645fd5b42ef96cac18c1a45` | H1, contract-derived (hotel's view: `in` is null, `expect` is the hotel's `hello`); refreshed for verb table rev 4 (see below) |
| `act-validation.jsonl` | `e3559b67c2347eceea7caaa00ca69edc71b68140b9ad448ef8bde52e862314ea` | H1, contract-derived |
| `blocked-all-reasons.jsonl` | `a23b3b5291696fd37727da2dbf0a5368585b71d619fbe7f8e3bc5addd92bc9ee` | H1, contract-derived |
| `slap-human-take.jsonl` | `18a23711e43fa1f2ab4d155fe5b3f2ebdb2efe7dc31a47bc60a17518bd27d487` | H2, recorded from the sequencer (test `fixtures_slap_human_take`) |
| `slap-human-timeout.jsonl` | `5777643e3eb0aebbec0a54223583da94633bba2d85b004f279246b74aa7a169c` | H2, recorded (`fixtures_slap_human_timeout`) |
| `kill-actor-revive.jsonl` | `52a2fe21242f5628bf05ea80e89c1967bc7544502da9eca506ec0ec45d296f8e` | H2, recorded (`fixtures_kill_actor_revive`) |
| `down-human-abort.jsonl` | `d307c2900c61d0817070e305a897f7e8f9ca0dfd66090da98b2c2e4993d199a4` | H2, recorded (`fixtures_down_human_abort`) |
| `hello-v1.json` | `b8aea0a3736e1472996dca293c77bc26d998ef596b74a97f3adfda1e806c4dc9` | the golden `hello` of a hotel with `PERFECTMAN_DRAMA` off, session masked as `SESSION` |
| `wire-examples.json` | `58b01d4c368e500466e05c122a77742c0fdf026c9eb53b083dca76f9450ca3fe` | H1, the wire examples of the hotel's own schema test |
| `HOTEL-README.md` | `b8f7c91a34d1b9967fc37fb34f6226afbb61cbaa66d68bee98668f3f4d2f6c5b` | the hotel's README of the fixtures |

`hello-offer.jsonl` was copied again from the hotel's `crates/server/tests/fixtures/drama/hello-offer.jsonl` on its branch `fix/drama-faint-effect` (habbo, verb table `rev` 3). The only byte that moved is `hello.drama.verb_vocab`: `rev` 2 to 3 and the sha256 of `verb-vocab.json` (`002fa380...` to `36dce043...`); see errata P5-12.

`PROVENANCE.md` is ours and is not pinned.

For verb table `rev` 4 (habbo `integ/cine`, 25 verbs, no emotion cues) the same two values in `hello.drama.verb_vocab` were edited by hand: `rev` 3 to 4 and the sha256 `36dce043...` to `d5e0def0...`. The rest of the file is still the older two-row form (a runtime switch); the hotel has since made drama always on (one row, `drama.enabled: true`), which this sidecar does not need yet.
