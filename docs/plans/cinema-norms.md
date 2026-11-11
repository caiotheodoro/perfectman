# Cinema norms

What a "cinematic" scene looks like in numbers, so a run can be scored against it. Built from a wide, publicly reachable corpus of plays, film screenplays, TV transcripts and subtitle files in pt-BR and English. Complements `script-likeness.md` (which is dialogue against 45 plays) by adding the axes it lacked: a time axis, silence, interruption, direction rate, reversals, an escalation curve, and when the inciting beat and the climax fall.

The norms are advisory and uncalibrated against human grades, exactly like script-likeness. The conflict-intensity curve is a proxy (see Reliability). Use the bucket and the confidence the file reports, and read the caveats.

## What is committed, what is not

Committed: the code (`packages/kb/src/cinema`, `packages/shared/src/cinema-norms`), `packages/shared/src/cinema-norms/cinema-norms.json` (+ `.generated.ts`, pinned equal by a test), `packages/kb/cinema-sources.json` (provenance, no text), tests and this page. Not committed, ever: raw text, cue files, per-scene features, vectors. They live in gitignored `packages/kb/corpus/` and `packages/kb/index/`. The owner authorised copyrighted material for local analysis and local embeddings; nothing of it is in git, and a test checks that no five-word run of the (invented) scenes it is built from reaches the norms.

## Corpus

| Group | What | Language | n sources | n scenes |
|---|---|---|---|---|
| `moviesum` | MovieSum, XML-structured film screenplays (HF `rohitsaxena/MovieSum`, CC BY-NC 4.0 dataset card, IMSDb-derived) | en | 2,134 | 127,796 |
| `summscreen` | ForeverDreaming TV transcripts, with action lines (HF `YuanPJ/summ_screen`) | en | 4,345 | 60,906 |
| `tms` | TVMegaSite soap-opera transcripts with scene breaks (dev, test, every 6th train episode): the melodrama set | en | 6,740 | 137,028 |
| `opus-ptbr` | OpenSubtitles v2018 raw XML, random sample, real cue times (mostly Portuguese subtitles of foreign works) | pt-BR | 2,302 | 61,003 |
| `opus-ptbr-native` | same zip, only titles that look like Brazilian originals (see Known biases) | pt-BR | 56 | 2,283 |
| `opus-en` | same, English | en | 655 | 18,162 |
| `plays` | 75 stage texts that parse (Gutenberg public domain, pt.wikisource CC BY-SA); 80 in the manifests | en 39, pt 36 | 75 | 1,684 |
| `extra` | 3 Brazilian pilot screenplays from open thesis annexes | pt-BR | 3 | 32 |

Totals: 16,298 sources, 408,894 scenes. IMDb's non-commercial `title.basics` gives title type, running time and genres (genre buckets, film vs series, a span-vs-runtime sanity check that dropped 73 subtitle files). Provenance, terms, fetch dates and what was tried and not used (Funarte's Plínio Marcos volumes: host did not resolve; Nelson Rodrigues: no free full text; script sites: not crawled because MovieSum already carries IMSDb screenplays; two university hosts with TLS failures: not bypassed) is in `packages/kb/cinema-sources.json`. Subtitle files are read from OPUS's object storage by HTTP range requests from the zip, 0.15 s apart, not from the paths its `robots.txt` disallows.

## Features

One implementation, `measureScene` in `@perfectman/shared`, measures a corpus scene and a run alike. A scene is a list of events (`speech` with speaker and text, `direction`), optionally timed.

- Turn length: words per turn (p50, p90), share of replies of 5 words or fewer, of 2 or fewer, of more than 25; bins.
- Interruption and pauses: turns cut off by a dash, turns that trail off, turns that are only dots, written pause markers per 100 turns. Timed sources: overlap share, back-to-back share (under 0.25 s), silence share of the span, gaps over 2 s per minute, median and longest gap, words per second.
- Direction rate: directions per turn and per minute, body acts per minute, hard physical acts (strike, shove, grab, kill, collapse, kiss, embrace), dialogue share of words, turns between directions.
- Arc: a 0-1 conflict-intensity series (hostile words, shouting with `!`, cut-off lines, hard acts), smoothed; ten-slice curve over normalised scene time; peak and opening level; inciting beat (first 40% of the rise); climax (peak, centre of a plateau); aftermath (time after intensity last holds 70% of its rise); reversals (turning points with a swing of 0.12+); role flip (who asks and who answers swaps between first and last third); reveals, accusations, commitments (the script-likeness lexicons); events per 10 turns; longest quiet stretch.
- Time: real cue times (subtitles), a film's running time shared out by text weight (screenplays), or a reading-rate estimate (plays, TV). A run with timestamps uses `timeSource: "clock"`.

