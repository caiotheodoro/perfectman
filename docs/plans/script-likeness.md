# Script likeness

Production run 58 (cinematic, 4 bot actors, pt-BR, a hand-written scene) read as long, looping lines with no arc, and had only been checked for garbled tokens. This page is what was built to measure dialogue against real plays and to hold hotel actors to it: a benchmark, norms derived from the corpus, checks in the actor loop (length, motif and novelty, question debt, narration, quotations, a move made at the actor), a scene spine for scenes with no authored beats, and a score in every run's replay manifest. Everything is deterministic and runs with no model.

Where the code is: metrics, norms, score, checks and spine in `packages/shared/src/script-likeness/`; the actor-loop checks in `packages/server/src/agent/` (`script-guard.ts`, `surface/action-intent-step.ts`); the run side in `packages/hotel/src/run/` (`scene-recorder.ts`, `run.ts`, `guard-log.ts`); the benchmark in `packages/eval/src/script-likeness/` and `cli/script-likeness.ts`; the norms builder `export-norms` in `packages/kb/src/norms.ts`.

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

With `script: true` in the runtime policy (hotel runs; `PERFECTMAN_SCRIPT_GUARD=0` turns it off for a process) a persona's `presence.messageLength` maps to a word target, `short` by default. A persona file with no `presence.messageLength` and a builder scene (`roomFiles`) that does not say compile to `short`; they compiled to `medium` until run 60, whose actors (cap 40) had a median line of 19 words with 26% over 25, where the pt plays have a median of 7 and 12.6% over 25. An explicit `medium`, `long` or `rapid_fire` is kept.

| messageLength | aim | cap | sentences |
|---|---|---|---|
| rapid_fire | 2-6 | 12 | 1 |
| short (pt) | 5-12 | 22 | 2 |
| short (en) | 6-14 | 28 | 2 |
| medium (pt / en) | 10-20 / 12-24 | 40 / 48 | 3 |
| long | 15-35 | 60 | 4 |

pt short sits between the plays' median (7) and p75 (15) for the aim and under their p90 (30) for the cap; en is the same percentiles of the en plays (median 10, p75 21), rounded up. A longer turn is available only to a persona with `long`; no authored beat kind marks a speech today, so there is no beat-level exception.

1. **Prompt.** The length line says the numbers in the persona's language, and the "Sounds like" model lines (compact) and the style examples (full) are cut to the target's upper aim at a sentence boundary. No corpus text is in a prompt.
2. **Retry.** A line over the cap is retried, with a note naming its word count and asking for the first sentence only (`llm_len_retry`). The aim is never enforced, only the cap.
3. **Cut.** A line still over the cap is cut at a sentence boundary: whole sentences while they fit, no more than the target's sentence count, a trailing second question dropped. A first sentence over the cap by itself is cut at a clause break that leaves 3 words, else at the cap with an ellipsis (`llm_len_trimmed`).

Without the policy flag no prompt changes by a byte (`drama-off.golden.json` is untouched).

## One retry per turn

Every rule below is judged on the first candidate, and every rule it breaks goes into one note (numbered under one heading when there is more than one), with one more model call: length, motif, novelty, question debt, a quotation nobody made, a line that was only narration, and the older echo, loop and garble checks. What the retry still breaks is repaired without asking again: cut to the cap, the offending sentences struck, or silence. The exceptions are the carve-outs that existed before: a person who asked the actor something is answered with what the model wrote (after the retry), and corrupt text is dropped. Before this a turn could retry up to `maxRetries` (2) times, one rule at a time; run 60 spent 92 model calls on about 41 spoken lines, 45% of them guard retries.

## Motif, novelty and question debt

