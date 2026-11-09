import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameDirection } from "./frame-schema.js";

/** `docs/drama/act-contract.md`, the frozen spec (revision 2). */
export const CONTRACT_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/drama/act-contract.md");

const SIDECAR = new Set(["hello_ack", "actor_cmd", "scene_advance"]);

export type ContractExample = { line: number; frame: Record<string, unknown>; direction: FrameDirection };

/**
 * Every one-line JSON object that starts `{"t":"` inside a fenced block of the contract, the two-line `hello` examples
 * joined, and a frame-log row (`{"ts_ms":...,"frame":{...}}`) unwrapped to its frame.
 */
export function contractExamples(): ContractExample[] {
  const lines = readFileSync(CONTRACT_PATH, "utf8").split("\n");
  const out: ContractExample[] = [];
  let inFence = false;
  let open: { start: number; text: string } | undefined;
  lines.forEach((raw, i) => {
    if (raw.startsWith("```")) {
      inFence = !inFence;
      open = undefined;
      return;
    }
    if (!inFence) return;
    const text = open ? `${open.text}${raw}` : raw;
    if (!open && !raw.startsWith('{"t":"') && !raw.startsWith('{"ts_ms"')) return;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const frame = (parsed["frame"] as Record<string, unknown> | undefined) ?? parsed;
      out.push({ line: (open?.start ?? i) + 1, frame, direction: SIDECAR.has(String(frame["t"])) ? "sidecar_to_hotel" : "hotel_to_sidecar" });
      open = undefined;
    } catch {
      open = { start: open?.start ?? i, text };
    }
  });
  return out;
}
