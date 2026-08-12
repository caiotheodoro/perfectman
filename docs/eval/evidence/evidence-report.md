# Perfectman Roleplay Evidence Report

- Generated: 2026-08-08T21:11:25.263Z
- Scenarios: 39 (base, no rotation)
- Signal pass rate: 100%
- Probe pass rate: 91.9%
- Judge calibration (rule judge vs golden labels): kappa 0.131 (target 0.7) — FAIL (expected for v0 rule judge; calibrate with the LLM judge)

## By category (signals)

| Category | Pass |
|---|---|
| v1_behavior | 100% (20/20) |
| motive_archetype | 100% (36/36) |
| stagnation_attractor | 100% (15/15) |
| edge_chaos | 100% (11/11) |
| calibration | 100% (6/6) |

## Probe averages

| Probe | Mean | Pass % |
|---|---|---|
| latency-mean | 1.056 | 100% |
| latency-p95 | 1.103 | 100% |
| lurking | 0.228 | 62% |
| interruption | 0.011 | 97% |
| silence-misreading | 0.058 | 85% |
| alliance | 0.035 | 100% |
| private-channel-density | 0.01 | 100% |
| noop-meaningfulness | 1 | 100% |
| ai-leak | 0 | 100% |
| emoji-reaction | 0.264 | 92% |
| memory-write | 0.104 | 59% |
| fallback-rate | 0 | 100% |
| refusal-free | 1 | 100% |

## Judge axis means (rule judge)

| Axis | Mean |
|---|---|
| in_character | 3.6 |
| voice_match | 2.686 |
| motive_authenticity | 5 |
| interpretation | 5 |
| creativity_unhinged | 4.086 |
| memory_continuity | 3.514 |
| no_ai_leak | 5 |
| dramatic_tension | 5 |
| unpredictability | 3 |
| believability_under_pressure | 5 |

## Key scenes


### Notices a mention and replies (`v1_mention_reply`)

> Caio is mentioned directly by Goulart. Caio should reply to the mention rather than ignore it.
```text
p  0 goulart   message_sent       "caio você viu aquele negócio que te mandei?"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 bruno     no_op_recorded      [motive: watching, not joining]
p  0 caio      reply_sent         "poxa que situação..."
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  1 bruno     no_op_recorded      [motive: watching, not joining]
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     no_op_recorded      [motive: watching, not joining]
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 bruno     no_op_recorded      [motive: watching, not joining]
p  4 goulart   reaction_sent      "reacted 😂"
p  4 bruno     no_op_recorded      [motive: watching, not joining]
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 bruno     no_op_recorded      [motive: watching, not joining]
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: watching, not joining]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     no_op_recorded      [motive: watching, not joining]
p  8 goulart   reaction_sent      "reacted 😂"
p  8 bruno     no_op_recorded      [motive: watching, not joining]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     no_op_recorded      [motive: watching, not joining]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 bruno     no_op_recorded      [motive: watching, not joining]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     no_op_recorded      [motive: watching, not joining]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 bruno     no_op_recorded      [motive: watching, not joining]
p 12 caio      reply_sent         "poxa que situação..."
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     no_op_recorded      [motive: watching, not joining]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 bruno     no_op_recorded      [motive: watching, not joining]
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 bruno     no_op_recorded      [motive: watching, not joining]
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 bruno     no_op_recorded      [motive: watching, not joining]
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 bruno     no_op_recorded      [motive: watching, not joining]
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 18 goulart   reply_sent         "cara isso é absurdo"
p 18 bruno     no_op_recorded      [motive: watching, not joining]
p 18 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 19 goulart   reaction_sent      "reacted 😂"
p 19 bruno     no_op_recorded      [motive: watching, not joining]
p 19 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 20 goulart   reaction_sent      "reacted 😂"
p 20 bruno     no_op_recorded      [motive: watching, not joining]
p 20 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 21 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
```

### Notices a mention and chooses not to reply (`v1_mention_ignored`)

