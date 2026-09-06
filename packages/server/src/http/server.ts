/**
 * The web runner's HTTP surface, on `node:http`.
 *
 * No framework: the whole API is six routes plus static files, and adding a
 * server dependency to a package that already ships a simulation engine buys
 * nothing here.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { LLMConfig } from "../llm/llm-config.js";
import { compileRunInputs, type RunInputs } from "../authoring/compile-run-inputs.js";
import { RunAlreadyActiveError, RunController } from "./run/run-controller.js";
import { listRuns, readManifest, readReplay, safeName } from "./run/run-artifacts.js";
import { setRunKey } from "./run/secrets.js";
import { SSE_HEADERS, type SseSink } from "./sse-hub.js";

/** Uploaded markdown arrives as JSON, so this is the whole request-size story. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_WALL_CLOCK_CAP_MS = 60 * 60 * 1000;
/** Keeps proxies and load balancers from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

export type WebServerDeps = {
  runsRoot: string;
  /** Built web assets; when absent the server is API-only (Vite serves the UI in dev). */
  staticDir?: string;
  controller?: RunController;
};

export type StartRunRequest = {
  inputs: RunInputs;
  llm: {
    providerType: LLMConfig["providerType"];
    modelName?: string;
    baseUrl?: string;
    /** Name of an existing env var. */
    apiKeyEnv?: string;
    /** A key pasted into the browser; becomes a per-run env var and is never stored. */
    apiKey?: string;
    temperature?: number;
    maxOutputTokens?: number;
    responseFormatJson?: boolean;
    responseFormatJsonSchema?: boolean;
    extraBody?: Record<string, unknown>;
  };
  limits?: { maxPulses?: number; wallClockCapMs?: number };
};

