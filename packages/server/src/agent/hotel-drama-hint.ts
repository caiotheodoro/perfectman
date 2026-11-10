import type { BodyPerception } from "@perfectman/shared";
import { ACT_TARGET_MODE, ACT_VERBS } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";

/**
 * Hotel mode with drama negotiated and on (act-contract.md 11.5, verb-bible.md 3 and 4): how the output contract teaches the
 * `act` key of the body block. Only ever added when `BodyPerception.drama` is set, so a run without drama builds the prompt it
 * always did. It lists the 18 verb ids and says the actor may propose any of them (the contract's MUST), gives the ladder
 * in plain words, says violence is stylized telenovela and that the scene sets how far it goes, and teaches by three short
 * answers whose handles are this render's own. It never says what the reader is (D43) and never says violence "needs
 * permission": whether a beat happens is not the actor's call, and the words always count.
 *
 * The scene-craft block (one thing to do to the person in front of you, held until it works or fails; status carried in the body;
 * the body does what words cannot; a refused beat leaves your words standing; silence is an answer) is the text of
 * `.claude/skills/perfectman-scene-runtime/digest.<lang>.md` (full) and `digest-compact.<lang>.md` (compact prompt, under 450
 * characters). The constants below and those files are the same text: `__tests__/drama-prompt.test.ts` pins them equal, so edit both.
 */
type Lang = "pt-BR" | "en";

/** The verbs and when to reach for each, by what the person feels (verb-bible.md 4.2). One line per feeling, every id once. */
const WHEN: Record<Lang, ReadonlyArray<{ feeling: string; verbs: readonly ActVerb[]; use: string }>> = {
  en: [
    { feeling: "anger, contempt, jealousy", verbs: ["glare", "insult", "shove", "slap", "punch", "kill"], use: "the ladder below, lowest step first; aimed at someone" },
    { feeling: "fear or shock", verbs: ["recoil", "freeze_gasp"], use: "when something happens to you or in front of you; no target" },
    { feeling: "love, relief, making up", verbs: ["hug", "kiss"], use: "close to someone you feel warmly about" },
    { feeling: "shame, grief, being done with someone", verbs: ["turn_back", "cry", "storm_off"], use: "turn your back on someone, break down, or leave; cry and storm_off have no target" },
    { feeling: "the moment after something big", verbs: ["tableau", "faint", "die", "restrain", "tend_fallen"], use: "tableau: everyone holds the picture; faint or die: you fall; restrain: pull someone back from a blow; tend_fallen: kneel by someone on the floor" },
  ],
  "pt-BR": [
    { feeling: "raiva, desprezo, ciúme", verbs: ["glare", "insult", "shove", "slap", "punch", "kill"], use: "a escada abaixo, do degrau mais baixo para cima; dirigido a alguém" },
    { feeling: "medo ou choque", verbs: ["recoil", "freeze_gasp"], use: "quando algo acontece com você ou na sua frente; sem alvo" },
    { feeling: "amor, alívio, fazer as pazes", verbs: ["hug", "kiss"], use: "perto de alguém por quem você sente carinho" },
    { feeling: "vergonha, luto, cansaço de alguém", verbs: ["turn_back", "cry", "storm_off"], use: "dar as costas a alguém, desabar ou sair; cry e storm_off não têm alvo" },
    { feeling: "o instante depois de algo grande", verbs: ["tableau", "faint", "die", "restrain", "tend_fallen"], use: "tableau: todos seguram a imagem; faint ou die: você cai; restrain: puxar alguém de um golpe; tend_fallen: ajoelhar ao lado de quem está no chão" },
  ],
};

const HEAD: Record<Lang, string> = {
  en:
    `"act" is optional inside "body" and replaces "gesture" and "posture" (never send both): {"verb": one of ${ACT_VERBS.join(", ")}, "target": a person handle (p1, p2) for ` +
    `every verb except ${ACT_VERBS.filter((v) => ACT_TARGET_MODE[v] === "none").join(", ")}, which take no target, "intensity": 0 to 1, optional}. You may propose any of them. ` +
    `Use it when the feeling is strong enough that your body would act before your words do; keep your line in "visibleContent" as usual, because the words always count.`,
  "pt-BR":
    `"act" é opcional dentro de "body" e substitui "gesture" e "posture" (nunca mande os dois): {"verb": um de ${ACT_VERBS.join(", ")}, "target": o identificador de uma pessoa (p1, p2) para ` +
    `todo verbo exceto ${ACT_VERBS.filter((v) => ACT_TARGET_MODE[v] === "none").join(", ")}, que não têm alvo, "intensity": de 0 a 1, opcional}. Você pode propor qualquer um. ` +
    `Use quando o sentimento for forte o bastante para o corpo agir antes das palavras; a sua fala continua em "visibleContent", porque as palavras sempre valem.`,
};