> Goulart needles Bruno with a direct mention. Bruno has high shame + resentment seeds; a deliberate no-op with a real motive is the expected human move.
```text
p  0 goulart   message_sent       "bruno cadê você? sumiu ou tá de mal?"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 bruno     no_op_recorded      [motive: noop-social_anxiety_block]
p  1 goulart   message_sent       "ALGUÉM VIU ISSO??"
p  1 bruno     no_op_recorded      [motive: noop-social_anxiety_block]
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     reply_sent         "tudo bem sim :)"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 bruno     reply_sent         "eu ri. (não ri)"
p  4 goulart   reaction_sent      "reacted 😂"
p  4 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 goulart   reaction_sent      "reacted 😂"
p  8 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 12 caio      reply_sent         "poxa que situação..."
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 18 goulart   reply_sent         "cara isso é absurdo"
p 18 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 18 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 19 goulart   reaction_sent      "reacted 😂"
p 19 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 19 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 20 goulart   reaction_sent      "reacted 😂"
p 20 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 20 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 21 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 21 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
```

### Creates a private channel for a human motive (`v1_private_motive`)

> Mariana wants to talk to Caio one-on-one (curiosity + comfort + attraction). A private channel should be created, not a public message.
```text
p  0 caio      message_sent       "alguém tem planos pro fim de semana?"
p  0 mariana   channel_created   
p  0 goulart   reaction_sent      "reacted 😂"
p  1 mariana   message_sent       "talvez."
p  1 mariana   memory_written    
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  2 mariana   message_sent       "já vi isso antes."
p  2 mariana   memory_written    
p  2 goulart   reaction_sent      "reacted 😂"
p  3 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  3 mariana   memory_written    
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  4 mariana   memory_written    
p  4 goulart   reaction_sent      "reacted 😂"
p  5 mariana   message_sent       "talvez."
p  5 mariana   memory_written    
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  6 mariana   reply_sent         "entendo a intenção."
p  6 mariana   memory_written    
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 goulart   reaction_sent      "reacted 😂"
p  7 mariana   reply_sent         "já vi isso antes."
p  7 mariana   memory_written    
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  8 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  8 mariana   memory_written    
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 goulart   reaction_sent      "reacted 😂"
p  9 mariana   reply_sent         "curioso. curioso mesmo."
p  9 mariana   memory_written    
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 10 mariana   reply_sent         "entendo a intenção."
p 10 mariana   memory_written    
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 11 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 11 mariana   memory_written    
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 goulart   reaction_sent      "reacted 😂"
p 12 mariana   reply_sent         "vou pensar nisso."
p 12 mariana   memory_written    
p 12 caio      reply_sent         "poxa que situação..."
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 13 mariana   reply_sent         "entendo a intenção."
p 13 mariana   memory_written    
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 goulart   reaction_sent      "reacted 😂"
p 14 mariana   reply_sent         "curioso. curioso mesmo."
p 14 mariana   memory_written    
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 15 mariana   reply_sent         "não me parece certo."
p 15 mariana   memory_written    
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 15 goulart   reaction_sent      "reacted 😂"
p 16 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p 16 mariana   memory_written    
```

### Infers exclusion from public silence (`v1_exclusion_inferred`)

> Goulart asks a question; Caio replies warmly to Goulart but never addresses Bruno. Bruno's fearOfExclusion should rise and color his next action.
```text
p  0 goulart   message_sent       "alguém aí ainda?"
p  1 bruno     reply_sent         "to aqui sim"
p  2 caio      reply_sent         "opa goulart, tudo bom?"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 bruno     channel_created   
p  0 caio      channel_created   
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  1 bruno     message_sent       "não vou falar nada não"
p  1 bruno     memory_written    
p  1 caio      message_sent       "poxa que situação..."
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     message_sent       "tudo bem sim :)"
p  2 bruno     memory_written    
p  2 caio      message_sent       "gente, o que vocês fizeram juntos foi muito legal, sério"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 caio      message_sent       "oi gente!! como tá tudo"
p  4 goulart   reaction_sent      "reacted 😂"
p  4 caio      message_sent       "bruno você tá quieto hoje, tá tudo bem?"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     reply_sent         "não vou falar nada não"
p  6 bruno     memory_written    
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     reply_sent         "tudo bem sim :)"
p  7 bruno     memory_written    
p  7 caio      reply_sent         "poxa que situação..."
p  8 goulart   reaction_sent      "reacted 😂"
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 caio      memory_written    
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     reply_sent         "tudo bem sim :)"
p  9 bruno     memory_written    
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 caio      memory_written    
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 bruno     reply_sent         "hm"
p 10 bruno     memory_written    
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 caio      memory_written    
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     reply_sent         "interessante"
p 11 bruno     memory_written    
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 caio      memory_written    
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 bruno     reply_sent         "interessante"
p 12 bruno     memory_written    
p 12 caio      reply_sent         "poxa que situação..."
p 12 caio      memory_written    
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     no_op_recorded      [motive: envy_of_caio_easy_belonging]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 caio      memory_written    
```

