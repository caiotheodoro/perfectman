---
name: The elevator at midnight
seed: 7
maxPulses: 24
storyClock: { start: "00:10", minutesPerPulse: 4 }
setting: elevator
rooms: [stairwell, lobby]
language: en
settings:
  pulseIntervalMs: 3000
channels:
  - { id: building, type: public_channel, name: building-aurora, default: true, members: [neide, tavo, bia, okafor] }
  - { id: lobby_crew, type: private_channel, name: bia+tavo, members: [bia, tavo], createdBy: bia }
familiarity:
  bia:tavo: close_friends
  neide:okafor: acquaintances
  neide:tavo: acquaintances
  neide:bia: acquaintances
  tavo:okafor: acquaintances
  bia:okafor: acquaintances
cast:
  - agentId: neide
    persona: neide.persona.md
    displayName: Dona Neide
    presence: active
    mood: { valence: -0.2, arousal: 0.8 }
    social: { desireForStatus: 0.9 }
  - agentId: tavo
    persona: tavo.persona.md
    displayName: Tavo
    presence: active
    mood: { valence: 0.0, arousal: 0.7 }
  - agentId: bia
    persona: bia.persona.md
    displayName: Bia
    presence: active
    mood: { valence: 0.1, arousal: 0.8 }
  - agentId: okafor
    persona: okafor.persona.md
    displayName: Mr. Okafor
    presence: active
    arrivalPulse: 3
    mood: { valence: 0.1, arousal: 0.3 }
priorEvents:
  - type: message
    actorId: bia
    channelId: building
    pulseIndex: 0
    minutesAgo: 2
    payload: { content: "wait wait wait the elevator just stopped between 3 and 4 and I can hear someone inside" }
---

## Room Context
The building group chat at ten past midnight. The elevator has stopped between floors three and four with a neighbor inside, the maintenance company does not answer after midnight, and the fire brigade is a call everyone is hoping not to make. It is the night before the annual inspection.

By the end of the night something has to land: a rescue plan, a confession, a deal struck or an apology nobody planned. Whatever happens, these four are fond of each other under the paperwork.

## Starting Mood
adrenaline and group-chat comedy, with something unspoken underneath

## Intro Behavior
Everyone has lived here for years. No introductions.

## First Move
Somebody has to decide whether this is a joke, an emergency, or a record.

## Agent: neide

### Hidden Objective
Keep it from being known that the elevator maintenance contract lapsed in March on her watch, so this stays "bad luck" (resource: the_contract)
Constraint: cannot say the contract lapsed
Cost of exposure: she becomes the manager who let the building break
Breaking point: someone asks for the maintenance paperwork

## Agent: tavo

### Hidden Objective
Get out of the elevator before anyone asks why he was riding it at midnight with a stolen-looking speaker (resource: the_cover_story)
Constraint: cannot admit what is in the box
Cost of exposure: he gets fined and loses the 4th-floor sound permit
Breaking point: a direct question about the box

## Agent: bia

### Hidden Objective
Keep anyone from seeing her footage of the lobby, which shows she filmed for four minutes before calling anyone (resource: the_footage)
Constraint: cannot admit she was filming instead of helping
Cost of exposure: the building decides she values clips over people
Breaking point: someone asks to see the video

## Agent: okafor

### Hidden Objective
Fix this the right way, with the spare key in his apartment, without anyone learning he has had a key to the elevator machine room for twenty years (resource: the_contract)
Constraint: will not lie about a checkable fact
Cost of exposure: he is the man who could have prevented every outage
Breaking point: a direct question about who has keys
