# @perfectman/kb

A small local retrieval index of dramatic beats, so the drafting skill can ask "show me a scene where someone intimidates someone and a killing happens, cast of three" and get real reference scenes back.

Ingest plays and screenplays, cut them into beats, tag each beat, embed it locally, and query by tactic, physical action and cast size.

```
corpus/<dir>/manifest.json + files   (gitignored: third-party text never enters git)
   | build-beats    parse + chunk by beat
index/beats.jsonl
   | export-tags    batches for the taggers
index/tagging/batch-NNNN.in.jsonl  ->  tagger  ->  batch-NNNN.out.jsonl
   | import-tags    validated against the controlled lists
index/tags.jsonl
   | embed          local multilingual model, no network after the first download
index/kb.sqlite   (gitignored)
   | query / queryReferenceBeats(tactic, actionTag, castSize)
```

What is committed: the code, the taxonomy, the tests and this README. What is not: `corpus/` and `index/`.

## Commands

```bash
pnpm --filter @perfectman/kb build
cd packages/kb
node dist/cli.js build-beats
node dist/cli.js export-tags --dialogue-fraction 0.25 --dialogue-fraction-pt 0.5 --heldout 0.1 --batch 40
# run taggers over index/tagging/*.in.jsonl, writing batch-NNNN.out.jsonl (index/tagging/PROMPT.md is the brief)
node dist/cli.js check-tags index/tagging/batch-0001.out.jsonl
node dist/cli.js import-tags index/tagging --by haiku
node dist/cli.js embed                       # Xenova/multilingual-e5-small, q8; --embedder hash for a model-free run
node dist/cli.js query --tactic "to intimidate" --action KILLING --cast 3 --limit 5 [--text] [--plan]
node dist/cli.js stats
```

`queryReferenceBeats(store, embedder, tactic, actionTag, castSize, opts)` is the library call. `createReferenceQuery(store, embedder)` binds it to the three-argument shape `(tactic, actionTag, castSize)`. `toPlanRefs()` turns results into the pointers that go into `plan.json` `reference_beats`: ids, titles, labels and scores, never the text. Beat text is returned only with `includeText`, for prompt injection at generation time.

## Labels

Defined in `src/taxonomy.ts`, and a test pins them to `plan.schema.json` in the drafting skill, so a reference beat and a plan beat always use the same words.

| Label | Values |
|---|---|
| `action_type` | KILLING, KISSING, HUGGING, CRYING, VIOLENT_PUSH, VIOLENT_STRIKE, PHYSICAL_RETREAT, FAINTING, DIALOGUE_ONLY. A query may use the plan's `NONE` for DIALOGUE_ONLY. |
| `status_delta` | The driver's own movement against the person they act on: HIGH_TO_LOW, LOW_TO_HIGH, EQUAL_STALEMATE, EQUALIZE, HIGH_STABLE, LOW_STABLE |
| `tactic_verb` | One of about 120 active verbs aimed at a person ("to intimidate", "to plead"). Never a feeling, never a result. |
| `emotion` | anger, contempt, fear, sadness, shame, joy, love, relief, surprise, jealousy, resolve, neutral |
| `medium` | THEATRE, CINEMA |

The tactic list is authored here, in our own words. No published verb list is reproduced. The craft background it draws on, to cite and not to copy: Stanislavski's units, objectives and tactics (the beat as a stretch where one tactic is held); Keith Johnstone, *Impro* (status as something a person does, moment to moment); Caldarone and Lloyd-Williams, *Actions: The Actors' Thesaurus* (the idea of a playable, transitive verb). The English-language finders found no openly licensed verb list and no verified operational rule for splitting beats, so both are our own definitions.

## Corpus and licences

`loadCorpus` ingests a file only when its manifest entry has a title, an author, a `license_line` quoted from the source, and a `license_class` that is neither `unclear` nor `other`. No licence line, no ingest.

