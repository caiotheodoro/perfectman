# Human-likeness baseline: runs 55 to 63

Measured with `pnpm --filter @perfectman/eval humanlike` on the hotel runs 55-63 (a cast of three, cinematic mode, before the human layer). Rates are per actor-minute of the scene, counted from the first line. Runs 55 to 58 predate the addressee log (`body-frames.json` `chat` frames), so their distance and gaze rows are n/a: their lines have no known addressee. The score only counts the bands that have a number.

## Scores

| run | actors | lines | seconds | score | proxemics | gaze | turns | gesture | idle |
|---|---|---|---|---|---|---|---|---|---|
| 55 | 3 | 8 | 76 | **29.4** | 38 | 14 | 14 | 17 | 61 |
| 56 | 3 | 16 | 195 | **38.6** | 0 | n/a | 25 | 29 | 69 |
| 57 | 4 | 13 | 175 | **39.9** | 0 | n/a | 32 | 29 | 66 |
| 58 | 4 | 11 | 131 | **51.6** | 100 | n/a | 19 | 29 | 70 |
| 59 | 4 | 37 | 329 | **65.7** | 100 | 94 | 37 | 22 | 68 |
| 60 | 3 | 38 | 407 | **64.1** | 46 | 94 | 54 | 58 | 69 |
| 61 | 3 | 57 | 458 | **53.3** | 63 | 94 | 20 | 17 | 69 |
| 62 | 3 | 63 | 2712 | **64** | 100 | 62 | 31 | 58 | 69 |
| 63 | 3 | 54 | 439 | **62.4** | 63 | 92 | 28 | 58 | 74 |

## Measures

| run | median dist | in earshot | same-tile lines | stacked events | speaker gaze | listener gaze | latency p50 ms | overlap | dash-cut | typing r | gesture/line | backchannel | walks/actor-min | idle/actor-min | frozen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 55 | 0 | 100% | 2 | 2 | 0% | 0% | 8825 | 43% | 0% | -0.52 | 0% | 0% | 0 | 2.79 | 52% |
| 56 | n/a | n/a | 0 | 1 | n/a | n/a | n/a | 40% | 0% | -0.54 | 0% | n/a | 0.41 | 2.57 | 61% |
| 57 | n/a | n/a | 0 | 3 | n/a | n/a | n/a | 50% | 0% | 0.21 | 0% | n/a | 0.26 | 3.54 | 53% |
| 58 | n/a | n/a | 0 | 0 | n/a | n/a | n/a | 60% | 0% | -0.29 | 0% | n/a | 0.57 | 5.47 | 44% |
| 59 | 4 | 100% | 0 | 0 | 89% | 89% | 15452 | 31% | 0% | -0.01 | 3% | 0% | 0.36 | 3.61 | 60% |
| 60 | 2 | 86% | 0 | 2 | 86% | 86% | 8038 | 30% | 0% | 0.21 | 0% | 29% | 0.83 | 3.71 | 54% |
| 61 | 2 | 100% | 0 | 1 | 82% | 91% | 9007 | 39% | 0% | -0.07 | 0% | 0% | 0.39 | 3.26 | 61% |
| 62 | 2 | 100% | 0 | 1 | 100% | 100% | 10592 | 2% | 0% | -0.01 | 0% | 25% | 0.55 | 3.61 | 59% |
| 63 | 3 | 92% | 1 | 1 | 85% | 69% | 11978 | 0% | 0% | 0.04 | 0% | 39% | 1.91 | 6.74 | 39% |

## Bands and where they come from

Every band is a prior unless the source column says otherwise: **prior** = literature or judgement, not measured on this hotel; **corpus** = read off the cinema-norms corpus (agent E1); **runs** = measured on runs 55-63.

| band | group | lo | hi | weight | source | basis |
|---|---|---|---|---|---|---|
| lines said within earshot (5 tiles) (`distance.inEarshotShare`) | proxemics | 0.9 | 1 | 1.5 | prior | embodiment.md 5.2: say is clear to 6 tiles; a speaker farther than that is not talking to anyone |
| lines said at 1-4 tiles (`distance.conversationalShare`) | proxemics | 0.6 | 1 | 1 | prior | Hall 1966: personal and near-social bands carry most conversation |
| stacked on one tile (events per actor-hour) (`stacking.perActorHour`) | proxemics | 0 | 0.5 | 1.5 | prior | two people never stand in one place |
| speaker faces the addressee (`gaze.speakerRate`) | gaze | 0.7 | 0.95 | 1.5 | prior | Argyle & Cook 1976: speakers look at the listener about half the time; staging asks for more, a break is the exception |
| listener faces the speaker (`gaze.listenerRate`) | gaze | 0.7 | 0.95 | 1.5 | prior | Argyle & Cook 1976: listeners look about three quarters of the time |
| speaker looks away and comes back (`gaze.breakReturnRate`) | gaze | 0.05 | 0.4 | 0.75 | prior | Kendon 1967: gaze breaks at the start of a turn and returns at its end |
| median ms from a line to the reply's first key press (`latency.startTyping.p50`) | turns | 600 | 6000 | 1 | prior | Stivers 2009: about 200 ms between spoken turns; chat adds reading and a first key press, and a scene written by a model lags by its call |
| a line lands while the last one is still on screen (`overlap.rate`) | turns | 0.05 | 0.3 | 1 | prior | Heldner & Edlund 2010: overlap is common in speech; chat shows it as a line landing on a line |
| lines cut off by a dash (`interruption.rate`) | turns | 0.01 | 0.06 | 1 | corpus | cinema-norms interruptShare: screenplays p50 0 / p75 0.038-0.044, plays p50 0.017-0.033 |
| bubble time follows the length of the line (r) (`typing.lengthCorrelation`) | turns | 0.4 | 1 | 1.25 | prior | typing is proportional to what is typed |
| lines carrying a gesture (`gesture.perLine`) | gesture | 0.2 | 0.6 | 1.25 | prior | McNeill 1992: most animated speech is accompanied by gesture; a chat avatar carries fewer |
| heard lines answered by a silent signal (`backchannel.rate`) | gesture | 0.25 | 0.7 | 1.25 | prior | Yngve 1970: listeners give feedback signals through the speaker's turn |
| face changes per actor-minute (`expression.changesPerActorMin`) | gesture | 1 | 6 | 0.5 | prior | judgement: a face that never changes reads as a mask |
| walks per actor-minute (`walks.perActorMin`) | idle | 0.4 | 3 | 1 | corpus | cinema-norms actsPerMin, screenplays p25-p75 1-2.5 body acts a minute for the whole scene; a walk is one |
| idle motion per actor-minute (`idle.motionPerActorMin`) | idle | 1 | 6 | 1 | prior | judgement: posture shifts, glances, a step, while nobody speaks to the actor |
| 10 s windows with no visible change (`idle.frozenShare`) | idle | 0 | 0.3 | 1.25 | prior | judgement: people do not hold still for ten seconds |
| back-and-forth walks (jitter) per actor-hour (`idle.reversalsPerActorHour`) | idle | 0 | 4 | 0.75 | prior | pacing is fine, a loop is not |
