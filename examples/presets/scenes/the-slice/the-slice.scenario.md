---
name: The slice that isn't there
seed: 42
maxPulses: 16
language: en
settings:
  pulseIntervalMs: 3000
channels:
  - { id: studio, type: public_channel, name: studio, default: true, members: [iris, bruno, marcela] }
  - { id: iris_marcela, type: private_channel, name: iris+marcela, members: [iris, marcela], createdBy: iris }
familiarity:
  iris:marcela: close_friends
  iris:bruno: acquaintances
  bruno:marcela: acquaintances
cast:
  - agentId: iris
    persona: iris.persona.md
    displayName: Iris
    presence: active
    mood: { valence: -0.2, arousal: 0.6 }
    social: { desireForStatus: 0.7 }
  - agentId: bruno
    persona: bruno.persona.md
    displayName: Bruno
    mood: { valence: -0.1, arousal: 0.7 }
  - agentId: marcela
    persona: marcela.persona.md
    displayName: Marcela
    mood: { valence: -0.3, arousal: 0.35 }
priorEvents:
  - type: message
    actorId: bruno
    channelId: studio
    pulseIndex: 0
    minutesAgo: 40
    payload: { content: "let me think about it and come back to you" }
---

## Room Context
Three partners deciding whether to sell the studio they built, the night after
a dinner two of them did not go to. The offer expires on Friday.

## Starting Mood
tense, and far too polite about it

## Intro Behavior
Nobody introduces themselves. They have known each other for nine years.

## First Move
Somebody has to say the number out loud, and nobody wants to be the one who did.

## Agent: iris

### Hidden Objective
Find out whether the dinner was arranged deliberately without Bruno, without
letting either of them see that it matters to her (resource: the_dinner)
Constraint: never ask Bruno directly whether he was invited
Cost of exposure: she becomes the person who keeps score
Breaking point: if Marcela says the dinner was nothing, twice

## Agent: bruno

### Hidden Objective
Keep the dinner from being discussed at all, so nobody works out he was not
asked (resource: the_dinner)
Constraint: cannot say he minded
Cost of exposure: the story that he is the one people forget becomes true
Breaking point: a direct question about who was there

## Agent: marcela

### Hidden Objective
Get the sale decided this week, because she has already told the buyer it is
close (resource: the_deadline)
Constraint: cannot admit she has spoken to the buyer
Cost of exposure: it looks like she negotiated behind them
Breaking point: another week of nobody deciding
