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
node dist/cli.js export-tags --dialogue-fraction 0.25 --batch 40
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

## Known limits

- **Beats are a heuristic.** A beat closes on a physical-action direction (plus the reply), a new speaker after a settled pair, an entrance, or a length cap. The tagger reports `boundary_ok`, so the build measures how often the cut is wrong.
- **`castSize` is the number of distinct speakers in the scene**, which is the cast the text shows, not the number on stage. In Ibsen the "scene" is a whole act.
- **Physical action is sparse in stage directions.** Most beats are dialogue. The action hint is a keyword guess that the tagger confirms or corrects.
- **Theatre only for now.** The Fountain parser is built and tested on synthetic fixtures, but no open screenplay corpus was found.
- **Only part of the corpus is tagged.** 946 of 3,131 beats. `build-beats` produces all of them, and `export-tags` can tag the rest later.
- **Rare actions are thin.** Portuguese crying has 2 tagged beats and faints have 6. The query widens the cast window to fill a request, but it cannot invent scenes the corpus lacks.
- **Tactic labels skew.** "to command" is 11% of all tags, which looks like the tagger's default for a speaker giving orders. Do not read tactic frequencies as a property of the plays.
- **Retrieval is a SQL filter and a brute-force cosine in JS.** Fine for thousands of beats. `sqlite-vec` can replace the scan behind `Store.candidates`.
