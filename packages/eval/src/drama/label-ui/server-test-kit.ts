/** Shared fixtures for the label server tests: a temp dir with fake clips and a running server. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAMA_AXES } from "../axes.js";
import type { ClipLabel } from "../label.js";
import type { ClipInfo } from "./label-session.js";
import { startLabelServer, type RunningLabelServer } from "./server.js";

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
}

export function send(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

export function validLabel(over: Partial<ClipLabel> = {}): ClipLabel {
  return {
    clipId: "alpha",
    labeler: "caio",
    labeledAt: "2026-11-08T22:00:00.000Z",
    scores: Object.fromEntries(DRAMA_AXES.map((a, i) => [a, { score: i === 5 ? null : (i % 5) + 1 }])) as ClipLabel["scores"],
    failureCodes: ["D2", "D1", "E10"],
    pass: false,
    notes: "slap with no cause",
    ...over,
  };
}

export const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
export const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");

export interface Fixture {
  root: string;
  labelsDir: string;
  clips: ClipInfo[];
  running: RunningLabelServer;
  put(id: string, body: unknown): Promise<Reply>;
  resetLabels(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "label-ui-test-"));
  await writeFile(join(root, "alpha.mp4"), VIDEO);
  await writeFile(join(root, "alpha.png"), PNG);
  await writeFile(join(root, "beta.mp4"), VIDEO);
  await writeFile(join(root, "empty.mp4"), "");
  await writeFile(join(root, "secret.json"), "TOP SECRET");
  const clips: ClipInfo[] = [
    { id: "alpha", title: "Alpha scene", durationSec: 12.5, scene: "bar", videoPath: join(root, "alpha.mp4"), contactPath: join(root, "alpha.png") },
    { id: "beta", title: "beta", durationSec: null, scene: null, videoPath: join(root, "beta.mp4"), contactPath: null },
    { id: "empty", title: "empty", durationSec: null, scene: null, videoPath: join(root, "empty.mp4"), contactPath: null },
  ];
  const labelsDir = join(root, "labels");
  const running = await startLabelServer({ clips, labelsDir, labeler: "tester", port: 0 });
  return {
    root,
    labelsDir,
    clips,
    running,
    put: (id, body) =>
      send(running.port, "PUT", `/api/labels/${id}`, {
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    resetLabels: async () => {
      await rm(labelsDir, { recursive: true, force: true });
      await mkdir(labelsDir, { recursive: true });
    },
    cleanup: async () => {
      await running.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
