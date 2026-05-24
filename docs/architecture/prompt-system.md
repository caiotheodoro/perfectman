# Prompt System

## Why PromptPurpose Exists

`PromptPurpose` prevents the prompt layer from treating every LLM call as a full persona action-generation call.

The architecture explicitly avoids persona as one giant prompt only; see `docs/concepts/concept-map.md:1161`. It also states that attention should not always trigger an LLM call; see `docs/architecture/social-presence.md:747`. Different LLM call surfaces need different persona fields. Writing guidance is valid for visible agent speech, but it is noise for reasoning-only interpretation, reflection, and recap surfaces.

## PromptPurpose Values

| Purpose | Description | V1 status |
| --- | --- | --- |
| `action_intent` | Builds the existing full persona prompt for choosing an action intent and optional visible chat text. | Active |
| `social_interpretation` | Reserved for interpreting tone, ambiguity, sarcasm, passive aggression, and plausible motive. | Reserved |
| `background_reflection` | Reserved for relationship memory, emotional residue, and pending-intention consolidation. | Reserved |
| `spectator_recap` | Reserved for narrator-facing recap generation. | Reserved |

Reserved values exist to make field gating explicit. They must not be wired into runtime LLM calls until their prompt builders and tests exist.

## Field-Purpose Matrix

| Profile Field | `action_intent` | `social_interpretation` | `background_reflection` | `spectator_recap` |
| --- | :---: | :---: | :---: | :---: |
| `identityFrame` | yes | yes | yes | no |
| `relationshipBiases` | yes | yes | yes | no |
| `voiceGuidelines` | yes | no | no | no |
| `styleExamples` | yes | no | no | no |
| `narratorStyle` | no | no | no | yes |

`narratorStyle` is not currently part of `PersonaPromptProfile`; do not add it until the spectator recap surface is implemented.

## BuiltPrompt.purpose

Every `BuiltPrompt` carries its `purpose`. Providers can receive one prompt object without needing extra parameters, and observability can derive the call type from the same source that built the prompt.

The default purpose is `action_intent` to preserve the existing runtime behavior and tests.

## callType Alignment

`AgentRuntime` maps `BuiltPrompt.purpose` to `LlmUsage.callType` through `purposeToCallType`.

| PromptPurpose | LlmUsage.callType |
| --- | --- |
| `action_intent` | `cognition` |
| `social_interpretation` | `interpretation` |
| `background_reflection` | `reflection` |
| `spectator_recap` | `recap` |

## Adding A New Purpose

1. Add or confirm the value in `PromptPurpose`.
2. Define the exact allowed persona fields for that purpose.
3. Add prompt-building logic that excludes unrelated fields.
4. Add a `purposeToCallType` mapping case.
5. Add tests for included fields, excluded fields, output contract, and usage call type.
6. Update this document with the new purpose and invariants.

## Hard Invariants

- Reasoning-only calls must not receive `voiceGuidelines` or `styleExamples`.
- Raw chain-of-thought must not be requested, stored, or exposed.
- Agents must never see another agent's private reasoning, private motive summaries, or spectator narration.
- `action_intent` prompt output must remain stable unless the action prompt is intentionally changed and tested.