## Buckets

`${lang}/${medium}/${form}`, where a genre is known `/${genre}`, and for Portuguese subtitles of Brazilian originals `/native`. Mediums: stage, film, series. Forms: play, screenplay, transcript, subtitle. Genres: drama (family drama), melodrama (soaps), thriller (thriller, crime, mystery, horror, action, war, western), comedy. 34 buckets (the 32 above plus `pt/film/subtitle/native` and `pt/series/subtitle/native`). Each carries n (scenes, sources, turns), a confidence (`high` 300+ scenes of 8+ turns from 25+ sources), caveats, ladders (p5..p95) for every feature, size strata (8-19, 20-39, 40+ turns) for count-like features, curves (absolute and rescaled), pooled turn-length shares, whole-source ladders (scene minutes, scenes per 10 minutes, turns per minute, talk share, long gaps), `strongArc` ladders and `roleFlipShare`. Only scenes with 8+ turns enter the ladders.

## Key numbers (scene medians; see the file for ladders)

| | turns/min | short replies (5 words or fewer) | silence share | interrupted turns | directions/min | hard acts/scene | reversals | inciting | climax | aftermath |
|---|---|---|---|---|---|---|---|---|---|---|
| en film screenplay | 9.9 | 0.40 | n/a | 0 (p90 0.11) | 3.8 | 0 (p90 2) | 1 (p90 4) | 0.35 | 0.58 | 0.29 |
| en series transcript | 11.3 | 0.33 | n/a | 0 (p90 0.08) | see children | 0 (p90 1) | 0 (p90 2) | 0.32 | 0.56 | 0.31 |
| en stage play | 7.2 | 0.25 | n/a | 0.02 | 1.9 | 0 (p90 1) | 3 (p90 7) | 0.18 | 0.50 | 0.27 |
| pt stage play | 11.2 | 0.42 | n/a | 0 | 3.1 | 0 (p90 1) | 1 (p90 5) | 0.21 | 0.56 | 0.26 |
| pt film subtitles | 16.5 | 0.56 (0.45 corrected) | 0.30 | n/a | n/a | n/a | 0 | 0.29 | 0.52 | 0.33 |
| pt series subtitles | 18.0 | 0.51 (0.38 corrected) | 0.24 | n/a | n/a | n/a | 0 | 0.26 | 0.51 | 0.34 |

Inciting, climax and aftermath are over scenes with an arc; for the strong-arc scenes (the trustworthy ones) the climax medians are 0.58 (en film), 0.58 (en series), 0.53 (en stage), 0.61 (pt stage), 0.58 (pt film subtitles) of scene time, the inciting beat 0.20-0.33, and strong-arc scenes carry 2 reversals at the median (3 to 4 on stage). Typical scene length: 1.2 minutes in a film screenplay (6.5 scenes per 10 minutes), 1.0 minute in pt-BR film subtitles, 2.0 minutes in pt-BR series subtitles, 8 minutes for a stage scene window. pt-BR film subtitles hold someone talking 45% of the time, series 64%; a gap over 5 s comes about once a minute, over 12 s every 2 minutes in films.

## Reliability

Honest list, not a certificate.