| Folder | Source | Licence class | Files |
|---|---|---|---|
| `gutenberg-shakespeare` | Project Gutenberg, PG Shakespeare Team texts | public-domain-us | Othello, Romeo and Juliet, Macbeth, Hamlet, King Lear, Julius Caesar, Much Ado About Nothing, A Midsummer Night's Dream, The Taming of the Shrew, Antony and Cleopatra, Titus Andronicus, The Winter's Tale |
| `gutenberg-plays` | Project Gutenberg | public-domain-us | Ibsen (A Doll's House, Hedda Gabler, Ghosts, The Wild Duck, The Master Builder), Strindberg (The Father), Chekhov (Uncle Vanya), Wilde (Earnest, An Ideal Husband), Marlowe (Doctor Faustus), Rostand (Cyrano), Molière (Tartuffe), Synge (Riders to the Sea, The Playboy of the Western World) |
| `pt-plays` | pt.wikisource | cc-by-sa | Martins Pena (O Juiz de Paz na Roça, Quem casa quer casa, Os Irmãos das Almas, O Namorador), Gil Vicente (Auto da Barca do Inferno) |
| `pt-plays-extra` | pt.wikisource, one Project Gutenberg text | cc-by-sa, public-domain-us | 14 more Portuguese-language plays (Alencar, Azevedo, Dias, França Júnior, Garrett, Machado de Assis, Martins Pena, Qorpo-Santo) |
| `screenplays` | none | | Nothing legally open with real scenes was found. `terms.json` records what the commercial script sites say: their pages say "educational purposes" or "fair use" and grant no right to copy, so none was ingested. |

Project Gutenberg's licence covers its trademark and asks that redistributions keep the header. Raw text stays in `corpus/` and never in git. The Wikisource texts are share-alike: anything derived from them that is redistributed keeps CC BY-SA. Folger Digital Texts (CC BY-NC) were left out on purpose.

The embedding model is `Xenova/multilingual-e5-small`, an ONNX port of `intfloat/multilingual-e5-small`, which is MIT. The port's own card carries no licence field.

## What the build produced (2026-11-09)

| | |
|---|---|
| Sources parsed | 31 of 31 (26 en, 5 pt) |
| Beats | 3,131 |
| Beats tagged and indexed | 946 (every beat with a physical-action hint, plus a deterministic 25% of dialogue-only beats) |
| Tagger | Haiku, 8 agents, 24 batches. 0 lines rejected by the validator after the ids were fixed. |
| Embeddings | `Xenova/multilingual-e5-small`, q8, 384 dimensions, local |
| Index split | 879 en, 67 pt. 728 dialogue-only, 38 killing, 51 kissing, 30 hugging, 31 strikes, 27 retreats, 18 crying, 17 pushes, 6 faints |

How far to trust the labels: a second tagger (Sonnet, blind to Haiku's labels) re-tagged a deterministic 10% sample of 107 beats.

| Field | Agreement |
|---|---|
| `action_type` | 93.5% |
| driver | 86% |
| emotion | 58% |
| `tactic_verb`, same group | 50% |
| `status_delta` | 50.5% |
| `tactic_verb`, exact | 32% |

So the physical-action label is dependable and is the hard filter in `queryReferenceBeats`. The tactic, emotion and status labels are judgement calls that two careful readers split on, and they are soft signals: use them to rank, never as ground truth. Haiku also marked 47% of beats `boundary_ok: false` (Sonnet 31% on the sample), so the chunker's cuts are often wrong by a tagger's eye. Treat a reference beat as "a scene like this", not as a clean unit.

## Label quality changes (2026-11-09, not yet applied to the index)

The numbers above describe the first build. Afterwards the chunker and the tagging brief were changed; neither the committed beats nor the 946 stored tags have been regenerated, so they still describe the old cuts and the old brief. Beat ids are `<source>:<act>.<scene>.<n>`, so a rebuild renumbers them and the old tags no longer join: re-tag after `build-beats`.

Chunker (`src/chunk.ts`). Reading 30 of the beats Haiku flagged showed the dominant causes: long beats (59% flagged at 1,200+ characters against 36% under 700), a character leaving mid-beat, a monologue glued to the exchange around it, four or more speakers in one beat, and an aside or exit direction stranded at the end of a beat but belonging to the next speech. The cuts now also close on the exit of a character who has been speaking, on a fourth distinct speaker, and around a speech of 900+ characters; the length cap went from 2,200 to 1,100 characters; and trailing asides move on to the speech they belong to. Same corpus (the 31 sources of the first build), before and after:

| | before | after |
|---|---|---|
| Beats | 3,131 | 4,124 |
| Characters per beat, mean / median / p90 | 1,105 / 880 / 2,271 | 839 / 847 / 1,313 |
| Beats of 1,800+ characters | 713 (22.8%) | 71 (1.7%) |
| Beats of 1,200+ characters | 1,158 (37.0%) | 736 (17.8%) |
| Beats under 300 characters | 370 (11.8%) | 561 (13.6%) |
| Beats with 4+ speakers | 246 | 161 |
| Beats ending on a stray non-action, non-exit direction | 467 | 44 |

Whether this lowers the tagger's `boundary_ok: false` rate on the new cuts is not measured: that needs the new beats tagged. The play-text parser's own failures (a following speaker folded into a speech or direction) are fixed separately, see "Parser fixes" below.

Tagging brief (`TAGGING_PROMPT` in `src/tags.ts`, written to `index/tagging/PROMPT.md` by `export-tags`). It now gives a decision order for tactic (what must the listener do, then the group, then the narrowest verb), a one-line original example for each `status_delta` value, a ban on defaulting to "to command", and a rule for when `boundary_ok` is false. The controlled lists are unchanged.

Measured on the same 107-beat sample, with two fresh Haiku taggers that saw only the new brief (the Sonnet labels were made under the old brief, so agreement with them understates the new brief):

| Field | old Haiku vs Sonnet | new Haiku A / B vs Sonnet | new A vs new B |
|---|---|---|---|
| `action_type` | 93.5% | 96.3% / 95.3% | 97.2% |
| driver | 86% | 86.9% / 79.4% | 86.9% |
| emotion | 57.9% | 63.6% / 56.1% | 72.0% |
| `status_delta` | 50.5% | 67.3% / 64.5% | 80.4% |
| `tactic_verb`, same group | 50.5% | 54.2% / 51.4% | 70.1% |
| `tactic_verb`, exact | 31.8% | 31.8% / 31.8% | 53.3% |
| "to command" share | 9.3% | 0% / 0% | |
| `boundary_ok: false` share | 50.5% | 25.2% / 26.2% | |

The brief was adjusted once after a first round (it over-produced `EQUAL_STALEMATE`: 39 of 107 against Sonnet's 9) and the table is the second round, so the sample is no longer held out from the wording. Tactic agreement with Sonnet did not move; status improved the most. "to command" at 0% is probably too far the other way, and `boundary_ok` is still above Sonnet's 30.8%.

## Parser fixes and the 45-source rebuild (2026-11-09)

`src/ingest/play-text.ts` swallowed the next speaker into a speech or direction in about 5% of beats (273 of 5,286 on the 45 sources, counting a speaker cue in the middle of a line) and turned a Faustus footnote into one 20,000-character beat. Causes and fixes:

- An unclosed `[` (a missing `]` in the source, common in the Ibsen texts) matched across blank lines up to the next `]` and ate the cue in between. A direction can no longer cross a blank line or hold another opener, and an unclosed one ends at the next blank line.
- Speakers that appear only once or twice (a Messenger, an OCR-damaged name) were not recognised as cues. An upper-case name is now a cue even when rare, and a rare name one letter off a frequent one (two, for names of nine letters or more) is read as the frequent one. Mixed-case rare names are still not accepted: they cannot be told from prose.
- `NAME (direction):` cues (Cyrano, 740 of them) were not read. The direction becomes its own item.
- Two speeches on one line in the dash style, and `D. MARIA -` style names, are split and read.
- Apparatus is dropped: `[Footnote n: ...]` and `[Illustration]` blocks, the Gutenberg licence tail (also when the end marker has no stars), and a lone `CURTAIN.` / `THE END` ends the speech. A manifest entry may carry `parse.stopBefore` (a regex) to cut an editor's afterword or a playbill after the play; used for Frei Luís de Sousa and Playboy.
- No speech item is longer than 1,200 characters (`MAX_SPEECH_CHARS`): longer ones are split at sentence ends into consecutive speeches of the same speaker. No beat is longer than 2,400 characters (`hardMaxChars` in `chunkScene`): a short leftover is no longer merged into a long beat, and an over-long group is cut at item boundaries.

Same corpus (45 sources), chunker unchanged otherwise:

| | before | after |
|---|---|---|
| Beats | 5,286 | 5,625 |
| Characters per beat, mean / median / p90 / p99 / max | 804 / 777 / 1,298 / 2,230 / 20,000 | 757 / 714 / 1,267 / 1,797 / 2,374 |
| Beats over 2,500 characters | 37 | 0 |
| Beats of 1,800+ characters | 83 | 56 |
| Beats with an inline speaker cue | 273 | 25 (stage-direction names and cast lists, and a few joint cues like `GREMIO, TRANIO.`) |

Beats by folder: `gutenberg-plays` 2,213 (14 sources), `gutenberg-shakespeare` 1,967 (12), `pt-plays` 272 (5), `pt-plays-extra` 1,173 (14). 4,180 en, 1,445 pt. `export-tags --dialogue-fraction 0.25 --dialogue-fraction-pt 0.5 --heldout 0.1` exports every action-hint beat, 25% of English dialogue-only beats and 50% of Portuguese ones (stage directions rarely name weeping or similar in Portuguese), then holds out 10% of that set (`sampleIds`, the same selection `sample` uses) in `index/tagging/heldout.ids.json` and `index/tagging/heldout/`, out of the main batches for a blind second tagger.

## Known limits

- **Beats are a heuristic.** A beat closes on a physical-action direction (plus the reply), the exit of a speaker, a new speaker after a settled pair or past three speakers, an entrance, a monologue, or a length cap. The tagger reports `boundary_ok`, so the build measures how often the cut is wrong.
- **`castSize` is the number of distinct speakers in the scene**, which is the cast the text shows, not the number on stage. In Ibsen the "scene" is a whole act.
- **Physical action is sparse in stage directions.** Most beats are dialogue. The action hint is a keyword guess that the tagger confirms or corrects.
- **Theatre only for now.** The Fountain parser is built and tested on synthetic fixtures, but no open screenplay corpus was found.
- **Only part of the corpus is tagged.** 946 of 3,131 beats. `build-beats` produces all of them, and `export-tags` can tag the rest later.
- **Rare actions are thin.** Portuguese crying has 2 tagged beats and faints have 6. The query widens the cast window to fill a request, but it cannot invent scenes the corpus lacks.
- **Tactic labels skew.** "to command" is 11% of all tags, which looks like the tagger's default for a speaker giving orders. Do not read tactic frequencies as a property of the plays.
- **Retrieval is a SQL filter and a brute-force cosine in JS.** Fine for thousands of beats. `sqlite-vec` can replace the scan behind `Store.candidates`.
