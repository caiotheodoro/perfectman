/**
 * How a person stands and sounds when nobody is making them do anything,
 * read from who they are. Deterministic: the same persona is drawn and voiced
 * the same way in every run.
 */
import type { DirectorProfile } from "./types.js";

export type ArmState = "down" | "folded" | "akimbo" | "up" | "hug" | "wring" | "open" | "behind" | "hold";
export type SignatureProp = "ledger" | "phone" | "clipboard" | "glasses" | null;
/** Which lettering family a renderer should use; the font itself is the renderer's choice. */
export type LetteringStyle = "typewriter" | "casual" | "tidy" | "formal" | "house";

export type PersonaSignature = {
  arms: ArmState;
  lean: number;
  squash: number;
  prop: SignatureProp;
  lettering: LetteringStyle;
  /** A plain sentence, for captions and alt text. */
  tell: string;
};

const BY_ARCHETYPE: Record<string, PersonaSignature> = {
  gatekeeper: { arms: "folded", lean: 0, squash: 1.02, prop: "ledger", lettering: "typewriter", tell: "upright, arms folded, a ledger under the elbow" },
  trickster: { arms: "hold", lean: -3, squash: 0.96, prop: "phone", lettering: "casual", tell: "slouched, thumb on a lit screen" },
  organizer: { arms: "hold", lean: 1, squash: 1.01, prop: "clipboard", lettering: "tidy", tell: "square-shouldered, clipboard against the chest" },
  elder: { arms: "behind", lean: 0, squash: 1.01, prop: "glasses", lettering: "formal", tell: "hands behind the back, round glasses" },
};

const DEFAULT: PersonaSignature = { arms: "down", lean: 0, squash: 1, prop: null, lettering: "house", tell: "arms at the sides" };

export function personaSignature(profile: Pick<DirectorProfile, "archetype">): PersonaSignature {
  return BY_ARCHETYPE[profile.archetype] ?? DEFAULT;
}

/** FNV-1a, so an id maps to the same number everywhere. */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Babble pitch multiplier for a voice, 0.85 to 1.75, stable per index. */
export function babblePitch(index: number): number {
  return 0.85 + ((index * 37) % 10) / 10 * 0.9;
}
