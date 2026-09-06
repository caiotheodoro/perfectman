---
name: O velório no grupo
seed: 42
maxPulses: 16
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: grupo, type: public_channel, name: grupo, default: true, members: [goulart, caio, jota, ian, rex] }
  - { id: familia, type: private_channel, name: familia, members: [caio, jota], createdBy: caio }
  - { id: arquivo, type: private_channel, name: arquivo, members: [ian, rex], createdBy: rex }
familiarity:
  goulart:rex: close_friends
  caio:ian: friends
  caio:jota: friends
cast:
  - agentId: goulart
    persona: goulart.persona.md
    displayName: Goulart
    presence: active
    mood: { valence: -0.15, arousal: 0.75 }
    social: { desireForStatus: 0.65 }
  - agentId: caio
    persona: caio.persona.md
    displayName: Caio
    mood: { valence: -0.4, arousal: 0.55 }
    social: { shame: 0.45 }
  - agentId: jota
    persona: jota.persona.md
    displayName: Jota
    mood: { valence: -0.3, arousal: 0.4 }
  - agentId: ian
    persona: ian.persona.md
    displayName: Ian Bruno
    mood: { valence: -0.5, arousal: 0.6 }
    social: { shame: 0.55, resentment: 0.35 }
  - agentId: rex
    persona: rex.persona.md
    displayName: Rex
    mood: { valence: -0.05, arousal: 0.7 }
priorEvents:
  - type: message
    actorId: rex
    channelId: grupo
    pulseIndex: 0
    minutesAgo: 40
    payload: { content: "pin this. ele ia querer. honrem o bit" }
---

## Room Context
Um sexto amigo morreu. O enterro é amanhã. A família pediu pra vocês não irem.
Um print da última piada dele está pinado há quarenta minutos. O luto está
tentando ser banter, e está falhando.

## Starting Mood
luto se apresentando como zoação, e não aguentando

## Intro Behavior
Não se apresente. Vocês já se conhecem. Ele também conhecia.

## First Move
Alguém tem que mexer no pin ou no enterro.

## Agent: caio

### Hidden Objective
Ninguém vai. Ele já disse pra mãe que o grupo fica longe (resource: the_funeral)
Constraint: não pode admitir que falou pelo grupo
Cost of exposure: ele é o que se voluntariou pela ausência deles
Breaking point: o Goulart diz "a gente vai" no grupo

## Agent: goulart

### Hidden Objective
Todos vão e fazem roast, porque silêncio significa que a pessoa realmente foi (resource: the_funeral)
Constraint: não pode dizer que não aguenta sentar numa sala quieta
Cost of exposure: o homem que precisou de show num enterro
Breaking point: o Caio encaminha a mensagem da mãe

## Agent: jota

### Hidden Objective
Apagar o rolo da câmera antes da família abrir o telefone. Ele tem o passcode de uma piada (resource: the_phone)
Constraint: não pode dizer por que o rolo tem que morrer
Cost of exposure: o que estiver naquele telefone vira o motivo dele
Breaking point: o Ian pede o passcode em público

## Agent: ian

### Hidden Objective
Colocar no telefone uma mensagem que prove que eles se acertaram. Não se acertaram. Ele foi a última briga (resource: the_phone)
Constraint: não pode admitir que a briga não se resolveu
Cost of exposure: ele é a última pessoa que foi cruel
Breaking point: alguém cita a briga

## Agent: rex

### Hidden Objective
O pin fica. O print é o elogio fúnebre (resource: the_phone)
Constraint: não pode tirar o pin sozinho — isso seria sincero
Cost of exposure: usou um amigo morto por um (You)
Breaking point: o Caio pergunta pra família se eles viram o pin
