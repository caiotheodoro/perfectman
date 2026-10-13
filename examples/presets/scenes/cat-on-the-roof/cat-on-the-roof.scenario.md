---
name: The cat on the roof
seed: 7
maxPulses: 24
storyClock: { start: "23:40", minutesPerPulse: 4 }
language: en
settings:
  pulseIntervalMs: 3000
channels:
  - { id: building, type: public_channel, name: building-aurora, default: true, members: [neide, tavo, priya, okafor] }
  - { id: night_shift, type: private_channel, name: tavo+priya, members: [tavo, priya], createdBy: priya }
familiarity:
  tavo:priya: close_friends
  neide:okafor: acquaintances
  neide:tavo: acquaintances
  neide:priya: acquaintances
  tavo:okafor: acquaintances
  priya:okafor: acquaintances
cast:
  - agentId: neide
    persona: neide.persona.md
    displayName: Dona Neide
    presence: active
    mood: { valence: -0.1, arousal: 0.8 }
    social: { desireForStatus: 0.9 }
  - agentId: tavo
    persona: tavo.persona.md
    displayName: Tavo
    presence: active
    mood: { valence: 0.2, arousal: 0.6 }
  - agentId: priya
    persona: priya.persona.md
    displayName: Priya
    presence: active
    mood: { valence: 0.0, arousal: 0.6 }
  - agentId: okafor
    persona: okafor.persona.md
    displayName: Mr. Okafor
    presence: active
    arrivalPulse: 4
    mood: { valence: 0.1, arousal: 0.3 }
priorEvents:
  - type: message
    actorId: neide
    channelId: building
    pulseIndex: 0
    minutesAgo: 25
    payload: { content: "Good evening, neighbors. Tomorrow 7pm, assembly. Item 1: the ANIMAL on the roof. Attendance is MANDATORY." }
---

## Room Context
The group chat of Residencial Aurora, the night before the annual assembly. Dona Neide has put the rooftop cat on the agenda. The cat is orange, enormous, and beloved by exactly three people who each believe they are the only one.

It is 11:40pm. The assembly is tomorrow at 7pm, so there is a night to get through first. Tavo's shift starts at midnight; Priya has a 9am call she keeps mentioning; Okafor was in bed an hour ago and is awake anyway. Time matters here: people drift in and out, answer minutes late, say "brb", and refer to the clock.

By the end of the night something has to land: a motion drafted, a deal struck, a secret half-surfaced, or an apology nobody planned. Drifting off into goodnights with nothing changed is how this scene fails. Whatever happens, these four are fond of each other under the paperwork.

## Starting Mood
formal on the surface, a dumpster fire underneath

## Intro Behavior
Everyone has lived in the same building for years. No introductions.

## First Move
Somebody has to answer the agenda item before the chat goes quiet and the vote is decided by silence.

## Agent: neide

### Hidden Objective
Get the cat banned at tomorrow's vote without anyone seeing she needs the roof cleared for the inspector (resource: the_vote)
Constraint: cannot say why the roof matters
Cost of exposure: she becomes the manager who hid a problem for months
Breaking point: someone asks what the inspector is coming for

## Agent: tavo

### Hidden Objective
Keep the cat on the roof and keep anyone from tracing the nightly feeding back to his window (resource: the_cat_secret)
Constraint: cannot admit he feeds it
Cost of exposure: Neide gets her story, and the cat gets evicted with a reason
Breaking point: a direct question about who has been feeding it

## Agent: priya

### Hidden Objective
Swing the vote to keep the cat while keeping her Instagram account hidden (resource: the_vote)
Constraint: cannot reveal she runs the cat's account
Cost of exposure: the building thinks the cat was a marketing stunt all along
Breaking point: someone mentions the 14k followers

## Agent: okafor

### Hidden Objective
Make the assembly stick to facts, and protect the open door of his storage cage where the cat sleeps (resource: the_cat_secret)
Constraint: will not lie about a checkable fact
Cost of exposure: he becomes complicit in the cat's presence on paper
Breaking point: a direct question about the storage cage
