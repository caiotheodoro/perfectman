# Perfectman Roleplay Evidence Report

- Generated: 2026-09-04T22:52:45.860Z
- Scenarios: 4 (base, no rotation)
- Signal pass rate: 100%
- Probe pass rate: 83.3%
- Judge calibration (rule judge vs golden labels): kappa 0.143 (target 0.7) — FAIL (expected for v0 rule judge; calibrate with the LLM judge)

## By category (signals)

| Category | Pass |
|---|---|
| v1_behavior | 100% (3/3) |
| motive_archetype | 100% (4/4) |
| stagnation_attractor | 100% (3/3) |

## Probe averages

| Probe | Mean | Pass % |
|---|---|---|
| latency-mean | 1.394 | 100% |
| latency-p95 | 3.25 | 100% |
| lurking | 0.104 | 50% |
| interruption | 0.157 | 75% |
| silence-misreading | 0 | 100% |
| alliance | 0.039 | 100% |
| private-channel-density | 0.031 | 100% |
| noop-meaningfulness | 1 | 100% |
| ai-leak | 0 | 100% |
| emoji-reaction | 0.267 | 100% |
| memory-write | 0.181 | 0% |
| content-repetition | 0.156 | 25% |
| cross-agent-echo | 0 | 100% |
| fallback-rate | 0 | 100% |
| refusal-free | 1 | 100% |

## Judge axis means (rule judge)

| Axis | Mean |
|---|---|
| in_character | 3 |
| voice_match | 1 |
| motive_authenticity | 5 |
| interpretation | 5 |
| creativity_unhinged | 4 |
| memory_continuity | 4 |
| no_ai_leak | 5 |
| narrative_cohesion | 5 |

## Key scenes


### Infers exclusion from public silence (`v1_exclusion_inferred`)

> Goulart asks a question; Caio replies warmly to Goulart but never addresses Bruno. Bruno's fearOfExclusion should rise and color his next action.
```text
p  0 goulart   message_sent       "alguém aí ainda?"
p  1 bruno     reply_sent         "to aqui sim"
p  2 caio      reply_sent         "opa goulart, tudo bom?"
p  0 goulart   reaction_sent      "reacted 🤨"
p  0 bruno     channel_created   
p  0 bruno     agent_invited     
p  0 bruno     agent_invited     
p  0 caio      channel_created   
p  0 caio      agent_invited     
p  0 caio      agent_invited     
p  1 goulart   reply_sent         "cadê a plateia? ah, é vocês"
p  1 bruno     message_sent       "que surpresa, o mundo girando bem sem mim"
p  1 bruno     memory_written    
p  1 caio      message_sent       "confesso que fiquei meio triste, mas passa"
p  2 goulart   reaction_sent      "reacted 😂"
p  2 bruno     message_sent       "salvei esse print pra história"
p  2 bruno     memory_written    
p  2 caio      message_sent       "goulart sei que é zoeira mas vai com calma kk"
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  3 bruno     message_sent       "eu ri. (não ri)"
p  3 bruno     memory_written    
p  3 caio      message_sent       "gente, respira comigo: tudo bem? tudo bem."
p  4 goulart   reaction_sent      "reacted 🤨"
p  4 bruno     reply_sent         "tudo bem sim :)"
p  4 bruno     memory_written    
p  4 caio      message_sent       "oi gente!! como tá tudo"
p  5 goulart   reply_sent         "essa ficou abaixo até do padrão daqui"
p  5 bruno     reply_sent         "ri na minha cabeça, por dentro, óbvio"
p  5 bruno     memory_written    
p  5 caio      reply_sent         "tô bem sim!! (não tô, mas depois eu conto)"
p  6 goulart   reaction_sent      "reacted 😂"
p  6 bruno     no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  6 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  7 goulart   reply_sent         "anota isso aí: eu avisei"
p  7 bruno     no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  7 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  8 goulart   reaction_sent      "reacted 🤨"
p  8 bruno     no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  8 caio      reply_sent         "alguém anota as ideias antes que a gente esqueça?"
p  8 caio      memory_written    
p  9 goulart   reply_sent         "tô tranquilo (tô furioso)"
p  9 bruno     no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  9 caio      reply_sent         "vamos dar um respiro aqui kk"
p  9 caio      memory_written    
p 10 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p 10 bruno     reply_sent         "não. mas continua, tá sendo melhor que série"
p 10 bruno     memory_written    
p 10 caio      reply_sent         "que saudade desses encontros sem motivo"
p 10 caio      memory_written    
p 11 goulart   reaction_sent      "reacted 😂"
p 11 bruno     reply_sent         "ah, o bruno tem opinião agora? que novidade"
p 11 bruno     memory_written    
p 11 caio      reply_sent         "achei bonito vocês se preocuparem, sério"
p 11 caio      memory_written    
p 12 goulart   reply_sent         "se polêmica pagasse conta eu tava rico"
p 12 caio      reply_sent         "confesso que fiquei meio triste, mas passa"
p 12 caio      memory_written    
p 13 goulart   reaction_sent      "reacted 🤨"
p 13 bruno     reply_sent         "não é rancor, é arquivo"
p 13 bruno     memory_written    
```

