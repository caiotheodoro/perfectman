import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

/** Hash and decode the same bounded read. */
export async function readTextSource(input: string): Promise<{ text: string; sha256: string }> {
  const info = await stat(input);
  if (!info.isFile()) throw new Error("Video input must be a file");
  if (info.size > MAX_SOURCE_BYTES) throw new Error("Video input exceeds the 32 MiB file limit");
  const bytes = await readFile(input);
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Video input exceeds the 32 MiB file limit");
  return {
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
