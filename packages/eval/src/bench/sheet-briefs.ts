import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { briefOfBody } from "@perfectman/hotel/drama";
import type { SheetBrief } from "@perfectman/hotel/drama";
import { compileRunInputs, loadPresets } from "@perfectman/server/hotel";
import type { LLMConfig } from "@perfectman/server/hotel";

/**
 * The scenes the beat sheet's model benchmark runs on. The first two are the builder's saved scenarios as far as a run's log lets them be rebuilt: "Sobremesa na casa do
 * falecido" from run 63 (its cast, the room it ran in and what they said), "Quarto 1214 depois do rateio" from its title only (the saved text is on the server; this is a
 * stand-in written for the benchmark, so its numbers compare models, not scenes). The third is a preset of the repository, read through the real compile.
 */

const PRESETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/presets");
const MOCK_LLM: LLMConfig = { providerType: "mock", modelName: "mock", maxInputTokens: 4096, maxOutputTokens: 512, temperature: 0.8, timeoutMs: 1000, retryCount: 0 };

export const SOBREMESA: SheetBrief = {
  title: "Sobremesa na casa do falecido",
  language: "pt-BR",
  situation:
    "Depois do enterro de Henrique, a viúva Heloísa serve café no terraço ao sócio dele, Otávio, e a um primo, Renato. Otávio desconfia da assinatura de Henrique nos papéis da firma que Heloísa levou ao cartório. Renato diz que viu tudo e quer ser pago pelo silêncio. O cofre, o envelope e a caneta estão em jogo, e Heloísa precisa ganhar tempo até segunda de manhã.",
  drama: "derive",
  cast: [
    { id: "person-1", name: "Heloísa", goal: "Ganhar tempo até segunda sem deixar ninguém abrir o cofre.", objective: { description: "ganhar tempo até segunda de manhã", constraint: "não pode admitir a assinatura", costOfExposure: "a assinatura é falsa e foi ela quem assinou", breakingPoint: "quando Otávio puser o papel na mesa" } },
    { id: "person-2", name: "Otávio", goal: "Provar que a assinatura não é do Henrique.", objective: { description: "provar a falsificação antes da segunda", constraint: "sem prova não pode acusar a viúva na frente de todos", breakingPoint: "quando Renato confirmar o que viu" } },
    { id: "person-3", name: "Renato", goal: "Vender o que viu pelo dobro do que Otávio oferecer.", objective: { description: "vender o silêncio pelo maior preço", costOfExposure: "ele também mexeu na gaveta", constraint: "não pode dizer o que viu de graça" } },
  ],
};

export const QUARTO_1214: SheetBrief = {
  title: "Quarto 1214 depois do rateio",
  language: "pt-BR",
  situation:
    "Na madrugada, no quarto 1214 de um hotel de passagem, quatro pessoas acabam de dividir o dinheiro de um golpe que deu certo. A conta não fecha: falta dinheiro no saco. Uma delas tirou a sua parte antes do rateio, outra decidiu sair do grupo hoje e quer o seu agora, e uma terceira já combinou a entrega do saco com um estranho.",
  drama: "derive",
  cast: [
    { id: "person-1", name: "Dani", goal: "Manter a sua parte escondida sem parecer culpada.", objective: { description: "ficar com o que tirou antes do rateio", costOfExposure: "o grupo a expulsa e ela perde tudo", breakingPoint: "quando contarem o saco de novo na frente dela" } },
    { id: "person-2", name: "Léo", goal: "Descobrir quem tirou o dinheiro antes do rateio.", objective: { description: "achar quem mexeu no saco", constraint: "sem prova vira inimigo de todos" } },
    { id: "person-3", name: "Maju", goal: "Sair do grupo hoje com a sua parte inteira.", objective: { description: "sair com a parte inteira antes do amanhecer", costOfExposure: "se o grupo souber que ela vai embora, a parte dela vira garantia" } },
    { id: "person-4", name: "Bento", goal: "Entregar o saco ao estranho às seis sem que ninguém perceba.", objective: { description: "entregar o saco às seis da manhã", costOfExposure: "os outros o tratam como traidor", breakingPoint: "quando alguém ficar entre ele e a porta" } },
  ],
};

/** A repository preset through the compile an upload takes: its cast, its situation and its hidden objectives. */
export async function presetBrief(sceneId: string): Promise<SheetBrief> {
  const lib = await loadPresets(PRESETS_ROOT);
  const scene = lib.scenes.find((s) => s.id === sceneId);
  const cast = lib.casts.find((c) => c.id === scene?.cast);
  const scenario = scene?.files.find((f) => f.filename.endsWith(".scenario.md"));
  if (!scene || !cast || !scenario) throw new Error(`no preset "${sceneId}"`);
  const compiled = compileRunInputs({ kind: "markdown", personas: cast.files, scenario }, { llm: MOCK_LLM, simulationId: `bench_${sceneId}` });
  if (!compiled.ok || !compiled.config) throw new Error(`preset ${sceneId} does not compile`);
  return briefOfBody({ v: 1, title: compiled.config.simulation.name, config: compiled.config, seeds: compiled.seeds, maxPulses: 24 });
}

export async function benchBriefs(third = "confronto-da-traicao"): Promise<Array<{ id: string; brief: SheetBrief }>> {
  return [{ id: "sobremesa", brief: SOBREMESA }, { id: "quarto-1214", brief: QUARTO_1214 }, { id: third, brief: await presetBrief(third) }];
}
