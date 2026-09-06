/**
 * The HTTP wire contract for the web runner, alongside the SSE protocol.
 *
 * Same reason `live-frame.types.ts` lives here: the browser bundle must never
 * import `@perfectman/server`. The server's own richer types — `RunSeeds`,
 * `SimulationAppConfig`, the `Diagnostic` bag — structurally satisfy these, and
 * everything crosses a JSON boundary anyway, so the shared shapes stay at the
 * level the UI actually reads.
 */

export type DiagnosticLevel = "error" | "warning" | "info";

export type Diagnostic = {
  level: DiagnosticLevel;
  /** Source file the problem came from, as uploaded. */
  file: string;
  /** 1-based line, when the problem can be traced to one. */
  line?: number;
  /** Dotted path of the field this affects, e.g. `cast[1].hiddenObjective`. */
  path?: string;
  message: string;
  /** What to do about it. Present whenever the fix is expressible in a sentence. */
  hint?: string;
};

export type UploadedFile = { filename: string; text: string };

export type RunInputs =
  | {
      kind: "markdown";
      personas: UploadedFile[];
      scenario: UploadedFile;
      /** Per-persona-file language override from the UI. */
      languageOverrides?: Record<string, string>;
    }
  | {
      /** Escape hatch: a config the compilers never touch. */
      kind: "raw-json";
      config: unknown;
      seeds?: unknown;
    };

export type CompileSummary = {
  agents: Array<{
    id: string;
    displayName: string;
    archetype: string;
    /** The uploaded file this agent came from — the key `languages` is under. */
    personaFile: string;
    /** Canonical persona the engine calibration fields were inherited from. */
    calibrationFrom: string;
  }>;
  channels: Array<{ id: string; name: string; type: string; members: string[] }>;
  maxPulses: number;
  seed: number;
  /** Per persona file, so the UI can show the detected value with an override. */
  languages: Record<string, { language: string; confidence: number; source: string }>;
};

/** `POST /api/compile`. The config is opaque here — the panel renders it as JSON. */
export type CompileResponse = {
  ok: boolean;
  config: unknown;
  diagnostics: Diagnostic[];
  summary: CompileSummary | null;
};

export type LlmRequest = {
  providerType: string;
  modelName?: string;
  baseUrl?: string;
  /** Name of an env var the server already has. */
  apiKeyEnv?: string;
  /** Pasted in the browser; becomes a per-run env var and is never stored. */
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider to constrain the reply to JSON. */
  responseFormatJson?: boolean;
  /**
   * Shape-constrained `json_schema` decoding. Defaults on where JSON is
   * requested; some hosted models handle schema mode badly and need `false`,
   * which falls back to syntax-only `json_object`.
   */
  responseFormatJsonSchema?: boolean;
  /**
   * Provider-specific keys spread onto the request body root. A hosted model
   * that reasons by default must be told not to, or the reasoning block eats
   * the output budget before the intent JSON.
   */
  extraBody?: Record<string, unknown>;
};

export type StartRunRequest = {
  inputs: RunInputs;
  llm: LlmRequest;
  limits?: { maxPulses?: number; wallClockCapMs?: number };
};

export type StartRunResponse = { runId: string; status: unknown; streamUrl: string };

/** `GET /api/runs` — one entry per directory under the artifact root. */
export type RunListEntry = {
  runId: string;
  simulationId: string;
  name: string;
  state: string;
  startedAt: number;
  endedAt?: number;
  pulsesRun: number;
  maxPulses: number;
  stopReason?: string;
  dirty?: boolean;
  counters: { llmFailures: number; gatewayTimeouts: number; framesDropped: number };
  diagnostics: Diagnostic[];
};

export type ApiError = { error: { message: string; hint?: string } };