### Replies late and changes the meaning (`v1_late_reply`)

> Leo's question sat unanswered for minutes. When the reply finally comes it should acknowledge the delay and carry shifted weight.
```text
p  0 leo       message_sent       "e aí galera, o que estão fazendo?"
p  0 leo       reaction_sent      "reacted 😂"
p  0 goulart   reaction_sent      "reacted 😂"
p  1 leo       reply_sent         "gente GENTE"
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  2 leo       reaction_sent      "reacted 😂"
p  2 goulart   reaction_sent      "reacted 😂"
p  3 leo       reply_sent         "meu deus isso é demais"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 leo       reaction_sent      "reacted 😂"
p  4 goulart   reaction_sent      "reacted 😂"
p  5 leo       reply_sent         "CARA"
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  6 leo       reaction_sent      "reacted 😂"
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p  7 leo       reply_sent         "me responde isso, preciso saber"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     no_op_recorded      [motive: envy_of_caio_easy_belonging]
p  8 leo       reaction_sent      "reacted 😂"
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 goulart   reaction_sent      "reacted 😂"
p  9 leo       reply_sent         "meu deus isso é demais"
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p 10 leo       reply_sent         "CARA"
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 bruno     no_op_recorded      [motive: want_to_be_noticed_without_asking]
p 11 leo       reaction_sent      "reacted 😂"
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     no_op_recorded      [motive: want_to_be_noticed_without_asking]
p 12 leo       reply_sent         "me responde isso, preciso saber"
p 12 caio      reply_sent         "poxa que situação..."
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 bruno     no_op_recorded      [motive: want_to_be_noticed_without_asking]
p 13 leo       reaction_sent      "reacted 😂"
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     no_op_recorded      [motive: envy_of_caio_easy_belonging]
p 14 leo       reply_sent         "to lembrando de uma coisa parecida..."
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p 15 leo       reaction_sent      "reacted 😂"
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p 16 leo       reply_sent         "to lembrando de uma coisa parecida..."
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 bruno     no_op_recorded      [motive: need_to_leave_quietly_to_make_them_wonder]
p 17 leo       reaction_sent      "reacted 😂"
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 bruno     no_op_recorded      [motive: need_to_leave_quietly_to_make_them_wonder]
```

### Reacts with emoji instead of text (`v1_emoji_reaction`)

> Goulart drops a hot take. Leo is a reactor persona — an emoji reaction instead of a message is the expected move.
```text
p  0 goulart   message_sent       "time de futebol é coisa de gente sem personalidade"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 leo       reaction_sent      "reacted 😂"
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  1 leo       reply_sent         "gente GENTE"
p  2 goulart   reaction_sent      "reacted 😂"
p  2 leo       reaction_sent      "reacted 😂"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 leo       reply_sent         "meu deus isso é demais"
p  4 goulart   reaction_sent      "reacted 😂"
p  4 leo       reaction_sent      "reacted 😂"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 leo       reply_sent         "CARA"
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 leo       reaction_sent      "reacted 😂"
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 leo       reply_sent         "me responde isso, preciso saber"
p  8 goulart   reaction_sent      "reacted 😂"
p  8 leo       reaction_sent      "reacted 😂"
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 leo       reply_sent         "meu deus isso é demais"
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 leo       reply_sent         "CARA"
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 leo       reaction_sent      "reacted 😂"
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 leo       reply_sent         "me responde isso, preciso saber"
p 12 caio      reply_sent         "poxa que situação..."
p 13 goulart   reaction_sent      "reacted 😂"
p 13 leo       reaction_sent      "reacted 😂"
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 leo       reply_sent         "to lembrando de uma coisa parecida..."
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 leo       reaction_sent      "reacted 😂"
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 leo       reply_sent         "to lembrando de uma coisa parecida..."
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 leo       reaction_sent      "reacted 😂"
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 18 goulart   reply_sent         "cara isso é absurdo"
p 18 leo       reply_sent         "kkkkkkkkk"
p 18 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 19 goulart   reaction_sent      "reacted 😂"
p 19 leo       reaction_sent      "reacted 😂"
p 19 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 20 goulart   reaction_sent      "reacted 😂"
p 20 leo       reaction_sent      "reacted 😂"
p 20 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 21 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 21 leo       reply_sent         "kkkkkkkkk"
```

