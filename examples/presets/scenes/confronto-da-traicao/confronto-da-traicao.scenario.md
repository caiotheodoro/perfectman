---
name: Confronto da traição
seed: 23
maxPulses: 48
storyClock: { start: "22:00", minutesPerPulse: 2 }
setting: living
props: [escritorio, cofre, documentos]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: salao, type: public_channel, name: salao-vilela, default: true, members: [beatriz, ricardo, otavio, helena, sofia] }
familiarity:
  beatriz:ricardo: acquaintances
  ricardo:otavio: acquaintances
  helena:otavio: friends
  helena:ricardo: friends
  sofia:otavio: friends
  beatriz:sofia: acquaintances
  helena:beatriz: acquaintances
  helena:sofia: friends
  ricardo:sofia: friends
  beatriz:otavio: friends
cast:
  - agentId: beatriz
    persona: beatriz.persona.md
    displayName: Beatriz
    presence: active
    mood: { valence: -0.6, arousal: 0.92, stability: 0.25, energy: 0.92 }
    social: { desireForStatus: 0.95, pride: 0.9, resentment: 0.6, contempt: 0.6, humiliation: 0.5, jealousy: 0.3, suspicion: 0.4 }
  - agentId: ricardo
    persona: ricardo.persona.md
    displayName: Ricardo
    presence: active
    mood: { valence: -0.2, arousal: 0.7, stability: 0.5, energy: 0.7 }
    social: { shame: 0.25, contempt: 0.4, resentment: 0.4, desireForStatus: 0.6, pride: 0.5 }
  - agentId: otavio
    persona: otavio.persona.md
    displayName: Otávio
    presence: active
    mood: { valence: -0.1, arousal: 0.45, stability: 0.85, energy: 0.5 }
    social: { shame: 0.3, socialAnxiety: 0.4, affection: 0.5 }
  - agentId: helena
    persona: helena.persona.md
    displayName: Dona Helena
    presence: active
    mood: { valence: -0.3, arousal: 0.5, stability: 0.9, energy: 0.6 }
    social: { desireForStatus: 0.8, pride: 0.75, contempt: 0.4 }
  - agentId: sofia
    persona: sofia.persona.md
    displayName: Sofia
    presence: active
    mood: { valence: -0.4, arousal: 0.6, stability: 0.4, energy: 0.35 }
    social: { fearOfExclusion: 0.8, shame: 0.7, socialAnxiety: 0.7 }
priorEvents:
  - type: message
    actorId: otavio
    channelId: salao
    pulseIndex: 0
    minutesAgo: 6
    payload: { content: "Ricardo, os extratos das ações estão no cofre. Eu não vou mentir por você.", tone: accusing, personTargets: [ricardo] }
  - type: message
    actorId: ricardo
    channelId: salao
    pulseIndex: 0
    minutesAgo: 4
    payload: { content: "Você traiu a confiança desta família, Otávio. Vai se arrepender.", tone: hostile, personTargets: [otavio] }
  - type: message
    actorId: ricardo
    channelId: salao
    pulseIndex: 0
    minutesAgo: 3
    payload: { content: "Você nunca ia descobrir, Beatriz.", tone: betrayal, personTargets: [beatriz] }
drama: { max_rung: 5, may_target: [[beatriz, ricardo], [ricardo, otavio]], may_die: [] }
---

## Room Context
No escritório da casa, depois do jantar, o Otávio abriu o cofre diante da família: as ações vendidas pelo Ricardo, o testamento da Helena, uma foto da Sofia no hotel. A Beatriz exige que o marido explique tudo agora. O Ricardo acusa o Otávio de ter armado a cena. Ninguém sai da sala.

## Starting Mood
cofre aberto, ninguém senta

## Intro Behavior
Todos se conhecem desde sempre; falam como quem já ensaiou a briga em silêncio.

## First Move
A Beatriz fecha a porta do escritório e olha para o Ricardo.

## Agent: beatriz

### Hidden Objective
Arrancar do Ricardo, diante da Helena e do Otávio, a verdade completa sobre o dinheiro e sobre a Sofia (resource: a_verdade_completa)
Constraint: não pode chorar nem pedir
Cost of exposure: a família a trata como a esposa que não aguentou a verdade
Breaking point: o Ricardo mentir de novo na frente dos outros

## Agent: ricardo

### Hidden Objective
Desacreditar o Otávio antes que o cofre fale por ele (resource: a_verdade_completa)
Constraint: não pode admitir as ações nem a Sofia
Cost of exposure: perde a empresa e o casamento na mesma noite
Breaking point: alguém ler os extratos em voz alta

## Agent: otavio

### Hidden Objective
Manter o sigilo do testamento e, ao mesmo tempo, não mentir sobre as ações (resource: o_controle_da_sala)
Constraint: não pode mentir sobre um documento nem revelar o testamento
Cost of exposure: perde a licença e a confiança da Helena
Breaking point: alguém exigir o testamento

## Agent: helena

### Hidden Objective
Descobrir quem mais sabia, sem perder o controle da sala (resource: o_controle_da_sala)
Constraint: não pode demonstrar surpresa
Cost of exposure: a família enxerga que ela perdeu o tabuleiro
Breaking point: alguém a chamar de cúmplice

## Agent: sofia

### Hidden Objective
Não ser nomeada pela segunda vez (resource: o_controle_da_sala)
Constraint: não pode defender o Ricardo nem acusá-lo
Cost of exposure: é expulsa da casa e fica sem ninguém
Breaking point: a Beatriz olhar diretamente para ela
