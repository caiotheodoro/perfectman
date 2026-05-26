# Perfectman: Guia de Papo sobre como a galera vê o outro (Peer Perception)

Este guia é pra ser usado num papo descontraído sobre como cada um do grupo vê outra pessoa no chat, com base em um modelo científico híbrido de personalidade (**HEXACO, Circunplexo Interpessoal e Circunplexo Afetivo**).

A ideia não é fazer uma biografia séria. O objetivo é pegar a **percepção real da galera**: como o alvo é lido pelos amigos, que comportamentos ele ativa nos outros e quais parâmetros de comportamento (como energia, estabilidade e reatividade ao vácuo) a gente deve colocar na simulação.

Use este guia junto com o [`solo-questionnaire.md`](solo-questionnaire.md), que serve pra pessoa falar dela mesma.

---

## 🔒 Diretrizes de Privacidade (Segredo de Estado)

Essas notas são material local e não devem ser commitadas no repositório. Antes de salvar:
- Salve respostas reais apenas em caminhos gitignored, como `config/persona-notes/`, `config/personas/` ou `docs/personas/<agent-id>/`.
- Prefira exemplos parafraseados ou resumidos em vez de expor conversas super privadas e literais.
- Nada de incluir dados pessoais (senhas, segredos pesados, etc.) que não tenham a ver com a simulação do chat.
- Se rolar alguma história muito sensível, marque como `exclude_from_prompt` para que a IA não leia no banco.
- O que importa é capturar o padrão de comportamento, não expor ninguém.

---

## 💬 Estilo do Papo

Mantenha a conversa leve, curta e informal. Peça exemplos concretos de mensagens reais. Se o amigo der uma resposta muito genérica, pergunte: *"Mas como seria isso no chat? O que ele digitaria?"*

Tempo sugerido: 25 a 35 minutinhos por pessoa.

---

# Parte 1: O Roteiro do Papo (45 Perguntas por Categoria)

> ### Explicando o lance pro seu amigo:
>
> *"Cara, estou mapeando a dinâmica de chat do nosso grupo pra calibrar as personas de IA da nossa simulação. Quero entender como VOCÊ vê o [Amigo Alvo] — as manias de digitação dele, as reações no grupo, os gatilhos e como ele age com cada um. Pode falar de forma bem aberta e citar nomes reais, porque depois a gente parafraseia as histórias mais sensíveis antes de salvar de verdade no código."*

---

### Categoria A: Agência e Dominância (Cadência e Controle da Conversa)
*Mede: Extroversão, Dominância (Circunplexo Interpessoal), Ativação Base (Arousal) e ritmo de escrita.*

#### 1. Atividade Pública
* **Pergunta:** De 1 (só fica espiando no vácuo de fantasma) a 7 (domina o chat, manda mensagem o dia todo), quão ativo ele é no grupo geral?
* **Sinal para o Dev:** Calibra o arousal (energia) base e o estado padrão de presença.

#### 2. Cortar Assunto
* **Pergunta:** De 1 (super educado, espera todo mundo terminar) a 7 (entra atropelando a conversa, corta o assunto pra falar dele), quão competitivo ele é pelo espaço?
* **Sinal para o Dev:** Ajusta o limiar de iniciativa e prioridade no chat.

#### 3. Metralhadora vs. Textão
* **Pergunta:** De 1 (escreve um bloco gigante bem pensado de uma vez só) a 7 (manda 15 frases de uma linha seguidas, poluindo a tela), qual é o layout de digitação dele?
* **Sinal para o Dev:** Formata a estrutura de blocos e tamanho de mensagens da IA.

#### 4. Chamar Atenção (Ego)
* **Pergunta:** De 1 (prefere ficar de boa no fundo sem incomodar) a 7 (joga umas verdades ácidas, memes polêmicos ou dramas só pra fazer o chat girar em torno dele), quanto ele busca ser o centro das atenções?
* **Sinal para o Dev:** Mede o impulso de busca por status/narcisismo.

#### 5. Pergunta Aberta
* **Pergunta:** *"Lembra de uma vez em que o grupo tava completamente morto e chato, e essa pessoa ressuscitou o chat do nada. O que exatamente ela mandou pra puxar a atenção?"*
* **Sinal para o Dev:** Captura o gatilho exato para ações induzidas por tédio.

---

### Categoria B: Comunhão e Calor Humano (Suporte vs. Distanciamento)
*Mede: Amabilidade, Comunhão (Circunplexo Interpessoal), Valência Base (Humor padrão) e empatia.*

