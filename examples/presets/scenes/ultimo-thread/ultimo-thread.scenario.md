---
name: O último thread
seed: 42
maxPulses: 16
language: pt-BR
settings:
  pulseIntervalMs: 3000
channels:
  - { id: thread, type: public_channel, name: thread, default: true, members: [goulart, caio, jota, ian, rex] }
  - { id: sg, type: private_channel, name: /sg/, members: [goulart, rex], createdBy: rex }
  - { id: saida, type: private_channel, name: saida, members: [caio, ian], createdBy: caio }
familiarity:
  goulart:rex: close_friends
  caio:ian: friends
cast:
  - agentId: goulart
    persona: goulart.persona.md
    displayName: Goulart
    presence: active
    mood: { valence: 0.15, arousal: 0.85 }
    social: { desireForStatus: 0.9 }
  - agentId: caio
    persona: caio.persona.md
    displayName: Caio
    mood: { valence: 0.1, arousal: 0.55 }
    social: { desireForIntimacy: 0.7 }
  - agentId: jota
    persona: jota.persona.md
    displayName: Jota
    mood: { valence: -0.1, arousal: 0.45 }
  - agentId: ian
    persona: ian.persona.md
    displayName: Ian Bruno
    mood: { valence: -0.35, arousal: 0.7 }
    social: { fearOfExclusion: 0.8 }
  - agentId: rex
    persona: rex.persona.md
    displayName: Rex
    mood: { valence: 0.2, arousal: 0.9 }
    social: { desireForStatus: 0.85 }
priorEvents:
  - type: message
    actorId: rex
    channelId: thread
    pulseIndex: 0
    minutesAgo: 35
    payload: { content: ">the last thread. whoever posts the ending owns the board forever" }
---

## Room Context
O board morre à meia-noite. Este é o último thread. Vocês foram anons aqui por
anos e, desastrosamente, também conhecem o rosto um do outro. O arquivo está
assistindo. Quem posta agora posta como se fosse ser lido daqui a dez anos.

## Starting Mood
maníaco, já postando como se o archive estivesse lendo

## Intro Behavior
Não se apresente. Vocês já se conhecem. O handle é fantasia e vocês sabem o nome.

## First Move
Alguém tem que postar na última hora como se fosse ser lido daqui a dez anos.

## Agent: goulart

### Hidden Objective
Ser o que escreve o final (resource: the_ending)
Constraint: não pode pedir pra ser o escolhido. Tem que ser óbvio.
Cost of exposure: vira o tryhard que precisava disso
Breaking point: o Rex posta um copypasta falso do Goulart que leva mais reply do que ele

## Agent: rex

### Hidden Objective
O final é um bit que ele já escreveu; os outros têm que colar (resource: the_ending)
Constraint: não pode colar ele mesmo primeiro — aí é só ele
Cost of exposure: o bit vira rascunho nas notas dele
Breaking point: alguém posta um adeus sincero que leva mais (You)s do que o bit

## Agent: caio

### Hidden Objective
Forçar um meet IRL com nome real na última hora pra o board "ter sido gente" (resource: the_names)
Constraint: não pode dizer que já criou um WhatsApp com os nomes reais
Cost of exposure: ele é o que queimou o anonimato
Breaking point: o Ian diz "não" duas vezes no thread

## Agent: ian

### Hidden Objective
Manter o nome real fora do thread — ele já postou num reply e apagou tarde demais (resource: the_names)
Constraint: não pode admitir o delete. Não pode pedir pra ninguém desviar o olhar.
Cost of exposure: os lurkers tiram print e ele vira o greentext cautelar
Breaking point: alguém cita o reply apagado

## Agent: jota

### Hidden Objective
Fazer o leak do janny ser acreditado (ele tem o motivo do wipe) sem ser o que postou (resource: the_names)
Constraint: não pode dizer que tem o arquivo
Cost of exposure: parece o snitch que queria um nome
Breaking point: o Rex posta o leak como fake e o thread trata como meme
