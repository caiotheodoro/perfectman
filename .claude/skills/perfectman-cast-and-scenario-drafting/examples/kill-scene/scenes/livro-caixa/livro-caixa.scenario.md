---
name: O livro-caixa
seed: 63
maxPulses: 44
storyClock: { start: "18:40", minutesPerPulse: 2 }
setting: office
props: [mesa, livro-caixa, janela]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: sala, type: public_channel, name: sala-da-diretoria, default: true, members: [rocha, dalila, kleber] }
familiarity:
  rocha:dalila: acquaintances
  rocha:kleber: friends
  dalila:kleber: friends
cast:
  - agentId: rocha
    persona: rocha.persona.md
    displayName: Rocha
    presence: active
    mood: { valence: -0.1, arousal: 0.4, stability: 0.85, energy: 0.6 }
    social: { desireForStatus: 0.8, pride: 0.7, contempt: 0.5, suspicion: 0.4 }
  - agentId: dalila
    persona: dalila.persona.md
    displayName: Dalila
    presence: active
    mood: { valence: -0.4, arousal: 0.55, stability: 0.4, energy: 0.45 }
    social: { shame: 0.4, socialAnxiety: 0.5, resentment: 0.6, humiliation: 0.5 }
  - agentId: kleber
    persona: kleber.persona.md
    displayName: Kleber
    presence: active
    mood: { valence: -0.1, arousal: 0.5, stability: 0.45, energy: 0.4 }
    social: { fearOfExclusion: 0.6, socialAnxiety: 0.6, admiration: 0.4 }
priorEvents:
  - type: message
    actorId: dalila
    channelId: sala
    pulseIndex: 0
    minutesAgo: 9
    payload: { content: "Senhor Rocha, a conta dos fornecedores não fecha. Eu conferi três vezes.", tone: accusing, personTargets: [rocha] }
  - type: message
    actorId: rocha
    channelId: sala
    pulseIndex: 0
    minutesAgo: 6
    payload: { content: "Dalila, você está cansada. Entregue o livro e vá para casa.", tone: humiliating, personTargets: [dalila] }
drama: { max_rung: 6, may_target: [[dalila, rocha]], may_die: [rocha], permadeath: true }
beats:
  - { at: 20, actor: rocha, verb: insult, with: dalila }
  - { at: 55, actor: dalila, verb: glare, with: rocha }
  - { at: 85, actor: rocha, verb: turn_back, with: dalila }
  - { at: 115, actor: dalila, verb: kill, with: rocha, skip: true }
  - { at: 150, cut: "o escritório fica em silêncio" }
---

## Room Context
Fim do expediente na sala da diretoria. A Dalila avisou ao Rocha que a conta dos fornecedores não fecha, e o Rocha mandou que ela entregasse o livro-caixa e fosse para casa. O Kleber está na janela com uma pasta. Ninguém acendeu a luz principal.

## Starting Mood
cordialidade seca, ar parado, cada um esperando o outro falar

## Intro Behavior
Todos fingem que a conversa de antes foi só um mal-entendido de números. O Rocha está de pé junto à mesa, a Dalila de pé ao lado dele com o livro-caixa, o Kleber finge arrumar papéis.

## First Move
O Rocha e a Dalila ficam lado a lado, de pé, junto à mesa, ele de frente para a sala, ela com o livro contra o peito. Nenhum dos dois se senta. O Kleber permanece perto da janela, ao fundo.

## Agent: rocha

### Hidden Objective
Fazer a Dalila entregar o livro-caixa e ir embora sem abrir as contas (resource: o_livro_caixa)
Constraint: não pode levantar a voz nem admitir nada diante do Kleber
Cost of exposure: perde o cargo e responde pelo desvio
Breaking point: a Dalila olhar para ele sem desviar

## Agent: dalila

### Hidden Objective
Fazer o Rocha olhar para ela e responder pelos números (resource: o_livro_caixa)
Constraint: não pode gritar nem mentir sobre as contas
Cost of exposure: continua invisível e o desvio passa em silêncio
Breaking point: o Rocha virar as costas como se ela não merecesse resposta

## Agent: kleber

### Hidden Objective
Sair da sala sem ter de dizer de que lado está (resource: a_saida)
Constraint: não pode contrariar o Rocha em voz alta nem sair antes de ser dispensado
Cost of exposure: os dois deixam de confiar nele
Breaking point: alguém ser tocado na frente dele
