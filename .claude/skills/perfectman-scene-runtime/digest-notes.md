# Digest notes (not for injection)

`digest.en.md` and `digest.pt-BR.md` are the whole text to inject, raw, into a later change of `packages/server/src/agent/hotel-drama-hint.ts`. They carry no comment on purpose. Nothing injects them today.

Rules they follow:

- Nothing says what the reader is (D43): no "actor", "character", "role", no ids.
- Never says violence needs permission. A beat that does not happen is said the way the hint's own STYLE block says it: the words still stand.
- The words always count.
- About 200 words each. pt-BR is a faithful translation, not a different text.
- Add only when `BodyPerception.drama` is set, after the existing HEAD, LADDER and STYLE blocks, never instead of them.

Before wiring: run the benches (`GOLDEN_SCENARIOS`, expect 35 scenarios 95.4% probe, 132 scenarios 93.7%, drama 9/9) and the drama judge on a replay. The prompt is size-budgeted.