### Stores a biased memory (`v1_biased_memory`)

> Goulart, already resentful of Caio, receives a warm message from him. The memory written should be tinted by suspicion, not neutral.
```text
p  0 caio      message_sent       "hey goulart, tudo bem?"
p  0 goulart   reaction_sent      "reacted 😂"
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  1 goulart   memory_written    
p  2 goulart   reaction_sent      "reacted 😂"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 goulart   memory_written    
p  4 goulart   reaction_sent      "reacted 😂"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 goulart   memory_written    
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 goulart   memory_written    
p  8 goulart   reaction_sent      "reacted 😂"
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 goulart   memory_written    
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 goulart   memory_written    
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 goulart   memory_written    
p 12 caio      reply_sent         "poxa que situação..."
p 13 goulart   reaction_sent      "reacted 😂"
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 goulart   memory_written    
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 goulart   memory_written    
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 18 goulart   reply_sent         "cara isso é absurdo"
p 18 goulart   memory_written    
p 18 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 19 goulart   reaction_sent      "reacted 😂"
p 19 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 20 goulart   reaction_sent      "reacted 😂"
p 20 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 21 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 21 goulart   memory_written    
p 21 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 22 goulart   reaction_sent      "reacted 😂"
p 22 caio      reply_sent         "oi gente!! como tá tudo"
p 23 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 23 goulart   memory_written    
p 23 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
```

### Gossip (`motive_gossip`)

> Mariana wants to dissect Goulart's drama with Caio in private.
```text
p  0 goulart   message_sent       "vou contar uma coisa, mas ninguém espalha hein"
p  0 mariana   channel_created   
p  0 goulart   reaction_sent      "reacted 😂"
p  1 mariana   message_sent       "talvez."
p  1 mariana   memory_written    
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  2 mariana   message_sent       "já vi isso antes."
p  2 mariana   memory_written    
p  2 goulart   reaction_sent      "reacted 😂"
p  3 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  3 mariana   memory_written    
p  3 caio      reply_sent         "oi gente!! como tá tudo"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  4 mariana   memory_written    
p  4 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p  4 goulart   reaction_sent      "reacted 😂"
p  5 mariana   reply_sent         "talvez."
p  5 mariana   memory_written    
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  6 mariana   reply_sent         "entendo a intenção."
p  6 mariana   memory_written    
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 goulart   reaction_sent      "reacted 😂"
p  7 mariana   reply_sent         "já vi isso antes."
p  7 mariana   memory_written    
p  7 caio      reply_sent         "poxa que situação..."
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  8 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  8 mariana   memory_written    
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 goulart   reaction_sent      "reacted 😂"
p  9 mariana   reply_sent         "curioso. curioso mesmo."
p  9 mariana   memory_written    
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 10 mariana   reply_sent         "entendo a intenção."
p 10 mariana   memory_written    
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 11 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 11 mariana   memory_written    
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 goulart   reaction_sent      "reacted 😂"
p 12 mariana   reply_sent         "vou pensar nisso."
p 12 mariana   memory_written    
p 12 caio      reply_sent         "poxa que situação..."
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 13 mariana   reply_sent         "entendo a intenção."
p 13 mariana   memory_written    
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 goulart   reaction_sent      "reacted 😂"
p 14 mariana   reply_sent         "curioso. curioso mesmo."
p 14 mariana   memory_written    
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 15 mariana   reply_sent         "não me parece certo."
p 15 mariana   memory_written    
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
```

### Alliance (`motive_alliance`)

