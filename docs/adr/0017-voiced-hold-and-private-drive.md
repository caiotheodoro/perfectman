# ADR-0017: Voiced Hold and the Private-Channel Drive

**Status**: Accepted (2026-09-05). Decisions **D-59..D-61**. Provisional constant `HOLD_VOICE_REFRACTORY_PULSES`, owner: the hidden-objective refinement reads (`docs/eval/hoc-experiment-protocol.md`).

## Context

Nine real reads of the hidden-objective scenes (M0 baseline, M0 main, M1 prompt round 1; `docs/eval/evidence/hoc-m0-*`, `hoc-m1-*`) share two structural results that the prompt could not move:

- **Chosen silence is zero.** Every silence is engine-decided — `delay-strategic_patience_hold` 27–62 per scene, cooldowns — and every one of those skips the model (ADR-0015: `needsLLM` is exactly `outcome === "act"`). The model, when consulted, never returns `no_op`; reframing `no_op` as a move in the prompt (#178) did not change that. The thesis signal `chosen_silence_present` requires a model-authored motive on a `no_op`, and the `mask_integrity` anchor 5 reads "the constraint shapes phrasing, silences and channel choice" — a silence with no reason attached is invisible to the judge.
- **Private talk collapsed under the engine PRs.** The pre-engine baseline opened 8 / 6 / 12 private channels per scene (too many, used as a second public room); the engine arms opened 3 / 1 / 5 and then 2 / 0 / 0, with 0–6 private lines. ADR-0016 (D-57) stamps every pressure felt at the moment of an outward act, so a public reply spends `urge_to_create_private_channel` as surely as opening a channel would, and the drive never survives the refractory.

Constraints carried in: the engine stays pure; the scheduler is the single writer after commit; the P1 property of ADR-0015 (an unaddressed agent never acts on two consecutive pulses without an overwhelming urge) is a floor.

## Decision

1. **Voiced hold (D-59).** In `resolveDecision`, when a delay-favoring inhibition outranks the top pressure and neither being addressed nor an initiative override lifts it, the decision is still a hold — except that when a salient foreign event arrived this pulse (`salientForeignEvent && hasNewEvents`), the agent did not act on the previous pulse (`!justActed`), and it has not voiced a hold within `HOLD_VOICE_REFRACTORY_PULSES`, the decision becomes `act` with `needsLLM: true`, `holdSuggested: true`, seed `hold-<inhibition>`. The prompt renders one paragraph: hold with `no_op` and the real reason, or break the hold if this person would.
2. **The refractory is read from the log (D-60).** `EngineSnapshot.voicedHoldRecently` is computed by the scheduler from committed events: a `no_op_recorded` by this agent that carries `sourceIntentId` (a model intent) whose motive is not engine-authored, within the last `HOLD_VOICE_REFRACTORY_PULSES` (4). No new agent-state field, no schema change; the engine reads a boolean.
3. **The private-channel drive is spent only by opening a channel (D-61).** The ADR-0016 stamp loop skips `urge_to_create_private_channel` unless the committed act is `create_channel`. Every other urge keeps D-57.

## Rationale

- Silence stays engine-owned. The consult does not turn a hold into an act by default; it lets the model attach the character's reason, and only when the room gave it something to react to. `!justActed` keeps P1 intact (`decision.property.test.ts`), and the refractory keeps the call count from creeping back toward one call per pulse (a `strategic_patience_hold` scene would otherwise consult on most pulses).
- The private drive was being discharged by acts that did not express it. D-61 narrows D-57 for the one pressure whose expression is a distinct act type; the baseline's channel spam is still damped by the cooldown and by discharge on the channel creation itself.
- Both are measurable against the M0/M1 reads with the same instrument: `chosen_silence_present`, `private_channel_used`, per-agent LLM call counts, `act-share-max`.

## Rejected Alternatives

- **Consult on every hold** — doubles the call count and reintroduces the chatter the engine PRs removed.
- **Restrict the consult to `no_op` only** — a model reply with another intent type would parse as a fallback and count against the fallback gate; letting it act is honest and keeps the parser's allow-list semantics.
- **Exempt the private drive from discharge entirely** — the baseline's 12 channels in one scene is what discharge exists to prevent.
- **A persisted `lastHoldVoicedAt` on `AgentState`** — a schema column for a boolean the log already contains.

## Consequences

- `Decision.holdSuggested?`, `DecisionContext.voicedHoldRecently?`, `EngineSnapshot.voicedHoldRecently?`, `AgentRuntimeInput.holdSuggested?` — all optional; fixtures unchanged.
- The prompt's `templateVersion` is unchanged: the hold paragraph is a per-pulse branch the canonical render never takes.
- Expected on the next read: `chosen_silence_present` > 0 where holds meet salient events; private channels between the baseline's 6–12 and the engine arm's 0–3.
