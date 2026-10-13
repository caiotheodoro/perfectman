// Adds x-opencode-session + key, forwards to opencode Go. Key from env, never logged. Never crashes: upstream failures become 502 (client retries).
import http from "node:http";
const KEY = process.env.OC_KEY, SESSION = `perfectman-demo-${Date.now()}`;
process.on("uncaughtException", (e) => console.error("uncaught", e?.message));
process.on("unhandledRejection", (e) => console.error("unhandled", e?.message));
http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    let up;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        up = await fetch("https://opencode.ai/zen/go" + req.url, {
          method: req.method,
          headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-opencode-session": SESSION },
          body: req.method === "GET" ? undefined : Buffer.concat(chunks),
          signal: AbortSignal.timeout(280000),
        });
        break;
      } catch (e) { console.error("upstream", attempt, e?.cause?.code ?? e?.message); await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (!up) { res.writeHead(502, { "content-type": "application/json" }); return res.end('{"error":{"message":"upstream unreachable"}}'); }
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) { console.error("handler", e?.message); try { res.writeHead(502); res.end("{}"); } catch {} }
}).listen(4399, "127.0.0.1", () => console.log("proxy up :4399"));