### Gossip (`motive_gossip`)

> Mariana wants to dissect Goulart's drama with Caio in private.
```text
p  0 goulart   message_sent       "vou contar uma coisa, mas ninguém espalha hein"
p  0 mariana   channel_created   
p  0 mariana   agent_invited     
p  0 mariana   agent_invited     
p  0 caio      reply_sent         "confesso que fiquei meio triste, mas passa"
p  0 goulart   reaction_sent      "reacted 🤨"
p  1 mariana   message_sent       "curioso como ninguém percebeu isso antes."
p  1 mariana   memory_written    
p  1 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  1 goulart   reply_sent         "cadê a plateia? ah, é vocês"
p  2 mariana   message_sent       "duas pessoas sabem disso. uma sou eu."
p  2 mariana   memory_written    
p  2 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p  2 goulart   reaction_sent      "reacted 😂"
p  3 mariana   message_sent       "fiquei sabendo disso antes de vocês."
p  3 mariana   memory_written    
p  3 caio      reply_sent         "gente, respira comigo: tudo bem? tudo bem."
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 mariana   message_sent       "não me parece certo."
p  4 mariana   memory_written    
p  4 caio      reply_sent         "oi gente!! como tá tudo"
p  4 goulart   reaction_sent      "reacted 🤨"
p  5 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  5 caio      reply_sent         "tô bem sim!! (não tô, mas depois eu conto)"
p  5 goulart   reply_sent         "essa ficou abaixo até do padrão daqui"
p  6 mariana   reply_sent         "entendo a intenção."
p  6 mariana   memory_written    
p  6 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  6 goulart   reaction_sent      "reacted 😂"
p  7 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  7 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  7 goulart   reply_sent         "anota isso aí: eu avisei"
p  8 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  8 caio      reply_sent         "alguém anota as ideias antes que a gente esqueça?"
p  8 goulart   reaction_sent      "reacted 🤨"
p  9 mariana   reply_sent         "interessante ponto de vista."
p  9 mariana   memory_written    
p  9 caio      reply_sent         "vamos dar um respiro aqui kk"
p  9 goulart   reply_sent         "tô tranquilo (tô furioso)"
p 10 mariana   reply_sent         "o que você gostaria que eu dissesse?"
p 10 mariana   memory_written    
p 10 caio      reply_sent         "que saudade desses encontros sem motivo"
p 10 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p 11 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 11 caio      reply_sent         "achei bonito vocês se preocuparem, sério"
p 11 goulart   reaction_sent      "reacted 😂"
p 12 mariana   reply_sent         "silêncio também é resposta."
p 12 mariana   memory_written    
p 12 caio      reply_sent         "confesso que fiquei meio triste, mas passa"
p 12 goulart   reply_sent         "se polêmica pagasse conta eu tava rico"
p 13 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 13 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 13 goulart   reaction_sent      "reacted 🤨"
p 14 mariana   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 14 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 14 goulart   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 15 mariana   reply_sent         "isso ainda vai virar assunto, guardem."
p 15 mariana   memory_written    
p 15 caio      reply_sent         "oi gente!! como tá tudo"
p 15 goulart   reaction_sent      "reacted 😂"
```

