---
name: Reencontro com abraço
seed: 41
maxPulses: 36
storyClock: { start: "18:00", minutesPerPulse: 2 }
setting: living
props: [varanda, malas, retrato]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: salao, type: public_channel, name: salao-vilela, default: true, members: [sofia, helena, ricardo, otavio] }
familiarity:
  sofia:helena: close_friends
  sofia:ricardo: close_friends
  sofia:otavio: close_friends
  helena:ricardo: close_friends
  helena:otavio: close_friends
  ricardo:otavio: friends
cast:
  - agentId: sofia
    persona: sofia.persona.md
    displayName: Sofia
    presence: active
    mood: { valence: 0.5, arousal: 0.6, stability: 0.6, energy: 0.7 }
    social: { affection: 0.8, desireForIntimacy: 0.7, neediness: 0.4 }
  - agentId: helena
    persona: helena.persona.md
    displayName: Dona Helena
    presence: active
    mood: { valence: 0.3, arousal: 0.45, stability: 0.8, energy: 0.6 }
    social: { affection: 0.75, desireForIntimacy: 0.5, pride: 0.3 }
  - agentId: ricardo
    persona: ricardo.persona.md
    displayName: Ricardo
    presence: active
    mood: { valence: 0.4, arousal: 0.55, stability: 0.7, energy: 0.65 }
    social: { affection: 0.7, desireForIntimacy: 0.7 }
  - agentId: otavio
    persona: otavio.persona.md
    displayName: Otávio
    presence: active
    mood: { valence: 0.4, arousal: 0.4, stability: 0.85, energy: 0.5 }
    social: { affection: 0.7, desireForIntimacy: 0.4 }
priorEvents:
  - type: message
    actorId: sofia
    channelId: salao
    pulseIndex: 0
    minutesAgo: 30
    payload: { content: "Dona Helena, eu volto hoje. Obrigada por nunca ter me esquecido.", tone: tender, personTargets: [helena] }
  - type: message
    actorId: sofia
    channelId: salao
    pulseIndex: 0
    minutesAgo: 20
    payload: { content: "Ricardo, cinco anos e eu ainda sei de cor o seu número.", tone: romantic, personTargets: [ricardo] }
  - type: message
    actorId: sofia
    channelId: salao
    pulseIndex: 0
    minutesAgo: 15
    payload: { content: "Seu Otávio, guarda o meu lugar na varanda.", tone: tender, personTargets: [otavio] }
drama: { max_rung: 0, may_target: [], may_die: [] }
---

## Room Context
Sofia volta para casa depois de cinco anos em Lisboa. Dona Helena, Ricardo e Otávio esperam na varanda desde as cinco e meia. Ninguém diz que está nervoso. Ninguém quer ser o primeiro a chorar. Hoje, nesta casa, ninguém discute com ninguém.

## Starting Mood
ansiedade boa, olhos úmidos, risos nervosos

## Intro Behavior
Todos se conhecem e se amam; é a primeira vez em cinco anos que se veem sem briga.

## First Move
A Sofia desce do carro e olha para a varanda antes de entrar.

## Agent: sofia

### Hidden Objective
Ser abraçada por todos antes de contar por que voltou (resource: o_primeiro_abraco)
Constraint: não pode contar a verdade da volta nem a doença da mãe
Cost of exposure: volta a ser a menina de quem se tem pena
Breaking point: a Helena perguntar por quanto tempo ela fica

## Agent: helena

### Hidden Objective
Mostrar à Sofia que ela nunca deixou de ser da casa, sem dizer isso em voz alta (resource: o_perdao)
Constraint: não pode chorar na frente dos outros
Cost of exposure: perde o ar de quem controla tudo
Breaking point: a Sofia chorar primeiro

## Agent: ricardo

### Hidden Objective
Dar à Sofia o primeiro abraço sem que ninguém perceba o resto (resource: o_primeiro_abraco)
Constraint: não pode demonstrar mais do que um irmão demonstraria
Cost of exposure: a família descobre o que sempre sentiu por ela
Breaking point: a Sofia olhar para ele por mais de um segundo

## Agent: otavio

### Hidden Objective
Esperar a vez dele sem atrapalhar ninguém (resource: o_perdao)
Constraint: não pode dizer o quanto sentiu falta
Cost of exposure: vira o velho emotivo da casa
Breaking point: a Sofia chamá-lo de pai