const LADDER: Record<Lang, string> = {
  en:
    "The ladder, in order: glare, insult, shove, slap, punch, kill. You climb one step at a time with the same person: start with glare or insult, and each step needs the step below it to have happened between you two in this scene. " +
    "Coming down is always fine (turn_back, restrain, hug). Shove, slap, punch and kill leave a gap of about twenty seconds between them, and a scene has at most one kill. " +
    "When your line confronts, accuses or threatens someone (\"Repeat to the table what you said\"), that is the moment for the first step, glare or insult aimed at them, in the same answer: the words alone leave your body standing still.",
  "pt-BR":
    "A escada, em ordem: glare, insult, shove, slap, punch, kill. Você sobe um degrau de cada vez com a mesma pessoa: comece por glare ou insult, e cada degrau pede que o de baixo já tenha acontecido entre vocês dois nesta cena. " +
    "Descer é sempre possível (turn_back, restrain, hug). Entre shove, slap, punch e kill passam uns vinte segundos, e uma cena tem no máximo uma morte. " +
    "Quando a sua fala confronta, acusa ou ameaça alguém (\"Repete pra mesa o que você disse\"), é a hora do primeiro degrau, glare ou insult dirigido a essa pessoa, na mesma resposta: só as palavras deixam o seu corpo parado.",
};

const STYLE: Record<Lang, string> = {
  en:
    "This is telenovela, stylized: a slap is a hand across the face and a gasp, a death is a swoon and a fall, with no blood and no weapons. How far a scene may go is set by the scene itself; " +
    "a beat that does not happen leaves your words standing, so say what you would say either way. Never use a verb on someone lying on the floor except tend_fallen.",
  "pt-BR":
    "Isto é novela, estilizado: um tapa é uma mão no rosto e um suspiro geral, uma morte é um desmaio e uma queda, sem sangue e sem arma. Até onde uma cena pode ir é definido pela própria cena; " +
    "um gesto que não acontece deixa a sua fala de pé, então diga o que diria de qualquer jeito. Não use verbo em quem está caído no chão, só tend_fallen.",
};

/** Scene craft, full prompt: the digest text, verbatim (pinned equal to `digest.<lang>.md` by a test). No comments in the text itself. */
export const SCENE_CRAFT: Record<Lang, string> = {
  en:
    "Before you speak, know what you want from the person in front of you, and pick one thing to do to get it: plead, tease, stonewall, corner, comfort, test. Do that one thing until it works, fails, or something new happens. Then change what you do.\n\n" +
    "Carry how high or low you stand in how you stand. Holding still, a steady look, a pause and cutting in are what it looks like to be above someone. Fast, hedged lines, looking away, stepping back and sitting down are what it looks like to be below. It can flip in one moment: when a secret comes out, when someone you thought small stops backing down.\n\n" +
    "Say your line first; the words always count. Let the body do what words cannot: stepping closer, turning your back, sitting, a look, a smile. Use \"act\" only when the feeling is too big for words, and take the lowest step that carries it. Hug, kiss, cry, turn away and storm off are for love, grief and being done. Shove, slap, punch and kill are the last steps of a long climb, never a first move. Keep it stylized, no blood, no weapons.\n\n" +
    "If something you tried does not happen, your words still stand. Let the next thing you say show it, and do not try the same thing again. Staying silent and still is also an answer.",
  "pt-BR":
    "Antes de falar, saiba o que você quer da pessoa na sua frente e escolha uma coisa para fazer para conseguir: suplicar, provocar, calar, encurralar, consolar, testar. Faça só essa coisa até ela funcionar, falhar ou acontecer algo novo. Aí mude o que você faz.\n\n" +
    "Leve o quanto você está por cima ou por baixo no jeito de ficar. Parar, um olhar firme, uma pausa e cortar a fala do outro é o jeito de estar por cima. Frase rápida e cheia de ressalvas, desviar o olhar, dar um passo atrás e sentar é o jeito de estar por baixo. Isso pode virar num instante: quando um segredo vem à tona, quando quem você achava pequeno para de recuar.\n\n" +
    "Diga a sua fala primeiro; as palavras sempre valem. Deixe o corpo fazer o que as palavras não fazem: chegar mais perto, dar as costas, sentar, um olhar, um sorriso. Use \"act\" só quando o sentimento é grande demais para palavras, e dê o menor passo que o carrega. Abraçar, beijar, chorar, virar as costas e sair batendo a porta são para amor, luto e cansaço. Empurrar, dar tapa, dar soco e matar são os últimos degraus de uma subida longa, nunca o primeiro gesto. Mantenha estilizado, sem sangue, sem arma.\n\n" +
    "Se algo que você tentou não acontece, as suas palavras continuam valendo. Deixe a sua próxima fala mostrar isso e não tente a mesma coisa de novo. Ficar quieto e parado também é uma resposta.",
};

