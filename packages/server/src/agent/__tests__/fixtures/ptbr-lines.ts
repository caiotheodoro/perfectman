/**
 * Lines the repetition guards are tested against.
 *
 * `PRODUCTION` holds the lines quoted from the 2026-11-10 hotel runs (pt-BR) that got through the older guard. Where the
 * exact text was not kept (the tail of Ian's second line, run 57's and run 53's tic lines) the lines are written in
 * the same shape and say so.
 *
 * `NORMAL` is a corpus of distinct, ordinary pt-BR chat lines: accents (ã õ ç é ê), "KKKK", slang, ALL CAPS shouting,
 * numbers, short interjections, and pairs that share a stock frame ("eu não sei", "você já viu"). No two of them are
 * a repeat of each other, so any guard that fires on a pair, a window or a single line is a false positive.
 */

/** Run 56, Ian, 15:17:54. */
export const IAN_FIRST = "Mamão, isso tá frio mesmo! Sente aí junto e vamos criar calor de conversa.";
/** Run 56, Ian, 15:20:11: the same sentence "with a short tail" (the tail's exact words were not kept). */
export const IAN_SECOND = `${IAN_FIRST} Bora, galera, ninguém vai ficar de fora.`;
/** Run 56, Caio, 15:19:05 and again at 15:19:32. */
export const CAIO_JOKE = "Se ele desse uma força, talvez dispensasse o cooper, KKKKK";

/** Run 57, Pistolinha: the question in 5 of ~6 lines (the surrounding words are made up, the question is quoted). */
export const PISTOLINHA = [
  "Escuta, Caio, antes de abrir qualquer envelope eu preciso saber uma coisa: você já viu um pato de perto?",
  "Lasanha fechada não se abre assim, hein, e ninguém aqui me respondeu ainda. Você já viu um pato de perto?",
  "E aí, Caio, deixa o cooper pra lá por um minuto e me diz com sinceridade, você já viu um pato de perto de verdade?",
  "Eu falei do envelope, mas antes me diz, porque isso muda tudo: você já viu um pato de perto?",
  "Calma, calma, ninguém aqui vai julgar ninguém, só me responde direito: você já viu um pato de perto?",
];

/** Run 53, Heloísa: nearly every line ends the same way (the lines are made up, the tic is quoted). */
export const HELOISA = [
  "Eu só quero o melhor pra você, meu bem... não é, querido?",
  "A família sempre vem em primeiro lugar, meu bem... não é, querido?",
  "Ninguém aqui quer te prejudicar, meu bem... não é, querido?",
  "Foi só um mal-entendido com o papel, meu bem... não é, querido?",
  "Vamos esquecer essa conversa de assinatura, meu bem... não é, querido?",
];

/** Run 56: a count that contradicts the line before it. Digit and word disagreement is out of scope for the guards. */
export const DUZENTAS = ["Foram DUZENTAS pratas, eu paguei na hora.", "Duas mil pratas?"];

/** Run 56 garbles. */
export const GARBLED = ["Éduğunu, mano, fala sério.", "Eu tenho umapreciação enorme por você, Caio."];

