# Script likeness

Production run 58 (cinematic, 4 bot actors, pt-BR, a hand-written scene) read as long, looping lines with no arc, and had only been checked for garbled tokens. This page is what was built to measure dialogue against real plays and to hold hotel actors to it: a benchmark, norms derived from the corpus, four checks in the actor loop, a scene spine for scenes with no authored beats, and a score in every run's replay manifest. Everything is deterministic and runs with no model.

Where the code is: metrics, norms, score, checks and spine in `packages/shared/src/script-likeness/`; the actor-loop checks in `packages/server/src/agent/` (`script-guard.ts`, `surface/action-intent-step.ts`); the run side in `packages/hotel/src/run/` (`scene-recorder.ts`, `run.ts`); the benchmark in `packages/eval/src/script-likeness/` and `cli/script-likeness.ts`; the norms builder `export-norms` in `packages/kb/src/norms.ts`.

## Norms

`script-norms.json` (and the same numbers as `script-norms.generated.ts`, which the packages import; a test pins the two equal) holds numbers only. It is built from `index/beats.jsonl` and `tags.jsonl` of the local, gitignored corpus (5,625 beats; 45 plays; THEATRE only, no screenplay was legally ingestible, so a CINEMA run reads the THEATRE norms and the manifest says so):

```
cd packages/kb && node dist/cli.js export-norms --beats <beats.jsonl> --tags <tags.jsonl> --built YYYY-MM-DD --holdout 100
```

200 beats (100 per language, chosen by a hash of the beat id) are left out of the norms and used only to check them. Speech turns are counted without stage directions; a beat needs 4 or more speech turns to count (3,873 do).

| | pt (734 beats) | en (2,939 beats) |
|---|---|---|
| speech turns per beat | 8.8 | 8.0 |
| words per turn, p25 / p50 / p75 / p90 / p95 | 4 / 7 / 15 / 30 / 45 | 5 / 10 / 21 / 41 / 61 |
| turns over 25 words / over 40 | 12.6% / 5.8% | 19.7% / 10.3% |
| replies of 5 words or fewer | 40.6% | 26.2% |
| lexical novelty (mean, 4+ letter words vs the 6 turns before) | 0.88 | 0.79 |
| novelty of turns with 7+ such words and 3+ turns before them, p5 / p10 / p50 | 0.67 / 0.71 / 0.90 | 0.55 / 0.62 / 0.84 |
| turns cut off by a dash / trailing off ("...") | 0.2% / 12.7% | 3.8% / 0.2% |
| status delta of tagged beats: HIGH_STABLE / LOW_STABLE | 66% / 30% | 62% / 27% |
| tagged beats next to each other with the same tactic / same status | 9% / 58% | 8% / 58% |

These reproduce the figures in the owner's report (pt median 7, p75 15, p90 30, 12.7% over 25, novelty 0.88, 8.8 turns per beat) within a point or two; en p75 and p90 come out at 21 and 41 against the 22 and 43 quoted. Beat-level percentile ladders by size of beat (4-7, 8-12, 13+ turns) are in the file for each metric below.

## Metrics

Over a list of turns (`ScriptTurn`: speaker, text, optional ms, `say` or `act`). Adapters read a hotel run directory (`events.jsonl` plus the frame log for walks and sits), an `events.jsonl` or eval simulation event log, and a plain turns file.

- **Length**: median, p90 and the share of turns over 25 and over 40 words; the share of replies of 5 words or fewer.
- **Novelty**: the share of a turn's words of 4 or more letters not seen in the previous 6 turns.
- **Motif repeat**: a key that three turns share inside 90 s (7 turns when there are no times), whoever says it. Keys: a phrase of 2 or 3 words with two topic words; a simile frame ("que nem", "tipo X", "like a"); a topic-word stem. Phrases and frames are the loops (about 2% of real beats have one); a topic word kept for three turns is common in real scenes (about 30% of beats) and only pulls the score down. Names are never motifs.
- **Progress**: turns that bring a new name, number or object (a noun after a determiner nobody named yet); promises, accusations, reveals, acts and position changes, and reversals of who asks and who answers (the last five move the scene); the longest stretch of speech turns with none of those.
- **Question debt**: a question not answered by its addressee (named by a vocative, else any other speaker) with a statement or a 3-word reply inside 3 turns. A question the scene ended on is not judged.

The lexicons for promises, accusations and reveals are short word lists in `text.ts`, pt and en. They miss a lot, and they miss it in the plays too, which is why the progress sub-score barely discriminates at the size of one beat (see "What this does not show").

## Score