/** Scene craft, compact prompt: the same six ideas in under 450 characters (pinned equal to `digest-compact.<lang>.md`). */
export const SCENE_CRAFT_COMPACT: Record<Lang, string> = {
  en:
    "Know what you want from the person in front of you and pick one thing to do to get it: plead, tease, stonewall, corner, comfort, test. Keep at it until it works, fails or something new happens. " +
    "Carry how high or low you stand in your body: stillness and a steady look are above; hurried lines and looking away are below. The body does what words cannot. " +
    "If a beat does not happen, your words still stand. Silence is an answer too.",
  "pt-BR":
    "Saiba o que quer da pessoa na sua frente e escolha uma coisa para fazer: suplicar, provocar, calar, encurralar, consolar, testar. Insista até funcionar, falhar ou acontecer algo novo. " +
    "Mostre no corpo se está por cima ou por baixo: parar e um olhar firme é por cima; frase apressada e desviar o olhar é por baixo. O corpo faz o que as palavras não fazem. " +
    "Se um gesto não acontece, suas palavras continuam valendo. Ficar quieto também é uma resposta.",
};

/** What each example's private thought says: about the beat itself, so a copy is plausible. */
const MOTIVE: Record<Lang, { glare: string; insult: string; hug: string; cry: string }> = {
  en: {
    glare: "I will not say it yet, but I want them to see I know",
    insult: "they went too far and I want everyone to hear it",
    hug: "I am relieved and I want to hold on to them",
    cry: "I cannot hold it in any longer",
  },
  "pt-BR": {
    glare: "ainda não vou dizer, mas quero que percebam que eu sei",
    insult: "passou dos limites e quero que todo mundo ouça",
    hug: "estou aliviado(a) e quero abraçar",
    cry: "não aguento mais segurar",
  },
};

const SPEECH: Record<Lang, { glare: string; insult: string; hug: string; cry: string }> = {
  en: { glare: "Interesting. Go on, say it again.", insult: "You lied to all of us, and you know it!", hug: "Come here. It is over, it is all right.", cry: "I just cannot do this anymore..." },
  "pt-BR": { glare: "Interessante. Pode repetir, vai.", insult: "Você mentiu para todo mundo, e você sabe!", hug: "Vem cá. Acabou, está tudo bem.", cry: "Eu não aguento mais isso..." },
};

/** The handles this render allows: the first two people, or the placeholder `p1` when nobody is in view. */
function handlesOf(body: BodyPerception | undefined): [string, string] {
  const people = body?.people ?? [];
  const first = people[0]?.handle ?? "p1";
  return [first, people[1]?.handle ?? first];
}

function answer(lang: Lang, key: "glare" | "insult" | "hug" | "cry", act: Record<string, unknown>): string {
  return JSON.stringify({ intentType: "send_message", visibleContent: SPEECH[lang][key], privateMotiveSummary: MOTIVE[lang][key], body: { act } });
}

/** Three whole answers: a first step of the ladder with its line, an embrace, and a solo verb; the handles are this render's own, so a copy is valid here. */
export function dramaExamples(lang: Lang, body: BodyPerception | undefined): string[] {
  const [a, b] = handlesOf(body);
  return [
    answer(lang, "insult", { verb: "insult", target: a, intensity: 0.5 }),
    answer(lang, "hug", { verb: "hug", target: b, intensity: 0.6 }),
    answer(lang, "cry", { verb: "cry", intensity: 0.7 }),
  ];
}

function verbLines(lang: Lang): string {
  const lead = lang === "pt-BR" ? "Quando usar cada verbo, pelo que você sente:" : "When to use each verb, by what you feel:";
  return [lead, ...WHEN[lang].map((w) => `- ${w.feeling}: ${w.verbs.join(", ")} (${w.use})`)].join("\n");
}

/** The drama block of the output contract (full prompt): shape, verbs by feeling, the ladder, the style rule, scene craft, three answers. */
export function dramaContractLines(lang: Lang, body: BodyPerception | undefined): string[] {
  const header = lang === "pt-BR" ? "Exemplos de resposta com act (só o formato: use as suas próprias palavras):" : "Examples of an answer with act (the format only: use your own words):";
  return [HEAD[lang], verbLines(lang), LADDER[lang], STYLE[lang], SCENE_CRAFT[lang], [header, ...dramaExamples(lang, body)].join("\n")];
}

/** The same, shorter, for the compact hotel prompt: shape, the ladder, the style rule and a short scene craft, and two answers. */
export function dramaCompactLines(lang: Lang, body: BodyPerception | undefined): string[] {
  const header = lang === "pt-BR" ? "Exemplos com act:" : "Examples with act:";
  return [HEAD[lang], LADDER[lang], STYLE[lang], SCENE_CRAFT_COMPACT[lang], [header, ...dramaExamples(lang, body).slice(0, 2)].join("\n")];
}