export const NORMAL: readonly string[] = [
  "Oi, gente! Cheguei atrasado de novo, desculpa aí.",
  "Eita, olha quem resolveu aparecer.",
  "Você viu o que aconteceu na rua ontem? Foi uma loucura.",
  "KKKKKKK não acredito que você falou isso na frente dela",
  "Eu não sei, cara. Sinceramente, eu não sei o que fazer.",
  "Eu não sei se devo confiar nele ou não.",
  "Quanto você pagou nessa jaqueta? Parece cara.",
  "DUZENTAS pratas! Você ficou maluco?",
  "Calma, calma, ninguém aqui está te acusando de nada.",
  "Então me explica por que o envelope estava na sua mochila.",
  "Esse envelope não é meu, juro por Deus.",
  "Ah, claro, agora a culpa é de todo mundo menos sua.",
  "Já passou da meia-noite e eu ainda nem jantei.",
  "Bora pedir uma pizza? Eu pago a primeira rodada.",
  "Pizza de quê? Não me venha com calabresa de novo.",
  "A Heloísa disse que viria, mas até agora nada.",
  "Otávio, assina logo isso e vamos embora daqui.",
  "Aquela assinatura não é a do meu pai, eu conheço a letra dele.",
  "Você tem certeza? Olha de novo com calma.",
  "Tenho, porque ele sempre fez o T com um risquinho embaixo.",
  "Não vou falar mais nada sem o meu advogado.",
  "Advogado? Mas ninguém chamou a polícia, pelo amor de Deus.",
  "Pistolinha, cadê o pato que você prometeu trazer?",
  "O pato fugiu quando abri a porta do carro, não foi culpa minha.",
  "Que absurdo! Esse bar tá mais caro a cada semana.",
  "Três reais num copo d'água, dá pra acreditar?",
  "Sério isso? Nem a água é de graça mais.",
  "Eu sei que você está mentindo, Caio, a sua orelha fica vermelha.",
  "Minha orelha não fica vermelha, é o calor daqui.",
  "Calor nada, tá um frio de rachar lá fora.",
  "Vem cá, senta do meu lado e me conta tudo desde o começo.",
  "Do começo? Foi na terça, quando o Cooper me ligou.",
  "O Cooper nunca liga pra ninguém, ele manda mensagem de voz.",
  "Mensagem de voz de quarenta minutos, pra ser exato.",
  "Aff, odeio quando fazem isso. Fala logo, gente.",
  "Eu fico nervoso quando todo mundo me olha desse jeito.",
  "Ninguém tá te olhando, relaxa e toma um gole.",
  "Tá bom, mas só um, porque amanhã eu acordo cedo.",
  "Acordar cedo pra quê? Hoje é sábado, criatura.",
  "Tenho consulta no dentista às oito, não me julga.",
  "Dentista de sábado? Esse cara deve cobrar o triplo.",
  "Cobra mesmo, mas ele é o único que não machuca.",
  "Uma vez ele esqueceu a broca dentro da minha boca. Brincadeira!",
  "HAHAHA você é terrível, Duda.",
  "Gente, olha só a hora, o último ônibus sai em dez minutos.",
  "Eu vou de táxi, sem problema, pode ficar.",
  "Táxi a essa hora custa um rim, melhor dividir um carro.",
  "Divide comigo, eu moro perto da praça da matriz.",
  "Perto da praça? Então a gente é vizinho e eu nem sabia.",
  "Sabia sim, você só finge que não pra não me convidar.",
  "Eu convido, convido sim, na próxima eu faço um churrasco.",
  "Churrasco de domingo? Conta comigo e com a minha farofa.",
  "Farofa não, pelo amor de Deus, a última virou cimento.",
  "Foi a única vez, e a gente comeu mesmo assim.",
  "Comeu porque estava com fome, não porque estava boa.",
  "Mudando de assunto: alguém aqui entende de contrato de aluguel?",
  "Eu entendo um pouco, meu irmão é corretor de imóveis.",
  "Então me ajuda, o dono quer aumentar o aluguel em trinta por cento.",
  "Trinta por cento é abuso, a lei não permite isso assim.",
  "Ele disse que é por causa da reforma do telhado.",
  "Mostra o contrato pra mim amanhã que eu dou uma olhada.",
  "Valeu, mano, você me salvou de um problemão.",
  "Ainda não salvei nada, calma, primeiro eu preciso ler tudo.",
  "Tá, mas não demora, ele quer resposta até sexta.",
  "Tá!",
  "Boa noite, pessoal. Alguém viu minha carteira por aqui?",
  "Carteira marrom, com um adesivo de time de futebol?",
  "Essa mesma! Onde você achou?",
  "Debaixo da mesa, estava ali junto do seu casaco.",
  "Obrigado, Heloísa, você é uma santa.",
  "Santa nada, eu só tenho olho bom pra achar coisa perdida.",
  "Então acha meu óculos também, faz dois dias que sumiu.",
  "Seus óculos estão na sua cabeça, querido.",
  "Ué, estão mesmo. Que vergonha.",
  "KKKKKK essa foi boa demais",
  "Eu juro que não encostei no cofre, pode me revistar.",
  "Ninguém falou nada de cofre, por que você tocou nesse assunto?",
  "Porque o Otávio comentou antes, eu só ouvi falar.",
  "Eu comentei de passagem, não foi acusação de ninguém.",
  "Chega! Cada um fala uma coisa, assim eu não entendo nada.",
  "Vamos por ordem: quem chegou primeiro no escritório hoje?",
  "Fui eu, cheguei às sete e meia e a porta já estava aberta.",
  "Aberta? Mas eu fechei ela com chave ontem à noite.",
  "Então alguém tem uma cópia da chave, só pode ser isso.",
  "A cópia fica com a faxineira, a Dona Neide.",
  "A Dona Neide está de férias desde segunda-feira.",
  "Está de férias, mas o neto dela trabalha aqui às quartas.",
  "O neto? Aquele magrinho de óculos escuros dentro do prédio?",
  "Ele mesmo, e anda gastando bastante pra quem ganha pouco.",
  "Isso não prova nada, ele pode ter ganhado na rifa.",
  "Rifa de quê, Caio? Nunca vi rifa nesse prédio.",
  "Do clube de xadrez, tem um prêmio de quinhentos reais.",
  "Quinhentos reais não paga aquele relógio que ele usa.",
  "Pode ser um relógio falso, desses de camelô da esquina.",
  "Vou olhar de perto amanhã e te falo o que achei.",
  "Beleza, mas sem escândalo, a gente conversa no almoço.",
  "Combinado. E agora, mais uma rodada pra fechar a noite?",
  "Fecha a conta, que eu preciso dormir antes das duas.",
  "Eu fico mais um pouquinho, o jogo ainda não acabou.",
  "Que jogo? O campeonato acabou domingo passado.",
  "QUE ISSO, MEU CHEFE?! TÁ DOIDO?!",
  "Mano do céu, que cena é essa?",
  "Tipo assim, eu nem queria vir, mas vim.",
  "Vish, a conversa tá ficando séria aqui.",
  "Aí complica, né?",
  "Boa, parceiro! Era disso que eu tava falando.",
  "Você já viu o que ele fez com a porta do banheiro?",
  "Você já foi a algum show daquela banda de forró?",
  "Meu bem, senta aqui, o jantar já vai sair.",
  "Meu bem, não faz drama por causa de um copo quebrado.",
  "Não é, querido, não é nada disso que você está pensando.",
  "Cadê o pato? Alguém viu o pato por aí?",
  "Pato de borracha ou pato de verdade, Pistolinha?",
  "Lasanha fechada, hein? Isso é novidade no cardápio.",
  "A lasanha da casa vem fechada mesmo, é assim desde 2019.",
  "Mamão, você tá com cara de quem perdeu o ônibus.",
  "Sente aí, a cadeira é sua, ninguém vai te tirar daí.",
  "Calor de conversa é bom, mas calor de verdade é demais.",
  "Se ele ajudasse a gente, o Cooper já estaria fora disso.",
  "Dispensar o Cooper agora seria burrice, ele sabe a senha do cofre.",
  "Preciso de dois minutos a sós com você, só dois.",
  "Dois minutos de quê? Você nunca fala só por dois minutos.",
  "O próximo passo é ligar pro dono e contar a verdade.",
  "Aposto que você não aguenta ficar calado nem por uma hora.",
  "Aposto vinte reais que ele chega antes das onze.",
  "Senta aí, a gente espera juntos, não tem pressa nenhuma.",
  "Os dois ficaram quietos quando entrei, achei estranho.",
  "Foi mal, eu não queria te acordar, volta a dormir.",
];
