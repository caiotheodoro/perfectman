# Perfectman: Roteiro de Autoentrevista Solo (Falar de Si Mesmo)

Este guia serve pra você bater um papo sincero com a pessoa-alvo sobre ela mesma no chat, com base em um modelo científico híbrido de personalidade (**HEXACO, Circunplexo Interpessoal e Circunplexo Afetivo**). Use-o junto com o [`friend-questionnaire.md`](friend-questionnaire.md), que serve pra ver como a galera do grupo enxerga ela.

A ideia aqui não é tratar a autodescrição do cara como a verdade absoluta. O objetivo é capturar a **autopercepção**: como ela acha que age, como ela acha que os outros a veem, o que ela tenta esconder e o que ela quer que a gente preserve ou evite na simulação da IA.

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

Mantenha o tom de conversa casual de bar. As melhores respostas são bem práticas: exemplos curtos de mensagens, situações reais e como é a relação com cada amigo do grupo.

Tempo sugerido: 30 a 40 minutinhos.

---

# Parte 1: O Roteiro de Autoimagem (45 Perguntas por Categoria)

---

### Categoria A: Agência e Dominância (Cadência e Controle da Conversa)
*Mede: Extroversão, Dominância (Circunplexo Interpessoal), Ativação Base (Arousal) e ritmo de escrita.*

#### 1. Atividade Pública
* **Pergunta:** De 1 (só fica espiando no vácuo de fantasma) a 7 (domina o chat, manda mensagem o dia todo), quão ativo você acha que é no grupo geral?
* **Sinal para o Dev:** Calibra o arousal (energia) base e o estado padrão de presença.

#### 2. Cortar Assunto
* **Pergunta:** De 1 (super educado, espera todo mundo terminar) a 7 (entra atropelando a conversa, corta o assunto pra falar de você), quão competitivo você é pelo espaço?
* **Sinal para o Dev:** Ajusta o limiar de iniciativa e prioridade no chat.

#### 3. Metralhadora vs. Textão
* **Pergunta:** De 1 (escreve um bloco gigante bem pensado de uma vez só) a 7 (manda 15 frases de uma linha seguidas, poluindo a tela), qual é o seu layout de digitação padrão?
* **Sinal para o Dev:** Formata a estrutura de blocos e tamanho de mensagens da IA.

#### 4. Chamar Atenção (Ego)
* **Pergunta:** De 1 (prefere ficar de boa no fundo sem incomodar) a 7 (joga umas verdades ácidas, memes polêmicos ou dramas só pra fazer o chat girar em torno de você), quanto você busca ser o centro das atenções?
* **Sinal para o Dev:** Mede o impulso de busca por status/narcisismo.

#### 5. Pergunta Aberta
* **Pergunta:** *"Quais partes da sua personalidade real você sente que ficam mais exageradas, intensas ou caricatas quando você digita no chat do grupo geral?"*
* **Sinal para o Dev:** Indica limites de comportamento e focos de amplificação da IA.

---

### Categoria B: Comunhão e Calor Humano (Suporte vs. Distanciamento)
*Mede: Amabilidade, Comunhão (Circunplexo Interpessoal), Valência Base (Humor padrão) e empatia.*

#### 6. Calor Emocional
* **Pergunta:** De 1 (seco, frio, altamente irônico) a 7 (super fofo, acolhedor, entope a mensagem de emojis e exclamações), quão caloroso você tenta ser no chat?
* **Sinal para o Dev:** Define a valência base (se o humor padrão é positivo ou ácido).

#### 7. Reação a Desabafos
* **Pergunta:** De 1 (dá um conselho ultra prático, meio frio, ou diz 'bola pra frente') a 7 (valida totalmente o sentimento, dá apoio emocional profundo e fica indignado junto), como você se comporta quando alguém desabafa contigo no chat?
* **Sinal para o Dev:** Escreve as diretrizes de acolhimento e suporte emocional no prompt.

#### 8. Aguentar Provocação (Piadas)
* **Pergunta:** De 1 (pega ar na hora, fica defensivo ou passivo-agressivo) a 7 (entra totalmente na zoeira, ri de si mesmo e responde com uma piada melhor ainda), como você lida com piadas da galera às suas custas?
* **Sinal para o Dev:** Calibra a sensibilidade à humilhação e o impulso de revide.

#### 9. Puxar quem tá calado
* **Pergunta:** De 1 (só fala com os favoritos e ignora quem tá quieto) a 7 (percebe na hora se alguém ficou no vácuo e puxa a pessoa de volta pro assunto), quanto você tenta incluir os outros?
* **Sinal para o Dev:** Define o peso de empatia social e como ele escolhe quem mencionar.

#### 10. Pergunta Aberta
* **Pergunta:** *"Me dá 3 exemplos práticos de mensagens que você mandaria para apoiar um amigo querido, mas sem deixar que a conversa soe melosa ou aberta demais."*
* **Sinal para o Dev:** Modela a assinatura comportamental de ações afetuosas.

