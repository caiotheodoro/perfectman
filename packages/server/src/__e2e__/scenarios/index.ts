export { SIMULATION_CHURRASCO } from "./01-churrasco.js";
export { SIMULATION_PROMOCAO }  from "./02-promocao.js";
export { SIMULATION_TERMINO }   from "./03-termino.js";
export { SIMULATION_VAZAMENTO } from "./04-vazamento.js";
export { SIMULATION_CONVITE }   from "./05-convite-perdido.js";
export { SIMULATION_CRUSH }     from "./06-crush-revelado.js";
export { SIMULATION_PLANO }     from "./07-plano-dividido.js";
export { SIMULATION_AUSENCIA }  from "./08-ausencia.js";
export { SIMULATION_OPINIAO }   from "./09-opiniao-polemica.js";
export { SIMULATION_NOVO }      from "./10-o-novo.js";

import type { SimulationAppConfig } from "../../config/simulation-config.js";
import { FOUR_PERSONA_CONFIG }    from "../4-persona-scenario.js";
import { SIMULATION_CHURRASCO }  from "./01-churrasco.js";
import { SIMULATION_PROMOCAO }   from "./02-promocao.js";
import { SIMULATION_TERMINO }    from "./03-termino.js";
import { SIMULATION_VAZAMENTO }  from "./04-vazamento.js";
import { SIMULATION_CONVITE }    from "./05-convite-perdido.js";
import { SIMULATION_CRUSH }      from "./06-crush-revelado.js";
import { SIMULATION_PLANO }      from "./07-plano-dividido.js";
import { SIMULATION_AUSENCIA }   from "./08-ausencia.js";
import { SIMULATION_OPINIAO }    from "./09-opiniao-polemica.js";
import { SIMULATION_NOVO }       from "./10-o-novo.js";

export const ALL_SCENARIOS: Record<string, SimulationAppConfig> = {
  "4-persona":            FOUR_PERSONA_CONFIG,
  "churrasco_do_sabado":  SIMULATION_CHURRASCO,
  "promocao_desigual":    SIMULATION_PROMOCAO,
  "termino_no_grupo":     SIMULATION_TERMINO,
  "o_vazamento":          SIMULATION_VAZAMENTO,
  "convite_perdido":      SIMULATION_CONVITE,
  "crush_revelado":       SIMULATION_CRUSH,
  "plano_dividido":       SIMULATION_PLANO,
  "a_ausencia":           SIMULATION_AUSENCIA,
  "opiniao_polemica":     SIMULATION_OPINIAO,
  "o_novo":               SIMULATION_NOVO,
};

export function getScenarioConfig(scenarioId: string): SimulationAppConfig {
  const config = ALL_SCENARIOS[scenarioId];
  if (!config) {
    throw new Error(
      `Unknown scenario: "${scenarioId}". Available: ${Object.keys(ALL_SCENARIOS).join(", ")}`,
    );
  }
  return config;
}
