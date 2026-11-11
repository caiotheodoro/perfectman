import { randomUUID } from "node:crypto";
import { linksOf } from "../config.js";
import type { LlmEnv } from "../config.js";
import { linkHeaders } from "../llm/chain-config.js";
import type { SheetLink } from "./beat-sheet-generate.js";

/**
 * The models the beat sheet's director step may call, best first, from the host's own chain (`PERFECTMAN_LLM_CHAIN`, or the legacy single link) and its keys.
 *
 *  - `model` (`PERFECTMAN_BEATSHEET_MODEL`) names the one to use: a chain link whose model or name it is, else the first keyed link's endpoint and key with that model id
 *    (an OpenRouter-style id, so a stronger model than the actors' needs no chain entry). The rest of the chain follows as failover.
 *  - `extraBody` (`PERFECTMAN_BEATSHEET_EXTRA_BODY`, JSON) rides with an override that is not a chain link: the chain's own `extraBody` is the actors' (a reasoning switch for
 *    DeepSeek) and does not fit another model.
 *  - `price` (`PERFECTMAN_BEATSHEET_PRICE`, `in,out` USD per million tokens) prices that model when `llm.prices` has none, so the cost cap is real, not assumed.
 * A link whose key variable is empty is left out. No key anywhere: none.
 */
export function buildSheetLinks(o: { llm: LlmEnv; env: (name: string) => string | undefined; model?: string | undefined; extraBody?: string | undefined; price?: string | undefined; sessionId?: string }): SheetLink[] {
  const sessionId = o.sessionId ?? randomUUID();
  const base: SheetLink[] = [];
  for (const link of linksOf(o.llm)) {
    const apiKey = o.env(link.apiKeyEnv)?.trim();
    if (!apiKey) continue;
    base.push({ name: link.name, baseUrl: link.baseUrl, model: link.model, apiKey, headers: linkHeaders(link, sessionId), ...(link.extraBody ? { extraBody: link.extraBody } : {}) });
  }
  const wanted = o.model?.trim();
  let links = base;
  if (wanted && base[0]) {
    const at = base.findIndex((l) => l.model === wanted || l.name === wanted);
    let extra: Record<string, unknown> | undefined;
    try {
      extra = o.extraBody ? (JSON.parse(o.extraBody) as Record<string, unknown>) : undefined;
    } catch {
      extra = undefined;
    }
    links = at >= 0 ? [base[at]!, ...base.filter((_, i) => i !== at)] : [{ name: `beatsheet:${wanted}`, baseUrl: base[0].baseUrl, model: wanted, apiKey: base[0].apiKey, ...(base[0].headers ? { headers: base[0].headers } : {}), ...(extra ? { extraBody: extra } : {}) }, ...base];
  }
  const parsed = o.price?.split(",").map((n) => Number(n.trim()));
  const fromEnv = parsed && parsed.length === 2 && parsed.every((n) => Number.isFinite(n) && n >= 0) ? { inUsdPerMTok: parsed[0]!, outUsdPerMTok: parsed[1]! } : undefined;
  return links.map((l, i) => {
    const price = (i === 0 && wanted && l.model === wanted ? fromEnv : undefined) ?? o.llm.prices[l.model];
    return price ? { ...l, price } : l;
  });
}

/** Mode of the director step: `PERFECTMAN_BEAT_SHEET=0` off, `mock` the deterministic sheet, anything else a model (and with the mock provider, none: tests and dev never spend or wait). */
export function sheetMode(provider: LlmEnv["provider"], env: (name: string) => string | undefined): "off" | "mock" | "llm" {
  const flag = env("PERFECTMAN_BEAT_SHEET")?.trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") return "off";
  if (flag === "mock") return "mock";
  return provider === "mock" ? "off" : "llm";
}