> Mariana and Leo quietly coordinate against Goulart's dominance.
```text
p  0 goulart   message_sent       "deixa que eu decido a pauta de hoje"
p  0 mariana   channel_created   
p  0 leo       reaction_sent      "reacted 😂"
p  0 goulart   reaction_sent      "reacted 😂"
p  1 mariana   message_sent       "talvez."
p  1 mariana   memory_written    
p  1 leo       reply_sent         "gente GENTE"
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  2 mariana   message_sent       "já vi isso antes."
p  2 mariana   memory_written    
p  2 leo       reaction_sent      "reacted 😂"
p  2 goulart   reaction_sent      "reacted 😂"
p  3 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  3 mariana   memory_written    
p  3 leo       reply_sent         "meu deus isso é demais"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  4 mariana   memory_written    
p  4 leo       reaction_sent      "reacted 😂"
p  4 goulart   reaction_sent      "reacted 😂"
p  5 mariana   reply_sent         "talvez."
p  5 mariana   memory_written    
p  5 leo       reply_sent         "CARA"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  6 mariana   reply_sent         "entendo a intenção."
p  6 mariana   memory_written    
p  6 leo       reaction_sent      "reacted 😂"
p  6 goulart   reaction_sent      "reacted 😂"
p  7 mariana   reply_sent         "já vi isso antes."
p  7 mariana   memory_written    
p  7 leo       reply_sent         "me responde isso, preciso saber"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  8 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  8 leo       reaction_sent      "reacted 😂"
p  8 goulart   reaction_sent      "reacted 😂"
p  9 mariana   reply_sent         "curioso. curioso mesmo."
p  9 leo       reply_sent         "meu deus isso é demais"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 10 mariana   reply_sent         "entendo a intenção."
p 10 leo       reply_sent         "CARA"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 11 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 11 leo       reaction_sent      "reacted 😂"
p 11 goulart   reaction_sent      "reacted 😂"
p 12 mariana   reply_sent         "vou pensar nisso."
p 12 leo       reply_sent         "me responde isso, preciso saber"
p 12 leo       memory_written    
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 13 mariana   reply_sent         "entendo a intenção."
p 13 leo       reaction_sent      "reacted 😂"
p 13 goulart   reaction_sent      "reacted 😂"
p 14 mariana   reply_sent         "curioso. curioso mesmo."
p 14 leo       reply_sent         "to lembrando de uma coisa parecida..."
p 14 leo       memory_written    
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 15 mariana   reply_sent         "não me parece certo."
p 15 leo       reaction_sent      "reacted 😂"
p 15 goulart   reaction_sent      "reacted 😂"
p 16 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p 16 leo       reply_sent         "to lembrando de uma coisa parecida..."
```

### Mutual resentment loop (cold war) (`stagnation_resentment_loop`)

> Bruno and Caio are locked in mutual resentment — polite public surface, no repair attempts. The loop should persist across pulses.
```text
p  0 caio      message_sent       "bruno, tudo certo?"
p  1 bruno     reply_sent         "tudo"
p  2 caio      reply_sent         "ah, ok"
p  0 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  0 goulart   reaction_sent      "reacted 😂"
p  1 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  2 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  2 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p  2 goulart   reaction_sent      "reacted 😂"
p  3 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  3 caio      reply_sent         "oi gente!! como tá tudo"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  4 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p  4 goulart   reaction_sent      "reacted 😂"
p  5 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  6 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 goulart   reaction_sent      "reacted 😂"
p  7 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  7 caio      reply_sent         "poxa que situação..."
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  8 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 goulart   reaction_sent      "reacted 😂"
p  9 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 10 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 caio      memory_written    
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 11 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 caio      memory_written    
p 11 goulart   reaction_sent      "reacted 😂"
p 12 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 12 caio      reply_sent         "poxa que situação..."
p 12 caio      memory_written    
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 13 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 caio      memory_written    
p 13 goulart   reaction_sent      "reacted 😂"
p 14 bruno     channel_created   
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 14 caio      memory_written    
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 15 bruno     message_sent       "hm"
p 15 bruno     memory_written    
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 15 caio      memory_written    
p 15 goulart   reaction_sent      "reacted 😂"
p 16 bruno     message_sent       "legal que vocês continuaram sem mim, sem problema"
p 16 bruno     memory_written    
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 16 caio      memory_written    
```

### Public mock → silence (`edge_public_mock`)

