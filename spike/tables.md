
### Addressed reply latency, LLM profile A (med 2.5s / p95 6s), 12 agents, ~3 ambient consults/base pulse, 1000 lines/row

| variant | p50 s | p95 s | p99 s | p50<=5 | p95<=10 | arrives mid-pulse | consult wait p50/p95 s | p50 parts: wait+gen+typing+spacing s | p50/p95 w/o room spacing | LLM calls/min | unanswered |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) today: sequential PulseScheduler | 13.3 | 32.3 | 42.1 | NO | NO | 72% | 9.4 / 28.2 | 9.4+2.5+0.9+0.0 | 13.1 / 32.2 | 15 | 0 |
| (b) split c=1, focused, debounce 1500 (ADR as written) | 9.7 | 24.5 | 30.6 | NO | NO | 81% | 3.7 / 15.9 | 3.7+3.3+0.1+0.0 | 9.3 / 22.0 | 17 | 0 |
| (b) split c=3, focused, debounce 1500 (ADR as written) | 7.1 | 13.3 | 17.0 | NO | NO | 72% | 1.9 / 7.4 | 1.9+3.0+0.3+0.0 | 6.5 / 12.0 | 24 | 0 |
| (b) split c=6, focused, debounce 1500 (ADR as written) | 6.4 | 11.6 | 15.2 | NO | NO | 69% | 1.5 / 5.8 | 1.5+2.9+0.4+0.0 | 5.9 / 10.2 | 27 | 0 |
| (b') split c=1, debounce 0 | 8.4 | 23.8 | 34.9 | NO | NO | 81% | 3.3 / 15.1 | 3.3+2.9+0.4+0.0 | 7.6 / 21.0 | 17 | 0 |
| (b') split c=3, debounce 0 | 6.1 | 13.6 | 19.2 | NO | NO | 73% | 1.5 / 7.6 | 1.5+2.6+0.8+0.0 | 5.3 / 12.3 | 23 | 0 |
| (b') split c=6, debounce 0 | 5.8 | 11.5 | 14.3 | NO | NO | 70% | 1.1 / 5.3 | 1.1+2.8+0.7+0.0 | 5.1 / 9.7 | 26 | 0 |
| (b') split c=3, debounce 500 | 6.4 | 13.7 | 19.5 | NO | NO | 71% | 1.5 / 6.9 | 1.5+2.8+0.5+0.0 | 5.8 / 12.3 | 23 | 0 |
| (b'') split c=3, debounce 0, early-commit addressed | 6.0 | 12.4 | 18.7 | NO | NO | 73% | 1.5 / 7.6 | 1.5+2.4+1.0+0.0 | 5.3 / 11.5 | 23 | 0 |
| (c) split c=3, debounce 0, parallel focus lane + per-agent locks | 4.3 | 11.6 | 16.5 | yes | NO | 75% | 0.0 / 6.2 | 0.0+2.5+0.8+0.0 | 4.0 / 10.0 | 27 | 0 |
| (c) split c=3, debounce 1500, parallel focus lane + per-agent locks | 5.5 | 11.6 | 16.1 | NO | NO | 75% | 1.5 / 6.2 | 1.5+2.5+0.9+0.0 | 5.5 / 10.5 | 27 | 0 |
| (d) split c=1, debounce 0, parallel lane + locks + commit-as-complete | 6.6 | 17.1 | 27.5 | NO | NO | 86% | 2.4 / 13.5 | 2.4+2.5+0.9+0.0 | 6.3 / 16.7 | 18 | 0 |
| (d) split c=3, debounce 0, parallel lane + locks + commit-as-complete | 4.0 | 9.6 | 12.9 | yes | yes | 74% | 0.0 / 4.4 | 0.0+2.5+0.9+0.0 | 4.0 / 9.0 | 27 | 0 |
| (d) split c=6, debounce 0, parallel lane + locks + commit-as-complete | 4.0 | 9.1 | 11.9 | yes | yes | 73% | 0.0 / 3.3 | 0.0+2.4+1.0+0.0 | 4.0 / 7.7 | 32 | 0 |
| (d) split c=3, debounce 300, parallel lane + locks + commit-as-complete | 4.3 | 9.9 | 13.0 | yes | yes | 74% | 0.3 / 4.4 | 0.3+2.5+1.0+0.0 | 4.3 / 8.6 | 27 | 0 |
| (b') split c=3, debounce 0, generateDeadline 8 s (ADR fallback 1) | 6.2 | 14.5 | 24.5 | NO | NO | 72% | 1.4 / 8.2 | 1.4+2.8+0.7+0.0 | 5.5 / 12.6 | 23 | 0 |

### Addressed reply latency, LLM profile B (med 4s / p95 10s), 12 agents, ~3 ambient consults/base pulse, 1000 lines/row

| variant | p50 s | p95 s | p99 s | p50<=5 | p95<=10 | arrives mid-pulse | consult wait p50/p95 s | p50 parts: wait+gen+typing+spacing s | p50/p95 w/o room spacing | LLM calls/min | unanswered |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) today: sequential PulseScheduler | 21.0 | 55.8 | 89.7 | NO | NO | 80% | 15.5 / 51.6 | 15.5+3.9+0.0+0.0 | 21.0 / 57.3 | 10 | 1 |
| (b) split c=1, focused, debounce 1500 (ADR as written) | 17.0 | 44.7 | 55.9 | NO | NO | 88% | 7.1 / 29.9 | 7.1+6.2+0.0+0.1 | 15.7 / 43.3 | 12 | 0 |
| (b) split c=3, focused, debounce 1500 (ADR as written) | 10.2 | 21.4 | 32.8 | NO | NO | 85% | 3.5 / 12.1 | 3.5+4.8+0.0+0.0 | 9.7 / 18.1 | 17 | 0 |
| (b) split c=6, focused, debounce 1500 (ADR as written) | 9.1 | 18.6 | 24.6 | NO | NO | 80% | 2.7 / 9.4 | 2.7+4.9+0.0+0.0 | 8.3 / 16.8 | 19 | 0 |
| (b') split c=1, debounce 0 | 15.9 | 48.4 | 68.2 | NO | NO | 90% | 7.6 / 31.6 | 7.6+5.4+0.0+0.0 | 14.6 / 41.8 | 12 | 0 |
| (b') split c=3, debounce 0 | 9.2 | 22.3 | 28.1 | NO | NO | 82% | 3.0 / 12.8 | 3.0+4.7+0.0+0.0 | 8.7 / 18.3 | 16 | 0 |
| (b') split c=6, debounce 0 | 8.9 | 18.9 | 25.6 | NO | NO | 80% | 2.6 / 9.9 | 2.6+4.7+0.0+0.0 | 8.1 / 17.8 | 18 | 0 |
| (b') split c=3, debounce 500 | 9.9 | 21.9 | 33.7 | NO | NO | 83% | 3.4 / 13.3 | 3.4+4.8+0.0+0.0 | 8.9 / 20.2 | 16 | 0 |
| (b'') split c=3, debounce 0, early-commit addressed | 8.5 | 19.7 | 24.0 | NO | NO | 82% | 2.9 / 11.8 | 2.9+4.0+0.0+0.0 | 8.0 / 17.6 | 16 | 0 |
| (c) split c=3, debounce 0, parallel focus lane + per-agent locks | 6.6 | 18.4 | 25.4 | NO | NO | 86% | 0.5 / 11.0 | 0.5+4.1+0.0+0.0 | 6.2 / 17.2 | 20 | 0 |
| (c) split c=3, debounce 1500, parallel focus lane + per-agent locks | 7.9 | 19.0 | 29.7 | NO | NO | 86% | 1.7 / 12.1 | 1.7+3.9+0.0+0.0 | 7.4 / 17.7 | 20 | 0 |
| (d) split c=1, debounce 0, parallel lane + locks + commit-as-complete | 13.0 | 38.3 | 50.7 | NO | NO | 93% | 7.5 / 32.6 | 7.5+4.0+0.0+0.0 | 12.9 / 37.9 | 12 | 0 |
| (d) split c=3, debounce 0, parallel lane + locks + commit-as-complete | 5.9 | 14.5 | 18.8 | NO | NO | 85% | 0.0 / 7.8 | 0.0+4.1+0.0+0.0 | 5.8 / 13.7 | 20 | 0 |
| (d) split c=6, debounce 0, parallel lane + locks + commit-as-complete | 5.6 | 14.1 | 19.6 | NO | NO | 80% | 0.0 / 6.5 | 0.0+4.0+0.0+0.0 | 5.5 / 13.6 | 24 | 0 |
| (d) split c=3, debounce 300, parallel lane + locks + commit-as-complete | 6.1 | 14.9 | 21.1 | NO | NO | 84% | 0.3 / 8.3 | 0.3+4.0+0.0+0.0 | 5.6 / 13.7 | 20 | 0 |
| (b') split c=3, debounce 0, generateDeadline 8 s (ADR fallback 1) | 8.4 | 31.0 | 55.2 | NO | NO | 80% | 2.7 / 20.1 | 2.7+4.4+0.0+0.0 | 7.8 / 27.6 | 17 | 0 |

### Load sensitivity: profile A, 6 ambient consults per base pulse (busy room)

| variant | p50 s | p95 s | p99 s | arrives mid-pulse | consult wait p50/p95 s |
|---|---|---|---|---|---|
| (a) today: sequential PulseScheduler | 18.1 | 46.2 | 64.2 | 79% | 14.0 / 40.9 |
| (b) split c=3, focused, debounce 1500 (ADR as written) | 9.4 | 21.4 | 30.6 | 80% | 3.2 / 11.9 |
| (b') split c=3, debounce 0 | 8.2 | 20.6 | 26.5 | 80% | 2.5 / 11.7 |
| (c) split c=3, debounce 0, parallel focus lane + per-agent locks | 6.6 | 17.5 | 24.9 | 86% | 1.2 / 10.8 |
| (d) split c=3, debounce 0, parallel lane + locks + commit-as-complete | 4.6 | 13.2 | 17.9 | 82% | 0.0 / 7.7 |

### Dog-pile rate (>=2 agents answer one unaddressed human line), 1000 lines/cell

| LLM profile | variant | arbiter | dog-pile rate | mean answers/line | lines with 0 answers | gate-blocked calls per line |
|---|---|---|---|---|---|---|
| A | seq (today) | none | 12.2% | 0.87 | 26% | 0.00 |
| A | seq (today) | adr | 9.6% | 0.86 | 24% | 0.04 |
| A | seq (today) | one | 0.0% | 0.84 | 16% | 0.00 |
| A | seq (today) | claim | 0.0% | 0.84 | 16% | 0.00 |
| A | split c=1 | none | 46.1% | 1.54 | 24% | 0.00 |
| A | split c=1 | adr | 27.3% | 0.96 | 39% | 0.57 |
| A | split c=1 | one | 0.0% | 0.77 | 23% | 0.82 |
| A | split c=1 | claim | 0.0% | 0.69 | 31% | 0.00 |
| A | split c=3 | none | 57.5% | 1.88 | 10% | 0.00 |
| A | split c=3 | adr | 34.8% | 1.17 | 28% | 0.69 |
| A | split c=3 | one | 0.0% | 0.90 | 10% | 0.97 |
| A | split c=3 | claim | 0.0% | 0.84 | 16% | 0.00 |
| A | split c=6 | none | 56.6% | 1.92 | 10% | 0.00 |
| A | split c=6 | adr | 45.0% | 1.40 | 22% | 0.58 |
| A | split c=6 | one | 0.0% | 0.90 | 11% | 1.02 |
| A | split c=6 | claim | 0.0% | 0.87 | 13% | 0.00 |
| B | seq (today) | none | 5.4% | 0.67 | 39% | 0.00 |
| B | seq (today) | adr | 4.6% | 0.67 | 38% | 0.02 |
| B | seq (today) | one | 0.0% | 0.71 | 29% | 0.00 |
| B | seq (today) | claim | 0.0% | 0.71 | 29% | 0.00 |
| B | split c=1 | none | 34.1% | 1.12 | 45% | 0.00 |
| B | split c=1 | adr | 21.1% | 0.72 | 55% | 0.40 |
| B | split c=1 | one | 0.0% | 0.56 | 44% | 0.58 |
| B | split c=1 | claim | 0.0% | 0.55 | 45% | 0.00 |
| B | split c=3 | none | 48.6% | 1.63 | 20% | 0.00 |
| B | split c=3 | adr | 29.2% | 1.04 | 34% | 0.60 |
| B | split c=3 | one | 0.0% | 0.82 | 18% | 0.85 |
| B | split c=3 | claim | 0.0% | 0.72 | 28% | 0.00 |
| B | split c=6 | none | 57.4% | 1.89 | 11% | 0.00 |
| B | split c=6 | adr | 35.1% | 1.18 | 28% | 0.71 |
| B | split c=6 | one | 0.0% | 0.92 | 9% | 1.01 |
| B | split c=6 | claim | 0.0% | 0.80 | 20% | 0.00 |

### Dog-pile sensitivity to priors (profile A): qSee = P(consult on an open line), pFresh/pAnswered = P(speak | no/some answer visible)

| qSee | pFresh/pAnswered | variant | arbiter | dog-pile rate |
|---|---|---|---|---|
| 0.15 | 0.5/0.1 | seq (today) | none | 3.4% |
| 0.15 | 0.5/0.1 | seq (today) | one | 0.0% |
| 0.15 | 0.5/0.1 | split c=3 | none | 18.0% |
| 0.15 | 0.5/0.1 | split c=3 | one | 0.0% |
| 0.35 | 0.5/0.1 | seq (today) | none | 12.2% |
| 0.35 | 0.5/0.1 | seq (today) | one | 0.0% |
| 0.35 | 0.5/0.1 | split c=3 | none | 57.5% |
| 0.35 | 0.5/0.1 | split c=3 | one | 0.0% |
| 0.35 | 0.8/0.3 | seq (today) | none | 35.6% |
| 0.35 | 0.8/0.3 | seq (today) | one | 0.0% |
| 0.35 | 0.8/0.3 | split c=3 | none | 83.4% |
| 0.35 | 0.8/0.3 | split c=3 | one | 0.0% |
| 0.6 | 0.5/0.1 | seq (today) | none | 15.1% |
| 0.6 | 0.5/0.1 | seq (today) | one | 0.0% |
| 0.6 | 0.5/0.1 | split c=3 | none | 72.3% |
| 0.6 | 0.5/0.1 | split c=3 | one | 0.0% |

### Recommended variant (d) c=3, debounce 0: base interval sweep and no-arbiter ambient chatter, profile A

| base interval s | arbiter | p50 s | p95 s | p99 s | LLM calls/min | consult wait p50/p95 s |
|---|---|---|---|---|---|---|
| 4 | one | 4.2 | 9.8 | 13.7 | 29 | 0.0 / 4.3 |
| 5 | one | 4.0 | 9.6 | 12.9 | 27 | 0.0 / 4.4 |
| 6 | one | 4.0 | 9.6 | 13.1 | 25 | 0.0 / 4.4 |
| 8 | one | 4.0 | 9.7 | 12.7 | 23 | 0.0 / 4.2 |
| 5 | none | 6.2 | 14.2 | 18.2 | 27 | 0.0 / 4.3 |

### Event-loop blocking (virtual-time runs, real CPU: real runEngineStep, in-memory repos, no I/O)

| variant | per-instant busy p99 ms | worst single block ms | monitorEventLoopDelay max ms |
|---|---|---|---|
| (a) today: sequential PulseScheduler | 0.5 | 1.9 | 5.8 |
| (b) split c=3, focused, debounce 1500 (ADR as written) | 1.6 | 9.6 | 12.7 |
| (b) split c=6, focused, debounce 1500 (ADR as written) | 0.8 | 4.5 | 6.8 |
| (d) split c=3, debounce 0, parallel lane + locks + commit-as-complete | 1.0 | 3.1 | 6.8 |