1. Hand-check (one reader, the builder, not independent). Round 1, 34 scenes, found and fixed: a speaker name cut at a title's full stop and read as shouting, kisses and embraces read as conflict, plateau ties resolved to the last point, page furniture and watermarks in screenplay directions, subtitle scenes of 200+ turns, stage directions glued to speech. Round 2, 38 fresh scenes after the fixes (6 per form; first 34 events of each): segmentation plausible in 35, failed in 3 (a garbled shooting script, two transcripts with no scene marks, now capped at 120 turns); an arc was found in 35 scenes and the climax was plausible in 21 (60%); in the 18 strong-arc scenes (peak 0.3+, rise 0.15+) it was plausible in 16 (89%); 5 of 5 flat scenes were correctly left without an arc. Defects seen in round 2 and fixed: camera "SHOT" read as a gunshot, shooting scripts with scene numbers as cues dropped (3.8% of scenes), long transcripts capped. So: read `tInciting`, `tClimax`, `aftermathShare` from `strongArc.ladders`.
2. Against the existing model-tagged beats of the 45 plays (1,924 beats; `action_type` labels are about 97% exact, emotion 65%): beats tagged with a violent action outscore dialogue-only beats on the intensity proxy with AUC 0.85; beats tagged with a hot emotion (anger, contempt, fear, jealousy) only reach AUC 0.56 (en 0.58, pt 0.53), so the proxy sees open hostility and physical acts and is near-blind to cold, afraid or restrained conflict. The hard-act lexicon has precision 0.72 and recall 0.56 against the tagged physical-action label (tenderness and retreats counted).
3. Estimator checks: the reading-rate estimate of a subtitle scene's seconds is 0.74 of the real seconds at the median (p25 0.58, p75 0.91, 79k scenes), as expected since subtitles hold speech only; a film's running time is 0.88 of its screenplay's estimate (p25 0.78, p75 1.02, 2,154 films), so action lines are not as long on screen as the model says.
4. Tactic and emotion labels from the older tagger (about 40% exact on tactic) are not used by the cinema norms at all.

## Known biases

- The pt-BR subtitles are mostly Portuguese translations of foreign (largely American) films and series, so their rhythm is Brazilian subtitling of someone else's script. Native Brazilian dialogue is the `/native` buckets: IMDb's open files carry no country of origin, so "native" is a heuristic (original title in Portuguese and a Brazil release row; Portuguese originals released in Brazil also pass). Only 56 such titles were read (a second, larger draw stalled against the host), 51 films in `pt/film/subtitle/native` (2,134 scenes: median silence 0.27, replies of 5 words or fewer 0.50, back-to-back share 0.50, 16.4 turns per minute, trailing-off turns p90 0.13) and 5 series (low confidence). Use them as the pt-BR rhythm reference when you trust them more than the translated pool; they agree with it closely.
- No pt-BR text with action lines at scale. pt-BR structure and action numbers are borrowed from English screenplays and transcripts (and cross-checked with 36 Brazilian stage texts); 32 scenes from 3 Brazilian pilots are too few to bucket. No pt-BR telenovela text was publicly reachable, so melodrama is soap-opera English only.
- Subtitle cues are shorter than spoken turns (an English film's subtitle replies of 5 words or fewer: 0.51, its screenplay: 0.40; median words per turn 5 against 7). `calibration.subtitleCueBias.*` and `ptAdjusted.*` apply the English gap to the Portuguese figures. Subtitles also lack action lines, so their intensity peaks are about half as high and strong arcs are 8-15% of scenes against 47% in screenplays.
- Stage scenes are old (pre-1930), translated or archaic, cut into windows of about 60 turns where the source had no usable scene breaks, and few: 39 English and 36 Portuguese texts, so every stage bucket's sources are authors' styles. Genres are my hand assignment, one reading each.
- Scene cuts are heuristic in every source (sluglines, place/time cues, 12 s silences, windows). Scene length in screenplays assumes uniform pace within a film.
- Films are IMSDb-skewed: Hollywood, many pre-2000. Series are US network drama, comedy and soap. Subtitle files are whatever OpenSubtitles users uploaded: dubbed fan subs, uneven quality, some English subtitles with Title Case lines; titles were not filtered for original language, so pt-BR subtitles of dubbed Anglophone shows are included (language here is the dialogue, not the film's origin).
- Reversals and the intensity curve depend on one smoothing and one swing threshold chosen by me and not tuned on any outcome.

## What the scorer imports

From `@perfectman/shared`: `CINEMA_NORMS`, `pickCinemaBucket(norms, { lang, genre?, forms?, mediums?, minConfidence?, fallbackLang? })`, `cinemaLadder(bucket, feature, turns?)` (size-stratified), `ladderRank`, `inLadderBand`, `curveFit(curve, band)`, `resampleCurve`, `cinemaBucketKey`, `cinemaSizeStratum`, and `measureScene` with the scene types (`CineScene`, `CineEvent`, `SourceInfo`, `SceneFeatures`) to measure a run the same way the corpus was measured: build `CineScene.events` from the run's chat lines and acts with millisecond timestamps (speech `t0`/`t1` in seconds, directions `t0`) and `SourceInfo.timeSource: "clock"`. Existing `SCRIPT_NORMS` and its API are untouched.

## Rebuild

See the "Cinema norms" section of `packages/kb/README.md`. A full rebuild over the local corpus takes about 8 minutes; the norms are deterministic for a given feature file.