Each metric is read against the real beats of the same size: 100 inside the real range up to the 97.5th percentile, 0 at the worst real beat and beyond, linear between (mirrored where too little is the failure). Five sub-scores (length 0.30, novelty 0.20, motif 0.20, progress 0.20, debt 0.10) combine into one 0-100 score. A metric a real script almost never fails (turn length, novelty, loops) caps its sub-score and the score at the weakest such part plus 30 and 25; the rest (few short replies, a topic word kept, no promise or accusation, a question left owing) only pull the mean down. A run longer than a beat is scored in windows of 10 speech turns and averaged. Every sub-score lists its metrics, the value, its score and the percentile of real beats it sits at; the score has the percentile of the corpus beats' own scores. 80 or more reads as script-like, under 60 as not.

```
pnpm --filter @perfectman/eval script-likeness --run <run dir | events.jsonl | turns.json> [--lang pt|en] [--json]
pnpm --filter @perfectman/eval script-likeness --fixtures
pnpm --filter @perfectman/eval script-likeness --validate-corpus <beats.jsonl>
pnpm --filter @perfectman/eval script-likeness --guard-rates <beats.jsonl> [--beats 150]
```

### What it measured (2026-11-10)

| | score | sub-scores |
|---|---|---|
| 200 held-out real beats, committed norms | 97.0% reach 80 (pt 95%, en 99%), median 100, p10 90 (pt) and 98 (en) | |
| the same, on three other held-out sets (salted) | 95.5%, 96.5%, 96.0% | |
| 24 windows of 10 of the repo's ordinary pt-BR chat lines | 94 to 100 | |
| run 56 (4 quoted lines) | 55 | novelty 49, motif 30 |
| run 57 (5 lines, the question quoted) | 25 | motif 0, debt 33 |
| run 58, the 2 lines quoted (2 turns: low confidence) | 55 | length 30 |
| run 58, the owner's aggregates (11 turns: median 32 words, 63.6% over 25, novelty 0.67) | 32 | length 7, novelty 84 |
| ten turns of 33 words | 25 | length 24, novelty 0, motif 0 |

The run 58 transcript was not available (only two of its lines were quoted), so no 11-turn run 58 transcript was scored, only its measured aggregates. The thresholds were tuned while the held-out set was visible (first run: 83% and 86% at the 95th and 99.5th percentiles; then the 97.5th and 100th, and the hard-metric rule above, after ordinary chat windows scored 55); the salted sets are the check that it was not fitted to those 200.

## Length guard

With `script: true` in the runtime policy (hotel runs; `PERFECTMAN_SCRIPT_GUARD=0` turns it off for a process) a persona's `presence.messageLength` maps to a word target, `short` by default:

| messageLength | aim | cap | sentences |
|---|---|---|---|
| rapid_fire | 2-6 | 12 | 1 |
| short (pt) | 6-12 | 25 | 2 |
| short (en) | 8-16 | 32 | 2 |
| medium (pt / en) | 10-20 / 12-24 | 40 / 48 | 3 |
| long | 15-35 | 60 | 4 |

pt short is the brief's numbers (turn-level percentiles 45, 70 and 87 of the pt plays); en is the same percentiles of the en plays, rounded up. A longer turn is available only to a persona with `long`; no authored beat kind marks a speech today, so there is no beat-level exception.

1. **Prompt.** The length line says the numbers in the persona's language, and the "Sounds like" model lines (compact) and the style examples (full) are cut to the target's upper aim at a sentence boundary. No corpus text is in a prompt.
2. **Retry.** A line over the cap is retried once, with a note naming its word count and asking for the first sentence only (`llm_len_retry`).
3. **Cut.** A line still over the cap is cut at a sentence boundary: whole sentences while they fit, no more than the target's sentence count, a trailing second question dropped. A first sentence over the cap by itself is cut at a clause break that leaves 3 words, else at the cap with an ellipsis (`llm_len_trimmed`).

Without the policy flag no prompt changes by a byte (`drama-off.golden.json` is untouched).

## Motif, novelty and question debt

One retry each, then a repair, and never against a person who just asked this actor something (that line goes out as the model wrote it, after the retry).

- **Motif** (`llm_motif_retry`): the candidate carries a phrase or simile frame that 2 of the room's last 6 turns already carry, whoever said them. The retry note names it and asks for one new fact, object, accusation or decision. If the retry brings it back, the line becomes its sentences that do not carry it, or a short reaction ("Ah.", "Hm.": picked by a hash of the turn) (`llm_motif_reaction`).
- **Novelty** (`llm_novelty_retry`): a candidate of 7 or more words of 4+ letters whose novelty against the last 6 room turns is under the 10th percentile of the plays' (pt 0.71, en 0.62). Same retry and repair. Seven words, not fewer: short chat lines share their topic words with the lines around them, and a floor measured on plays flagged 14% of the repo's ordinary lines at 4 and 5 words, 0.7% at 7. An exact repeat of a short line is the older echo guard's.
- **Question debt** (`llm_debt_note`, `llm_debt_retry`, `llm_debt_stripped`): a direct question to this actor (named by a vocative, or aimed by its addressee list) that two turns of others have passed without an answer from it puts a note in the decision: answer first, in a few words. A candidate that opens with a question, or only asks, is retried; if it still asks, its questions are cut (a short reaction when nothing is left).