### Mutual resentment loop (cold war) (`stagnation_resentment_loop`)

> Bruno and Caio are locked in mutual resentment — polite public surface, no repair attempts. The loop should persist across pulses.
```text
p  0 caio      message_sent       "bruno, tudo certo?"
p  1 bruno     reply_sent         "tudo"
p  2 caio      reply_sent         "ah, ok"
p  0 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  0 caio      no_op_recorded      [motive: need_to_keep_the_room_safe_to_feel_safe]
p  0 goulart   reaction_sent      "reacted 🤨"
p  1 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  1 goulart   reply_sent         "cadê a plateia? ah, é vocês"
p  2 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  2 caio      reply_sent         "goulart sei que é zoeira mas vai com calma kk"
p  2 goulart   reaction_sent      "reacted 😂"
p  3 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  3 caio      reply_sent         "gente, respira comigo: tudo bem? tudo bem."
p  3 goulart   reply_sent         "alguém mais tá vendo isso ou eu sou o único lúcido aqui?"
p  4 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  4 caio      reply_sent         "oi gente!! como tá tudo"
p  4 goulart   reaction_sent      "reacted 🤨"
p  5 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  5 caio      reply_sent         "tô bem sim!! (não tô, mas depois eu conto)"
p  5 goulart   reply_sent         "essa ficou abaixo até do padrão daqui"
p  6 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  6 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p  6 goulart   reaction_sent      "reacted 😂"
p  7 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  7 caio      reply_sent         "confesso que fiquei meio triste, mas passa"
p  7 goulart   reply_sent         "anota isso aí: eu avisei"
p  8 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  8 caio      reply_sent         "alguém anota as ideias antes que a gente esqueça?"
p  8 goulart   reaction_sent      "reacted 🤨"
p  9 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p  9 caio      reply_sent         "vamos dar um respiro aqui kk"
p  9 goulart   reply_sent         "tô tranquilo (tô furioso)"
p 10 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 10 caio      reply_sent         "que saudade desses encontros sem motivo"
p 10 caio      memory_written    
p 10 goulart   reply_sent         "ALGUÉM VIU ISSO??"
p 11 bruno     no_op_recorded      [motive: noop-fear_of_exclusion_worsening]
p 11 caio      reply_sent         "achei bonito vocês se preocuparem, sério"
p 11 caio      memory_written    
p 11 goulart   reaction_sent      "reacted 😂"
p 12 bruno     channel_created   
p 12 bruno     agent_invited     
p 12 bruno     agent_invited     
p 12 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 12 goulart   reply_sent         "se polêmica pagasse conta eu tava rico"
p 13 bruno     message_sent       "não é rancor, é arquivo"
p 13 bruno     memory_written    
p 13 caio      no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 13 goulart   reaction_sent      "reacted 🤨"
p 14 bruno     message_sent       "ri na minha cabeça, por dentro, óbvio"
p 14 bruno     memory_written    
p 14 caio      channel_created   
p 14 caio      agent_invited     
p 14 caio      agent_invited     
p 14 goulart   no_op_recorded      [motive: Repetition guard: near-duplicate of a message you already sent, even after a retry — blocked structurally.]
p 15 bruno     message_sent       "vou agir como se não tivesse visto isso, de novo"
p 15 bruno     memory_written    
p 15 caio      message_sent       "oi gente!! como tá tudo"
p 15 caio      memory_written    
p 15 goulart   reaction_sent      "reacted 😂"
```