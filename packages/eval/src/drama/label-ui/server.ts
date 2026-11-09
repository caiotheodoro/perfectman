/**
 * Local clip labeling server. node:http only, bound to 127.0.0.1, no runtime deps.
 * Serves the page, streams clips with HTTP Range support, and reads/writes one
 * label file per clip (`<labelsDir>/<id>.json`).
 */
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { DRAMA_AXES, DRAMA_FAILURE_CODES } from "../axes.js";
import { parseClipLabel, serializeClipLabel, type ClipLabel } from "../label.js";
import {
  AXIS_QUESTIONS,
  isSafeClipId,
  normalizeLabel,
  parseByteRange,
  parseManifest,
  statusForLabel,
  toClipListItem,
  type ClipInfo,
  type LabelStatus,
} from "./label-session.js";

const MAX_BODY_BYTES = 64 * 1024;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const ASSET_FILES = [
  { route: "/", file: "page.html", type: "text/html; charset=utf-8" },
  { route: "/page.js", file: "page.js", type: "text/javascript; charset=utf-8" },
  { route: "/page.css", file: "page.css", type: "text/css; charset=utf-8" },
] as const;

export interface LabelServerOptions {
  clips: readonly ClipInfo[];
  labelsDir: string;
  /** Pre-filled labeler name (the `--labeler` flag). The page falls back to a name saved in localStorage. */
  labeler?: string | null;
  /** Directory holding page.html / page.js / page.css. Defaults to the source directory. */
  assetsDir?: string;
}

export interface RunningLabelServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Reads a baseline manifest file and drops contact sheets that are not on disk. */
export async function loadClipsFromManifest(manifestPath: string): Promise<ClipInfo[]> {
  const text = await readFile(manifestPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`manifest is not valid JSON: ${manifestPath}`);
  }
  return parseManifest(json, dirname(manifestPath)).map((clip) =>
    clip.contactPath !== null && !existsSync(clip.contactPath) ? { ...clip, contactPath: null } : clip,
  );
}

