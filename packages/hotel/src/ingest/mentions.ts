import { fold } from "../util/text.js";

const BOUNDARY = "[^\\p{L}\\p{N}]";
const MIN_NAME = 2;

/**
 * Exact, case- and accent-insensitive display-name mentions (an optional `@`
 * counts as a boundary). Same rule as the resolver's private matcher; swap for
 * the exported one when L3 ships it (embodiment.md 9, intent-resolver).
 */
export function matchMentions(text: string, names: Readonly<Record<string, string>>): string[] {
  const folded = fold(text);
  const out: string[] = [];
  for (const [agentId, name] of Object.entries(names)) {
    const n = fold(name).trim();
    if (n.length < MIN_NAME) continue;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|${BOUNDARY})@?${escaped}($|${BOUNDARY})`, "u").test(folded)) out.push(agentId);
  }
  return out;
}
