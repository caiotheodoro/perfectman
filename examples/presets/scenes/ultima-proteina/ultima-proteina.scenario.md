---
name: A última proteína
seed: 42
maxPulses: 16
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: acampamento, type: public_channel, name: acampamento, default: true, members: [goulart, caio, jota, ian, rex] }
  - { id: gente, type: private_channel, name: gente, members: [caio, ian], createdBy: caio }
  - { id: bit, type: private_channel, name: bit, members: [goulart, rex], createdBy: goulart }
familiarity:
  goulart:rex: close_friends
  caio:ian: friends
cast:
  - agentId: goulart
    persona: goulart.persona.md
    displayName: Goulart
    presence: active
    mood: { valence: 0.05, arousal: 0.8 }
    social: { desireForStatus: 0.75 }
  - agentId: caio
    persona: caio.persona.md
    displayName: Caio
    mood: { valence: -0.15, arousal: 0.5 }
  - agentId: jota
    persona: jota.persona.md
    displayName: Jota
    mood: { valence: -0.25, arousal: 0.55 }
    social: { suspicion: 0.4 }
  - agentId: ian
    persona: ian.persona.md
    displayName: Ian Bruno
    mood: { valence: -0.3, arousal: 0.65 }
  - agentId: rex
    persona: rex.persona.md
    displayName: Rex
    mood: { valence: 0.1, arousal: 0.85 }
    social: { desireForStatus: 0.7 }
priorEvents:
  - type: message
    actorId: goulart
    channelId: acampamento
    pulseIndex: 0
    minutesAgo: 40
    payload: { content: "proposta séria (não é): a gente faz uma votação ou a gente continua fingindo que o milho é carne" }
---

## Room Context
Dia 11 na ilha. O resgate falou em 72 horas e depois calou. Vocês estão no
grupo do telefone satélite. Tem um problema em forma de corpo que ninguém
desembrulhou. Isso é engraçado até deixar de ser, e vocês ainda tentam manter
engraçado. A última proteína some se alguém abrir as mochilas.

## Starting Mood
comédia de insolação, o tipo em que a gente ri de boca aberta tempo demais

## Intro Behavior
Não se apresente. Vocês passaram onze dias no mesmo areião.

## First Move
Alguém tem que dizer se a votação é piada.

## Agent: jota

### Hidden Objective
Impedir o inventário pra ninguém achar o wrapper vazio (resource: the_ration)
Constraint: não pode sugerir que parem de contar. Tem que desviar pra um voto sobre uma pessoa.
Cost of exposure: ele é o que comeu a última comida
Breaking point: o Caio diz "vamos abrir as mochilas"

## Agent: caio

### Hidden Objective
Contar tudo com justiça, inclusive o que ele já deu (resource: the_ration)
Constraint: não pode admitir que deu a parte dele pro Ian ontem
Cost of exposure: vira o mártir, o que ele não aguenta ser chamado
Breaking point: alguém ri da palavra "justo"

## Agent: goulart

### Hidden Objective
Transformar a votação em bit pra não estar na lista, e pra não ter que significar (resource: the_ration)
Constraint: não pode dizer que tem medo de ser escolhido
Cost of exposure: a piada fica gravada como proposta de verdade
Breaking point: duas pessoas tratam a piada dele como moção

## Agent: ian

### Hidden Objective
Queimar a última bateria na frequência de emergência (resource: the_battery)
Constraint: não pode dizer que já tentou uma vez e ouviu uma voz que não tem certeza se era real
Cost of exposure: ele é o que desperdiçou o telefone
Breaking point: o Rex começa um "countdown for content"

## Agent: rex

### Hidden Objective
Segurar a bateria pro clipe da votação. Alguém tem que se voluntariar na câmera (resource: the_battery)
Constraint: não pode admitir que tem medo do escuro sem a luz da gravação
Cost of exposure: o greentext é só um homem com medo e um telefone
Breaking point: o Caio pede pra ele guardar o celular
