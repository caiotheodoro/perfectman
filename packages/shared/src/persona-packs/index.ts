import type { PersonaPack } from "../persona/persona-pack.types.js";
import { BRUNO_PACK } from "./bruno.js";
import { CAIO_PACK } from "./caio.js";
import { GOULART_PACK } from "./goulart.js";
import { LEO_PACK } from "./leo.js";
import { MARIANA_PACK } from "./mariana.js";

export { BRUNO_PACK, CAIO_PACK, GOULART_PACK, LEO_PACK, MARIANA_PACK };

export const ALL_PERSONA_PACKS: readonly PersonaPack[] = [
  GOULART_PACK,
  BRUNO_PACK,
  CAIO_PACK,
  MARIANA_PACK,
  LEO_PACK,
];

export function getPersonaPackById(id: string): PersonaPack | undefined {
  return ALL_PERSONA_PACKS.find((pack) => pack.personaId === id);
}