#### 6. Calor Emocional
* **Pergunta:** De 1 (seco, frio, altamente irônico) a 7 (super fofo, acolhedor, entope a mensagem de emojis e exclamações), quão caloroso ele é no chat?
* **Sinal para o Dev:** Define a valência base (se o humor padrão é positivo ou ácido).

#### 7. Reação a Desabafos
* **Pergunta:** De 1 (dá um conselho ultra prático, meio frio, ou diz 'bola pra frente') a 7 (valida totalmente o sentimento, dá apoio emocional profundo e fica indignado junto), como ele reage quando alguém desabafa no chat?
* **Sinal para o Dev:** Escreve as diretrizes de acolhimento e suporte emocional no prompt.

#### 8. Aguentar Provocação (Piadas)
* **Pergunta:** De 1 (pega ar na hora, fica defensivo ou passivo-agressivo) a 7 (entra totalmente na zoeira, ri de si mesmo e responde com uma piada melhor ainda), como ele lida com piadas da galera às custas dele?
* **Sinal para o Dev:** Calibra a sensibilidade à humilhação e o impulso de revide.

#### 9. Puxar quem tá calado
* **Pergunta:** De 1 (só fala com os favoritos dele e ignora quem tá quieto) a 7 (percebe na hora se alguém ficou no vácuo e puxa a pessoa de volta pro assunto), quanto ele tenta incluir os outros?
* **Sinal para o Dev:** Define o peso de empatia social e como ele escolhe quem mencionar.

#### 10. Pergunta Aberta
* **Pergunta:** *"Como essa pessoa demonstra que gosta de alguém ou que se importa no chat, mas sem precisar falar isso de um jeito meloso ou direto? Qual é a marca registrada dela?"*
* **Sinal para o Dev:** Modela a assinatura comportamental de ações afetuosas.

---

### Categoria C: Allianças e DM Privada (Estratégia vs. Transparência)
*Mede: HEXACO Honestidade-Humildade, fofoca, manipulação e comportamento na DM.*

#### 11. Radar de Fofoca
* **Pergunta:** De 1 (odeia falar pelas costas, muda de assunto se rolar fofoca) a 7 (é o epicentro da fofoca, sabe de tudo e adora repassar no privado), quão fofoqueiro ele é?
* **Sinal para o Dev:** Ajusta o peso dos pensamentos privados da IA e o uso de fofoca.

#### 12. Máscara Social
* **Pergunta:** De 1 (super transparente, o que ele sente tá estampado no chat geral) a 7 (calculista, finge estar de boa ou faz piadas públicas pra disfarçar que está magoado), quanto ele mascara as emoções?
* **Sinal para o Dev:** Controla a probabilidade de gerar eventos de resumo de motivos privados.

#### 13. Articulação no Privado
* **Pergunta:** De 1 (nunca chama ninguém no privado no meio do chat geral) a 7 (o chat geral tá bombando e ele tá articulando com 3 pessoas em DMs paralelas ao mesmo tempo), quão ativo ele é nas DMs paralelas?
* **Sinal para o Dev:** Calibra a prioridade de criação de canais privados na simulação.

#### 14. Ostentação e Vaidade
* **Pergunta:** De 1 (super humilde, fica sem graça até com elogio besta) a 7 (vaidoso, adora contar vantagem, citar conquistas ou fingir modéstia pra ganhar confete), quanto ele gosta de inflar o próprio ego?
* **Sinal para o Dev:** Ajusta o gatilho da emoção social de busca por status.

#### 15. Pergunta Aberta
* **Pergunta:** *"Quando essa pessoa te chama no privado enquanto rola um assunto polêmico no grupo geral, o que ela costuma te dizer? Qual é a intenção real dela ali?"*
* **Sinal para o Dev:** Define vieses específicos de relacionamento entre os agentes.

---

### Categoria D: Reatividade Emocional e Apego (Gatilhos e Recuperação)
*Mede: Estabilidade Emocional, Estilo de Apego (Ansioso/Evitativo), sensibilidade à exclusão e recuperação.*

#### 16. Volatilidade de Humor
* **Pergunta:** De 1 (uma rocha, nada abala o cara) a 7 (pavio curto, o humor muda completamente dependendo de uma palavra ou reação no chat), quão volátil ele é?
* **Sinal para o Dev:** Calibra o parâmetro de estabilidade emocional da IA (menor estabilidade = reações rápidas).