Measured on real dialogue (would this flag it?): over 150 beats per language (the 100 held-out plus 50), the novelty and motif checks flag 1.9% of pt turns and 3.1% of en turns (novelty 1.6% and 2.8%, motif 0.3% and 0.4%); 23 and 29 of 150 beats have at least one flagged turn. Over the repo's 128 ordinary pt-BR lines (the 6 before as the room, in rotations): motif 0, novelty 0.7% of turns. Over the five personas' own hand-written lines: none flagged. The flag rate is not zero, and cannot be for a floor set at a percentile of real turns; it is under 5% everywhere it was measured. 13.5% of real pt turns and 15.6% of en turns are over the length cap: by design, the cap is below what the plays do.

## Scene spine

For a hotel run whose scenario has no authored beats, drama on (not `drama: off`, negotiated), and two or more actors, `startSpine` works out at run start, with no model call, four steps from what the scenario already carries: each persona's `hiddenObjective` (aim, `constraint` or `costOfExposure` as the obstacle) and the situation text. People who share a `scarceResourceId` are aimed at each other (the first in cast order is the holder, the rest challengers); a person with an objective nobody shares is aimed at the next in the cast; a person with none is free.

| step | nominal second | challenger / holder / free tactic (verbs of `packages/kb/src/taxonomy.ts`) | waits for |
|---|---|---|---|
| pressure | 0 | to press / to stall / to provoke | any new fact or move |
| first demand or reveal | 45 | to demand / to deflect / to reveal | a promise, accusation, reveal, act or reversal |
| turn | 90 | to accuse / to confess / to confront | the same |
| decision | 150 | to propose / to bargain / to propose | |

Each step is one note per actor, in the scene's language, under 600 characters (the beat-craft budget `BEAT_CRAFT_MAX_CHARS`): the aim, the obstacle, the tactic verb and the person it is aimed at, and "make ONE move that changes that person's position". It rides the same feed as the KB's beat craft (`ScopedMirror.setCraft`, `BodyPerception.craft`, under the scene-craft digest of the drama prompt) and is shown to that actor only while its step is current. The arc gates on what happens: a step starts no earlier than its nominal second and not before the step before it saw its progress event (the recorder tracks the same events the benchmark counts), unless 40 s have passed since its nominal second (or since the previous step began, if later). The run's manifest says where the spine ended and whether each step came through progress or the release. Off with `PERFECTMAN_SCENE_SPINE=0`; inert with authored beats (their own feed owns the slot) and with `drama: off`, where the drama block that renders the note is absent.

## In each run

`replay.json` has `script_likeness` (score, percentile, sub-scores, worst window, windows, speech turns, language, medium and whether it fell back, motifs, unanswered questions, the norms' `built` date), `scene_spine` (final step, each advance with its second and whether `progress` or `released`) and in `counters`: `script_likeness_score`, `script_likeness_percentile`, one `script_likeness_<sub>` each, `scene_spine_step`, `scene_spine_released`, and next to the guard counters `llm_len_retry`, `llm_len_trimmed`, `llm_motif_retry`, `llm_novelty_retry`, `llm_motif_reaction`, `llm_debt_note`, `llm_debt_retry`, `llm_debt_stripped`. The end-of-run info logs `run script likeness` (and `scriptLikeness` inside `run llm usage`). What is scored is the actors' committed lines and their bodies' moves (walks and sits from the frame log); a guest's line is not an actor's turn and is left out.

## What this does not show

- No real model ran. The retry loop, the notes and the spine are tested with scripted answers and a local HTTP stand-in; nothing here measures whether deepseek-v4.1-flash obeys a 25-word cap or answers first when told to.
- The progress sub-score barely discriminates at the size of one beat. Real beats of 8 to 12 turns have no detected promise, accusation, reveal, act or reversal in at least 5% of cases (p5 of the rate is 0) and stretches of 11 to 12 turns without one at the 95th percentile, so a run with no arc inside 11 turns cannot be told from a real beat by this. A scene-level norm (consecutive beats joined, 30 turns or more) is the follow-up; today a long run is judged in windows of 10.
- Run 58's own transcript was not scored; see above.
- CINEMA has no corpus: a cinematic run is scored against theatre norms.
- The corpus is plays, many of them 19th-century or earlier. Modern chat differs (the repo's ordinary chat lines score 94 to 100, which is a check, not a norm).
- Motif keys are lexical. A repeated idea in new words is not a motif; a catchphrase is only caught when it is two topic words or a simile frame (the older echo guard keeps owning an actor's own tics).