/** Statuses for every clip, read from the labels dir. A label file that fails to parse is marked invalid. */
export async function readLabelStatuses(clips: readonly ClipInfo[], labelsDir: string): Promise<LabelStatus[]> {
  return Promise.all(
    clips.map(async (clip) => {
      try {
        const label = await readLabelFile(labelsDir, clip.id);
        return statusForLabel(clip.id, label);
      } catch {
        return statusForLabel(clip.id, null, true);
      }
    }),
  );
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function labelPath(labelsDir: string, id: string): string {
  return join(labelsDir, `${id}.json`);
}

/** Null when no file exists; throws when it exists but is not a valid label for `id`. */
async function readLabelFile(labelsDir: string, id: string): Promise<ClipLabel | null> {
  let text: string;
  try {
    text = await readFile(labelPath(labelsDir, id), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const label = parseClipLabel(text);
  if (label.clipId !== id) throw new Error(`label file for ${id} names clip ${label.clipId}`);
  return label;
}

/** Writes via a temp file in the same directory, then renames, so a crash never leaves a half-written label. */
async function writeLabelAtomic(labelsDir: string, id: string, label: ClipLabel): Promise<void> {
  const tmp = join(labelsDir, `.${id}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${serializeClipLabel(label)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tmp, labelPath(labelsDir, id));
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function describeZod(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

async function streamFile(req: IncomingMessage, res: ServerResponse, filePath: string, contentType: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    throw new HttpError(404, "file not found");
  }
  const range = parseByteRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes" });
    res.end();
    return;
  }
  const headers: Record<string, string | number> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  let status = 200;
  let start = 0;
  let end = size - 1;
  if (range !== null) {
    status = 206;
    start = range.start;
    end = range.end;
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(filePath, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function checkLocalRequest(req: IncomingMessage): void {
  const host = req.headers.host ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0] ?? "";
  if (!LOCAL_HOSTS.has(hostname)) throw new HttpError(403, "forbidden host");
  const origin = req.headers.origin;
  if (origin !== undefined && new URL(origin).host !== host) throw new HttpError(403, "forbidden origin");
}

function decodeId(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "malformed clip id");
  }
  if (!isSafeClipId(id)) throw new HttpError(400, "invalid clip id");
  return id;
}

export function createLabelServer(options: LabelServerOptions): Server {
  const { clips, labelsDir } = options;
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const assetsDir = options.assetsDir ?? resolveAssetsDir();
  const assets = new Map<string, { type: string; body: Buffer }>(
    ASSET_FILES.map((a) => [a.route, { type: a.type, body: readFileSync(join(assetsDir, a.file)) }]),
  );

  const requireClip = (id: string): ClipInfo => {
    const clip = clipById.get(id);
    if (!clip) throw new HttpError(404, `unknown clip: ${id}`);
    return clip;
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    checkLocalRequest(req);
    const method = req.method ?? "GET";
    // Not `new URL(...).pathname`: that would silently normalize `/clips/..` to `/`.
    const path = (req.url ?? "/").split(/[?#]/, 1)[0] as string;
    const isRead = method === "GET" || method === "HEAD";

    const asset = isRead ? assets.get(path) : undefined;
    if (asset) {
      res.writeHead(200, { "content-type": asset.type, "content-length": asset.body.length, "cache-control": "no-store" });
      res.end(method === "HEAD" ? undefined : asset.body);
      return;
    }

    if (isRead && path === "/api/meta") {
      sendJson(res, 200, {
        labeler: options.labeler ?? null,
        axes: DRAMA_AXES.map((id) => ({ id, question: AXIS_QUESTIONS[id] })),
        failureCodes: DRAMA_FAILURE_CODES.map(({ id, slug, definition }) => ({ id, slug, definition })),
      });
      return;
    }
    if (isRead && path === "/api/clips") {
      sendJson(res, 200, clips.map(toClipListItem));
      return;
    }
    if (isRead && path === "/api/labels") {
      sendJson(res, 200, await readLabelStatuses(clips, labelsDir));
      return;
    }

    const clipMatch = /^\/clips\/([^/]+)$/.exec(path);
    if (isRead && clipMatch) {
      const clip = requireClip(decodeId(clipMatch[1] as string));
      await streamFile(req, res, clip.videoPath, "video/mp4");
      return;
    }
    const contactMatch = /^\/contacts\/([^/]+)$/.exec(path);
    if (isRead && contactMatch) {
      const clip = requireClip(decodeId(contactMatch[1] as string));
      if (clip.contactPath === null) throw new HttpError(404, "clip has no contact sheet");
      await streamFile(req, res, clip.contactPath, "image/png");
      return;
    }

    const labelMatch = /^\/api\/labels\/([^/]+)$/.exec(path);
    if (labelMatch) {
      const id = decodeId(labelMatch[1] as string);
      requireClip(id);
      if (method === "GET") {
        let label: ClipLabel | null;
        try {
          label = await readLabelFile(labelsDir, id);
        } catch (err) {
          throw new HttpError(422, `stored label for ${id} is invalid`, err instanceof ZodError ? describeZod(err) : String(err));
        }
        if (label === null) throw new HttpError(404, `no label for ${id}`);
        sendJson(res, 200, label);
        return;
      }
      if (method === "PUT") {
        const label = await parsePutBody(req, id);
        await writeLabelAtomic(labelsDir, id, label);
        sendJson(res, 200, label);
        return;
      }
      throw new HttpError(405, `${method} not allowed`);
    }

    throw new HttpError(404, "not found");
  }

  return createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
        return;
      }
      sendJson(res, 500, { error: "internal error" });
    });
  });
}

async function parsePutBody(req: IncomingMessage, id: string): Promise<ClipLabel> {
  const text = await readBody(req);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
  if (typeof json === "object" && json !== null && (json as { clipId?: unknown }).clipId !== id) {
    throw new HttpError(400, `body clipId does not match URL id ${id}`);
  }
  try {
    return normalizeLabel(parseClipLabel(json));
  } catch (err) {
    if (err instanceof ZodError) throw new HttpError(400, "invalid label", describeZod(err));
    throw err;
  }
}

/** The page files live next to this module in `src/`; when running compiled from `dist/`, fall back to `src/`. */
function resolveAssetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [here, join(here, "..", "..", "..", "src", "drama", "label-ui")];
  const found = candidates.find((dir) => existsSync(join(dir, "page.html")));
  if (!found) throw new Error(`label UI assets (page.html) not found in: ${candidates.join(", ")}`);
  return found;
}

/** Starts the server on 127.0.0.1. Pass `port: 0` for an ephemeral port. */
export async function startLabelServer(options: LabelServerOptions & { port: number }): Promise<RunningLabelServer> {
  await mkdir(options.labelsDir, { recursive: true });
  const server = createLabelServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("label server has no TCP address");
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