#### 17. Sensibilidade ao Vácuo (Exclusão)
* **Pergunta:** De 1 (nem liga se for ignorado, continua digitando) a 7 (ficou no vácuo duas vezes seguidas, já se cala chateado, fica de bico ou fecha o app), quanto dói o vácuo nele?
* **Sinal para o Dev:** Define o multiplicador do medo de exclusão no motor.

#### 18. Expressão de Raiva
* **Pergunta:** De 1 (barraqueiro, explode no geral na hora) a 7 (fica com uma frieza cirúrgica, some em silêncio ou passa a dar respostas de uma palavra), como ele reage quando está puto?
* **Sinal para o Dev:** Ajusta a pressão para ações de conflito ou no-op defensivo.

#### 19. Tempo de Recuperação
* **Pergunta:** De 1 (faz as pazes e esquece a treta em 5 minutos) a 7 (guarda rancor por dias, fica um clima gelado e responde travado por muito tempo), quanto ele demora pra voltar ao normal?
* **Sinal para o Dev:** Define a taxa de decaimento de emoções como ressentimento e vergonha.

#### 20. Pergunta Aberta
* **Pergunta:** *"Quais são os maiores gatilhos dele no chat — aquilo que instantaneamente faz ele entrar em uma discussão, ficar defensivo, mudar de humor repentinamente ou abrir uma DM privada? (Ex: ser contrariado sobre algo que ele domina, piadas sobre certos temas pessoais, sentir-se deixado de fora de uma conversa interna, etc.)"*
* **Sinal para o Dev:** Cria os limiares de inibição/pressão para disparar reações de estresse.

---

### Categoria E: Tédio e Estados Atractores (Agito vs. Sumiço)
*Mede: Sensibilidade ao tédio, necessidade de estímulo e padrões de espreita (lurking).*

#### 21. Fome de Assunto
* **Pergunta:** De 1 (perfeitamente feliz se o grupo ficar calado por 3 dias) a 7 (não suporta o chat parado por 2 horas e precisa mandar alguma zoeira ou dar um cutucão em alguém pra gerar assunto), quão impaciente ele é com o tédio?
* **Sinal para o Dev:** Define o limiar de acúmulo da initiative de tédio.

#### 22. Comportamento no Tédio
* **Pergunta:** De 1 (some em silêncio absoluto e vai ler um livro/fazer outra coisa) a 7 (manda perguntas absurdas, provocações do nada ou fofocas antigas só pra fazer o chat pegar fogo), o que ele faz quando tá entediado?
* **Sinal para o Dev:** Seleciona o peso das ações disponíveis quando a IA cai no tédio.

#### 23. Nível de Espreita (Lurk Rate)
* **Pergunta:** De 1 (só abre o chat se for pra digitar algo) a 7 (fica de fantasma lendo tudo o dia inteiro, sabe de todas as conversas, mas quase nunca digita nada), qual é o nível de espreita dele?
* **Sinal para o Dev:** Ajusta a chance da IA ler mensagens mas decidir voluntariamente não responder (no-op).

#### 24. Pergunta Aberta
* **Pergunta:** *"Qual foi a mensagem mais bizarra, aleatória ou sem noção que essa pessoa já mandou no chat do grupo puramente por estar entediada e sem nada pra fazer?"*
* **Sinal para o Dev:** Alimenta a lista de styleExamples no arquivo da persona.

---

# Parte 2: Versão Curta de Altíssimo Sinal (12 Perguntas - 10 Minutos)

*Se você só tiver 10 minutos com o seu amigo, foque nestas 12 perguntas essenciais para tirar o maior sinal possível para os códigos:*

### Pergunta 1 a 6: Notas de 1 a 7 (Parâmetros Numéricos)
1. **Nível de Atividade:** Lurker/Quieto (1) $\rightarrow$ Dominador do Chat/Spammer (7). *(Sinal: baselineArousal)*
2. **Humor Padrão:** Seco, irônico ou cínico (1) $\rightarrow$ Caloroso, expressivo e acolhedor (7). *(Sinal: baselineValence)*
3. **Pavio Curto:** Super calmo e inabalável (1) $\rightarrow$ Altamente volátil, muda de humor na hora (7). *(Sinal: estabilidade)*
4. **Sensibilidade ao Vácuo:** Dá risada e nem liga (1) $\rightarrow$ Fica super chateado, se fecha ou some (7). *(Sinal: sensibilidade à exclusão)*
5. **Articulação de DM:** Nunca conversa no privado enquanto rola o geral (1) $\rightarrow$ Vive mandando DM de fofoca/aliança em paralelo (7). *(Sinal: Honesty-Humility)*
6. **Reação ao Tédio:** Some e vai fazer outra coisa (1) $\rightarrow$ Começa a provocar ou mandar coisas aleatórias pra agitar o chat (7). *(Sinal: boredomSensitivity)*

