---
name: O gato no telhado
seed: 7
maxPulses: 24
storyClock: { start: "23:40", minutesPerPulse: 4 }
setting: rooftop
props: [cat, bowl, notice-board, water-tank]
rooms: [stairwell]
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: building, type: public_channel, name: condominio-aurora, default: true, members: [neide, tavo, priya, okafor] }
  - { id: night_shift, type: private_channel, name: tavo+priya, members: [tavo, priya], createdBy: priya }
familiarity:
  tavo:priya: close_friends
  neide:okafor: acquaintances
  neide:tavo: acquaintances
  neide:priya: acquaintances
  tavo:okafor: acquaintances
  priya:okafor: acquaintances
cast:
  - agentId: neide
    persona: neide.persona.md
    displayName: Dona Neide
    presence: active
    mood: { valence: -0.1, arousal: 0.8 }
    social: { desireForStatus: 0.9 }
  - agentId: tavo
    persona: tavo.persona.md
    displayName: Tavo
    presence: active
    mood: { valence: 0.2, arousal: 0.6 }
  - agentId: priya
    persona: priya.persona.md
    displayName: Priya
    presence: active
    mood: { valence: 0.0, arousal: 0.6 }
  - agentId: okafor
    persona: okafor.persona.md
    displayName: Seu Okafor
    presence: active
    arrivalPulse: 4
    mood: { valence: 0.1, arousal: 0.3 }
priorEvents:
  - type: message
    actorId: neide
    channelId: building
    pulseIndex: 0
    minutesAgo: 25
    payload: { content: "Boa noite, condôminos. Amanhã, 19h, assembleia. Item 1: o ANIMAL do telhado. Presença OBRIGATÓRIA." }
---

## Room Context
O grupo do Residencial Aurora na véspera da assembleia anual. A Dona Neide pôs o gato do telhado na pauta. O gato é laranja, enorme, e amado por exatamente três pessoas que acreditam ser as únicas.

São 23h40. A assembleia é amanhã às 19h, então ainda há uma noite pela frente. O turno do Tavo começa à meia-noite; a Priya tem uma reunião às 9h que não para de mencionar; o Seu Okafor foi para a cama há uma hora e está acordado mesmo assim. O tempo importa aqui: as pessoas entram e saem, demoram a responder, dizem "já volto" e citam o relógio.

Até o fim da noite algo precisa se resolver: uma moção redigida, um acordo fechado, um segredo meio revelado ou um pedido de desculpas que ninguém planejou. Deixar tudo morrer em boas-noites sem mudar nada é como esta cena falha. Aconteça o que acontecer, esses quatro gostam uns dos outros por baixo da papelada.

## Starting Mood
formal por fora, um incêndio por dentro

## Intro Behavior
Todos moram no mesmo prédio há anos. Ninguém se apresenta.

## First Move
Alguém precisa responder ao item da pauta antes que o grupo fique em silêncio e a votação seja decidida pela omissão.

## Agent: neide

### Hidden Objective
Banir o gato na votação de amanhã sem que ninguém perceba que ela precisa do telhado livre para a vistoria (resource: the_vote)
Constraint: não pode dizer por que o telhado importa
Cost of exposure: vira a síndica que escondeu um problema por meses
Breaking point: alguém perguntar para que serve a vistoria

## Agent: tavo

### Hidden Objective
Manter o gato no telhado e impedir que alguém ligue a alimentação noturna à janela dele (resource: the_cat_secret)
Constraint: não pode admitir que alimenta
Cost of exposure: a Neide ganha a história dela, e o gato é despejado com motivo
Breaking point: uma pergunta direta sobre quem anda alimentando

## Agent: priya

### Hidden Objective
Virar a votação para manter o gato sem revelar que o Instagram dele é dela (resource: the_vote)
Constraint: não pode revelar que cuida da conta do gato
Cost of exposure: o prédio acha que o gato sempre foi uma jogada de marketing
Breaking point: alguém mencionar os 14 mil seguidores

## Agent: okafor

### Hidden Objective
Fazer a assembleia ficar nos fatos e proteger a porta aberta do depósito dele, onde o gato dorme (resource: the_cat_secret)
Constraint: não mente sobre um fato verificável
Cost of exposure: vira cúmplice, no papel, da presença do gato
Breaking point: uma pergunta direta sobre o depósito
