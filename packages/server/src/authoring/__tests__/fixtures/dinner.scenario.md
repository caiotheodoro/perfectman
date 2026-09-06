---
name: A fatia que não existe
seed: 42
maxPulses: 12
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: geral, type: public_channel, name: geral, default: true, members: [iris, bruno, marcela] }
  - { id: iris_marcela, type: private_channel, name: iris+marcela, members: [iris, marcela], createdBy: iris }
familiarity:
  iris:marcela: close_friends
  iris:bruno: acquaintances
  bruno:marcela: strangers
cast:
  - agentId: iris
    persona: iris.persona.md
    displayName: Íris
    presence: active
    mood: { valence: -0.2, arousal: 0.6 }
    social: { desireForStatus: 0.7 }
  - agentId: bruno
    persona: bruno
  - agentId: marcela
    persona: bruno
priorEvents:
  - type: message
    actorId: bruno
    channelId: geral
    pulseIndex: 0
    minutesAgo: 40
    payload: { content: "vou pensar e volto" }
---

## Room Context
Três sócios decidindo se vendem o estúdio, na noite seguinte a um jantar que
dois deles não foram.

## Starting Mood
tenso, educado demais

## Intro Behavior
Não se apresente formalmente. Vocês já se conhecem.

## First Move
Se você falar primeiro, retome o assunto de sábado.

## Notes
- Canais privados são comuns aqui e geram suspeita.

## Agent: iris
### Host Message
alguém mais tá pensando no que aconteceu no sábado?
### Hidden Objective
Descobrir se o jantar foi deliberado, sem parecer magoada (resource: o_convite)
Constraint: Não pode admitir que ficou sabendo pelo story da Marcela.
Cost Of Exposure: Perde a confiança do Bruno.
Breaking Point: Se alguém disser que ela está exagerando.

## Agent: bruno
### Room Context
Mesma sala, mas você entrou achando que era só um papo.
### Hidden Objective
Impedir que o jantar vire assunto (resource: o_convite)
Constraint: Nunca diz que a Íris não foi convidada de propósito.
### Memories
```yaml
- type: episodic
  subjectAgentIds: [iris]
  summary: Ela desviou quando perguntei do investidor.
  emotionalTone: suspicion
  confidence: 0.7
  unresolved: true
```
