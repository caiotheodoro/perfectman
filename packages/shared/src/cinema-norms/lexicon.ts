import { fold } from "../script-likeness/text.js";
import type { CineLang } from "./scene-types.js";

/**
 * Word lists behind the conflict-intensity proxy and the act detectors. Folded (no accents, lower case), matched on the joined
 * words of a turn. They are crude on purpose: the same lists read every source, so a bias hits every bucket alike. Original lists.
 */

const list = (s: string): string[] => s.split("|").map((x) => x.trim()).filter(Boolean);

/** Words and phrases that carry open hostility, threat or violence. Weight 1. */
const STRONG: Record<CineLang, string[]> = {
  pt: list(
    "cala a boca|cale a boca|cala boca|some daqui|sai daqui|saia daqui|fora daqui|cai fora|vai embora|vai se foder|foder|foda|fodido|porra|merda|caralho|puta|filho da puta|desgracado|desgracada|maldito|maldita|idiota|imbecil|" +
      "cretino|canalha|covarde|verme|nojento|nojenta|odeio|te odeio|vou te matar|vou matar|te mato|matar|matou|morrer|morra|morre|vagabunda|vagabundo|safado|safada|miseravel|mentiroso|mentirosa|traidor|traidora|traiu|" +
      "me larga|me solta|nao encosta|nao toca|socorro|burro|burra|bosta|otario|palhaco|bandido|assassino|assassina|sangue|faca|revolver|tiro|atirar|atira|bala|arma|ameaca|vai se arrepender|cachorro|lixo|inferno|diabo|droga",
  ),
  en: list(
    "shut up|get out|go to hell|fuck|fucking|shit|bastard|bitch|asshole|dick|goddamn|damn you|idiot|moron|coward|liar|traitor|scum|hate you|i hate|kill you|kill|killed|murder|murderer|die|dead|bleed|blood|knife|gun|shoot|shot|bullet|weapon|" +
      "i swear|how dare you|let go|get away|dont touch|stay away|back off|leave me|son of a bitch|motherfucker|jerk|creep|monster|bastards|you will pay|youll regret|regret|threat|screw you|piss off|get lost|liar|filth|pathetic",
  ),
};

/** Weaker markers of pressure (pleading, ordering, stopping someone). Weight 0.5. */
const MILD: Record<CineLang, string[]> = {
  pt: list("pare|para com isso|chega|basta|nunca mais|acabou|louco|louca|doente|mentira|culpa|culpado|culpada|cuidado|por favor|me escuta|escuta aqui|olha aqui|agora|ja|nao vou|nao posso|nao quero|mentir|odio|medo|chorar|desculpa|perdao"),
  en: list("stop|enough|never again|its over|crazy|insane|sick|lie|lies|blame|guilty|careful|please|listen to me|look at me|now|i cant|i wont|i dont want|afraid|scared|cry|sorry|forgive|why did you|what did you"),
};

/** Hard physical acts in a stage direction or sound cue. */
const HARD_ACT: Record<CineLang, string[]> = {
  pt: list(
    "tapa|esbofeteia|estapeia|bate|bateu|soco|socos|murro|empurra|empurrou|chuta|chutou|agarra|agarrou|estrangula|enforca|esfaqueia|esfaqueou|atira|atirou|dispara|mata|matou|morre|morreu|cai morto|desmaia|desmaiou|cai|joga|arremessa|quebra|destroi|" +
      "esmurra|segura pelo|puxa pelo|arranca|aponta a arma|saca a arma|luta|briga",
  ),
  en: list(
    "slap|slaps|slapped|hits|hit|punch|punches|punched|strikes|struck|shoves|shoved|pushes|pushed|kicks|kicked|grabs|grabbed|chokes|strangles|stabs|stabbed|shoots|is shot|gets shot|shot dead|shot in|shot at|fires at|fires a|fired at|fired a|opens fire|gunshot|kills|killed|dies|died|falls dead|collapses|faints|passes out|" +
      "throws|hurls|smashes|slams|destroys|tackles|drags|yanks|rips|points a gun|draws a gun|aims|fights|struggles|wrestles|explosion|explodes|screams|crash|crashes",
  ),
};

/** Tenderness acts: count as physical beats, but they are not conflict. */
const AFFECT_ACT: Record<CineLang, string[]> = {
  pt: list("beija|beijou|abraca|abracou|beijo|abraco|acaricia|afaga|beija a mao"),
  en: list("kisses|kissed|kiss|embraces|embraced|hugs|hugged|hug|caresses|strokes"),
};

/** Small body movement (not violence). */
const SOFT_ACT: Record<CineLang, string[]> = {
  pt: list("senta|levanta|anda|caminha|olha|vira|entra|sai|abre|fecha|pega|acende|serve|bebe|fuma|sorri|ri|suspira|balanca|aproxima|afasta|cruza|encara|se levanta|se senta|volta|para|corre|foge|chora|chorou|grita|sussurra"),
  en: list("sits|stands|walks|crosses|looks|turns|enters|exits|opens|closes|picks|lights|pours|drinks|smokes|smiles|laughs|sighs|shakes|approaches|steps|faces|stares|rises|returns|stops|runs|flees|cries|shouts|whispers|nods|pauses|gestures"),
};

const PAUSE_WORDS: Record<CineLang, string[]> = {
  pt: list("pausa|pausa longa|silencio|em silencio|silencio constrangedor|segundos|um tempo|longo silencio|demora|hesita|hesitacao|sem responder|nao responde"),
  en: list("pause|long pause|beat|a beat|silence|silent|in silence|awkward silence|seconds|a moment|hesitates|hesitation|doesnt answer|no answer|says nothing|long moment"),
};

const compile = (phrases: string[]): RegExp => new RegExp(`(?:^| )(?:${phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?: |$)`, "g");
const cache = new Map<string, RegExp>();
const rx = (kind: string, lang: CineLang, src: Record<CineLang, string[]>): RegExp => {
  const k = `${kind}:${lang}`;
  let r = cache.get(k);
  if (!r) cache.set(k, (r = compile(src[lang])));
  return r;
};

/** Folded text with single spaces and punctuation as spaces. */
export const flat = (text: string): string =>
  fold(text)
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const count = (re: RegExp, s: string): number => {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) n += 1;
  return n;
};

export const strongHits = (flatText: string, lang: CineLang): number => count(rx("strong", lang, STRONG), flatText);
export const mildHits = (flatText: string, lang: CineLang): number => count(rx("mild", lang, MILD), flatText);
export const hardActHits = (flatText: string, lang: CineLang): number => count(rx("hard", lang, HARD_ACT), flatText);
export const affectActHits = (flatText: string, lang: CineLang): number => count(rx("affect", lang, AFFECT_ACT), flatText);
export const softActHits = (flatText: string, lang: CineLang): number => count(rx("soft", lang, SOFT_ACT), flatText);
export const pauseHits = (flatText: string, lang: CineLang): number => count(rx("pause", lang, PAUSE_WORDS), flatText);
