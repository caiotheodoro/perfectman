/**
 * Who answers, and for how long.
 *
 * Kept to four visible fields. Everything a hosted reasoning model needs to
 * behave — JSON mode, a reasoning-disable key — is real and load-bearing but
 * belongs behind a disclosure, because getting it wrong is a specific failure
 * with a specific message rather than something to warn everyone about.
 */
import { useMemo } from "react";
import type { StartRunRequest } from "@perfectman/shared";
import { KNOWN_ROUTES } from "./known-routes.js";

export type ProviderValue = {
  llm: StartRunRequest["llm"];
  maxPulses: number | null;
  /** Held as text so a half-typed object does not blank the field. */
  extraBodyText: string;
};

export const DEFAULT_PROVIDER: ProviderValue = {
  llm: { providerType: "mock", modelName: "mock" },
  maxPulses: null,
  extraBodyText: "",
};

const PROVIDERS = [
  { id: "mock", label: "Mock", note: "Instant, no key, no network. Shows the shape of a run." },
  { id: "ollama", label: "Ollama", note: "A model on this machine. Needs the daemon running." },
  { id: "openai-compatible", label: "Any /v1 endpoint", note: "OpenAI-compatible. Bring a base URL and a key." },
];

export function ProviderForm({
  value,
  onChange,
  onRun,
  ready,
}: {
  value: ProviderValue;
  onChange: (next: ProviderValue) => void;
  onRun: () => void;
  ready: boolean;
}): JSX.Element {
  const extraBodyError = useMemo(() => parseExtraBody(value.extraBodyText).error, [value.extraBodyText]);
  const hosted = value.llm.providerType !== "mock";
  const set = (llm: Partial<StartRunRequest["llm"]>): void =>
    onChange({ ...value, llm: { ...value.llm, ...llm } });

  return (
    <div className="provider">
      <div className="provider__choices">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`card${value.llm.providerType === p.id ? " card--on" : ""}`}
            aria-pressed={value.llm.providerType === p.id}
            onClick={() => set({ providerType: p.id, modelName: p.id === "mock" ? "mock" : value.llm.modelName })}
          >
            <span className="card__title u-serif">{p.label}</span>
            <span className="card__blurb">{p.note}</span>
          </button>
        ))}
      </div>

      {hosted ? (
        <div className="routes">
          <p className="u-dim">
            Endpoints someone has already got working. Filling one in still
            leaves you to paste the key.
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
      ) : null}

      <div className="provider__fields">
        {hosted ? (
          <>
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
                value={value.llm.baseUrl ?? ""}
                placeholder="https://api.orcarouter.ai/v1"
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </label>
            <label>
              <span>API key</span>
              <input
                type="password"
                value={value.llm.apiKey ?? ""}
                placeholder="Leave blank to use the server's .env"
                onChange={(e) => set({ apiKey: e.target.value })}
              />
              <em>Held for this run only. The saved config keeps the variable name, never the key.</em>
            </label>
          </>
        ) : null}

        <label>
          <span>Turns</span>
          <input
            type="number"
            min={1}
            max={200}
            value={value.maxPulses ?? ""}
            placeholder="as written in the scene"
            onChange={(e) => onChange({ ...value, maxPulses: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
      </div>

      {hosted ? (
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
      ) : null}

      <div className="step__foot">
        <button
          type="button"
          className="btn"
          disabled={!ready || Boolean(extraBodyError)}
          onClick={() => {
            const extra = parseExtraBody(value.extraBodyText);
            onChange({ ...value, llm: { ...value.llm, ...(extra.value ? { extraBody: extra.value } : {}) } });
            onRun();
          }}
        >
          Start the run
        </button>
        {!ready ? <span className="u-dim">The cast and scene need to fit together first.</span> : null}
      </div>
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
