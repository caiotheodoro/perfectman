# Observability Stream: Event Volume & Receiver Memory Bounds (SC-005)

The delivery-gateway operator stream is the single observability contract of the
simulation (FR-003). This document records the per-agent-per-pulse event volume the
enriched stream adds (issue #91), the memory bound of stream-fed receivers that
accumulate frames (like `HtmlSnapshotGateway`), and the provider-agnostic shape of
the stream (FR-006).

## Per-Agent-Per-Pulse Event Volume

For every pulse, the scheduler emits, per agent, through the existing
best-effort `emitOperatorEvent` channel:

| Event | When | Count per agent per pulse |
| ----- | ---- | ------------------------- |
| `agent_state_snapshot` | every agent, every pulse (all three persist paths — no-LLM fall-through, provider-null, resolver-null) | exactly 1 |
| `action_intent` | only agents whose intent entered resolution (post-resolve; includes truthful fallback `no_op` intents) | 0 or 1 |
| `event_visibility` | once per **committed** event (all event types), so 1 for a `no_op_recorded`, 1-2 for a `message_sent`/`reply_sent`, 2 for a `channel_created` + `agent_invited` pair | 0..n, where n = events committed by that agent in the pulse |
| `pulse_metrics` | pre-existing; 1 per LLM call (usage/latency/tokens) | 0 or 1 (LLM-called agents only) |
| `scheduler_error`, `llm_failure`, `intent_blocked`, `intent_delayed`, `stagnation_warning` | pre-existing; only on the corresponding conditions | 0..n (rare) |

Operator events never enter LLM context — the payload is delivered to gateways
only, so the added volume has no token cost. All new payloads are additive:
existing consumers (stdout lines, mock capture, projections, recorder frames)
are unaffected.

### 4-Persona × 15-Pulse Bound

The e2e 4-persona scenario (Ana, Bruno, Carla, Diego; 15 pulses) stays within:

- **~60 `agent_state_snapshot`** events (4 agents × 15 pulses, exactly 1 per agent per pulse)
- **≤ ~60 `action_intent`** events (LLM-called agents only; uncalled agents emit none)
- **~60–120 `event_visibility`** events (committed events per pulse: 1–3 per acting agent;
  engine `no_op_recorded` plus message/reply/channel events)
- plus the pre-existing `pulse_metrics` per LLM call (≤ ~60)

Payloads stay bounded per the spec's current-state-only framing: snapshots carry
the full serialized `AgentState` (including `memories` — bounded by the engine's
memory lifecycle — and no history/deltas); `action_intent` carries the five
FR-002 fields verbatim; `event_visibility` carries id/type/actor/channel/
`visibleToAgents` plus content/channelName where present.

## Goal-Layer Event Volume (per Review)

With `goalLayer.enabled`, the world review — every `reviewEveryPulses`
pulses, pulse 0 exempt — adds goal-layer events to the stream through the
same `sendOperatorEvent` channel:

| Event | When | Count |
| ----- | ---- | ----- |
| `world_verdict` | every active goal, one per goal in the evaluator's verdict loop | exactly 1 per active goal per review |
| `delusion_gap_sampled` | same loop, one sample per goal after its verdict | exactly 1 per active goal per review |
| `goal_proposed` | synthesis intervals only (`pulseIndex % intervalPulses === 0`); per agent, candidates capped at `maxCandidatesPerReview`, reviewer-recommended only, absent from the registry already | `0..maxCandidatesPerReview` per agent |
| `goal_accepted` | pending proposals decided at review N+1, accepted branch | 0..1 per pending proposal |
| `goal_declined` | same acceptance loop, declined branch | 0..1 per pending proposal |
| `ending_offered` | ending gate; the registry's single-offer invariant refuses later claims | 0..1 per run |

So the "≤1 goal event per goal per review" contract holds strictly for
`world_verdict` and `delusion_gap_sampled` — precisely 1 each per active
goal per review. Proposal/accepted/declined are per-proposal, and
`ending_offered` is run-level. `simulation_stopped` is **not** an operator
event: its `endReason`/`endingOffer` ride the delivery callback
`onSimulationStopped(simulationId, endReason?, endingOffer?)` (D-24).

The goal end-to-end suite pins the review counts against the committed log
(`reviewEveryPulses = 1`): verdict and gap counts are equal with identical
pulse indexes, consecutive verdict pulses are contiguous, and the ending
offer lands on the review of the final verdict — the deterministic arc
accepts, verdicts, and ends on the acceptance review, so that review
carries exactly 1 verdict and 1 gap for the goal.

Every goal-layer event is state-only: its payload carries its own transition
(proposal, verdict replace, one gap sample, ending), never a replay of
earlier history. A stream-fed receiver keeps one `GoalPanel` entry per goal
(constant fields) plus at most one gap sample per review per goal, so
receiver memory stays linear in reviews × active goals — the same class as
the per-pulse frame bound below.

## Receiver Memory Bound

Stream-fed receivers that accumulate per-pulse frames (the `HtmlSnapshotGateway`
pattern, like the e2e recorder before it) hold, at most:

```
memory ≈ pulseCount × (per-frame events + serialized agent states + thinking + operator events)
```

A frame (`PulseFrame`) contains: `committedEvents` (rebuilt rows from
`event_visibility`), `agentStates` (one serialized state per agent),
`agentThinking` (one row per called agent), `operatorEvents` (the pulse's
operator events), and the D-9 approximation of `PulseResult`. In the
4-persona × 15-pulse scenario this is ~15 frames ≈ tens of KB per frame
(dominated by the serialized states), i.e. well under 1 MB per run.

The receiver's memory grows linearly with pulse count, not with wall-clock
time: a long run accumulates frames for every pulse from start to stop.
Receivers must flush on the `simulation_stopped` signal (partial frames
included — `HtmlSnapshotGateway` renders whatever has been delivered on
`onSimulationStopped`). No history or cross-pulse aggregation is retained.

## Provider-Agnostic Shape (FR-006)

The stream shape is identical for every `providerType` — `mock`, `ollama`,
`openai-compatible` — because all payloads are built in the scheduler from
shared types (`packages/shared/src/operator/operator.types.ts`), with zero
changes to the SDK transport or the LLM provider layer. A receiver consuming
`agent_state_snapshot` / `action_intent` / `event_visibility` + construction
metadata produces the same artifact for a hosted-provider run as for a mock
run (SC-003); only the thinking content itself reflects the real model.