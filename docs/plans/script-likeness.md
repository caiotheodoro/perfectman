# Script likeness

Production run 58 (cinematic, 4 bot actors, pt-BR, a hand-written scene) read as long, looping lines with no arc, and had only been checked for garbled tokens. This page is what was built to measure dialogue against real plays and to hold hotel actors to it: a benchmark, norms derived from the corpus, four checks in the actor loop, a scene spine for scenes with no authored beats, and a score in every run's replay manifest. Everything is deterministic and runs with no model.

**The benchmark is advisory and uncalibrated.** No human has labelled a run against it. Its thresholds come from real plays (a percentile of beats or scenes, or a multiple of the plays' turn-level figures) and from the handful of production runs a human called bad; none was fitted to a human's score. A low score is a reason to read the transcript. A high one is no evidence that a run is good: it says the run is not far from a typical play on the figures listed under Metrics, and those figures miss a lot (a repeated idea in new words, a flat scene with plenty of vocabulary, anything the lexicons do not list). `scripts/run-metrics.mjs` reads the same transcripts with code that shares nothing with the benchmark.

Where the code is: metrics, loops, norms, score, checks and spine in `packages/shared/src/script-likeness/`; the actor-loop checks in `packages/server/src/agent/` (`script-guard.ts`, `surface/action-intent-step.ts`); the run side in `packages/hotel/src/run/` (`scene-recorder.ts`, `run.ts`); the benchmark in `packages/eval/src/script-likeness/` and `cli/script-likeness.ts`; the norms builder `export-norms` in `packages/kb/src/norms.ts`; the independent reader in `scripts/run-metrics.mjs`.

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

### Scene norms

A beat is a few turns; a run is a scene. `scene` in each language block joins consecutive beats of one scene (source, act and scene; the corpus has no gaps in a scene's indices) and reads the same metrics over the whole of it. Scenes with fewer than 13 speech turns are not counted, and a scene that holds a held-out beat is left out, so the held-out check stays a check. Two sizes, 13-29 and 30 or more speech turns, each with its own ladders.

| | pt | en |
|---|---|---|
| scenes counted (13-29 / 30+ turns) | 179 (93 / 86) | 205 (59 / 146) |
| beats per scene (mean), speech turns per joined beat | 4.3, 7.9 | 15.7, 6.7 |
| speech turns per scene, p25 / p50 / p75 / p90 | 20 / 29 / 44 / 60 | 27 / 48 / 96 / 249 |
| median words per turn of a 30+ scene, p5 / p50 / p97.5 | 5 / 8 / 16 | 7 / 11 / 21 |
| share of turns over 25 words, p50 / p97.5 | 13% / 37% | 25% / 47% |
| novelty (mean) of a 30+ scene, p5 / p50 | 0.76 / 0.84 | 0.66 / 0.73 |
| major events per 10 turns of a 30+ scene, p5 / p50 | 0.25 / 1.05 | 1.09 / 2.5 |
| longest stretch of turns with no major event, 30+, p50 / p90 / max | 16 / 33 / 54 | 16 / 32 / 67 |
| 30+ scenes with a reversal of who asks and who answers in the second half | 64% | 68% |

Real scenes vary far more than a binomial draw of their turns would (a play with speeches next to one of quick exchanges), which is why a length read against the 97.5th percentile of scenes lets a run with a median of 16 words through.

## Metrics

Over a list of turns (`ScriptTurn`: speaker, text, optional ms, `say` or `act`). Adapters read a hotel run directory (`events.jsonl` plus the frame log for walks and sits), an `events.jsonl` or eval simulation event log, and a plain turns file.

- **Length**: median, p90 and the share of turns over 25 and over 40 words; the share of replies of 5 words or fewer.
- **Novelty**: the share of a turn's words of 4 or more letters not seen in the previous 6 turns.
- **Motif repeat**: a key that three turns share inside 90 s (7 turns when there are no times), whoever says it. Keys: a phrase of 2 or 3 words with two topic words; a simile frame ("que nem", "tipo X", "like a"); a topic-word stem. Phrases and frames are the loops (about 2% of real beats have one); a topic word kept for three turns is common in real scenes (about 30% of beats) and only pulls the score down. Names are never motifs.
- **Progress**: turns that bring a new name, number or object (a noun after a determiner nobody named yet); promises, accusations, reveals, acts and position changes, and reversals of who asks and who answers (the last five move the scene); the longest stretch of speech turns with none of those.
- **Question debt**: a question not answered by its addressee (named by a vocative, else any other speaker) with a statement or a 3-word reply inside 3 turns. A question the scene ended on is not judged.
- **Reactions**: a say turn of at most 3 words that are all interjections (ué, hm, hmm, ah, tá, sei, é, né, uh, oh, ok, okay, huh, right and a few more; laughter alone counts), or a turn flagged `filler: true`. The guard's own reactions ("Ah.", "Hm.", "Ué.", "Sei.", "Tá.", "Huh.", "Right.", "Okay.") are all caught by the text rule, so the hotel recorder does not need to flag them. A reaction is counted (`reactionShare`) and then left out: it adds no length, takes no slot of the novelty look-back, belongs to no loop, brings no progress event, and it never answers a question (it still takes a turn, so a question that only drew reactions goes unanswered).
- **Demand loops**: an actor's turns that carry a demand cue (a demand phrase such as "cofre hoje", "abre", "quero", "me dá", "agora", "senão", "ou eu", "paga", "diz", "fala", "give me", "or else", or an imperative opening a sentence) are clustered by the Jaccard overlap of their words of 4 or more letters that are not stop words, names or proper nouns (0.4 or more), or by one shared cue and one shared word of 5 letters or more (the same ultimatum in new words). A loop is 3 or more turns of one cluster by one actor inside 90 s (7 room turns when there are no times). The metric is the share of content turns in a loop.
- **Tics**: one word of 4 or more letters (a stem, so "rapaz" and "rapazes" meet; not a stop word, a name, a title such as "senhor", or a word capitalised everywhere it appears) in 5 or more of one speaker's turns inside 24 room turns. The metric is the share of content turns in a tic.
- **Progress events**: a turn that brings a name, number or object; a promise, accusation, reveal or reversal; an `act`; a `move`. A `move` is a body that walks, sits or gestures (a hotel body event, or a stage direction without an act verb); an `act` is a real act (a stage direction with an act verb in a play, an exit, a drama act). Only commitment, accusation, reveal, act and reversal are major events: a bare move is an event and never a major one.

The lexicons for promises, accusations and reveals are short word lists in `text.ts`, pt and en. They miss a lot, and they miss it in the plays too, which is why the progress sub-score cannot tell a flat beat from a real one at the size of one beat (see "What this does not show").

Flag rates on the 3,873 corpus beats of 4 or more speech turns and on the 439 scenes of 13 or more (all of them, held-out included: the detectors have no fitted constant):

| | beats pt / en | scenes 13+ pt / en | scenes 30+ pt / en |
|---|---|---|---|
| a demand loop | 0.4% / 0.2% | 2.4% / 8.3% | 3.9% / 9.6% |
| a tic | 2.3% / 0.5% | 15.2% / 44.5% | 22.5% / 58.7% |
| any reaction | 5.4% / 1.8% | 18.1% / 11.8% | 22.5% / 15.6% |
| reactions in 20% or more of the turns | 0.7% / 0.4% | 0% / 0% | 0% / 0% |

Demand loops and reactions are rare in real dialogue. A tic is not: a character who keeps coming back to the money trips it, over a long scene most of all, so a tic found is not a verdict. The score reads the share of turns in one against the same share in real scenes (below), never the flag.

## Score

**A run is scored whole.** The headline is one score over all of the run's turns, not the mean of windows (the old windows of 10 turns each fell into the 8-12 beat bucket, where the length ladder gives full marks up to a median of 26 words). The bucket comes from the run's total speech turns: under 13, real beats of the same size (4-7, 8-12); from 13, real scenes, 13-29 or 30+ turns. Windows of 13 speech turns are still scored, each next to real beats, for diagnosis only: `worst_window` stays in the manifest and is the lowest of them.

Each metric (at scene scale, all but length and progress) is read against the ladder of its size: 100 inside the real range up to the 97.5th percentile (the 99th for the three detectors that fire in real dialogue only by accident: reactions, demand loops, tics), 0 at the worst real unit and beyond, linear between (mirrored where too little is the failure). Seven sub-scores: length 0.30, novelty 0.20, motif 0.20, progress 0.20, debt 0.10 and two gates with no weight, `reactions` (reaction share) and `repeats` (demand loops, tics), which only cap. A metric a real script almost never fails (turn length, novelty, loops, a line that is only "Ah.") caps its sub-score and the score at the weakest such part plus 30 and 25; the rest (few short replies, a topic word kept, no promise or accusation, a question left owing) only pull the mean down.

**Length of a run of 13 turns or more** is read against the plays' turn-level figures (pt median 7, p75 15, p90 30, 12.6% over 25 words, 5.8% over 40, 40.6% short; en 10, 21, 41, 19.7%, 10.3%, 26.2%) and not against a percentile of beats: full marks up to 1.5 times the figure, zero from 3 times, linear between (short replies the other way up). Median, p75 and the share over 25 words cap the sub-score; the share over 40 and p90 pull the mean only, being the noisiest figures over one scene. A pt run with a median of 10 words and none of 3 loses only the short-reply part; one at 21 gets 0 for the median.

**Progress of a scene of 30 turns or more** is read on its own terms: at least one major event per 12 content turns (full marks at 0.83 per 10 turns, 0 at none), a longest stretch without one inside what real scenes of this size show (full marks up to their 90th percentile, 0 at the longest real one), and a reversal of who asks and who answers in the second half. Weights 0.4, 0.3, 0.3; progress does not cap the score. Below 30 turns progress is read as before and cannot fail: real beats go 11 and 12 turns with no detected move.

Every sub-score lists its metrics, the value, its score, the limit and the point where it reaches zero; the score has the percentile of the real units' own scores (beats under 13 turns, scenes from 13). 80 or more reads as script-like, under 60 as not.

```
pnpm --filter @perfectman/eval script-likeness --run <run dir | events.jsonl | transcript.jsonl | turns.json> [--actors "A,B"] [--lang pt|en] [--json]
pnpm --filter @perfectman/eval script-likeness --fixtures
pnpm --filter @perfectman/eval script-likeness --validate-corpus <beats.jsonl> [--salts a1,b2,c3]
pnpm --filter @perfectman/eval script-likeness --guard-rates <beats.jsonl> [--beats 150]
node scripts/run-metrics.mjs <transcript.jsonl | events.jsonl | run dir> [--actors "A,B"] [--json]
```

A transcript export is one JSON per line, `{t, name, kind, text}` with `t` in seconds since the run's start; `--actors` keeps only the bot actors, since the export can hold the players' lines too.

### What it measured (2026-11-10, after the repair)

Real dialogue (all of it is the local corpus; only these numbers are committed):

| | result |
|---|---|
| 200 held-out real beats, committed norms | 95.5% reach 80 (191 of 200: pt 93%, en 98%), median 100, p10 90 (pt) and 95 (en) |
| the same, on four other held-out sets (salts a1, b2, c3, d4) | 94.5%, 95.0%, 95.0%, 97.0% |
| the real scenes of 13 or more turns that hold a held-out beat, scored as one run | 48 of 55 reach 80 (87.3%); salted: 87.0%, 87.0%, 80.9%, 90.2% |
| every scene counted in the scene norms (in sample) | 88% reach 80 (339 of 384: pt 92%, en 85%); the misses are mostly scenes of long speeches |
| 128 ordinary pt-BR chat lines of the repo, in runs of 13 / 20 / 30 consecutive lines | 94 to 98 / 94 to 95 / 80 to 88 (at 30 lines, progress asks for an arc that ordinary small talk has not) |
| the corpus beats, in sample (pt / en) | 95.8% / 94.9% reach 80 |

Before the repair the same 200 held-out beats gave 97.0% (salted 95.5%, 96.5%, 96.0%); the three added detectors, the stricter length and the scene scale cost about 1.5 points on beats. The thresholds were set on the beats and scenes outside the held-out set and on the production runs; the held-out aggregates (never beat by beat) were read six times while the detectors and the length factors were chosen, so the salted sets are the check that the committed 200 were not fitted.

Production runs, the bot actors' lines only (players' chat left out), scored whole. The "before" column is the benchmark at the commit before this repair, run on the same transcripts:

| run | speech turns (reactions) | read next to | before | score | worst window | length / novelty / motif / progress / debt / reactions / repeats |
|---|---|---|---|---|---|---|
| 52 | 4 | beats | 55 | 55 | 55 | 30 / 100 / 100 / 100 / 100 / 100 / 100 |
| 53 | 19 | scenes | 33.8 | 25 | 25 | 26.7 / 22.7 / 0 / 100 / 100 / 100 / 100 |
| 55 | 8 | beats | 25 | 25 | 25 | 30 / 0 / 25 / 100 / 100 / 100 / 100 |
| 56 | 16 | scenes | 88.1 | 52.9 | 45 | 27.9 / 80.4 / 64.8 / 100 / 100 / 100 / 30 |
| 57 | 13 | scenes | 25 | 25 | 25 | 24.1 / 32.5 / 0 / 100 / 0 / 100 / 100 |
| 58 | 11 | beats | 53.6 | 53.6 | 53.6 | 28.6 / 89.3 / 30 / 100 / 100 / 100 / 100 |
| 59 | 37 (10) | scenes | 80.5 | 25 | 25 | 24.8 / 0 / 15.8 / 70 / 100 / 0 / 100 |
| 60 | 38 (9) | scenes | 76.2 | 25 | 25 | 28.6 / 0 / 30 / 63.1 / 100 / 0 / 0 |

Run 60 as production scored it (41 turns, with the guard's 10 reactions) was 88.4. The export used here has 38 of those 41 turns and 9 of the 10 reactions; on it the old benchmark gave 76.2 and this one 25. The two fixtures `run60-transcript` and `run60-summary` (the owner's aggregates: median 19, 26% over 25 words, novelty 0.67, 10 reactions in 41 turns, which score 24.4) join the three older ones and must all stay under 60. What fails run 60 now: reactions (24% of turns; no real pt scene of 30 turns or more has over 6%), novelty over the content turns (0.56; the 5th percentile of real pt scenes of that size is 0.76), a demand loop (Renato, 4 turns, "cofre", between 306 s and 406 s) and tics ("rapaz" in 9 of Otávio's 13 turns, "cofre" and "mano" in 6 of Renato's), a median of 23 words on the content turns (20 over all turns). What it does not fail: its progress (63; 2 major events in 29 content turns, no reversal in the second half, only a soft penalty), its debt.

`scripts/run-metrics.mjs` on the same transcripts (words per turn over all turns, as the plays' figures are; novelty is over the content turns):

| run | turns | median / p75 / p90 words | over 25 / over 40 | fillers | novelty (turns with 7+ words) | demand loops | tics (word, turns) |
|---|---|---|---|---|---|---|---|
| 52 | 4 | 33 / 43 / 43 | 100% / 25% | 0 | 0.79 | 0 | none |
| 53 | 19 | 28 / 33 / 38 | 63% / 0% | 0 | 0.57 | 0 | Otávio: rapaz 5 |
| 55 | 8 | 30 / 32 / 34 | 63% / 0% | 0 | 0.56 | 0 | none |
| 56 | 16 | 26 / 31 / 34 | 50% / 0% | 0 | 0.67 | 1 | none |
| 57 | 13 | 35 / 37 / 39 | 92% / 8% | 0 | 0.59 | 0 | none |
| 58 | 11 | 31 / 38 / 38 | 64% / 0% | 0 | 0.70 | 0 | none |
| 59 | 37 | 20 / 33 / 37 | 35% / 0% | 10 (27%) | 0.68 | 0 | Pistolinha: lasanha 9, jura 7, tchacabum 7, entendeu 5 |
| 60 | 38 | 20 / 27 / 34 | 29% / 0% | 9 (24%) | 0.59 | 1 | Otávio: rapaz 9, assinatura 5, preço 5; Renato: cofre 6, mano 6, hoje 5 |

The plays' turn-level figures are median 7, p75 15, 12.6% over 25 words and novelty 0.88 (pt). Every production run has a median of 3 to 5 times the plays'.

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

Each step is one note per actor, in the scene's language, under 600 characters (the beat-craft budget `BEAT_CRAFT_MAX_CHARS`): the aim, the obstacle, the tactic verb and the person it is aimed at, and "make ONE move that changes that person's position". It rides the same feed as the KB's beat craft (`ScopedMirror.setCraft`, `BodyPerception.craft`, under the scene-craft digest of the drama prompt) and is shown to that actor only while its step is current. The arc gates on what happens: a step starts no earlier than its nominal second and not before the step before it saw its progress event (the recorder tracks the same events the benchmark counts; a body's walk, sit or gesture is a `move`, new for the first step and never a major event, so only an act verb, a promise, an accusation, a reveal or a reversal releases the later ones), unless 40 s have passed since its nominal second (or since the previous step began, if later). The run's manifest says where the spine ended and whether each step came through progress or the release. Off with `PERFECTMAN_SCENE_SPINE=0`; inert with authored beats (their own feed owns the slot) and with `drama: off`, where the drama block that renders the note is absent.

## In each run

`replay.json` has `script_likeness` (the whole run's score, percentile, sub-scores including the two gates `reactions` and `repeats`, worst window, windows, speech turns, language, medium and whether it fell back, motifs, unanswered questions, the norms' `built` date), `scene_spine` (final step, each advance with its second and whether `progress` or `released`) and in `counters`: `script_likeness_score`, `script_likeness_percentile`, one `script_likeness_<sub>` each, `scene_spine_step`, `scene_spine_released`, and next to the guard counters `llm_len_retry`, `llm_len_trimmed`, `llm_motif_retry`, `llm_novelty_retry`, `llm_motif_reaction`, `llm_debt_note`, `llm_debt_retry`, `llm_debt_stripped`. The end-of-run info logs `run script likeness` (and `scriptLikeness` inside `run llm usage`). What is scored is the actors' committed lines and their bodies' moves (walks and sits from the frame log) plus the acts the director committed; a guest's line is not an actor's turn and is left out.

## What this does not show

- No human has labelled a run against the score: it is a comparison with plays, not a measure of quality. The factors (1.5 and 3 times the plays' turn length, one major event per 12 turns, the 90th percentile of real stalls, the 99th percentile for reactions, loops and tics) are judgement, checked on real beats and scenes and on the production runs a human called bad.
- No real model ran. The retry loop, the notes and the spine are tested with scripted answers and a local HTTP stand-in; nothing here measures whether deepseek-v4.1-flash obeys a 25-word cap or answers first when told to.
- About 1 real beat in 20 and 1 real scene in 8 score under 80, by construction of a percentile norm. The scenes that miss are mostly plays with long speeches: the benchmark reads a scene of quick exchanges as the typical one, on purpose.
- Progress can fail only from 30 turns, and softly (it does not cap). The lexicons for promises, accusations and reveals miss a lot, in the plays too, so "one major event per 12 turns" under-reads: 36% of real pt scenes of 30+ turns and 32% of en have no reversal in the second half. Run 60's missing climax shows as a 63, not a failure.
- A tic is only scored beyond what real scenes show: over a long scene a topical word a character keeps using trips the detector in 23% of pt and 59% of en scenes of 30+ turns. Real tics inside that range (the vocative of a character) go unscored.
- Reactions are found by text (interjection-only lines) and by an explicit `filler` flag. The hotel recorder does not set the flag: the guard's own reactions are all interjections, so the text rule catches them, but a guard reaction worded differently would not be caught.
- Motif keys are lexical. A repeated idea in new words is not a motif; a demand repeated in new words is caught only when the turns share a cue and a word of 5 letters or more.
- A run of fewer than 30 turns has no arc requirement. A run of 4 to 12 turns is read against beats, whose length ladder reaches the 97.5th percentile of beats.
- CINEMA has no corpus: a cinematic run is scored against theatre norms.
- The corpus is plays, many of them 19th-century or earlier. Modern chat differs (the repo's ordinary chat lines score 94 to 98 in runs of 13 to 20 lines, which is a check, not a norm).
- `scripts/run-metrics.mjs` reads the same lexicon ideas (it is a second implementation, not a second opinion on the definitions): where the benchmark's definition is wrong, it is wrong there too.
