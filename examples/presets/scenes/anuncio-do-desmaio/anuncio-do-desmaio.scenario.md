---
name: Anúncio do desmaio
seed: 53
maxPulses: 40
storyClock: { start: "20:30", minutesPerPulse: 2 }
setting: living
props: [salao, cadeiras, testamento]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: salao, type: public_channel, name: salao-vilela, default: true, members: [sofia, helena, otavio, ricardo, beatriz] }
familiarity:
  helena:sofia: friends
  otavio:sofia: close_friends
  ricardo:sofia: friends
  beatriz:sofia: friends
  helena:ricardo: friends
  helena:beatriz: acquaintances
  helena:otavio: friends
  ricardo:beatriz: acquaintances
  ricardo:otavio: acquaintances
  beatriz:otavio: friends
cast:
  - agentId: sofia
    persona: sofia.persona.md
    displayName: Sofia
    presence: active
    mood: { valence: -0.5, arousal: 0.6, stability: 0.25, energy: 0.3 }
    social: { fearOfExclusion: 0.7, humiliation: 0.25, shame: 0.3, socialAnxiety: 0.8 }
  - agentId: helena
    persona: helena.persona.md
    displayName: Dona Helena
    presence: active
    mood: { valence: -0.1, arousal: 0.4, stability: 0.9, energy: 0.6 }
    social: { desireForStatus: 0.8, pride: 0.7, contempt: 0.45 }
  - agentId: otavio
    persona: otavio.persona.md
    displayName: Otávio
    presence: active
    mood: { valence: -0.1, arousal: 0.4, stability: 0.85, energy: 0.5 }
    social: { affection: 0.5, shame: 0.3 }
  - agentId: ricardo
    persona: ricardo.persona.md
    displayName: Ricardo
    presence: active
    mood: { valence: -0.2, arousal: 0.55, stability: 0.6, energy: 0.6 }
    social: { resentment: 0.35, contempt: 0.3, desireForStatus: 0.5 }
  - agentId: beatriz
    persona: beatriz.persona.md
    displayName: Beatriz
    presence: active
    mood: { valence: -0.2, arousal: 0.5, stability: 0.65, energy: 0.6 }
    social: { resentment: 0.3, contempt: 0.3, desireForStatus: 0.5 }
priorEvents:
  - type: message
    actorId: helena
    channelId: salao
    pulseIndex: 0
    minutesAgo: 3
    payload: { content: "Sofia, minha querida: você não faz parte do testamento. A casa é dos Vilela, e hóspedes vão embora.", tone: humiliating, personTargets: [sofia] }
drama: { max_rung: 2, may_target: [], may_die: [] }
---

## Room Context
A Dona Helena reuniu todos no salão para ler o testamento antes de cortar o bolo. A primeira frase foi para a Sofia, diante de todos: ela não faz parte da herança e não faz parte da família. A Sofia ouviu em pé, com o prato na mão.

## Starting Mood
sala cheia, ar parado, um prato prestes a cair

## Intro Behavior
Todos já estão no salão e ninguém se senta; o Otávio segura o testamento dobrado, sem coragem de abrir.

## First Move
A Sofia precisa respirar fundo antes de responder à Dona Helena.

## Agent: sofia

### Hidden Objective
Não desmoronar diante da família inteira (resource: a_dignidade)
Constraint: não pode chorar nem pedir
Cost of exposure: perde a casa e a única família que teve
Breaking point: a Helena repetir a frase

## Agent: helena

### Hidden Objective
Deixar claro, de uma vez e em público, quem pertence à casa (resource: o_motivo_do_testamento)
Constraint: não pode explicar o motivo da exclusão
Cost of exposure: a família vê que ela está protegendo outra pessoa
Breaking point: alguém perguntar por quê

## Agent: otavio

### Hidden Objective
Ler o testamento sem aumentar a dor da Sofia (resource: o_documento)
Constraint: não pode alterar uma palavra do documento
Cost of exposure: perde a licença e a Helena
Breaking point: a Sofia olhar para ele pedindo ajuda

## Agent: ricardo

### Hidden Objective
Ficar calado enquanto a mãe humilha a Sofia, para não se expor (resource: o_silencio)
Constraint: não pode defender a Sofia nem olhar para ela
Cost of exposure: a Beatriz descobre o caso
Breaking point: a Sofia dizer o nome dele

## Agent: beatriz

### Hidden Objective
Ver quem defende a Sofia e quem se cala (resource: a_prova_do_caso)
Constraint: não pode demonstrar que sabe do caso
Cost of exposure: perde a vantagem de saber primeiro
Breaking point: o Ricardo sair da sala
