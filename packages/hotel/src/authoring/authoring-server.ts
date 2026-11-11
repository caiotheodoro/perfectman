import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { bearer, secretMatches } from "../util/auth.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { AuthoringError } from "./authoring-service.js";
import type { AuthoringService } from "./authoring-service.js";

export const MAX_REQUEST_BYTES = 256 * 1024;

export type AuthoringServerOptions = {
  service: AuthoringService;
  secret: string;
  host: string;
  port: number;
  logger?: Logger;
};

/**
 * The sidecar's authoring listener (director-protocol.md 7): JSON over HTTP on
 * the compose network, Bearer `PERFECTMAN_SECRET` on every route except
 * `GET /healthz`. The hotel's admin API calls it as a background job; the
 * Director WebSocket never carries authoring.
 */
export class AuthoringServer {
  private server: Server | null = null;
  private readonly log: Logger;

  constructor(private readonly o: AuthoringServerOptions) {
    this.log = o.logger ?? silentLogger;
  }

  /** Resolves with the bound port (0 asks the OS for one). */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      server.once("error", reject);
      server.listen(this.o.port, this.o.host, () => {
        const addr = server.address();
        this.server = server;
        resolve(typeof addr === "object" && addr ? addr.port : this.o.port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://sidecar");
    const method = req.method ?? "GET";
    try {
      if (url.pathname === "/healthz" && method === "GET") return send(res, 200, { ok: true });
      if (!secretMatches(bearer(req.headers["authorization"]), this.o.secret)) {
        res.writeHead(401).end();
        return;
      }
      const svc = this.o.service;
      const route = `${method} ${url.pathname}`;
      if (route === "POST /authoring/v1/validate") return send(res, 200, svc.validate((await readJson(req)) as Parameters<AuthoringService["validate"]>[0]));
      if (route === "POST /authoring/v1/compile") return send(res, 200, await svc.compileWithSheet((await readJson(req)) as { source?: unknown }));
      if (route === "POST /authoring/v1/draft") return send(res, 200, await svc.draft((await readJson(req)) as Parameters<AuthoringService["draft"]>[0]));
      if (route === "POST /authoring/v1/autolook") return send(res, 200, svc.autolook((await readJson(req)) as Parameters<AuthoringService["autolook"]>[0]));
      if (route === "GET /authoring/v1/presets") return send(res, 200, await svc.presets());
      const preset = /^\/authoring\/v1\/presets\/([^/]+)$/.exec(url.pathname);
      if (method === "GET" && preset?.[1]) return send(res, 200, await svc.preset(decodeURIComponent(preset[1])));
      send(res, 404, { error: "not_found", message: `no route ${route}` });
    } catch (err) {
      if (err instanceof AuthoringError) {
        send(res, err.status, { error: err.code, message: err.message, ...(err.errors ? { errors: err.errors } : {}) });
        return;
      }
      if (err instanceof SyntaxError || (err instanceof Error && err.name === "BodyTooLarge")) {
        send(res, err instanceof SyntaxError ? 400 : 413, { error: "bad_request", message: err.message });
        return;
      }
      this.log.error("authoring request failed", { error: err instanceof Error ? err.message : String(err) });
      send(res, 500, { error: "internal", message: "internal error" });
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BYTES) {
      const err = new Error("request body over 256 KiB");
      err.name = "BodyTooLarge";
      throw err;
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) throw new SyntaxError("expected a JSON body");
  return JSON.parse(text);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
