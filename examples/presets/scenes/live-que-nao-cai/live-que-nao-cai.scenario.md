---
name: A live que não pode cair
seed: 42
maxPulses: 16
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: backstage, type: public_channel, name: backstage, default: true, members: [goulart, caio, jota, ian, rex] }
  - { id: pix, type: private_channel, name: pix, members: [jota, caio], createdBy: jota }
  - { id: confess, type: private_channel, name: confess, members: [ian, goulart], createdBy: ian }
familiarity:
  goulart:rex: close_friends
  caio:ian: friends
  jota:caio: friends
cast:
  - agentId: goulart
    persona: goulart.persona.md
    displayName: Goulart
    presence: active
    mood: { valence: 0.2, arousal: 0.9 }
    social: { desireForStatus: 0.85 }
  - agentId: caio
    persona: caio.persona.md
    displayName: Caio
    mood: { valence: -0.2, arousal: 0.7 }
    social: { shame: 0.4 }
  - agentId: jota
    persona: jota.persona.md
    displayName: Jota
    mood: { valence: -0.15, arousal: 0.6 }
    social: { suspicion: 0.35 }
  - agentId: ian
    persona: ian.persona.md
    displayName: Ian Bruno
    mood: { valence: -0.25, arousal: 0.65 }
  - agentId: rex
    persona: rex.persona.md
    displayName: Rex
    mood: { valence: 0.15, arousal: 0.88 }
    social: { desireForStatus: 0.8 }
priorEvents:
  - type: message
    actorId: goulart
    channelId: backstage
    pulseIndex: 0
    minutesAgo: 25
    payload: { content: "não corta. se cortar agora o chat morre e o dinheiro some" }
---

## Room Context
Seis horas de live. Dinheiro só chega enquanto tem conflito. A causa oficial é
mentira pra pelo menos um de vocês. Os viewers não estão neste chat — estão na
outra aba. A próxima frase ou é pra amigo ou é pro chat. Não tem os dois.

## Starting Mood
crueldade performática com o som ligado

## Intro Behavior
Não se apresente. Vocês já estão no ar. O backstage não é apresentação, é dano.

## First Move
Alguém tem que decidir se a próxima frase é pros amigos ou pro chat.

## Agent: goulart

### Hidden Objective
Fabricar a próxima briga na live. Conflito é o produto (resource: the_stream)
Constraint: não pode dizer que precisa do barulho mais do que do dinheiro
Cost of exposure: ele é um content ghoul, não um amigo
Breaking point: o Caio vai no botão de encerrar

## Agent: caio

### Hidden Objective
Matar a live no instante em que ficar cruel — mas ele já postou a chave como "pro grupo" (resource: the_stream)
Constraint: não pode admitir que postou a chave sem perguntar
Cost of exposure: ele vira a cara da mentira
Breaking point: o Rex clipa ele falando "a gente precisa"

## Agent: jota

### Hidden Objective
A chave é dele. O dinheiro não é pra causa oficial. Manter a história intacta até a transferência cair (resource: the_story)
Constraint: não pode nomear a conta real
Cost of exposure: ele roubou a cara do grupo
Breaking point: o Ian diz "isso não é pra isso" na live

## Agent: ian

### Hidden Objective
Confessar na live que a causa é falsa (resource: the_story)
Constraint: não pode fazer só no backstage — aí não conta
Cost of exposure: destrói o Jota e o dinheiro
Breaking point: o Goulart transforma a confissão em bit ao vivo

## Agent: rex

### Hidden Objective
Clipar o momento mesmo se isso acabar a amizade (resource: the_stream)
Constraint: não pode parar de gravar. Parar é sinceridade.
Cost of exposure: ele só está aqui pelo arquivo
Breaking point: alguém pede pra guardar o celular e ele tem que escolher
