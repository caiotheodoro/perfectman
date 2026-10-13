/**
 * What is being said right now, as plain text, for a screen too small to read
 * a balloon on. The stage keeps drawing balloons; on a phone they are a few
 * pixels tall, so the line is also set in a caption under the stage.
 */
import type { Sample } from "@perfectman/shared";

export type Caption = { name: string; text: string; kind: "speech" | "shout" | "whisper" | "thought" };

const CJK = /[぀-ヿ一-鿿]/;

/** The newest live balloon, with only the words that have landed so far. */
export function captionAt(S: Sample, name: (id: string) => string): Caption | null {
  let latest: Sample["balloons"][number] | null = null;
  for (const b of S.balloons) if (b.pages && (!latest || b.t0 > latest.t0)) latest = b;
  if (!latest?.pages) return null;
  const page = latest.pages.find((p) => S.t >= p.t0 && S.t <= p.t1) ?? latest.pages[0]!;
  const line = page.lines.join(" ");
  let text: string;
  if (latest.kind === "thought" || latest.words.length === 0) text = line;
  else {
    let landed = 0;
    for (let k = 0; k < page.n; k++) { const w = latest.words[page.w0 + k]; if (w && w.t <= S.t) landed++; else break; }
    text = CJK.test(line) ? [...line].slice(0, landed).join("") : line.split(" ").filter(Boolean).slice(0, landed).join(" ");
  }
  return text ? { name: name(latest.actor), text, kind: latest.kind } : null;
}