### Pergunta 7 a 12: Perguntas Faladas (Estrutura do Prompt)
7. **Mania de Escrita:** *"Quais são as 2 ou 3 manias mais óbvias dele ao digitar? (Ex: abreviações como 'pq/tbm', caps lock, sem vírgula, erro de digitação proposital, emojis específicos)."*
8. **Frase Clássica:** *"Me diz uma mensagem curta que soa exatamente como se ele tivesse mandado. Uma frase que a gente lê e sabe na hora que foi ele."*
9. **Como fica puto:** *"Como a galera percebe a diferença exata de quando ele está apenas provocando na zoeira de quando ele está realmente chateado ou ofendido?"*
10. **Fazer as pazes:** *"Quando ele percebe que deixou o clima chato ou chateou alguém, o que ele faz pra consertar? Pede desculpa, faz piada, some ou chama no privado?"*
11. **DM Típica:** *"Quando ele te chama do nada no privado no meio de uma zoeira geral, o que ele costuma falar? Qual é a vibe da mensagem?"*
12. **O que ele NUNCA falaria:** *"Me diz uma frase ou expressão que essa pessoa jamais digitaria no chat porque soaria formal, falsa ou nada a ver com ela."*

---

# Parte 3: Guia de Ingestão e Tradução para o Dev

Como traduzir as respostas do papo em código e parâmetros da simulação:

### Passo 1: Limpeza e Resolução de Contradições
* **Banter Offset (Ajuste de Zoeira):** Amigos muito íntimos tendem a classificar provocações ácidas como "brincadeira calorosa" (inflando a nota de Calor Humano). Se houver grande discrepância de humor entre os amigos, **abaixe a Valência Base geral do agente**, mas crie uma **valência de relacionamento alta exclusiva para o amigo íntimo**.
* **Público vs. Privado:** Se um amigo diz que ele é ultra frio (geral) e outro diz que ele é super carente (privado), não tire a média simples! **Use a nota fria para a valência pública no geral e a nota quente exclusivamente para os limites de ações de DM privada.**

### Passo 2: Fórmulas Matemáticas para o `PersonaConfig`
Traduza as médias das notas de 1 a 7 diretamente para os floats do motor:

* **Baseline Arousal (Ativação):**
  $$\text{baselineArousal} = \frac{(\text{Atividade Pública}) + (\text{Cortar Assunto}) - 2}{10} + 0.1$$
  *(Mapeia a média para um float entre $0.1$ e $0.9$)*
* **Baseline Valence (Humor Padrão):**
  $$\text{baselineValence} = \frac{\text{Calor Emocional} - 4}{3}$$
  *(Mapeia de $-1.0$ [ácido/irritado] a $+1.0$ [feliz/acolhedor])*
* **Estabilidade Emocional:**
  $$\text{stability} = 1.0 - \left(\frac{\text{Volatilidade} - 1}{6}\right)$$
  *(Inverte: volatilidade alta = estabilidade baixa. Escala entre $0.1$ e $1.0$)*
* **Sensibilidade à Exclusão:**
  $$\text{exclusionSensitivity} = \frac{\text{Sensibilidade ao Vácuo}}{7} \times 2.0$$
  *(Define um multiplicador de sensibilidade de até $2.0$)*

### Passo 3: Montando o Prompt do Agente (`PersonaPromptProfile`)
Use as respostas das perguntas abertas para preencher a estrutura:
* **`identityFrame`:** Sintetize o resumo de como ele age e o que teme: *"Você é o Example Peer. Você morre de medo de ser ignorado ou parecer chato, por isso tenta aliviar o clima com piadas, mas corre pro privado pra checar se as pessoas estão bem se rolar treta."*
* **`voiceGuidelines`:** Insira as manias de digitação traduzidas para regras restritivas em português: *"Sempre escreva tudo em caixa baixa. Nunca use pontuação final. Substitua 'porque' por 'pq' e 'também' por 'tbm'. Use o emoji '🙏' para tentar acalmar o grupo."*
