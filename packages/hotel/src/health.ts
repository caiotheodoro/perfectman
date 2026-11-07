import { createServer } from "node:http";
import type { Server } from "node:http";

export type HealthState = () => { enabled: boolean; connected: boolean; runs: number };

/** Loopback health endpoint for the container HEALTHCHECK. No secret: it answers 127.0.0.1 only. */
export function startHealth(port: number, state: HealthState, host = "127.0.0.1"): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/healthz") {
        const body = JSON.stringify({ ok: true, ...state() });
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      res.writeHead(404).end();
    });
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}
