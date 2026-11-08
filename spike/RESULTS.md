# Phase 1 lane C: pulse latency spike (ADR-0020 / ADR-0021)

Question: with 12 agents, can the hotel meet timing rule 1 (addressed reply p50 <= 5 s, p95 <= 10 s after the human line) and keep dog-pile <= 5%, with (a) today's sequential `PulseScheduler` or (b) the decide/generate/commit split + focused pulse of ADR-0020?

Throwaway prototype on branch `spike/pulse-latency`. Nothing under `packages/*/src` was changed. Reproduce: `node node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs --config spike/vite.config.mjs spike/run.ts` (about 70 s; writes `spike/tables.md`, `spike/results.json`).

## Verdict

1. **The ADR-0020 split alone is not enough.** As written (c=3, focused pulse queued behind the in-flight pulse, 1.5 s trailing debounce) addressed replies land at p50 7.1 s / p95 13.3 s on the fast profile and 10.2 / 21.4 s on the slow one. Both targets are missed at every concurrency (c=6: 6.4 / 11.6 s). Today's loop is far worse: 13.3 / 32.3 s.
2. **What is needed on top of the split** (all three, measured one by one in the tables below):
   - the focused pulse must not queue behind the base pulse: a separate focus lane gated by per-agent locks (the ADR's last-resort option, "per-agent locking", has to be the default);
   - tasks commit as their generate call settles (so a base pulse's slowest call neither holds the addressed agent's lock nor delays its commit), not in one turn-ordered phase C;
   - no 1.5 s trailing debounce on addressed lines: with typing starting at `onConsult`, the reply already costs about 3.7 s of typing floor, so a 1.5 s debounce alone is the whole p50 slack. Fire on the first addressed line and coalesce for at most 300 ms.
3. With those, **c=3 meets both targets on the fast profile at about 3 consults per pulse (p50 4.0 s, p95 9.6 s, p99 12.9 s)**. c=6 buys 0.5 s of p95 for about 5 more LLM calls/min. c=1 fails (6.6 / 17.1 s). **Default concurrency 3** with 1 slot reserved for addressed.
4. **On the slow profile (median 4 s, p95 10 s) p95 <= 10 s cannot be met by any scheduling**: the model's own p95 is already 10 s. Best case is p50 5.6-5.9 s / p95 14.1-14.5 s. That needs a model/latency decision (faster model for addressed replies, hedged second request, or a relaxed target), not a scheduler change.
5. **Dog-pile: the arbiter is mandatory once the split lands, and ADR-0021's rules as I read them are not enough.** Without an arbiter, today's sequential loop is at 12% (fast profile; its same-pulse `worldSignals` damper) and the split is at 46-58% for every c. The ADR-0021 rules taken literally (`not_addressed_open_line` only applies when a human line still has unanswered addressees; `line_budget` allows 3 lines) still leave 27-45% on the split. A gate rule "one answer per unaddressed human line" brings it to 0% at c=1, 3 and 6. Timing rule 2 needs that rule written down and owned by the arbiter.
6. The split raises LLM load: 23-27 calls/min against 15 today (fast profile, same ~3 consults per base pulse), because the base pulse now runs every 5 s instead of every ~15 s. The gate-only arbiter also wastes about 1 call per unaddressed line at c >= 3 (calls whose answer is then blocked); a claim token at preview time removes that waste at the price of more silent lines.
7. Event-loop lag is not a constraint at 12 agents: worst single synchronous block 1.9-9.6 ms with the real `runEngineStep`, in-memory repos and no I/O (no run above 10 ms).

## Setup

- **Real code**: the unmodified `PulseScheduler` (variant a), the real `runEngineStep`, in-memory event/state/channel repos, real `IntentResolver`, `RateLimitGate`, projections. `spike/split-scheduler.ts` is a minimal fork of `pulse-scheduler.ts` implementing ADR-0020 (phases A/B/C, `runPulse(opts)`, one-slot queue with id union, `onConsult`, `generateDeadlineMs`, `pulseIndex` not advanced by focused pulses). Stagnation and goal review are omitted from the fork.
- **Mock model**: `generateIntent` sleeps for a lognormal draw (profile A: median 2.5 s / p95 6 s; profile B: median 4 s / p95 10 s) and returns a `send_message` or `no_op`. No key, no tokens.
- **Clock**: discrete-event virtual clock for the matrix (sleeps are free, all CPU work is real); a real-time validation run is at the end. 12 agents, base pulse every 5 s (sequential: 5 s after the previous pulse ends, as `start()` does today; split: fixed cadence, overruns skip beats).
- **What the engine decides is injected, not simulated**: `needsLLM` per agent per base pulse is drawn so that about 3 of 12 agents are consulted (ADR-0020's own example); the addressee is always consulted when it evaluates the line; for an unaddressed line each in-band agent consults with probability 0.35 (the "qSee" prior) and then speaks with probability 0.5, or 0.1 when an answer is already visible in the snapshot it was built from. Ambient consults speak with probability 0.5. The real `runEngineStep` runs for CPU realism but its decision is overridden.
- **Landing time**: typing starts at `onConsult`/call start; line lands at `max(commit, consultAt + min(4000, U[0.5,2] s persona delay + 55 ms x chars))`, chars lognormal with median 45 (so the typing floor has a median near 3.7 s); then the gateway per-room queue enforces >= 2.5 s between actor lines (FIFO).
- **Arbiter** (wraps the real resolver; a denial becomes `no_op`, i.e. `fallback_committed`): `none`; `adr` = ambient_too_soon (10 s) + `line_budget` (block the 4th actor line since the human line); `one` = ambient_too_soon + one answer per unaddressed human line (preview in decide, authoritative gate in the resolver); `claim` = `one` plus a claim token taken at preview so concurrent consults do not both go.
- **Injection**: Poisson arrivals, mean gap 14 s, addressee uniform over the 12 agents (addressed experiment) or nobody (dog-pile experiment). 5 seeds x 200 lines = **1000 lines per table cell** per profile. An addressed line never expires for its addressee; an unanswered line is scored as 120 s.
- Addressed-latency rows use the `one` arbiter (the hotel always has one); the `none` row near the end shows what ungoverned ambient chatter does to the room queue.

Variants: (a) today; (b) ADR-0020 as written (single in-flight pulse, focused pulse queues behind it); (b') same with the debounce changed; (b'') plus early commit of addressed tasks; (c) focused pulse on its own lane, gated by per-agent locks, addressed commit early; (d) (c) plus every task commits when its generate settles. Concurrency c is the instance-wide number of in-flight model calls, 1 slot reserved for addressed when c > 1.


## Numbers

Columns in the two latency tables: "arrives mid-pulse" = share of human lines that arrive while any pulse is in flight; "consult wait" = human line to the addressee's model call starting (this is the "waits for an in-flight pulse" cost); "p50 parts" = p50 of wait + model call to commit + extra typing floor beyond commit + room-queue spacing; "w/o room spacing" removes the gateway 2.5 s queue.

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



Read-across:

- Today (a) is dominated by waiting: 72-80% of lines arrive mid-pulse and a sequential pulse lasts about 10 s (3.3 consults x 2.9 s mean) and is followed by the 5 s gap, so the median line waits 9.4 s (fast) to 15.5 s (slow) before its model call even starts.
- (b) as written still has 67-90% of lines arriving mid-pulse and then queueing behind the whole remaining base pulse (consult wait p50 1.9 s, p95 7.4 s at c=3). Concurrency helps because it shortens that pulse (c=1 -> 6: p50 9.7 -> 6.4 s), but it cannot go to zero.
- Debounce 1500 -> 0 buys about 1 s at p50 (7.1 -> 6.1 s at c=3) and nothing at p95 (the queue wait dominates there). 500 ms costs 0.3 s at p50.
- Shortening `generateDeadlineMs` to 8 s (ADR fallback 1) does not help the median or p95 (6.2 / 14.5 s) and on the slow profile hurts (p95 31 s) because an abandoned call is a lost turn; drop it from the ladder.
- Early commit of addressed tasks alone (b'') changes little (6.0 / 12.4 s). The jump comes from the parallel focus lane (c: 4.3 / 11.6 s) and then from committing every task when it settles (d: 4.0 / 9.6 s), which is what stops an agent's lock from being held until the base pulse's slowest call returns.
- Load matters: with 6 ambient consults per base pulse (busy room) even (d) at c=3 slips to p50 4.6 s / p95 13.2 s, so p95 <= 10 s holds only while the room stays at about 3 consults per pulse or c is raised; re-measure the real consult rate (item 3 below).
- The room queue matters: with no arbiter, ambient chatter fills the 2.5 s spacing queue and (d) falls to p50 6.2 s / p95 14.2 s (table below). Addressed replies should jump the gateway queue, or ambient must be throttled by the arbiter (rule 5).

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



Notes: "gate-blocked calls" are model calls whose output the resolver gate then denied (pure cost). `claim` takes the line at preview so concurrent consults skip; it removes the waste but leaves more lines unanswered (13-31% against 10-23%; silence is valid, but check the scorecard).

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



The dog-pile numbers move a lot with the behaviour priors (the real-model measurement is the one that counts), but the ordering does not: split without an arbiter is 3-5x worse than today, and a one-answer gate gives 0% in every cell.

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


CPU only: no sqlite, no network, no frames sidecar. The worst single synchronous block (the whole awaited microtask chain of a pulse's decide phase) is under 10 ms at 12 agents for every variant.

## Real-time validation

Same harness on a real clock (`setTimeout`), profile A, 24 addressed lines each at mean gap 9 s, three processes in parallel, 345 s each. Small samples, but they line up with the virtual-time matrix:

| variant | p50 s | p95 s | p99 s | arrives mid-pulse | LLM calls/min | virtual-time p50 / p95 |
|---|---|---|---|---|---|---|
| (a) today | 11.8 | 25.9 | 39.1 | 63% | 15 | 13.3 / 32.3 |
| (b) ADR-0020 as written, c=3, debounce 1500 | 5.6 | 10.9 | 13.4 | 50% | 23 | 7.1 / 13.3 |
| (d) focus lane + locks + commit-as-complete, c=3, debounce 0 | 4.1 | 8.4 | 10.4 | 79% | 28 | 4.0 / 9.6 |

`monitorEventLoopDelay` (5 ms resolution): mean 6.1 ms, p99 6.7 ms, max 52 ms. The 52 ms max is identical across the three variants, so it is a process start artifact (module load / JIT with three processes starting at once), not pulse work.

## Recommended defaults (hotel runs, assuming the changes in verdict 2)

| setting | value | why |
|---|---|---|
| `pulseMode` | `split`, with focus lane + per-agent locks as part of the mode | (b) alone misses both targets |
| `generateConcurrency` | 3, one slot reserved for addressed | c=1 fails; c=6 only buys ~0.5 s p95 for +5 calls/min |
| base pulse interval | 6 s (range 5-8) | addressed latency is flat from 4 to 8 s once the focus lane exists; 4 s costs 29 calls/min against 23 at 8 s |
| focused-pulse debounce | fire on the first addressed line, coalesce further lines for <= 300 ms; no 1.5 s trailing debounce | 1.5 s eats the whole p50 slack because typing starts at `onConsult` |
| `generateDeadlineMs` | keep 20 s | 8 s was worse |
| commit | per task as generate settles (live mode); keep turn-order commit only for eval/replay | releases the agent lock early |
| arbiter | ADR-0021 plus an explicit "one answer per unaddressed human line" gate rule; optionally a claim token at preview | 0% dog-pile in every cell; ADR rules as written leave 27-45% |
| gateway queue | addressed replies jump ambient lines in the 2.5 s per-room queue | FIFO ambient backlog adds 2 s at p50 |

## Not modelled / re-measure with a real model before Phase 2 exit

1. **Real latency distribution**, not lognormal: time to first token vs full completion for the actual model and prompt size (12 agents, 40-event window), tail behaviour under provider rate limits (429s), cold connections, and the effect of the IntentParser repair or retry path (a parse failure doubles the call). Re-run both profiles from measured quantiles. If the real p95 is above ~6 s the p95 <= 10 s target is not reachable (verdict 4).
2. **Concurrency 3 against the real provider limits**, including several runs sharing one key (`PERFECTMAN_MAX_RUNS`): the governor, not the scheduler, may be the cap.
3. **The engine's real `needsLLM` rate** per pulse and per human line (I fixed it at about 3 per base pulse and injected the addressee). Needs the real attention scoring fed with a real human line, including how "addressed" detection reaches the engine, and whether `justActed` and cooldowns keep ambient consults near 3 per pulse at a 5-6 s cadence.
4. **Dog-pile priors** (qSee, speak-after-answer-visible): measure on the real model with the dog-pile probe; my 12% for today's loop is a prior, not a finding. Also check what the real model does when told nothing about other consults (phase A hides same-pulse commits).
5. **Typing-floor inputs**: real reply length distribution and the `presenceProfile.responseDelayMs` of the shipped personas. The 3.7 s floor is the single largest fixed term in the addressed budget.
6. **Per-agent locking correctness** (not prototyped): `agentStates` loaded at pulse start and written per agent, `lastCommittedEventId`, `currentChannelIdByAgent` and `simTime` shared across lanes, and the base pulse overwriting an agent's state with its start-of-pulse copy. The prototype only gates on a lock; the real design needs a state merge or a single writer, with tests. Also the case where the addressee is mid-call for an ambient reason (the line waits for that call, then a second call).
7. **Event loop with I/O**: the hotel gateway, frame sidecar, sqlite/artifact writes and 12 agents' memory growth over a long run. My runs are ~25 virtual minutes each and CPU only.
8. **Cost**: 23-27 calls/min against 15 today at the same consults-per-pulse; check against the LLM governor budget (ADR-0025).
9. Multi-room runs, human typing suppression (rule 4), pair acts and cinematic mode were left out.

## Files

- `spike/split-scheduler.ts`: the ADR-0020 fork (plus the spike-only focus lane, locks, commit-as-complete).
- `spike/harness.ts`, `spike/clock.ts`: world model, mock provider, arbiter, drivers, metrics, virtual and real clocks.
- `spike/run.ts` (full matrix), `spike/real.ts` (real-time validation), `spike/vite.config.mjs`.
- `spike/tables.md`, `spike/results.json`: raw output of the last matrix run.
