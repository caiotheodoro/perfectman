/**
 * Who answers, and for how long.
 *
 * One way to answer: an OpenAI-compatible endpoint with a key. The mock and
 * the local daemon were developer conveniences that put a "run" on screen
 * with nothing behind it. Everything a hosted reasoning model needs to behave
 * — JSON mode, a reasoning-disable key — is real and load-bearing but belongs
 * behind a disclosure, because getting it wrong is a specific failure with a
 * specific message rather than something to warn everyone about.
 */
import { useEffect, useMemo, useRef } from "react";
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

export function ProviderForm({
  value,
  onChange,
  onRun,
  ready,
  busy = false,
  focusKey = false,
}: {
  value: ProviderValue;
  onChange: (next: ProviderValue) => void;
  onRun: (value: ProviderValue) => void;
  ready: boolean;
  busy?: boolean;
  /** Put the cursor in the key field: the last run failed and it is probably the key. */
  focusKey?: boolean;
}): JSX.Element {
  const extraBodyError = useMemo(() => parseExtraBody(value.extraBodyText).error, [value.extraBodyText]);
  const keyField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusKey) keyField.current?.focus();
  }, [focusKey]);
  const hasKey = (value.llm.apiKey ?? "").trim() !== "";
  const set = (llm: Partial<StartRunRequest["llm"]>): void =>
    onChange({ ...value, llm: { ...value.llm, ...llm } });

  return (
    <form className="provider" onSubmit={(event) => {
      event.preventDefault();
      const extra = parseExtraBody(value.extraBodyText);
      if (!ready || busy || !hasKey || extra.error) return;
      const next = { ...value, llm: { ...value.llm, extraBody: extra.value } };
      onChange(next);
      onRun(next);
    }}>
      {(
        <div className="routes">
          <p className="u-dim">
            Use a saved setup, or enter your own endpoint below.
          </p>
          <div className="routes__list">
            {KNOWN_ROUTES.map((route) => (
              <button
                key={route.id}
                type="button"
                className="route"
                onClick={() =>
                  onChange({
                    ...value,
                    llm: { ...value.llm, ...route.llm },
                    extraBodyText: route.extraBodyText,
                  })
                }
              >
                <span className="route__label">{route.label}</span>
                <span className="route__note">{route.note}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="provider__fields">
        {(
          <>
            <label>
              <span>Model</span>
              <input
                required
                value={value.llm.modelName ?? ""}
                placeholder="deepseek/deepseek-v4-flash"
                onChange={(e) => set({ modelName: e.target.value })}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                type="url"
                required
                value={value.llm.baseUrl ?? ""}
                placeholder="https://api.orcarouter.ai/v1"
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </label>
            <label>
              <span>API key</span>
              <input
                ref={keyField}
                type="password"
                required
                value={value.llm.apiKey ?? ""}
                placeholder="Paste the key for this endpoint"
                autoComplete="off"
                onChange={(e) => set({ apiKey: e.target.value })}
              />
              <em>Used for this run. The saved configuration never contains your key.</em>
            </label>
          </>
        )}

        <label>
          <span>Turns</span>
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={value.maxPulses ?? ""}
            placeholder="as written in the scene"
            onChange={(e) => onChange({ ...value, maxPulses: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
      </div>

      {(
        <details className="advanced">
          <summary>If the model answers with nothing</summary>
          <p>
            A model that reasons by default will spend its whole output budget
            thinking and never produce a usable reply. Two settings fix almost
            every provider that does this.
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
      )}

      <div className="step__foot">
        <button
          type="submit"
          className="btn"
          disabled={!ready || busy || !hasKey || Boolean(extraBodyError)}
        >
          Start the run
        </button>
        {!ready ? (
          <span className="u-dim">The cast and scene need to fit together first.</span>
        ) : busy ? (
          <span className="u-dim">Waiting for the current run to finish.</span>
        ) : !hasKey ? (
          <span className="u-dim">Paste a key to start.</span>
        ) : null}
      </div>
    </form>
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
