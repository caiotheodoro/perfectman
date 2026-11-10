# Digest notes (not for injection)

`digest.en.md` and `digest.pt-BR.md` (the full text) and `digest-compact.en.md` and `digest-compact.pt-BR.md` (under 450 characters, for the compact prompt) are injected raw by `packages/server/src/agent/hotel-drama-hint.ts`: `SCENE_CRAFT` into `dramaContractLines` (full prompt) and `SCENE_CRAFT_COMPACT` into `dramaCompactLines` (compact prompt). They carry no comment on purpose.

The files and the constants are the same text. `packages/server/src/agent/__tests__/drama-prompt.test.ts` pins each file to its constant (file equals constant plus one newline), so edit both together or the test fails.

Rules they follow:

- Nothing says what the reader is (D43): no "actor", "character", "role", no ids. The same test scans them for those words and for "permission".
- Never says violence needs permission. A beat that does not happen is said the way the hint's own STYLE block says it: the words still stand.
- The words always count.
- About 200 words (full) and about 70 words (compact) each. pt-BR is a faithful translation, not a different text.
- Added only when `BodyPerception.drama` is set, after the existing HEAD, LADDER and STYLE blocks and before the examples, never instead of them. No new flag: a run without drama builds the prompt it always did (`drama-off-identity.test.ts` holds that byte for byte).

Size (chars added to the system prompt, en / pt-BR): full 1218 / 1329 (about 300 tokens), compact 430 / 448 (about 110 tokens).

Benches to run after a change to the text: `GOLDEN_SCENARIOS` mock bench (35 scenarios, 95.4% probe), the 132-scenario run (93.7%), drama bench 9/9, and the drama judge on a replay. The prompt is size-budgeted.