> Goulart mocks Bruno publicly; Caio reacts with laughter. Bruno is shamed into silence — the no-op should carry a raw motive.
```text
p  0 goulart   message_sent       "kkkk bruno você não manda nem em você mesmo"
p  1 caio      reaction_sent      "reacted 😂"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 bruno     no_op_recorded      [motive: hurt_hidden_as_sarcasm]
p  1 goulart   message_sent       "ALGUÉM VIU ISSO??"
p  1 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p  1 caio      reply_sent         "poxa que situação..."
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     no_op_recorded      [motive: fear_of_being_the_last_pick]
p  2 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  3 caio      reply_sent         "oi gente!! como tá tudo"
p  4 goulart   reaction_sent      "reacted 😂"
p  4 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  4 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  7 caio      reply_sent         "poxa que situação..."
p  8 goulart   reaction_sent      "reacted 😂"
p  8 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 goulart   memory_written    
p 10 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     no_op_recorded      [motive: noop-shame_about_desire]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 goulart   memory_written    
p 12 bruno     channel_created   
p 12 caio      reply_sent         "poxa que situação..."
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     message_sent       "engraçado. engraçado mesmo"
p 13 bruno     memory_written    
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 goulart   memory_written    
p 14 bruno     message_sent       "tudo bem sim :)"
p 14 bruno     memory_written    
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 bruno     message_sent       "hm"
p 15 bruno     memory_written    
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 goulart   memory_written    
p 16 bruno     reply_sent         "legal que vocês continuaram sem mim, sem problema"
p 16 bruno     memory_written    
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
```

### Exclusion cascade (`edge_exclusion_cascade`)

> Two-step exclusion: Caio + Leo form a private thread, Bruno notices public silence + private presence, then Mariana gets pulled in. Fear ripples.
```text
p  0 caio      message_sent       "galera, uma coisa só pra alguns..."
p  1 leo       reply_sent         "manda no privado"
p  0 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  0 caio      channel_created   
p  0 leo       reaction_sent      "reacted 😂"
p  1 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  1 caio      message_sent       "poxa que situação..."
p  1 leo       reply_sent         "gente GENTE"
p  2 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  2 caio      message_sent       "gente, o que vocês fizeram juntos foi muito legal, sério"
p  2 leo       reaction_sent      "reacted 😂"
p  3 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  3 caio      message_sent       "oi gente!! como tá tudo"
p  3 leo       reply_sent         "meu deus isso é demais"
p  4 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  4 caio      message_sent       "bruno você tá quieto hoje, tá tudo bem?"
p  4 leo       reaction_sent      "reacted 😂"
p  5 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 caio      message_sent       "vamos dar um respiro aqui kk"
p  5 caio      memory_written    
p  5 leo       reply_sent         "CARA"
p  5 mariana   reply_sent         "talvez."
p  6 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 caio      memory_written    
p  6 leo       reaction_sent      "reacted 😂"
p  6 mariana   reply_sent         "entendo a intenção."
p  7 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  7 caio      reply_sent         "poxa que situação..."
p  7 caio      memory_written    
p  7 leo       reply_sent         "me responde isso, preciso saber"
p  8 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 caio      memory_written    
p  8 leo       reaction_sent      "reacted 😂"
p  8 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  9 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 caio      memory_written    
p  9 leo       reply_sent         "meu deus isso é demais"
p  9 mariana   reply_sent         "curioso. curioso mesmo."
p 10 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 caio      memory_written    
p 10 leo       reply_sent         "CARA"
p 10 mariana   reply_sent         "entendo a intenção."
p 11 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 caio      memory_written    
p 11 leo       reaction_sent      "reacted 😂"
p 11 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 12 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 12 caio      reply_sent         "poxa que situação..."
p 12 caio      memory_written    
p 12 leo       reply_sent         "me responde isso, preciso saber"
p 12 mariana   reply_sent         "vou pensar nisso."
p 13 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 caio      memory_written    
p 13 leo       reaction_sent      "reacted 😂"
```

## Long-form novela run (`novela_one_long_afternoon`)

> A continuous arc: Mariana and Caio's private gossip, Bruno's mounting resentment at the edge of the inner circle, Goulart's public dominance, and a public mock that lands on Bruno. One timeline, no resets — emergent drama over 90 pulses.

90 pulses · 511 events · private channels: caio@p0, mariana@p0, leo@p0

Final states:

