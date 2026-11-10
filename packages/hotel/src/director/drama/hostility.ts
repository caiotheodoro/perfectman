/**
 * What a spoken line does to the person it is about (errata P7): a word list, no model. The engine's relational rules are blind to content (a directed
 * `message_sent` warms its target, `resentmentDelta: 0`), so a cast that only talks never builds the grievance the ladder's motive gate (LAD-6) asks for.
 * This reads one line and says whether it is an insult, a threat, a challenge (a dare, a bet) or mockery; `ProvocationLedger` turns that into a bounded,
 * decaying grievance. The lists are small and literal on purpose (pt-BR and English, diacritics folded): a miss costs a beat the director would not have
 * started, a false hit is capped by the ledger and by the scenario's `may_target` pairs.
 */

export type HostilityKind = "insult" | "threat" | "challenge" | "mockery";

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const word = (list: readonly string[]): RegExp => new RegExp(`(?<![a-z0-9])(?:${list.join("|")})(?![a-z0-9])`);

const INSULT = word([
  "imbecil", "idiota", "babaca", "otario", "otaria", "trouxa", "burro", "burra", "palhaco", "palhaca", "cretino", "cretina", "lixo", "vagabundo", "vagabunda",
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

const CHALLENGE = word([
  "duvido", "aposto", "aposta", "apostar", "apostei", "quero ver", "nao tem coragem", "tem coragem", "te desafio", "desafio voce", "paga a aposta", "cade o dinheiro",
  "i bet", "bet you", "dare you", "i dare", "prove it", "put your money", "double or nothing",
]);

const MOCKERY = word([
  "k{3,}", "(?:ha){2,}", "(?:he){2,}", "rsrs+", "lol", "que piada", "faz (?:me|eu) rir", "coitado", "coitadinho", "se achando", "se acha", "ri da cara", "poor thing", "cry me a river",
]);

/** The strongest kind of hostility in one line, or none. A line counts once, whatever it says: threat, then insult, then challenge, then mockery. */
export function classifyHostility(text: string | undefined): HostilityKind | undefined {
  if (!text) return undefined;
  const t = fold(text);
  if (THREAT.test(t)) return "threat";
  if (INSULT.test(t)) return "insult";
  if (CHALLENGE.test(t)) return "challenge";
  if (MOCKERY.test(t)) return "mockery";
  return undefined;
}