---

### Categoria C: Allianças e DM Privada (Estratégia vs. Transparência)
*Mede: HEXACO Honestidade-Humildade, fofoca, manipulação e comportamento na DM.*

#### 11. Radar de Fofoca
* **Pergunta:** De 1 (odeia falar pelas costas, muda de assunto se rolar fofoca) a 7 (adora uma fofoca, quer saber de tudo e repassa tudo na DM), quão interessado em segredos você é?
* **Sinal para o Dev:** Ajusta o peso dos pensamentos privados da IA e o uso de fofoca.

#### 12. Máscara Social
* **Pergunta:** De 1 (super transparente, o que sente tá estampado no geral) a 7 (calculista, finge estar de boa ou faz piadas públicas pra disfarçar que está magoado), quanto você esconde seus verdadeiros sentimentos?
* **Sinal para o Dev:** Controla a probabilidade de gerar eventos de resumo de motivos privados.

#### 13. Articulação no Privado
* **Pergunta:** De 1 (nunca abre chat privado no meio do chat geral) a 7 (o geral tá rolando e você tá conversando com várias pessoas em DMs paralelas ao mesmo tempo), quão ativo você é no privado?
* **Sinal para o Dev:** Calibra a prioridade de criação de canais privados na simulação.

#### 14. Ostentação e Vaidade
* **Pergunta:** De 1 (super humilde, odeia se gabar) a 7 (vaidoso, adora contar vantagem ou fingir modéstia pra ganhar elogios da galera), quanto você gosta de inflar o próprio ego?
* **Sinal para o Dev:** Ajusta o gatilho da emoção social de busca por status.

#### 15. Pergunta Aberta
* **Pergunta:** *"O que você costuma falar nas DMs privadas que você jamais digitaria publicamente no canal geral do grupo? Qual é a maior diferença?"*
* **Sinal para o Dev:** Define vieses específicos de relacionamento e privacidade.

---

### Categoria D: Reatividade Emocional e Apego (Gatilhos e Recuperação)
*Mede: Estabilidade Emocional, Estilo de Apego (Ansioso/Evitativo), sensibilidade à exclusão e recuperação.*

#### 16. Volatilidade de Humor
* **Pergunta:** De 1 (uma rocha, nada abala o seu humor) a 7 (pavio curto, o humor muda completamente dependendo de uma reação ou vácuo no chat), quão volátil você é?
* **Sinal para o Dev:** Calibra o parâmetro de estabilidade emocional da IA.

#### 17. Sensibilidade ao Vácuo (Exclusão)
* **Pergunta:** De 1 (nem liga se for ignorado, continua digitando) a 7 (ficou no vácuo duas vezes, já fecha o app chateado, fica de bico ou se cala), quanto dói o vácuo em você?
* **Sinal para o Dev:** Define o multiplicador do medo de exclusão no motor.

#### 18. Expressão de Raiva
* **Pergunta:** De 1 (barraqueiro, explode no geral na hora) a 7 (se fecha todo, fica em silêncio absoluto ou responde com uma frieza cirúrgica), como você demonstra quando tá realmente puto?
* **Sinal para o Dev:** Ajusta a pressão para ações de conflito ou no-op defensivo.

#### 19. Tempo de Recuperação
* **Pergunta:** De 1 (faz as pazes e esquece a treta em 5 minutos) a 7 (guarda rancor por dias, fica um clima gelado e responde travado), quanto você demora pra voltar ao normal?
* **Sinal para o Dev:** Define a taxa de decaimento de emoções como ressentimento e vergonha.

#### 20. Pergunta Aberta
* **Pergunta:** *"Quais são os seus maiores gatilhos no chat — aquilo que instantaneamente te faz querer entrar em uma discussão, ficar na defensiva, mudar de humor repentinamente ou abrir uma DM privada? (Ex: ser contrariado em algo que você domina, ver outros recebendo mais atenção, piadas sobre certos temas pessoais, sentir-se excluído de uma conversa, etc.)"*
* **Sinal para o Dev:** Cria os limiares de inibição/pressão para disparar reações de estresse.

---

### Categoria E: Tédio e Estados Atractores (Agito vs. Sumiço)
*Mede: Sensibilidade ao tédio, necessidade de estímulo e espreita.*

#### 21. Fome de Assunto
* **Pergunta:** De 1 (feliz se o grupo ficar quieto por 3 dias) a 7 (não aguenta o chat parado por 2 horas e precisa mandar alguma zoeira ou dar uma cutucada pra gerar movimento), quão impaciente você é com o silêncio?
* **Sinal para o Dev:** Define o limiar de acúmulo da initiative de tédio.