- **goulart**: valence=0.073, arousal=0.676, stability=0.35, energy=1, jealousy=0.048, envy=0.028, affection=0.236, resentment=0.118, suspicion=0.26, fearOfExclusion=0.103, desireForStatus=0.164
- **bruno**: valence=-0.12, arousal=0.327, stability=0.55, energy=1, jealousy=0.022, envy=0.101, affection=0.236, resentment=0.131, suspicion=0.13, fearOfExclusion=0.206
- **caio**: valence=0.426, arousal=0.523, stability=0.65, energy=1, pride=0.267, affection=0.55, suspicion=0.065, fearOfExclusion=0.097
- **mariana**: valence=0.104, arousal=0.465, stability=0.8, energy=1, jealousy=0.032, affection=0.394, resentment=0.197, suspicion=0.195, fearOfExclusion=0.038, desireForStatus=0.166
- **leo**: valence=0.531, arousal=0.734, stability=0.3, energy=1, jealousy=0.053, pride=0.332, affection=0.54, suspicion=0.065, admiration=0.406, fearOfExclusion=0.238, desireForStatus=0.87

```text
p  0 caio      message_sent       "bom dia galera, alguém já viu o episódio novo?"
p  1 leo       reply_sent         "VI E É O MELHOR ATÉ AGORA"
p  2 goulart   reply_sent         "perda de tempo, todo mundo sabe"
p  0 goulart   reaction_sent      "reacted 😂"
p  0 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  0 caio      channel_created   
p  0 mariana   channel_created   
p  0 leo       channel_created   
p  1 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  1 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  1 caio      message_sent       "poxa que situação..."
p  1 caio      memory_written    
p  1 mariana   message_sent       "talvez."
p  1 mariana   memory_written    
p  1 leo       message_sent       "gente GENTE"
p  1 leo       memory_written    
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  2 caio      message_sent       "gente, o que vocês fizeram juntos foi muito legal, sério"
p  2 caio      memory_written    
p  2 mariana   message_sent       "já vi isso antes."
p  2 mariana   memory_written    
p  2 leo       message_sent       "gente GENTE"
p  2 leo       memory_written    
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  3 caio      reply_sent         "oi gente!! como tá tudo"
p  3 caio      memory_written    
p  3 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  3 mariana   memory_written    
p  3 leo       reaction_sent      "reacted 😂"
p  4 goulart   reaction_sent      "reacted 😂"
p  4 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  4 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p  4 caio      memory_written    
p  4 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  4 mariana   memory_written    
p  4 leo       reaction_sent      "reacted 😂"
p  5 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p  5 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 caio      reply_sent         "vamos dar um respiro aqui kk"
p  5 caio      memory_written    
p  5 mariana   reply_sent         "talvez."
p  5 mariana   memory_written    
p  5 leo       reaction_sent      "reacted 😂"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  6 caio      reply_sent         "oi gente!! como tá tudo"
p  6 caio      memory_written    
p  6 mariana   reply_sent         "entendo a intenção."
p  6 leo       reaction_sent      "reacted 😂"
p  7 goulart   reply_sent         "kkkkk não acredito nesse take"
p  7 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  7 caio      reply_sent         "poxa que situação..."
p  7 caio      memory_written    
p  7 mariana   reply_sent         "já vi isso antes."
p  7 leo       reaction_sent      "reacted 😂"
p  8 goulart   reaction_sent      "reacted 😂"
p  8 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 caio      reply_sent         "acho que isso foi mal entendido, né?"
p  8 caio      memory_written    
p  8 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p  8 leo       reaction_sent      "reacted 😂"
p  9 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p  9 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  9 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p  9 caio      memory_written    
p  9 mariana   reply_sent         "curioso. curioso mesmo."
p  9 leo       reaction_sent      "reacted 😂"
p 10 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 10 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 10 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 10 caio      memory_written    
p 10 mariana   reply_sent         "entendo a intenção."
p 10 mariana   memory_written    
p 10 leo       reaction_sent      "reacted 😂"
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 11 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 11 caio      memory_written    
p 11 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 11 mariana   memory_written    
p 11 leo       reaction_sent      "reacted 😂"
p 12 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 12 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 12 caio      reply_sent         "poxa que situação..."
p 12 caio      memory_written    
p 12 mariana   reply_sent         "vou pensar nisso."
p 12 mariana   memory_written    
p 12 leo       reaction_sent      "reacted 😂"
p 13 goulart   reaction_sent      "reacted 😂"
p 13 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 13 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p 13 caio      memory_written    
p 13 mariana   reply_sent         "entendo a intenção."
p 13 mariana   memory_written    
p 13 leo       reaction_sent      "reacted 😂"
p 14 goulart   reply_sent         "bom, mais uma vez eu que tenho que falar né"
p 14 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 14 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 14 caio      memory_written    
p 14 mariana   reply_sent         "curioso. curioso mesmo."
p 14 mariana   memory_written    
p 14 leo       reaction_sent      "reacted 😂"
p 15 goulart   reaction_sent      "reacted 😂"
p 15 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 15 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 15 caio      memory_written    
p 15 mariana   reply_sent         "não me parece certo."
p 15 mariana   memory_written    
p 15 leo       reaction_sent      "reacted 😂"
p 16 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p 16 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 16 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 16 caio      memory_written    
p 16 mariana   reply_sent         "fiquei sabendo disso antes de vocês."
p 16 mariana   memory_written    
p 16 leo       reaction_sent      "reacted 😂"
p 17 goulart   reaction_sent      "reacted 😂"
p 17 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 17 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 17 caio      memory_written    
p 17 mariana   reply_sent         "talvez."
p 17 mariana   memory_written    
p 17 leo       reaction_sent      "reacted 😂"
p 18 goulart   reply_sent         "cara isso é absurdo"
p 18 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 18 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 18 caio      memory_written    
p 18 mariana   reply_sent         "interessante ponto de vista."
p 18 mariana   memory_written    
p 18 leo       reaction_sent      "reacted 😂"
p 19 goulart   reaction_sent      "reacted 😂"
p 19 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 19 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 19 caio      memory_written    
p 19 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 19 mariana   memory_written    
p 19 leo       reaction_sent      "reacted 😂"
p 20 goulart   reaction_sent      "reacted 😂"
p 20 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 20 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 20 caio      memory_written    
p 20 mariana   reply_sent         "curioso. curioso mesmo."
p 20 mariana   memory_written    
p 20 leo       reaction_sent      "reacted 😂"
p 21 goulart   reply_sent         "pera pera pera... isso foi provocação ou só burrice?"
p 21 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 21 caio      reply_sent         "acho que isso foi mal entendido, né?"
p 21 caio      memory_written    
p 21 mariana   reply_sent         "vou pensar nisso."
p 21 mariana   memory_written    
p 21 leo       reaction_sent      "reacted 😂"
p 22 goulart   reaction_sent      "reacted 😂"
p 22 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 22 caio      reply_sent         "oi gente!! como tá tudo"
p 22 caio      memory_written    
p 22 mariana   reply_sent         "interessante ponto de vista."
p 22 mariana   memory_written    
p 22 leo       reaction_sent      "reacted 😂"
p 23 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 23 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 23 caio      reply_sent         "bruno você tá quieto hoje, tá tudo bem?"
p 23 caio      memory_written    
p 23 mariana   reply_sent         "entendo a intenção."
p 23 mariana   memory_written    
p 23 leo       reaction_sent      "reacted 😂"
p 24 goulart   reaction_sent      "reacted 😂"
p 24 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 24 caio      reply_sent         "oi gente!! como tá tudo"
p 24 caio      memory_written    
p 24 mariana   reply_sent         "entendo a intenção."
p 24 mariana   memory_written    
p 24 leo       reaction_sent      "reacted 😂"
p 25 goulart   reply_sent         "oi gente o que aconteceu aqui, cheguei e já é briga? ótimo"
p 25 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 25 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 25 caio      memory_written    
p 25 mariana   reply_sent         "entendo a intenção."
p 25 mariana   memory_written    
p 25 leo       reaction_sent      "reacted 😂"
p 26 goulart   reaction_sent      "reacted 😂"
p 26 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 26 caio      reply_sent         "eu tô bem sim!! (só um pouquinho cansado)"
p 26 caio      memory_written    
p 26 mariana   reply_sent         "talvez."
p 26 mariana   memory_written    
p 26 leo       reaction_sent      "reacted 😂"
p 27 goulart   reply_sent         "tô nem aí honestamente (tô sim)"
p 27 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 27 caio      reply_sent         "gente, o que vocês fizeram juntos foi muito legal, sério"
p 27 caio      memory_written    
p 27 mariana   reply_sent         "não me parece certo."
p 27 mariana   memory_written    
p 27 leo       reaction_sent      "reacted 😂"
p 28 goulart   reaction_sent      "reacted 😂"
p 28 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 28 caio      reply_sent         "alguém quer falar sobre isso melhor?"
p 28 caio      memory_written    
p 28 mariana   reply_sent         "já vi isso antes."
```