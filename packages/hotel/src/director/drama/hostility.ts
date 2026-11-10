/**
 * What a spoken line does to the person it is about (errata P7, P8): a word list, no model. The engine's relational rules are blind to content (a directed
 * `message_sent` warms its target, `resentmentDelta: 0`), so a cast that only talks never builds the grievance the ladder's motive gate (LAD-6) asks for.
 * This reads one line and says whether it is an insult, a threat, blackmail or an ultimatum, an accusation, a challenge (a dare, a bet) or mockery;
 * `ProvocationLedger` turns that into a bounded, decaying grievance. The lists are small and literal on purpose (pt-BR and English, diacritics folded): a miss
 * costs a beat the director would not have started, a false hit is capped by the ledger and by the scenario's `may_target` pairs.
 *
 * Blackmail and accusation (P8) are phrases, not bare words: `escandalo`, `ou voce`, `foi voce que`, `eu vi voce` and `mente` are all ordinary talk, so each is
 * written with the verb or the object that makes it a demand or a charge (a corpus of ordinary pt-BR lines and the persona packs' style examples are the
 * false-positive check, `hostility-false-positives.test.ts`).
 *
 * Reported speech (P8): a hostile word inside a frame that reports someone else's words ("ela te chamou de burro", "disse que voce e um idiota", "she called
 * you a liar") is not the speaker's own insult. `readHostility` returns it as `reported`, apart from `own`, and `ProvocationLedger` raises no grievance against
 * the messenger for it. No regex lookbehind is used: the shared builds run on older engines.
 */

export type HostilityKind = "insult" | "threat" | "blackmail" | "accusation" | "challenge" | "mockery";

/** What a line holds: the strongest kind of its own, and the strongest kind it only reports. */
export type LineReading = { own?: HostilityKind; reported?: HostilityKind };

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A global regex that finds a phrase of the list at word boundaries, with no lookbehind: group 1 is the character (or start) the phrase follows. */
const word = (list: readonly string[]): RegExp => new RegExp(`(^|[^a-z0-9])(?:${list.join("|")})(?![a-z0-9])`, "g");

const INSULT = word([
  "imbecil", "idiota", "babaca", "otario", "otaria", "trouxa", "burro(?! de carga)", "burra", "palhaco", "palhaca", "cretino", "cretina", "lixo", "vagabundo", "vagabunda",
  "covarde", "mentiroso", "mentirosa", "ladrao", "nojento", "nojenta", "canalha", "safado", "safada", "fdp", "desgracado", "maldito", "maldita", "traidor",
  "traidora", "traira", "verme", "bosta", "arrombado", "fracassado", "fracassada", "inutil", "patetico", "patetica", "ridiculo", "ridicula", "cuzao", "corno",
  "porcaria", "imundo", "sem vergonha", "cara de pau", "filho da puta", "filha da puta", "cala a boca", "cala boca", "vai se foder", "vai tomar no", "se fode",
  "idiot", "moron", "stupid", "jerk", "loser", "liar", "coward", "pathetic", "scum", "bastard", "asshole", "dumbass", "jackass", "worthless", "traitor", "creep",
  "shut up", "piece of shit", "go to hell", "fuck you", "screw you",
]);

const THREAT = word([
  "vou te (?:matar|quebrar|arrebentar|bater|socar|encher|acabar|esmagar|pegar)", "te (?:mato|quebro|arrebento|soco|pego|esgano|acabo)", "na minha cara", "repete (?:isso|ai|o que)",
  "repita", "quer (?:brigar|apanhar|briga|levar)", "sai pra fora", "parte pra cima", "me enfrenta", "levanta (?:a mao|pra mim)", "voce vai (?:se arrepender|pagar)",
  "say it to my face", "i(?:'ll| will) (?:kill|hit|break|crush|punch)", "step outside", "want to fight", "come at me", "you(?:'ll| will) (?:regret|pay)", "watch your back",
]);

