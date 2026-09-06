/**
 * Files in, run parameters, Run.
 *
 * Personas and the scenario are told apart by filename suffix first
 * (`*.persona.md` / `*.scenario.md`) and by frontmatter second, because an
 * author who drops five files should not also have to say which is which.
 */
import { useMemo, useRef, useState } from "react";
import type { RunInputs, StartRunRequest, UploadedFile } from "@perfectman/shared";

export type RunFormValue = {
  personas: UploadedFile[];
  scenario: UploadedFile | null;
  llm: StartRunRequest["llm"];
  maxPulses: number | null;
  /** Kept as text so a half-typed object does not blank the field. */
  extraBodyText: string;
};

const PROVIDERS: Array<{ id: string; label: string; note: string }> = [
  { id: "mock", label: "mock", note: "deterministic, no network — the CI path" },
  { id: "ollama", label: "ollama", note: "local model, needs the daemon running" },
  { id: "openai-compatible", label: "openai-compatible", note: "any /v1 endpoint" },
];

export function RunForm({
  value,
  onChange,
  onRun,
  onStop,
  busy,
  canRun,
}: {
  value: RunFormValue;
  onChange: (next: RunFormValue) => void;
  onRun: () => void;
  onStop: () => void;
  busy: boolean;
  canRun: boolean;
}): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const extraBodyError = useMemo(() => parseExtraBody(value.extraBodyText).error, [value.extraBodyText]);

  async function absorb(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const read = await Promise.all(
      Array.from(files).map(async (f) => ({ filename: f.name, text: await f.text() })),
    );
    let scenario = value.scenario;
    const personas = [...value.personas];
    for (const file of read) {
      if (isScenario(file)) scenario = file;
      else replaceOrAppend(personas, file);
    }
    onChange({ ...value, personas, scenario });
  }

  const files = [
    ...(value.scenario ? [{ role: "scenario" as const, file: value.scenario }] : []),
    ...value.personas.map((file) => ({ role: "persona" as const, file })),
  ];

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Inputs</h2>
      </header>

      <div
        className={dragging ? "drop drop--over" : "drop"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void absorb(e.dataTransfer.files);
        }}
        onClick={() => picker.current?.click()}
      >
        <input
          ref={picker}
          type="file"
          accept=".md,text/markdown"
          multiple
          hidden
          onChange={(e) => void absorb(e.target.files)}
        />
        <p>Drop one <code>.scenario.md</code> and its <code>.persona.md</code> files</p>
        <p className="dim">or click to pick</p>
      </div>

      {files.length > 0 ? (
        <ul className="files">
          {files.map(({ role, file }) => (
            <li key={file.filename}>
              <span className={`pill pill--${role}`}>{role}</span>
              <span>{file.filename}</span>
              <span className="dim">{Math.ceil(file.text.length / 1024)} KB</span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  onChange(
                    role === "scenario"
                      ? { ...value, scenario: null }
                      : {
                          ...value,
                          personas: value.personas.filter((p) => p.filename !== file.filename),
                        },
                  )
                }
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="fields">
        <label>
          <span>provider</span>
          <select
            value={value.llm.providerType}
            onChange={(e) =>
              onChange({ ...value, llm: { ...value.llm, providerType: e.target.value } })
            }
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <em className="dim">{PROVIDERS.find((p) => p.id === value.llm.providerType)?.note}</em>
        </label>

        <label>
          <span>model</span>
          <input
            value={value.llm.modelName ?? ""}
            placeholder={value.llm.providerType === "mock" ? "mock" : "model name"}
            onChange={(e) => onChange({ ...value, llm: { ...value.llm, modelName: e.target.value } })}
          />
        </label>

        {value.llm.providerType !== "mock" ? (
          <>
            <label>
              <span>base URL</span>
              <input
                value={value.llm.baseUrl ?? ""}
                placeholder="http://localhost:11434"
                onChange={(e) => onChange({ ...value, llm: { ...value.llm, baseUrl: e.target.value } })}
              />
            </label>
            <label>
              <span>API key</span>
              <input
                type="password"
                value={value.llm.apiKey ?? ""}
                placeholder="pasted key, or leave blank for the server's .env"
                onChange={(e) => onChange({ ...value, llm: { ...value.llm, apiKey: e.target.value } })}
              />
              <em className="dim">
                Becomes a per-run env var. Only the variable name reaches the stored config.
              </em>
            </label>
          </>
        ) : null}

        {value.llm.providerType !== "mock" ? (
          <details className="advanced">
            <summary>Provider quirks</summary>
            <p className="dim">
              A hosted model that reasons by default will spend the whole output
              budget thinking and never emit parseable intent. Two knobs fix
              almost every such provider.
            </p>

            <label>
              <span>JSON mode</span>
              <select
                value={jsonMode(value.llm)}
                onChange={(e) => onChange({ ...value, llm: { ...value.llm, ...fromJsonMode(e.target.value) } })}
              >
                <option value="off">off — model returns prose-wrapped JSON</option>
                <option value="object">json_object — syntax only</option>
                <option value="schema">json_schema — shape constrained</option>
              </select>
              <em className="dim">
                Some models run to the token cap inside schema mode. `json_object` is the safe choice.
              </em>
            </label>

            <label>
              <span>extra request body</span>
              <textarea
                rows={3}
                spellCheck={false}
                value={value.extraBodyText}
                placeholder={'{ "thinking": { "type": "disabled" } }'}
                onChange={(e) => onChange({ ...value, extraBodyText: e.target.value })}
              />
              <em className={extraBodyError ? "bad" : "dim"}>
                {extraBodyError ??
                  'Spread onto the request root. DeepSeek: {"thinking":{"type":"disabled"}}. Qwen: {"chat_template_kwargs":{"enable_thinking":false}}.'}
              </em>
            </label>
          </details>
        ) : null}

        <label>
          <span>max pulses</span>
          <input
            type="number"
            min={1}
            max={200}
            value={value.maxPulses ?? ""}
            placeholder="from the scenario"
            onChange={(e) =>
              onChange({ ...value, maxPulses: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
      </div>

      <div className="actions">
        <button type="button" className="primary" disabled={!canRun || busy} onClick={onRun}>
          Run
        </button>
        <button type="button" disabled={!busy} onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}

/**
 * The extra body is edited as text and only becomes an object when it parses,
 * so typing `{` does not wipe what was there. Blank is valid and means none.
 */
export function parseExtraBody(text: string): { value?: Record<string, unknown>; error?: string } {
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Must be a JSON object." };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function jsonMode(llm: RunFormValue["llm"]): "off" | "object" | "schema" {
  if (llm.responseFormatJson !== true) return "off";
  return llm.responseFormatJsonSchema === false ? "object" : "schema";
}

function fromJsonMode(mode: string): Partial<RunFormValue["llm"]> {
  if (mode === "off") return { responseFormatJson: false, responseFormatJsonSchema: undefined };
  return { responseFormatJson: true, responseFormatJsonSchema: mode === "schema" };
}

export function toRunInputs(value: RunFormValue): RunInputs | null {
  if (!value.scenario) return null;
  return { kind: "markdown", personas: value.personas, scenario: value.scenario };
}

function isScenario(file: UploadedFile): boolean {
  if (/\.scenario\.md$/i.test(file.filename)) return true;
  if (/\.persona\.md$/i.test(file.filename)) return false;
  // Fall back to the frontmatter: only a scenario declares a cast.
  return /^\s*cast\s*:/m.test(file.text.split(/^---\s*$/m)[1] ?? "");
}

function replaceOrAppend(personas: UploadedFile[], file: UploadedFile): void {
  const at = personas.findIndex((p) => p.filename === file.filename);
  if (at >= 0) personas[at] = file;
  else personas.push(file);
}
