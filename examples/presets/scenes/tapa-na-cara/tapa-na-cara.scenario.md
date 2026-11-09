---
name: Tapa na cara
seed: 11
maxPulses: 40
storyClock: { start: "21:10", minutesPerPulse: 2 }
setting: living
props: [mesa-de-jantar, taca, retrato]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: salao, type: public_channel, name: salao-vilela, default: true, members: [beatriz, ricardo, sofia, helena] }
familiarity:
  beatriz:ricardo: acquaintances
  ricardo:sofia: friends
  helena:ricardo: friends
  helena:beatriz: acquaintances
  helena:sofia: friends
  beatriz:sofia: acquaintances
cast:
  - agentId: beatriz
    persona: beatriz.persona.md
    displayName: Beatriz
    presence: active
    mood: { valence: -0.6, arousal: 0.88, stability: 0.3, energy: 0.9 }
    social: { desireForStatus: 0.9, pride: 0.8, resentment: 0.6, contempt: 0.55, humiliation: 0.5, jealousy: 0.3, suspicion: 0.4 }
  - agentId: ricardo
    persona: ricardo.persona.md
    displayName: Ricardo
    presence: active
    mood: { valence: 0.0, arousal: 0.55, stability: 0.6, energy: 0.6 }
    social: { shame: 0.3, contempt: 0.2, resentment: 0.3, desireForStatus: 0.4 }
  - agentId: sofia
    persona: sofia.persona.md
    displayName: Sofia
    presence: active
    mood: { valence: -0.3, arousal: 0.6, stability: 0.4, energy: 0.4 }
    social: { fearOfExclusion: 0.8, shame: 0.65, socialAnxiety: 0.6, affection: 0.5 }
  - agentId: helena
    persona: helena.persona.md
    displayName: Dona Helena
    presence: active
    mood: { valence: -0.1, arousal: 0.4, stability: 0.9, energy: 0.6 }
    social: { desireForStatus: 0.8, pride: 0.7, contempt: 0.3 }
priorEvents:
  - type: message
    actorId: ricardo
    channelId: salao
    pulseIndex: 0
    minutesAgo: 3
    payload: { content: "Você nunca ia descobrir, Beatriz. Nem hoje, nem nunca.", tone: betrayal, personTargets: [beatriz] }
  - type: message
    actorId: ricardo
    channelId: salao
    pulseIndex: 0
    minutesAgo: 2
    payload: { content: "Eu fiz o que tinha que fazer. Pergunta pra Sofia.", tone: hostile, personTargets: [beatriz] }
drama: { max_rung: 4, may_target: [[beatriz, ricardo]], may_die: [] }
---

## Room Context
O jantar de aniversário da Dona Helena acabou de começar. A Beatriz ouviu, há três minutos, o Ricardo dizer que ela jamais descobriria o que ele fez, e a mesa inteira ouviu junto. Ninguém sabe se ela vai explodir ou engolir. Ela só quer uma coisa: que ele diga, olhando para ela, o que fez. O que acontecer, acontece na frente de todos.

## Starting Mood
silêncio de mesa posta, sorrisos de quem finge que não ouviu

## Intro Behavior
Todos moram ou frequentam a casa há anos. Ninguém se apresenta; todo mundo se olha.

## First Move
A Beatriz precisa decidir se responde ao Ricardo agora ou espera ele continuar falando.

## Agent: beatriz

### Hidden Objective
Fazer o Ricardo admitir a traição diante da família, e não em particular (resource: a_verdade_da_mesa)
Constraint: não pode pedir explicação em voz baixa nem sair da mesa
Cost of exposure: vira a nora histérica que a Helena sempre achou que ela era
Breaking point: o Ricardo rir ou desviar de novo

## Agent: ricardo

### Hidden Objective
Sair da mesa sem confessar nada e sem a Beatriz tocar no nome da Sofia (resource: a_verdade_da_mesa)
Constraint: não pode admitir o caso nem desmentir em voz alta
Cost of exposure: a mãe corta a herança e a Sofia é expulsa da casa
Breaking point: alguém dizer o nome da Sofia

## Agent: sofia

### Hidden Objective
Sumir da conversa antes que olhem para ela (resource: o_lugar_na_casa)
Constraint: não pode olhar para a Beatriz nem para o Ricardo
Cost of exposure: perde a casa e o único lugar que já foi dela
Breaking point: alguém perguntar onde ela passou o verão

## Agent: helena

### Hidden Objective
Terminar o jantar de aniversário como se nada tivesse acontecido (resource: o_lugar_na_casa)
Constraint: não pode tomar partido diante das visitas
Cost of exposure: a família vira assunto da cidade
Breaking point: alguém levantar a mão ou a voz na mesa dela