- **Motif** (`llm_motif_retry`): the candidate carries a phrase or simile frame that 2 of the room's last 6 turns already carry, whoever said them. The note names it and asks for one new fact, object, accusation or decision. If the retry brings it back, the line becomes its sentences that do not carry it, else silence (below).
- **Novelty** (`llm_novelty_retry`): a candidate of 7 or more words of 4+ letters whose novelty is under the 10th percentile of the plays' (pt 0.71, en 0.62), judged against the actor's own last 3 lines (the packet's own-utterance list included) and the turn right before it, not the room's last 6. Words the scene keeps using never count as seen: proper nouns (a capitalised word inside a sentence, the names of the room's speakers) and the 5 content words most of the room's lines share (each in at least 2 lines; ties by spelling). Judging against all 6 turns flagged 66% of the turns of 8 production runs that the 7-word floor could judge, because three people circling one object (the safe, the pen, "rapaz") share words without anyone repeating himself. Same retry and repair. An exact repeat of a short line is the older echo guard's.
- **Question debt** (`llm_debt_note`, `llm_debt_retry`, `llm_debt_stripped`): a direct question to this actor (named by a vocative, or aimed by its addressee list) that two turns of others have passed without an answer from it puts a note in the decision: answer first, in a few words. A line of the actor's own clears the debt only if it answers: a real answer is not only fillers ("Ah", "Hm", "Ué", "Sei", "Tá", "Okay"...), and has 4 or more words, or a direct yes, no, maybe, never, nobody, where or when word or a number, or 2 words with one of 5+ letters ("Na gaveta."). The benchmark's own debt metric still takes any reply of 3 words or fewer as an answer; this rule is the guard's. A candidate that opens with a question, or only asks, is retried; if it still asks, its questions are cut (silence when nothing is left).

Measured on real dialogue (would this flag it?), the novelty rule against the old window: the bot lines of runs 52, 53 and 55-60 as candidates (122 turns, 100 judged): old 54% of turns (66% of the judged), new 24% (29%); the rest are runs that do loop on a few words (run 53: 63% of turns). The repo's 128 ordinary pt-BR lines (6 before as the room, rotations, 1,000 turns of which 199 judged): 0.7% of turns, 3.5% of the judged, old and new alike. 300 real corpus beats per language (sampled by id; 2,663 pt turns of which 800 have 7+ content words): pt old 3.9% of the 7+ turns, new 1.3% (0.4% of all turns); en 8.6% and 1.9%. Over the five personas' own hand-written lines: none flagged. 13.5% of real pt turns and 15.6% of en turns were over the old caps; the new caps (22 and 28) are further below what the plays do, by design.

## Silence, not a filler

A line the guard cannot repair (what a retry brought back for motif, novelty or debt, with nothing left after striking, a quotation struck to nothing, or only narration) is not replaced with a short reaction. The turn is a no-op committed with the motive `Output guard: no fresh line (<why>); staying quiet.` (engine-written: `isEngineAuthoredMotive` is true, as is the chain's `Line held back by the output guard`, so an audit tells a held-back line from a silence the actor chose), `fallbackApplied` true and no `llm_failure` (the provider answered), an `intent_blocked` operator event, and `llm_guard_silenced`. The body is kept: the model's block when it has an `expression`, `gesture` or `act` (the silence still shows what the person feels), else, in a run with bodies, a `body.expression` for the strongest feeling in the model's `emotionDrivers` (raiva and anger give `angry`, tristeza, vergonha and shame `sad`, surpresa and medo `surprised`, alegria and alívio `smile`, sono and tédio `sleepy`; a feeling that maps to none gives no face). Run 60 had 10 lines of "Ah.", "Hm.", "Ué.", "Sei." and "Tá." said in place of repairs; they also closed question debts, because the benchmark reads 3 words or fewer as an answer. The retry notes no longer end with "if you have nothing new, give a short reaction". `PERFECTMAN_FILLER_SILENCE=0` restores the old text fallback (`llm_motif_reaction` then counts the swaps).

## Narration in speech

The contract line (full and compact prompts, script checks on) says `visibleContent` is only what the person says out loud and actions, looks and expressions go in `body.gesture` or `body.expression`. Deterministically, before any other check reads a candidate (so length and novelty are judged on the speech), the sentences that open with a first-person singular present body verb are cut out: about 85 pt verbs (olho, boto, pego, levanto, sento, sorrio, viro, cruzo, encaro, aponto, bato, puxo, empurro, abro, fecho, ponho, dou, tiro, deixo, ando, caminho, respiro, suspiro, cerro...), also after "me" ("Me levanto") or a leading "e", and "I look", "I put" and the like in English. A sentence is left alone when it has a quotation mark, is a question, is longer than 14 words, or has a promise, condition or address in it (se, quando, amanhã, vou, prometo, você, senhor, quiser...: "Abro o cofre amanhã", "Dou o que você quiser"). `llm_narration_stripped`. A candidate with nothing but narration is retried with a note that names the body channel; if the retry is too, the turn is silent. On run 60 it cuts exactly "Olho pra ela, sorriso atravessado." (Renato, 52 s) and "Boto um copo na mão dele e olho fixo." (Otávio, 77 s); it changes no other bot line of runs 52-60 nor any of the 128 ordinary lines. Delimited stage directions (`*sorri*`, `(rindo)`) are not touched.

## Quotations nobody made

`falseQuotes` checks a candidate against the last 10 room lines (the actor's own included), folded for case, accents and punctuation: a quoted span of 3 or more words (straight, curly or guillemet quotes) in a sentence with a verb of saying passes when its words run unbroken in one line or 80% of its trigrams are in one; "X te chamou de Y" with X a speaker in view (or ela, ele, você: anyone else) needs Y to be a word X said; "X disse que ..." (the "que" is required) with 3 or more content words needs 60% of them in X's lines. What cannot be checked passes: a speaker with no line in view, a quotation with no verb of saying (a letter, a saying), a claim of fewer than 3 content words. The one retry note names the claim; a sentence that still fails is struck (`llm_quote_retry`, `llm_quote_struck`; silence if nothing is left). Run 60, Otávio at 230 s: "Ela te chamou de irmão e de burro na mesma frase." (Heloísa said irmão, never burro) is flagged. On the other bot lines of runs 52-60 nothing is flagged; on the 128 ordinary lines 1 is ("Ele disse que é por causa da reforma do telhado.": nothing in view says it). A claim about someone who is not in the room (ele or ela for an absent person) is read as a claim about someone in it and can be struck wrongly: the cost of a pronoun check.

## A move made at the actor

When the room's last line (not the actor's, not a guest's) is a reveal, an accusation, a threat (blackmail, ultimatum) or an offer, everyone who hears it gets, next to the owed-question note, `<X> acabou de <revelar|acusar|ameaçar|propor>: "<its first 12 words>". Reaja a isso primeiro: negar, admitir, contra-atacar ou ceder. Não ignore.` (English: "just revealed|accused|threatened|proposed ... React to that first: deny, admit, counter or give in. Do not ignore it."). The person named gets it first of all; a three-person scene has no bystanders, so the others get it too. Only the turn right before counts, never a whisper. The lexicons are the appended block at the end of `text.ts` (`MOVE_PHRASES`, whole words, accents folded): reveal ("eu vi", "vi você", "sei que você", "foi você que", "descobri", "a mão que"), accusation ("falsificou", "forjou", "mentiu", "mente", "assinou", "roubou", "enganou", "traiu", "foi você"), threat ("senão eu", "ou eu", "ou você", "vou contar", "abro a boca", "conto pra todos", "escândalo", and "se não" only with "eu" and a verb after it), offer ("proponho", "te pago", "eu pago", "aceito", "fechado", "combinado", "prometo", "topo"...), and the English equivalents. The benchmark's `isReveal` and `isAccusation` are unchanged. `llm_answer_note`. Run 60: Renato's "Mas eu vi a caneta na sua mão, Heloísa." (251 s) reaches both Heloísa and Otávio, and Heloísa's "Ah." after it is not a neutral line for the next speaker. After 5 of 125 ordinary lines the note would fire, 2 of them on a stretch ("juro que não encostei", "sem escândalo") that is not a move at the actor; after 23 of 138 bot-line turns.

## The guard log

`runs/<id>/guard-log.jsonl`, registered in the manifest as `guard_log`, one line per thing a guard did to an actor's line: `{"t_ms", "actor", "rule", "before", "after"}`, `t_ms` from the run's start, `actor` the display name. For the operator only (no replay, player or web client reads it); a run in which no guard acted writes no file; `PERFECTMAN_GUARD_LOG=0` turns it off. `RepetitionPolicy.onGuard(kind, info)` carries the actor and the texts, so the counters are unchanged. Rules: `len_retry`, `len_trim`, `motif_retry`, `novelty_retry`, `echo_own`, `echo_room`, `phrase_loop`, `garble`, `garble_drop`, `debt_note`, `debt_retry`, `silenced`, `narration_stripped`, `quote_struck`, `answer_note`, and three the audit list left out that the counters already had: `motif_strike` (sentences struck), `debt_strip` (questions cut) and `quote_retry`. `before` is the text the guard was given (the line a retry replaced, a cut, a strike or a silence; the text a note answered is empty), `after` the text it left or the note it added (empty when silenced or dropped). A repetition-guard block is logged as `silenced`. The stall nudge and a held line dropped on release change no line and are not logged.

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

`replay.json` has `script_likeness` (score, percentile, sub-scores, worst window, windows, speech turns, language, medium and whether it fell back, motifs, unanswered questions, the norms' `built` date), `scene_spine` (final step, each advance with its second and whether `progress` or `released`) and in `counters`: `script_likeness_score`, `script_likeness_percentile`, one `script_likeness_<sub>` each, `scene_spine_step`, `scene_spine_released`, and next to the guard counters `llm_len_retry`, `llm_len_trimmed`, `llm_motif_retry`, `llm_novelty_retry`, `llm_motif_reaction` (repairs of a motif or a stale line; the swaps for a reaction with `PERFECTMAN_FILLER_SILENCE=0`), `llm_debt_note`, `llm_debt_retry`, `llm_debt_stripped`, `llm_narration_stripped`, `llm_quote_retry`, `llm_quote_struck`, `llm_guard_silenced`, `llm_answer_note`. The end-of-run info logs `run script likeness` (and `scriptLikeness` inside `run llm usage`). What is scored is the actors' committed lines and their bodies' moves (walks and sits from the frame log); a guest's line is not an actor's turn and is left out.

## Switches

| Variable | Default | Off (`0`) |
|---|---|---|
| `PERFECTMAN_SCRIPT_GUARD` | on | every check on this page: length, motif, novelty, debt, narration, quotations, move notes, one-retry cap and the speech-only contract line (prompts change by no byte) |
| `PERFECTMAN_FILLER_SILENCE` | on | a line the guard cannot repair is swapped for "Ah.", "Hm." and the like, as before |
| `PERFECTMAN_GUARD_LOG` | on | no `guard-log.jsonl` |
| `PERFECTMAN_SCENE_SPINE` | on | the scene spine |

## What this does not show

- No real model ran. The retry loop, the notes and the spine are tested with scripted answers and a local HTTP stand-in; nothing here measures whether deepseek-v4.1-flash obeys a 22-word cap, keeps its actions out of `visibleContent`, quotes only what was said or reacts first to a reveal when told to. The lines of run 60 that the old guard replaced with a filler are not on disk (the transcript keeps the filler), so what the new pipeline does with them is shown only on scripted candidates.
- The progress sub-score barely discriminates at the size of one beat. Real beats of 8 to 12 turns have no detected promise, accusation, reveal, act or reversal in at least 5% of cases (p5 of the rate is 0) and stretches of 11 to 12 turns without one at the 95th percentile, so a run with no arc inside 11 turns cannot be told from a real beat by this. A scene-level norm (consecutive beats joined, 30 turns or more) is the follow-up; today a long run is judged in windows of 10.
- Run 58's own transcript was not scored; see above.
- CINEMA has no corpus: a cinematic run is scored against theatre norms.
- The corpus is plays, many of them 19th-century or earlier. Modern chat differs (the repo's ordinary chat lines score 94 to 100, which is a check, not a norm).
- Motif keys are lexical. A repeated idea in new words is not a motif; a catchphrase is only caught when it is two topic words or a simile frame (the older echo guard keeps owning an actor's own tics).