/** A demand with a price on silence, or an ultimatum: "pay or I tell" (P8). Each phrase names the disclosure or the demand; `ou eu` and `ou voce` alone are ordinary. */
const DISCLOSE = "conto|abro a boca|exponho|revelo|denuncio|entrego|vou (?:contar|abrir a boca|expor|revelar|denunciar|entregar|falar tudo|dizer tudo)";
const BLACKMAIL = word([
  `senao eu (?:${DISCLOSE})`, `ou (?:entao )?eu (?:${DISCLOSE})`, "abro a boca", "vou abrir a boca",
  "vou contar (?:pra|para|a) (?:todos|todo mundo|toda a mesa|a mesa|mesa|a policia|a imprensa|todo o mundo)", "conto (?:pra|para|a) (?:todos|todo mundo|toda a mesa|a mesa|mesa|a policia|a imprensa|todo o mundo)",
  "cofre hoje", "cofre ou", "ou voce (?:paga|me paga|vai pagar|se arrepende|me da|me entrega|devolve|assina|sai daqui)", "(?:pague|paga) ou", "ou paga",
  "(?:nao )?quer escandalo", "(?:vou|vai|vamos|faco|armo|dou) (?:fazer |armar |dar |ter |virar )?(?:um )?escandalo", "(?:vira|virar|virou) escandalo", "escandalo (?:nao )?(?:interessa|vai)",
  "or i(?:'ll| will)? (?:tell|talk|expose|reveal|spill|go to)", "or else", "pay up or", "or you(?:'ll| will)? (?:pay|regret)", "i(?:'ll| will) tell (?:everyone|the (?:whole )?table|them all|the police)", "open my mouth",
]);

/** A charge of a lie, a forgery, a theft, a betrayal, or of having done it (P8). */
const DEED = "roubou|mentiu|forjou|falsificou|matou|quebrou|escondeu|traiu|vendeu|enganou|armou|apertou|segurou|assinou|plantou|derrubou|empurrou|bateu";
const ACCUSATION = word([
  "(?:voce|tu|ele|ela|vc) mente", "mentiu", "mentiram", "falsificou", "falsificaram", "forjou", "forjaram",
  "(?:voce|tu|ele|ela|vc|voces|eles|elas) (?:(?:me|te|nos|a gente|todos|todo mundo) )?enganou", "enganou (?:a )?(?:todo mundo|todos|a gente|a mim)", "roubou(?! a cena)", "roubaram",
  `foi (?:voce|ela|ele|tu) (?:que|quem) (?:${DEED})`, "a mao que (?:apertou|assinou|segurou|empurrou|bateu|roubou|escreveu|forjou|matou|puxou|derrubou|plantou|disparou)",
  "assinatura (?:falsa|forjada|falsificada)", "falsa assinatura", "(?:documento|carta|letra) (?:falso|falsa|forjado|forjada|falsificado|falsificada)",
  "eu vi (?:tudo|o que voce fez)", "eu vi voce (?:roubar|roubando|mexer|mexendo|esconder|escondendo|plantar|plantando|assinar|assinando|segurar|segurando|apertar|apertando|mentir|mentindo|forjar|forjando)",
  "sei (?:o que|tudo o que|tudo que|de tudo o que|de tudo que) (?:voce|tu|ela|ele|voces) (?:fez|escondeu|tramou|aprontou|fizeram)",
  "you(?:'ve| have)? (?:forged|lied|stolen|stole|cheated|betrayed|framed)", "you(?:'re| are) lying", "i saw what you did", "i know what you did", "it(?:'s| is| was) you who",
]);

const CHALLENGE = word([
  "duvido", "aposto", "aposta", "apostar", "apostei", "quero ver", "nao tem coragem", "tem coragem", "te desafio", "desafio voce", "paga a aposta", "cade o dinheiro",
  "i bet", "bet you", "dare you", "i dare", "prove it", "put your money", "double or nothing",
]);

const MOCKERY = word([
  "k{3,}", "(?:ha){2,}", "(?:he){2,}", "rsrs+", "lol", "que piada", "faz (?:me|eu) rir", "coitado", "coitadinho", "se achando", "se acha", "ri da cara", "poor thing", "cry me a river",
]);

