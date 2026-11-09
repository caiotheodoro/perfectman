# Persona file template (`<agentId>.persona.md`)

Compiled by `packages/server/src/authoring/persona-md-compiler.ts`. Copy the shape from `examples/presets/casts/casa-vilela/*.persona.md`. Prose is in the user's language (see `localization.md`).

```markdown
---
personaId: <agentId, ascii slug, same as scenario agentId>
displayName: <name as the user spells it>
archetype: <free string: charmer, gatekeeper, wounded-proud, ...>
language: <en | pt-BR>
writingStyle: <one line: how they type, what they do when cornered>
chaosCap: <low | medium | high>
sampling:
  temperature: <0.8 to 1.1>
  topP: 0.95
  maxTokens: 300
presence:
  responseDelayMs: [<min>, <max>]
  silenceTolerancePulses: <0 to 3>
  messageLength: <short | medium | long>
  punctuationTells: ["!", "..."]
---

## Identity
<Second person. Name, age, occupation, the one fact that hurts. 2 to 4 sentences.>

## Voice
- <how they talk when winning>
- <how they talk when losing>
- <length and rhythm>

## Style Examples
- <3 to 5 lines in their voice. Chat lines of at most 200 characters.>

## Social Theory
- <one belief about how people work>

## Relationships
- <agentId>: <what this person is to them, in one line>

## Triggers
```yaml
- trigger: <what has to happen>
  behavior: <what they do with words and body>
  pressure: <urge_to_deflect | urge_to_assert_control | urge_to_justify | urge_to_withdraw | urge_to_repair | urge_to_confront | urge_to_dominate | urge_to_defend_self | urge_to_seek_comfort | urge_to_protect | ...>
  sensitivity: <1.4 to 2.8>
```

## Mask Tells
- <the visible leak between what they say and what they feel>

## Private Motives
- <what they need and will not say>

## Hard Limits
- <what they never do>
```

## How the narrative layer lands in a persona (no new keys)

| Plan field | Where it goes |
|---|---|
| `baseline_status` | `Voice` (high: slow, interrupts, sustained eye contact; low: quick, trails off, looks away), `archetype`, `chaosCap`, `presence.silenceTolerancePulses` (high status tolerates silence), `sampling.temperature` |
| Super-objective | `Private Motives` |
| Tactics a character reaches for | `Triggers`: `trigger` is the obstacle event, `behavior` is the tactic as an action ("to plead: lowers voice, steps closer"), `pressure` is the urge |
| Status collapse or rise they will go through | `Triggers` with a high `sensitivity`, and `Mask Tells` |
| Hard limit that stops a beat | `Hard Limits` |
| Scene goal | scenario `Hidden Objective` (see `scenario-template.md`), not the persona, because a persona is reused across scenes |

Never write a `body.act` instruction or a verb id into a persona. Verbs are taught by the hotel's own hint. Never write that the persona is a character, an actor or a role (D43).
