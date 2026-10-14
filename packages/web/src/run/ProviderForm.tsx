/**
 * Who answers, and for how long.
 *
 * One way to answer: an OpenAI-compatible endpoint with a key. For a model we
 * know, the whole form is one pasted key. Everything a hosted reasoning model
 * needs to behave — endpoint, model name, JSON mode, a reasoning-disable key —
 * is real and load-bearing but sits behind "Another model" and a disclosure,
 * because getting it wrong is a specific failure with a specific message
 * rather than something to warn everyone about.
 */
import { useEffect, useId, useMemo, useRef } from "react";
import type { StartRunRequest } from "@perfectman/shared";
import { KNOWN_ROUTES } from "./known-routes.js";

export type ProviderValue = {
  llm: StartRunRequest["llm"];
  maxPulses: number | null;
  /** Held as text so a half-typed object does not blank the field. */
  extraBodyText: string;
};

/** Opens on the first route that is known to work; the key is always yours to paste. */
export const DEFAULT_PROVIDER: ProviderValue = {
  llm: { providerType: "openai-compatible", ...KNOWN_ROUTES[0]?.llm },
  maxPulses: null,
  extraBodyText: KNOWN_ROUTES[0]?.extraBodyText ?? "",
};

/** How long to let the room run. `null` keeps what the story was written for. */
export const LENGTHS: Array<{ id: string; label: string; turns: number | null }> = [
  { id: "quick", label: "Quick", turns: 8 },
  { id: "standard", label: "As written", turns: null },
  { id: "long", label: "Long", turns: 30 },
];

const CUSTOM = "custom";

/** The route whose endpoint and model the form currently holds, or "custom". */
function routeOf(value: ProviderValue): string {
  return KNOWN_ROUTES.find((r) => r.llm.baseUrl === value.llm.baseUrl && r.llm.modelName === value.llm.modelName)?.id ?? CUSTOM;
}

/** Everything the run needs is filled in and parses. */
export function isProviderReady(value: ProviderValue): boolean {
  const filled = (s: string | undefined): boolean => (s ?? "").trim() !== "";
  return filled(value.llm.apiKey) && filled(value.llm.modelName) && filled(value.llm.baseUrl) && !parseExtraBody(value.extraBodyText).error;
}

export function ProviderForm({
  value,
  onChange,
  focusKey = false,
}: {
  value: ProviderValue;
  onChange: (next: ProviderValue) => void;
  /** Put the cursor in the key field: the last run failed and it is probably the key. */
  focusKey?: boolean;
}): JSX.Element {
  const extraBodyError = useMemo(() => parseExtraBody(value.extraBodyText).error, [value.extraBodyText]);
  const keyField = useRef<HTMLInputElement>(null);
  const group = useId();
  useEffect(() => {
    if (focusKey) keyField.current?.focus();
  }, [focusKey]);
  const route = routeOf(value);
  const set = (llm: Partial<StartRunRequest["llm"]>): void =>
    onChange({ ...value, llm: { ...value.llm, ...llm } });
  const choose = (id: string): void => {
    const next = KNOWN_ROUTES.find((r) => r.id === id);
    if (next) onChange({ ...value, llm: { ...value.llm, ...next.llm }, extraBodyText: next.extraBodyText });
    else onChange({ ...value, llm: { ...value.llm, modelName: "", baseUrl: "" }, extraBodyText: "" });
  };
  const turns = value.maxPulses;

  return (
    <div className="provider">
      <fieldset className="routes">
        <legend>Which model should they think with?</legend>
        <div className="routes__list">
          {[...KNOWN_ROUTES.map((r) => ({ id: r.id, label: r.label, note: r.note })), { id: CUSTOM, label: "Another model", note: "Any OpenAI-compatible endpoint." }].map((r) => (
            <label key={r.id} className={`route${route === r.id ? " route--on" : ""}`}>
              <input type="radio" name={group} checked={route === r.id} onChange={() => choose(r.id)} />
              <span className="route__label">{r.label}</span>
              <span className="route__note">{r.note}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="provider__key">
        <span>API key</span>
        <input
          ref={keyField}
          type="password"
          value={value.llm.apiKey ?? ""}
          placeholder="Paste the key for this model"
          autoComplete="off"
          onChange={(e) => set({ apiKey: e.target.value })}
        />
        <em>Used for this run only. It is never saved.</em>
      </label>

      <fieldset className="lengths">
        <legend>How long should they talk?</legend>
        <div className="lengths__list">
          {LENGTHS.map((l) => (
            <button
              key={l.id} type="button" className="chip" aria-pressed={turns === l.turns}
              onClick={() => onChange({ ...value, maxPulses: l.turns })}
            >{l.label}{l.turns ? ` · ${l.turns} turns` : ""}</button>
          ))}
        </div>
      </fieldset>

      <details className="advanced" open={route === CUSTOM}>
        <summary>Model settings</summary>
        <div className="provider__fields">
          <label>
            <span>Model</span>
            <input
              value={value.llm.modelName ?? ""}
              placeholder="deepseek/deepseek-v4-flash"
              onChange={(e) => set({ modelName: e.target.value })}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              type="url"
              value={value.llm.baseUrl ?? ""}
              placeholder="https://api.orcarouter.ai/v1"
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </label>
        </div>
        <p>
          If the model answers with nothing: a model that reasons by default will spend its whole output
          budget thinking and never produce a usable reply. Two settings fix almost every provider that does this.
        </p>
        <label>
          <span>JSON mode</span>
          <select
            value={jsonMode(value.llm)}
            onChange={(e) => set(fromJsonMode(e.target.value))}
          >
            <option value="off">Off — the model returns prose-wrapped JSON</option>
            <option value="object">json_object — syntax only</option>
            <option value="schema">json_schema — shape constrained</option>
          </select>
          <em>Some models run to the token cap inside schema mode. json_object is the safe choice.</em>
        </label>
        <label>
          <span>Extra request fields</span>
          <textarea
            rows={3}
            spellCheck={false}
            value={value.extraBodyText}
            placeholder={'{ "thinking": { "type": "disabled" } }'}
            onChange={(e) => onChange({ ...value, extraBodyText: e.target.value })}
          />
          <em className={extraBodyError ? "is-bad" : undefined}>
            {extraBodyError ??
              'Merged into the request. DeepSeek: {"thinking":{"type":"disabled"}}. Qwen: {"chat_template_kwargs":{"enable_thinking":false}}.'}
          </em>
        </label>
      </details>
    </div>
  );
}

export function parseExtraBody(text: string): { value?: Record<string, unknown>; error?: string } {
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "This needs to be a JSON object." };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function jsonMode(llm: StartRunRequest["llm"]): "off" | "object" | "schema" {
  if (llm.responseFormatJson !== true) return "off";
  return llm.responseFormatJsonSchema === false ? "object" : "schema";
}

function fromJsonMode(mode: string): Partial<StartRunRequest["llm"]> {
  if (mode === "off") return { responseFormatJson: false, responseFormatJsonSchema: undefined };
  return { responseFormatJson: true, responseFormatJsonSchema: mode === "schema" };
}