/** Strongest first: a threat, then blackmail, an insult, an accusation, a challenge, a laugh. */
const ORDER: ReadonlyArray<readonly [HostilityKind, RegExp]> = [
  ["threat", THREAT],
  ["blackmail", BLACKMAIL],
  ["insult", INSULT],
  ["accusation", ACCUSATION],
  ["challenge", CHALLENGE],
  ["mockery", MOCKERY],
];

/**
 * The verbs and pronouns that mark someone else's words, ending where the reported words begin. "chamou (voce) de", "disse que", "falou:", "segundo ela", "she called
 * you", "he said you". A frame whose subject is the speaker ("eu disse que voce e um idiota", "i said you are") is the speaker's own words and is not one.
 */
const REPORT_PT = [
  "(?:chamou|chamaram|chama|chamam|chamava|chamavam|chamando|xingou|xingaram|xingando) (?:[a-z]+ ){0,2}?(?:de|como)",
  "(?:disse|disseram|diz|dizem|dizia|diziam|dizendo|falou|falaram|fala|falam|falava|falando|contou|contaram|conta|contam|comentou|comentaram|escreveu|escreveram|afirmou|afirmam|garantiu|jurou|jura|insinuou|insinuando|alegou|alegam|sugeriu|sugere|gritou|berrou|declarou|publicou|postou|acha|acham|achou|pensa|pensam|pensou|acredita|acusou|acusaram|ouvi dizer|ouvi falar|soube) (?:[a-z]+ ){0,2}?que",
  "(?:disse|falou|gritou|escreveu|postou|comentou|respondeu|berrou):",
  "segundo (?:ele|ela|eles|elas|[a-z]+)",
];
const REPORT_EN = [
  "(?:called|calls|calling) (?:you|me|us|him|her|them|[a-z]+)",
  "(?:said|says|saying|told (?:me|us|him|her|them)|tells (?:me|us)|claimed|claims|heard|wrote|texted|thinks|thought)(?: that)?(?= (?:you|he|she|they|we|i|everyone|people)(?![a-z0-9]))",
];
const REPORT = word([...REPORT_PT, ...REPORT_EN]);
/** The speaker's own subject right before a frame: "eu disse", "eu ja falei", "i said". */
const OWN_SUBJECT = /(?:^|[^a-z0-9])(?:eu|i)(?: (?:ja|bem|sempre|tambem|also|always|already|just))? $/;
/** Where the reported words stop: a sentence end, a dash, a turn ("mas", "e eu", "e voce"). */
const CLAUSE_BREAK = /[.!?;\n—]|(?:^|[^a-z])(?:mas|porem|but|e eu|e voce|and i|and you)(?:[^a-z]|$)/;
/** How far past the frame the reported words may run. */
const REPORT_REACH = 45;

type Hit = { at: number; end: number };

function hits(re: RegExp, text: string): Hit[] {
  const out: Hit[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push({ at: m.index + (m[1]?.length ?? 0), end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** The frames in `text` that report another's words: where each ends. */
function frames(text: string): Hit[] {
  return hits(REPORT, text).filter((f) => !OWN_SUBJECT.test(text.slice(0, f.at)));
}

/**
 * What one line holds. Each hostile phrase is own unless it sits inside a reporting frame (within `REPORT_REACH` characters of its end, with no clause break
 * between); `own` is the strongest own kind and `reported` the strongest reported one. Nothing for an empty line.
 */
export function readHostility(text: string | undefined): LineReading {
  if (!text) return {};
  const t = fold(text);
  const reports = frames(t);
  const out: LineReading = {};
  for (const [kind, re] of ORDER) {
    for (const h of hits(re, t)) {
      const frame = [...reports].reverse().find((f) => f.end <= h.at && h.at - f.end <= REPORT_REACH && !CLAUSE_BREAK.test(t.slice(f.end, h.at)));
      if (frame) out.reported ??= kind;
      else out.own ??= kind;
    }
    if (out.own && out.reported) break;
  }
  return out;
}

/** The strongest kind of hostility the speaker means in one line, or none. A line counts once, whatever it says; words it only reports do not count. */
export function classifyHostility(text: string | undefined): HostilityKind | undefined {
  return readHostility(text).own;
}
