import type { ModelPrice } from "../config.js";
import type { RunModel } from "../director/index.js";
import { KNOWN_TOKEN_RATIOS, modelTier } from "./chain-config.js";
import type { LlmLink, ModelTier, PromptStyle } from "./chain-config.js";

/** A model picked for one run (D54), as the hotel's `run_start` carries it. */
export type PickedModel = RunModel;

/** The window at or under which an owner-picked model is sent the compact hotel prompt (owner, 2026-11-07). */
export const PICK_COMPACT_WINDOW_TOKENS = 8192;
/** The name of the picked link in the chain's logs and per-link usage. */
export const PICK_LINK_NAME = "pick";
/** Used when the hotel did not know the window (its model list was out of reach). */
const UNKNOWN_WINDOW_TOKENS = 32_768;
const OPENROUTER = "https://openrouter.ai/api/v1";
const OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY";

const isOpenRouter = (baseUrl: string): boolean => {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
};

/**
 * The tier of the model the admin picked, from the window and the size in its id. The window the hotel did not know counts
 * for nothing here (the link below assumes 32K for sizing the prompt, which would read as `fast`).
 */
export function pickTier(pick: PickedModel): ModelTier {
  return modelTier({ id: pick.id, context: pick.context });
}

/** The provider-specific body that keeps a thinking model from spending its answer budget thinking. */
export function reasoningBody(reasoning: PickedModel["reasoning"]): Record<string, unknown> | undefined {
  if (reasoning === "mandatory") return { reasoning: { effort: "low" } };
  if (reasoning === "optional") return { reasoning: { enabled: false } };
  return undefined;
}

/**
 * The chain a run calls when the admin picked a model: the pick is link 1, on OpenRouter with the
 * same key the configured OpenRouter link uses, and the configured chain stays behind it as failover
 * (a configured link that is the same model is dropped, so it is not tried twice). The pick is sent
 * the compact prompt when its window is 8K or less. The mock provider has no links, so a pick changes
 * nothing there.
 */
export function withPickedModel(base: readonly LlmLink[], pick: PickedModel | null | undefined): LlmLink[] {
  if (!pick || base.length === 0) return [...base];
  const viaOpenRouter = base.find((l) => isOpenRouter(l.baseUrl));
  const window = pick.context ?? undefined;
  const extra = reasoningBody(pick.reasoning ?? undefined);
  const style: PromptStyle = (window ?? UNKNOWN_WINDOW_TOKENS) <= PICK_COMPACT_WINDOW_TOKENS ? "compact" : "full";
  const link: LlmLink = {
    name: PICK_LINK_NAME,
    baseUrl: viaOpenRouter?.baseUrl ?? OPENROUTER,
    apiKeyEnv: viaOpenRouter?.apiKeyEnv ?? OPENROUTER_KEY_ENV,
    model: pick.id,
    maxContextTokens: window ?? UNKNOWN_WINDOW_TOKENS,
    promptStyle: style,
    tier: pickTier(pick),
    ...(KNOWN_TOKEN_RATIOS[pick.id] !== undefined ? { tokenRatio: KNOWN_TOKEN_RATIOS[pick.id] } : {}),
    ...(extra ? { extraBody: extra } : {}),
  };
  return [link, ...base.filter((l) => l.model !== pick.id)];
}

/**
 * The prices the meter uses for a run: the configured table, and the picked model at OpenRouter's
 * listed price when the table has none for it. A model with neither is metered from the cost the
 * provider bills per call (`usage.cost`), which the chain already prefers.
 */
export function pricesWithPick(prices: Readonly<Record<string, ModelPrice>>, pick: PickedModel | null | undefined): Record<string, ModelPrice> {
  if (!pick || prices[pick.id] || pick.price_in === undefined || pick.price_in === null || pick.price_out === undefined || pick.price_out === null) return { ...prices };
  return { ...prices, [pick.id]: { inUsdPerMTok: pick.price_in, outUsdPerMTok: pick.price_out } };
}
