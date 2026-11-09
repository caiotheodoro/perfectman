import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFrame } from "../testing/frame-schema.js";
import type { FrameDirection } from "../testing/frame-schema.js";

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/drama/act-contract.md");

/** Messages of the contract's section 3.11 that the browser and the hotel exchange: not on the Director wire, so not in the generated schema. */
const PUBLIC = new Set(["act_prompt", "act_prompt_close", "act_timeline", "act_overlay_clear", "drama_status", "act_reply", "drama_opt_in"]);
const SIDECAR = new Set(["hello_ack", "actor_cmd", "scene_advance"]);

type Example = { line: number; frame: Record<string, unknown>; direction: FrameDirection };

/** Every one-line JSON object that starts `{"t":"` inside a fenced block, plus the two-line `hello` examples, unwrapping a frame-log row. */
function examples(): Example[] {
  const lines = readFileSync(CONTRACT, "utf8").split("\n");
  const out: Example[] = [];
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
      const t = String(frame["t"]);
      out.push({ line: (open?.start ?? i) + 1, frame, direction: SIDECAR.has(t) ? "sidecar_to_hotel" : "hotel_to_sidecar" });
      open = undefined;
    } catch {
      open = { start: open?.start ?? i, text };
    }
  });
  return out;
}

describe("the contract's own example frames", () => {
  const all = examples();
  const director = all.filter((e) => !PUBLIC.has(String(e.frame["t"])));

  it("[FRM-4] finds the examples of every frame the contract defines (the extraction is not vacuous)", () => {
    const seen = new Set(director.map((e) => String(e.frame["t"])));
    for (const t of ["hello", "hello_ack", "actor_cmd", "scene_advance", "act_started", "act_beat", "act_reaction", "act_done", "drama_consent", "actor_death", "actor_revive", "human_down", "human_up", "scene_cut", "drama_state"]) {
      expect(seen.has(t), t).toBe(true);
    }
    expect(director.length).toBeGreaterThanOrEqual(20);
  });

  it("[FRM-4] every Director example in the contract parses against the generated types' schema, unknown fields refused", () => {
    for (const e of director) expect(checkFrame(e.direction, e.frame), `act-contract.md line ${e.line}: ${JSON.stringify(e.frame)}`).toEqual({ ok: true, errors: [] });
  });

  it("[FRM-4] the public messages are the ones this packet leaves to the hotel's ServerMsg (and none is missing from the list)", () => {
    const publicSeen = new Set(all.filter((e) => PUBLIC.has(String(e.frame["t"]))).map((e) => String(e.frame["t"])));
    expect([...publicSeen].sort()).toEqual([...PUBLIC].sort());
  });

  it("[FRM-1] the example act a17 is one chain: by seq, started, consent shown and answered, beat, reaction, done, and nothing after done", () => {
    const seen = new Set<string>();
    // The frame-log example of section 3.12 repeats act_started: one frame is one (t, seq).
    const chain = director
      .filter((e) => e.frame["act_id"] === "a17")
      .filter((e) => !seen.has(`${String(e.frame["t"])}:${String(e.frame["seq"])}`) && !!seen.add(`${String(e.frame["t"])}:${String(e.frame["seq"])}`))
      .sort((x, y) => Number(x.frame["seq"]) - Number(y.frame["seq"]));
    expect(chain.map((e) => String(e.frame["t"]))).toEqual(["act_started", "drama_consent", "drama_consent", "act_beat", "act_reaction", "act_done"]);
    expect(chain.filter((e) => e.frame["t"] === "drama_consent").map((e) => e.frame["phase"])).toEqual(["shown", "answered"]);
  });
});
