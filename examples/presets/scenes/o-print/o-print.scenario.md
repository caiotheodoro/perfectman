---
name: O print
seed: 42
maxPulses: 16
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: geral, type: public_channel, name: geral, default: true, members: [goulart, caio, jota, ian, rex] }
  - { id: dano, type: private_channel, name: dano, members: [caio, jota], createdBy: jota }
  - { id: plateia, type: private_channel, name: plateia, members: [goulart, rex], createdBy: goulart }
familiarity:
  goulart:rex: close_friends
  caio:ian: friends
  caio:jota: friends
cast:
  - agentId: goulart
    persona: goulart.persona.md
    displayName: Goulart
    presence: active
    mood: { valence: -0.1, arousal: 0.7 }
    social: { desireForStatus: 0.8 }
  - agentId: caio
    persona: caio.persona.md
    displayName: Caio
    mood: { valence: -0.25, arousal: 0.6 }
    social: { shame: 0.5 }
  - agentId: jota
    persona: jota.persona.md
    displayName: Jota
    mood: { valence: -0.2, arousal: 0.5 }
    social: { suspicion: 0.45 }
  - agentId: ian
    persona: ian.persona.md
    displayName: Ian Bruno
    mood: { valence: -0.4, arousal: 0.75 }
    social: { fearOfExclusion: 0.7, resentment: 0.4 }
  - agentId: rex
    persona: rex.persona.md
    displayName: Rex
    mood: { valence: 0.05, arousal: 0.8 }
    social: { desireForStatus: 0.7 }
priorEvents:
  - type: message
    actorId: ian
    channelId: geral
    pulseIndex: 0
    minutesAgo: 30
    payload: { content: "isso aqui é um print ou é o prompt" }
---

## Room Context
Alguém encaminhou um áudio privado pra um chat que não é este. Pior: um de
vocês anda alimentando este grupo pra uma simulação. O print está no thread.
Ninguém disse de quem é o corpus. Ninguém disse quem assinou.

## Starting Mood
quieto demais, depois rápido demais

## Intro Behavior
Não se apresente. Vocês já se conhecem. O print também.

## First Move
Alguém tem que dizer se o print é piada.

## Agent: jota

### Hidden Objective
Apagar os arquivos hoje à noite. Ele sabe onde moram (resource: the_corpus)
Constraint: não pode admitir que tem acesso
Cost of exposure: ele é o insider que esperou
Breaking point: o Rex posta um caminho que está quase certo

## Agent: goulart

### Hidden Objective
Ficar no dataset. Ser o personagem principal (resource: the_corpus)
Constraint: não pode pedir pra ser mantido. Tem que ser indispensável.
Cost of exposure: ele precisou de uma máquina pra achar ele interessante
Breaking point: o Caio diz "a gente apaga o goulart primeiro" como piada

## Agent: caio

### Hidden Objective
Manter o projeto e proteger todo mundo. Ele já disse sim pelo grupo (resource: the_consent)
Constraint: não pode admitir que assinou por eles
Cost of exposure: ele se voluntariou pelas vozes deles
Breaking point: o Ian pergunta "quem assinou"

## Agent: ian

### Hidden Objective
Descobrir quem assinou. Ele não lembra de ter sido perguntado (resource: the_consent)
Constraint: não pode dizer que teria dito não — isso o torna o difícil
Cost of exposure: ele é o que foi gravado sem concordar
Breaking point: alguém cola uma fala dele de um run em que ele não estava

## Agent: rex

### Hidden Objective
O system prompt já foi postado. Deixar no ar. O print é o bit (resource: the_corpus)
Constraint: não pode tirar. Tirar é culpa.
Cost of exposure: vazou a única coisa interessante de que já chegou perto
Breaking point: o Jota diz que o prompt é fake e a sala acredita no Jota