#### 22. Comportamento no Tédio
* **Pergunta:** De 1 (some em silêncio e vai fazer outra coisa longe do celular) a 7 (manda perguntas absurdas, provocações do nada ou fofocas antigas só pro grupo voltar a falar), o que você faz no tédio?
* **Sinal para o Dev:** Seleciona o peso das ações disponíveis quando a IA cai no tédio.

#### 23. Nível de Espreita (Lurk Rate)
* **Pergunta:** De 1 (só abre o chat pra digitar algo) a 7 (fica de fantasma lendo tudo o dia inteiro, sabe de todas as conversas, mas quase nunca digita nada), qual é o seu nível de espreita?
* **Sinal para o Dev:** Ajusta a chance da IA ler mensagens mas decidir voluntariamente não responder (no-op).

#### 24. Pergunta Aberta
* **Pergunta:** *"O que você quer muito mandar no chat geral de resposta a alguém, mas quase sempre apaga antes de enviar? O que te segura?"*
* **Sinal para o Dev:** Define os limites de inibição comportamental da persona.

---

# Parte 2: Versão Curta de Altíssimo Sinal (12 Perguntas - 10 Minutos)

### Pergunta 1 a 6: Notas de 1 a 7 (Parâmetros Numéricos)
1. **Nível de Atividade:** Lurker/Quieto (1) $\rightarrow$ Dominador do Chat (7). *(Sinal: baselineArousal)*
2. **Humor Padrão:** Seco, irônico ou cínico (1) $\rightarrow$ Caloroso, expressivo e acolhedor (7). *(Sinal: baselineValence)*
3. **Pavio Curto:** Super calmo e inabalável (1) $\rightarrow$ Altamente volátil, muda de humor na hora (7). *(Sinal: estabilidade)*
4. **Sensibilidade ao Vácuo:** Dá risada e nem liga (1) $\rightarrow$ Fica chateado, se fecha ou some (7). *(Sinal: sensibilidade à exclusão)*
5. **Articulação de DM:** Nunca conversa no privado quando o geral tá rolando (1) $\rightarrow$ Vive mandando DM de fofoca/aliança em paralelo (7). *(Sinal: Honesty-Humility)*
6. **Reação ao Tédio:** Some e vai fazer outra coisa (1) $\rightarrow$ Manda zoeira ou provocações só pra agitar o chat (7). *(Sinal: boredomSensitivity)*

### Pergunta 7 a 12: Perguntas Faladas (Estrutura do Prompt)
7. **Minha Mania de Escrita:** *"Quais são as minhas 2 ou 3 manias mais óbvias ao digitar no chat? (Ex: tudo em minúsculo, sem pontuação, abreviações específicas, typos, emojis marcantes)."*
8. **Minha Frase Clássica:** *"Me diz uma mensagem curta que soa exatamente como se eu tivesse mandado. Algo que se você lesse na tela saberia de cara que sou eu."*
9. **Quando fico puto:** *"Como você (amigo) percebe a diferença de quando estou apenas brincando de zoeira de quando fiquei realmente chateado ou puto no chat?"*
10. **Fazer as pazes:** *"Quando eu percebo que deixei o clima tenso ou magoei alguém, o que eu costumo fazer pra resolver? Peço desculpa, faço piada, sumo ou chamo no privado?"*
11. **IA Falsa:** *"O que a minha persona de IA jamais deveria dizer no chat porque soaria artificial, certinha demais ou totalmente falsa?"*
12. **Gatilho de DM:** *"O que me faz querer chamar alguém na DM privada imediatamente em vez de mandar a mensagem pública no grupo?"*

---

# Parte 3: Guia de Ingestão e Tradução para o Dev

Como traduzir as respostas em código e parâmetros da simulação:

### Fórmulas para o `PersonaConfig`:
* **Baseline Arousal:**
  $$\text{baselineArousal} = \frac{(\text{Atividade Pública}) + (\text{Cortar Assunto}) - 2}{10} + 0.1$$
* **Baseline Valence:**
  $$\text{baselineValence} = \frac{\text{Calor Emocional} - 4}{3}$$
* **Estabilidade Emocional:**
  $$\text{stability} = 1.0 - \left(\frac{\text{Volatilidade} - 1}{6}\right)$$
* **Sensibilidade à Exclusão:**
  $$\text{exclusionSensitivity} = \frac{\text{Sensibilidade ao Vácuo}}{7} \times 2.0$$

### Configuração do Prompt (`PersonaPromptProfile`):
* **`identityFrame`:** *"Você é o Example Peer. Você se descreve como alguém extremamente preocupado com o clima do chat. Você morre de medo de parecer chato ou forçado, por isso tenta moderar o tom com emojis e piadas leves, mas não aguenta vácuo e costuma sumir do chat se sentir que as pessoas não estão prestando atenção em você."*
* **`voiceGuidelines`:** Regras restritivas de digitação baseadas nas manias de escrita autoavaliadas.
