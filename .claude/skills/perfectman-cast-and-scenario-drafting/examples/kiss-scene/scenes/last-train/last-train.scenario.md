---
name: The last train
seed: 52
maxPulses: 40
storyClock: { start: "23:05", minutesPerPulse: 2 }
setting: rooftop
props: [water-tank, bench, string-lights]
language: en
settings:
  pulseIntervalMs: 3000
channels:
  - { id: roof, type: public_channel, name: roof, default: true, members: [iris, marlowe, dev] }
familiarity:
  iris:marlowe: close_friends
  iris:dev: close_friends
  marlowe:dev: close_friends
cast:
  - agentId: iris
    persona: iris.persona.md
    displayName: Iris
    presence: active
    mood: { valence: -0.1, arousal: 0.55, stability: 0.4, energy: 0.4 }
    social: { fearOfExclusion: 0.55, socialAnxiety: 0.45, affection: 0.85, desireForIntimacy: 0.8 }
  - agentId: marlowe
    persona: marlowe.persona.md
    displayName: Marlowe
    presence: active
    mood: { valence: -0.2, arousal: 0.35, stability: 0.8, energy: 0.5 }
    social: { desireForStatus: 0.6, pride: 0.65, affection: 0.8, shame: 0.2 }
  - agentId: dev
    persona: dev.persona.md
    displayName: Dev
    presence: active
    mood: { valence: 0.0, arousal: 0.5, stability: 0.6, energy: 0.6 }
    social: { affection: 0.7, resentment: 0.3 }
priorEvents:
  - type: message
    actorId: iris
    channelId: roof
    pulseIndex: 0
    minutesAgo: 12
    payload: { content: "You have your ticket, right?", tone: tender, personTargets: [marlowe] }
  - type: message
    actorId: dev
    channelId: roof
    pulseIndex: 0
    minutesAgo: 6
    payload: { content: "Okay. Nobody say anything stupid for the next ten minutes.", tone: tender, personTargets: [iris, marlowe] }
drama: { max_rung: 0, may_target: [], may_die: [], permadeath: false }
beats:
  - { at: 20, actor: marlowe, verb: turn_back, with: iris }
  - { at: 50, actor: iris, verb: cry }
  - { at: 100, actor: marlowe, verb: kiss, with: iris }
  - { at: 130, cut: "the last train leaves" }
---

## Room Context
The rooftop of the building where they have all spent two years of Friday nights. Marlowe takes the 23:40 train to a new city and a new job. Iris has not asked him to stay. Dev came up to see them off and to keep himself from saying what everyone knows. String lights on, bench empty, nobody sits.

## Starting Mood
polite, bright, held breath

## Intro Behavior
Everyone talks about the train, the weather and the packing. Nobody says what it means. Marlowe is calm, Iris is helpful, Dev is loud enough to cover the gaps.

## First Move
Marlowe and Iris stand a step apart by the stair door, in the middle of the roof, looking at the city. Dev leans against the water tank at the far end with his hands in his pockets.

## Agent: iris

### Hidden Objective
Get Marlowe to choose to stay without asking him to (resource: the_decision)
Constraint: cannot ask him, cannot beg, cannot raise her voice
Cost of exposure: he leaves knowing she waited and did not matter enough
Breaking point: Marlowe turns away from her

## Agent: marlowe

### Hidden Objective
Leave without being asked to stay, and without admitting that he wants to be (resource: the_decision)
Constraint: cannot say it first, cannot be warm in front of a third person
Cost of exposure: he has to admit the move was an escape
Breaking point: Dev says out loud what he is doing, and Iris does not defend herself

## Agent: dev

### Hidden Objective
Make them say it to each other so he does not have to say it for them (resource: the_decision)
Constraint: cannot take a side for more than a sentence, cannot leave before it is settled
Cost of exposure: the two of them stop trusting him with it
Breaking point: Marlowe turns his back on Iris a second time
