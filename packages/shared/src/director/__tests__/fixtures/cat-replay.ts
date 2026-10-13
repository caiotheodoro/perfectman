import cat from "./cat-run.json" with { type: "json" };
import type { DirectorReplay } from "../../types.js";

/** A real run of "The cat on the roof", trimmed to what the director reads. It predates recorded addressees on purpose. */
export const catReplay = (): DirectorReplay => structuredClone(cat) as unknown as DirectorReplay;
