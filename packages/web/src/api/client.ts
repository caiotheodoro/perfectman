/**
 * Thin fetch wrappers over the run server.
 *
 * Paths go through `apiUrl`, which is a no-op unless the interface is deployed
 * apart from the server it talks to. See `origin.ts`.
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
import { apiUrl } from "./origin.js";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : {},
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = (body as ApiError | null)?.error?.message ?? `${res.status} ${res.statusText}`;
    const hint = (body as ApiError | null)?.error?.hint;
    throw new ApiRequestError(message, res.status, hint);
  }
  // A static host with no run server behind it answers every path with its
  // own index page: status 200, body HTML. That is not an answer, and handing
  // back null would crash whoever reads it.
  if (body === null && text.trim() !== "") {
    throw new ApiRequestError(
      `The server answered ${path} with something that is not JSON.`,
      res.status,
      "The interface is probably deployed apart from the run server: build it with VITE_API_BASE set to the server's URL.",
    );
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