export function createWebServer(deps: WebServerDeps): {
  server: Server;
  controller: RunController;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
} {
  const controller = deps.controller ?? new RunController(deps.runsRoot);

  const server = createServer((req, res) => {
    handle(req, res, deps, controller).catch((err: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: { message: err.message } });
      else res.end();
    });
  });

  return {
    server,
    controller,
    listen(port: number) {
      return new Promise<number>((resolvePort) => {
        server.listen(port, () => {
          const address = server.address();
          resolvePort(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close() {
      return new Promise<void>((done) => {
        controller.stop();
        server.close(() => done());
      });
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebServerDeps,
  controller: RunController,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // The Vite dev server runs on a different origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (path === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path === "/api/compile" && method === "POST") {
    const body = await readJsonBody<{ inputs: RunInputs; llm?: StartRunRequest["llm"] }>(req);
    // A preview never starts anything, so a placeholder id and mock provider
    // are enough to reach the validator.
    const result = compileRunInputs(body.inputs, {
      llm: buildLlmConfig(body.llm ?? { providerType: "mock" }, undefined),
      simulationId: "preview",
    });
    sendJson(res, 200, result);
    return;
  }

  if (path === "/api/runs" && method === "POST") {
    await startRun(req, res, controller);
    return;
  }

  if (path === "/api/runs" && method === "GET") {
    sendJson(res, 200, { runs: await listRuns(deps.runsRoot) });
    return;
  }

  if (path === "/api/runs/current") {
    sendJson(res, 200, controller.getStatus());
    return;
  }

  const runMatch = /^\/api\/runs\/([^/]+)\/(stream|stop|replay|manifest)$/.exec(path);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1] ?? "");
    const action = runMatch[2];

    if (action === "stream") {
      streamRun(req, res, controller);
      return;
    }
    if (action === "stop" && method === "POST") {
      sendJson(res, 202, controller.stop());
      return;
    }
    if (action === "replay") {
      const replay = await readReplay(deps.runsRoot, runId);
      if (!replay) {
        sendJson(res, 404, { error: { message: `No replay for run ${runId}` } });
        return;
      }
      sendJson(res, 200, replay);
      return;
    }
    if (action === "manifest") {
      const manifest = await readManifest(deps.runsRoot, runId);
      if (!manifest) {
        sendJson(res, 404, { error: { message: `No such run: ${runId}` } });
        return;
      }
      sendJson(res, 200, manifest);
      return;
    }
  }

  if (path.startsWith("/api/")) {
    sendJson(res, 404, { error: { message: `No such endpoint: ${method} ${path}` } });
    return;
  }

  if (deps.staticDir) {
    serveStatic(res, deps.staticDir, path);
    return;
  }

  sendJson(res, 404, { error: { message: "Not found" } });
}

async function startRun(
  req: IncomingMessage,
  res: ServerResponse,
  controller: RunController,
): Promise<void> {
  const body = await readJsonBody<StartRunRequest>(req);
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // A pasted key becomes an env var immediately and is referenced only by name
  // from here on, so it cannot reach a config object or an artifact.
  const apiKeyEnv = body.llm.apiKey ? setRunKey(runId, body.llm.apiKey) : body.llm.apiKeyEnv;
  const llm = buildLlmConfig(body.llm, apiKeyEnv);

  const compiled = compileRunInputs(body.inputs, { llm, simulationId: runId });
  if (!compiled.ok || !compiled.config) {
    sendJson(res, 422, { error: { message: "Inputs did not compile" }, ...compiled });
    return;
  }

  try {
    const status = await controller.start({
      runId,
      config: compiled.config,
      seeds: compiled.seeds,
      maxPulses: body.limits?.maxPulses ?? compiled.summary?.maxPulses ?? 24,
      wallClockCapMs: body.limits?.wallClockCapMs ?? DEFAULT_WALL_CLOCK_CAP_MS,
      diagnostics: compiled.diagnostics,
      inputFiles: inputFilesOf(body.inputs),
      skipHealthCheck: llm.providerType === "mock",
    });
    sendJson(res, 201, { runId, status, streamUrl: `/api/runs/${runId}/stream` });
  } catch (err) {
    if (err instanceof RunAlreadyActiveError) {
      sendJson(res, 409, { error: { message: err.message }, status: controller.getStatus() });
      return;
    }
    throw err;
  }
}

function streamRun(req: IncomingMessage, res: ServerResponse, controller: RunController): void {
  res.writeHead(200, SSE_HEADERS);
  // Tell the browser how long to wait before reconnecting.
  res.write("retry: 2000\n\n");

  const unsubscribe = controller.currentHub().subscribe(res as unknown as SseSink);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

function buildLlmConfig(
  requested: StartRunRequest["llm"],
  apiKeyEnv: string | undefined,
): LLMConfig {
  return {
    providerType: requested.providerType,
    modelName: requested.modelName ?? "mock",
    ...(requested.baseUrl ? { baseUrl: requested.baseUrl } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    maxInputTokens: 4096,
    maxOutputTokens: requested.maxOutputTokens ?? 512,
    temperature: requested.temperature ?? 0.8,
    timeoutMs: 60_000,
    retryCount: 2,
    // Both are meaningful as `false`, so they pass through whenever set rather
    // than only when truthy: a hosted model that mishandles schema decoding
    // needs `responseFormatJsonSchema: false` to reach the transport.
    ...(requested.responseFormatJson === undefined
      ? {}
      : { responseFormatJson: requested.responseFormatJson }),
    ...(requested.responseFormatJsonSchema === undefined
      ? {}
      : { responseFormatJsonSchema: requested.responseFormatJsonSchema }),
    ...(requested.extraBody ? { extraBody: requested.extraBody } : {}),
  };
}

function inputFilesOf(inputs: RunInputs): Array<{ filename: string; text: string }> {
  if (inputs.kind === "raw-json") {
    return [{ filename: "config.input.json", text: JSON.stringify(inputs.config, null, 2) }];
  }
  return [inputs.scenario, ...inputs.personas];
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) throw new Error("Expected a JSON body");
  return JSON.parse(text) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function serveStatic(res: ServerResponse, staticDir: string, path: string): void {
  const root = resolve(staticDir);
  const requested = resolve(root, `.${normalize(path)}`);
  // Anything that resolves outside the static root is a traversal attempt.
  const withinRoot = requested === root || requested.startsWith(root + sep);
  const file =
    withinRoot && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(root, "index.html"); // SPA fallback

  if (!existsSync(file)) {
    sendJson(res, 404, { error: { message: "Not found" } });
    return;
  }
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

export { safeName };
