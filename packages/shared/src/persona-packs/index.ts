import type { PersonaPack } from "../persona/persona-pack.types.js";
import { DARIO_PACK } from "./dario.js";
import { TOMAS_PACK } from "./tomas.js";
import { VASCO_PACK } from "./vasco.js";
import { RENAN_PACK } from "./renan.js";
import { LARA_PACK } from "./lara.js";

export { DARIO_PACK, TOMAS_PACK, VASCO_PACK, RENAN_PACK, LARA_PACK };

export const ALL_PERSONA_PACKS: readonly PersonaPack[] = [
  VASCO_PACK,
  DARIO_PACK,
  TOMAS_PACK,
  LARA_PACK,
  RENAN_PACK,
];

export function getPersonaPackById(id: string): PersonaPack | undefined {
  return ALL_PERSONA_PACKS.find((pack) => pack.personaId === id);
}
