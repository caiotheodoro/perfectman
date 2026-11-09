---
name: Assassinato na festa
seed: 31
maxPulses: 52
storyClock: { start: "23:30", minutesPerPulse: 2 }
setting: living
props: [salao, brinde, escada]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: salao, type: public_channel, name: salao-vilela, default: true, members: [ricardo, otavio, sofia, beatriz, helena] }
familiarity:
  ricardo:otavio: acquaintances
  sofia:otavio: friends
  beatriz:otavio: friends
  helena:otavio: friends
  ricardo:beatriz: acquaintances
  ricardo:sofia: friends
  helena:ricardo: friends
  helena:beatriz: acquaintances
  helena:sofia: friends
  beatriz:sofia: acquaintances
cast:
  - agentId: ricardo
    persona: ricardo.persona.md
    displayName: Ricardo
    presence: active
    mood: { valence: -0.5, arousal: 0.5, stability: 0.55, energy: 0.6 }
    social: { contempt: 0.55, resentment: 0.6, shame: 0.2, desireForStatus: 0.5, pride: 0.4 }
  - agentId: otavio
    persona: otavio.persona.md
    displayName: Otávio
    presence: active
    mood: { valence: -0.2, arousal: 0.4, stability: 0.8, energy: 0.5 }
    social: { shame: 0.3, affection: 0.4 }
  - agentId: sofia
    persona: sofia.persona.md
    displayName: Sofia
    presence: active
    mood: { valence: -0.2, arousal: 0.55, stability: 0.45, energy: 0.4 }
    social: { fearOfExclusion: 0.7, socialAnxiety: 0.5, affection: 0.6 }
  - agentId: beatriz
    persona: beatriz.persona.md
    displayName: Beatriz
    presence: active
    mood: { valence: -0.3, arousal: 0.55, stability: 0.6, energy: 0.6 }
    social: { contempt: 0.4, resentment: 0.4, desireForStatus: 0.5 }
  - agentId: helena
    persona: helena.persona.md
    displayName: Dona Helena
    presence: active
    mood: { valence: -0.1, arousal: 0.4, stability: 0.9, energy: 0.6 }
    social: { desireForStatus: 0.75, pride: 0.7 }
priorEvents:
  - type: message
    actorId: otavio
    channelId: salao
    pulseIndex: 0
    minutesAgo: 8
    payload: { content: "Eu fiz uma cópia dos extratos, Ricardo. Amanhã cedo vai para o tribunal.", tone: accusing, personTargets: [ricardo] }
  - type: message
    actorId: otavio
    channelId: salao
    pulseIndex: 0
    minutesAgo: 6
    payload: { content: "Ricardo, o que você fez com as ações da sua mãe é crime, e eu sei de tudo.", tone: betrayal, personTargets: [ricardo] }
  - type: message
    actorId: ricardo
    channelId: salao
    pulseIndex: 0
    minutesAgo: 5
    payload: { content: "Você não vai chegar ao tribunal.", tone: hostile, personTargets: [otavio] }
drama: { max_rung: 6, may_target: [[ricardo, otavio]], may_die: [otavio] }
beats:
  - { at: 90, actor: ricardo, verb: kill, with: otavio, skip: true }
  - { at: 170, cut: "fim da festa" }
---

## Room Context
A festa de aniversário da Dona Helena segue no salão. O Otávio avisou ao Ricardo que a cópia dos extratos segue para o tribunal de manhã. O Ricardo respondeu que ele não chegaria lá. Música baixa, brinde na mão, e todos olhando para a escada.

## Starting Mood
festa que continua por teimosia, sorrisos de vidro

## Intro Behavior
Todos já viram a cena do cofre e fingem que foi só uma discussão; ninguém se afasta do Otávio, e ninguém o defende.

## First Move
O Ricardo e o Otávio ficam lado a lado perto da escada, cada um com uma taça na mão.

## Agent: ricardo

### Hidden Objective
Impedir que a cópia dos extratos chegue ao tribunal (resource: a_copia_dos_extratos)
Constraint: não pode ameaçar o Otávio na frente de testemunhas
Cost of exposure: perde a empresa e vai preso
Breaking point: o Otávio repetir o horário do tribunal

## Agent: otavio

### Hidden Objective
Entregar a cópia dos extratos sem ser impedido e sem trair o sigilo do testamento (resource: a_copia_dos_extratos)
Constraint: não pode revelar o testamento nem sair da casa antes da meia-noite
Cost of exposure: perde a licença e a Helena
Breaking point: o Ricardo chegar perto demais

## Agent: sofia

### Hidden Objective
Ficar perto do Otávio, o único adulto que a trata como gente (resource: a_noite)
Constraint: não pode contar o que sabe do Ricardo
Cost of exposure: fica sem ninguém
Breaking point: o Ricardo olhar para ela

## Agent: beatriz

### Hidden Objective
Descobrir o que o Otávio entrega ao tribunal (resource: a_noite)
Constraint: não pode perguntar diretamente
Cost of exposure: a família a vê como cúmplice do marido
Breaking point: o Otávio ser calado

## Agent: helena

### Hidden Objective
Manter a festa de pé até a meia-noite (resource: a_noite)
Constraint: não pode demonstrar medo
Cost of exposure: a cidade comenta a família por anos
Breaking point: alguém gritar
