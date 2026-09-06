/**
 * Thin fetch wrappers over the run server.
 *
 * Relative URLs throughout: in dev Vite proxies `/api` to the node server, and
 * in production that same server hosts this bundle. One set of URLs, no origin
 * configuration in the app.
 */
import type {
  ApiError,
  CompileResponse,
  RunInputs,
  RunListEntry,
  RunStatus,
  StartRunRequest,
  StartRunResponse,
  UploadedFile,
  ViewerReplay,
} from "@perfectman/shared";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : {},
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as ApiError | null)?.error?.message ?? `${res.status} ${res.statusText}`;
    const hint = (body as ApiError | null)?.error?.hint;
    throw new ApiRequestError(message, res.status, hint);
  }
  return body as T;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function compile(inputs: RunInputs, llm?: StartRunRequest["llm"]): Promise<CompileResponse> {
  return json<CompileResponse>("/api/compile", {
    method: "POST",
    body: JSON.stringify({ inputs, llm }),
  });
}

export function startRun(request: StartRunRequest): Promise<StartRunResponse> {
  return json<StartRunResponse>("/api/runs", { method: "POST", body: JSON.stringify(request) });
}

export function stopRun(runId: string): Promise<unknown> {
  return json(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
}

export function currentStatus(): Promise<RunStatus> {
  return json<RunStatus>("/api/runs/current");
}

export function listPresets(): Promise<{
  casts: Array<{ id: string; title: string; blurb: string; cast?: string; files: UploadedFile[] }>;
  scenes: Array<{ id: string; title: string; blurb: string; cast?: string; files: UploadedFile[] }>;
}> {
  return json("/api/presets");
}

export function listRuns(): Promise<{ runs: RunListEntry[] }> {
  return json<{ runs: RunListEntry[] }>("/api/runs");
}

export function fetchReplay(runId: string): Promise<ViewerReplay> {
  return json<ViewerReplay>(`/api/runs/${encodeURIComponent(runId)}/replay`);
}
