import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateActCmd } from "../director/act-cmd.js";
import { negotiate } from "../director/dialect.js";
import { DRAMA_HOTEL_TYPES, isDramaFrame } from "../director/drama-frames.js";
import type { HotelFrame } from "../director/index.js";
import { routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { checkFrame } from "../testing/frame-schema.js";
import { HOTEL_FIXTURE_DIR, HOTEL_FIXTURE_FILES, LIFECYCLES, asWire, hotelSha256, lifecycleFrames, pinnedShas, readHotelRows } from "../testing/hotel-fixtures.js";

const JSONL = HOTEL_FIXTURE_FILES.filter((f) => f.endsWith(".jsonl"));

/** Rows of `act-validation.jsonl` whose sidecar frame is not even a valid `SidecarMsg`: the hotel answers them field by field (ACT-4, ACT-6). */
const UNPARSEABLE_IN = ["f-with6", "f-origin8", "v5"];

describe("the hotel's vendored fixtures: provenance", () => {
  it("pins every file by the sha256 in PROVENANCE.md, and lists no file that is not there", () => {
    const pinned = pinnedShas();
    expect(Object.keys(pinned).sort()).toEqual([...HOTEL_FIXTURE_FILES].sort());
    for (const file of HOTEL_FIXTURE_FILES) expect(hotelSha256(file), file).toBe(pinned[file]);
  });

  it("names the hotel branch and commit it was copied from", () => {
    const text = readFileSync(join(HOTEL_FIXTURE_DIR, "PROVENANCE.md"), "utf8");
    expect(text).toContain("drama/h2-sequencer");
    expect(text).toContain("e1ba02545bf1843e728bd9de00cf5ac513bb55e4");
    expect(text).toContain("drama/h1-contract");
  });
});

describe("the hotel's frames against the real schema and the TS frame types", () => {
  it("[FRM-3] every frame the hotel expects is a valid HotelMsg of the real schema, in every file", () => {
    for (const file of JSONL) {
      for (const [i, row] of readHotelRows(file).entries()) {
        row.expect.forEach((frame, n) => {
          const check = checkFrame("hotel_to_sidecar", asWire(frame, n + 1));
          expect({ file, row: i, frame: frame["t"], errors: check.errors.slice(0, 2) }).toEqual({ file, row: i, frame: frame["t"], errors: [] });
        });
      }
    }
  });

  it("every sidecar frame the hotel was fed is a valid SidecarMsg, except the three rows that are wrong on purpose", () => {
    const wrong: string[] = [];
    for (const file of JSONL) {
      for (const row of readHotelRows(file)) {
        if (!row.in) continue;
        if (!checkFrame("sidecar_to_hotel", row.in).ok) wrong.push(String((row.in["cmd"] as { act_id: string }).act_id));
      }
    }
    expect(wrong).toEqual(UNPARSEABLE_IN);
  });

  it("the hotel's own wire examples (16 hotel and 4 sidecar frames; the browser and client ones are not on the Director wire) all validate", () => {
    const examples = JSON.parse(readFileSync(join(HOTEL_FIXTURE_DIR, "wire-examples.json"), "utf8")) as Array<{ kind: string; frame: Record<string, unknown> }>;
    const byKind = (kind: string) => examples.filter((e) => e.kind === kind);
    expect([byKind("hotel").length, byKind("sidecar").length]).toEqual([16, 4]);
    for (const e of byKind("hotel")) expect(checkFrame("hotel_to_sidecar", e.frame), String(e.frame["t"])).toEqual({ ok: true, errors: [] });
    for (const e of byKind("sidecar")) expect(checkFrame("sidecar_to_hotel", e.frame), String(e.frame["t"])).toEqual({ ok: true, errors: [] });
  });

  it("every drama frame of the four recorded lifecycles is routed to its own handler by the exhaustive router", () => {
    const handled: string[] = [];
    const sink = Object.fromEntries(
      ["onSession", "onActStarted", "onActBeat", "onActReaction", "onActDone", "onDramaConsent", "onActorDeath", "onActorRevive", "onHumanDown", "onHumanUp", "onSceneCut", "onDramaState"].map((m) => [m, (f: { t?: string } | null) => void handled.push(f?.t ?? m)]),
    ) as unknown as DramaFrameSink;
    const seen = new Set<string>();
    for (const life of LIFECYCLES) {
      lifecycleFrames(life).forEach((frame, n) => {
        const wire = asWire(frame, n + 1) as unknown as HotelFrame;
        expect(isDramaFrame(wire), String(frame["t"])).toBe(true);
        if (isDramaFrame(wire)) routeDramaFrame(wire, sink);
        seen.add(String(frame["t"]));
      });
    }
    expect([...seen].sort()).toEqual([...DRAMA_HOTEL_TYPES].sort());
    expect(handled.length).toBe(LIFECYCLES.flatMap((l) => lifecycleFrames(l)).length);
  });
});

describe("[FRM-1] the order inside an act, as the hotel recorded it", () => {
  const kinds = (life: (typeof LIFECYCLES)[number]) => lifecycleFrames(life).map((f) => f["t"]);

  it("a slap the human takes: start, the chip shown and answered, contact, the witnesses, then exactly one act_done as the last frame", () => {
    expect(kinds("slap-human-take")).toEqual(["act_started", "drama_consent", "drama_consent", "act_beat", "act_reaction", "act_reaction", "act_done"]);
  });

  it("a chip nobody answers ends dodged by timeout, with no contact and no reaction", () => {
    expect(kinds("slap-human-timeout")).toEqual(["act_started", "drama_consent", "drama_consent", "act_done"]);
    expect(lifecycleFrames("slap-human-timeout").at(-1)).toMatchObject({ outcome: "dodged", answer: "timeout" });
  });

  it("a kill: the death and the target's `die` reaction on one instant, the act_done five seconds after, then a scene cut revives the dead", () => {
    expect(kinds("kill-actor-revive")).toEqual(["act_started", "act_beat", "actor_death", "act_reaction", "act_reaction", "act_done", "scene_cut", "actor_revive", "drama_state"]);
  });

  it("a killed human is down for 5 s and the abort of the act leaves the down alone: human_up follows act_done", () => {
    const frames = lifecycleFrames("down-human-abort");
    expect(kinds("down-human-abort").slice(-3)).toEqual(["act_reaction", "act_done", "human_up"]);
    const down = frames.find((f) => f["t"] === "human_down");
    const up = frames.find((f) => f["t"] === "human_up");
    expect(Number(up?.["at"]) - Number(down?.["at"])).toBe(Number(down?.["ms"]));
    expect(frames.find((f) => f["t"] === "act_done")).toMatchObject({ outcome: "aborted", reason: "calm_room" });
  });
});

describe("the sidecar's own checks against the hotel's act-validation rows", () => {
  const rows = readHotelRows("act-validation.jsonl");
  /** The answers that need the world (the room, the posture, the lease, the switch) and that the sidecar leaves to the hotel. */
  const WORLD_ANSWERS = ["stale_lease", "no_such_run", "unknown_actor", "action_not_here", "target_gone"];

  it("[ACT-4] to [ACT-9] answers every row the frame and the ids decide with the code and detail the hotel gave, and lets every other row through", () => {
    const consumed = new Set<string>();
    const refused: string[] = [];
    for (const row of rows) {
      if (row.given) consumed.clear();
      const cmd = row.in?.["cmd"];
      const got = validateActCmd(cmd, { run: row.in?.["run"] as number, actor: row.in?.["actor"] as number }, consumed);
      const want = row.expect[0] as { t: string; code?: string; detail?: string };
      if (got) {
        expect({ code: got.code, detail: got.detail }, JSON.stringify(cmd)).toEqual({ code: want.code, detail: want.detail });
        refused.push(String((cmd as { act_id: string }).act_id));
      } else {
        const hotelsOwn = want.t === "act_done" || WORLD_ANSWERS.includes(String(want.code)) || (want.code === "bad_message" && want.detail === undefined) || (want.code === "bad_target" && ["bot", "kind", "not_fallen"].includes(String(want.detail)));
        expect(hotelsOwn, JSON.stringify(want)).toBe(true);
      }
    }
    expect(refused).toHaveLength(12);
  });
});

describe("the sidecar's answer to the hotel's own hello", () => {
  const [off, on] = readHotelRows("hello-offer.jsonl");
  type Hello = Extract<HotelFrame, { t: "hello" }>;
  const hello = (frame: Record<string, unknown> | undefined): Hello => asWire(frame ?? {}, 1) as unknown as Hello;

  it("[NEG-2] a hotel with the switch off sends no offer, and a drama sidecar answers it as plain PROTO 1", () => {
    const frame = hello(off?.expect[0]);
    expect(frame).not.toHaveProperty("drama");
    expect(frame).not.toHaveProperty("proto_max");
    expect(negotiate(frame, { enabled: true })).toMatchObject({ dialect: 1, ackProto: 1, session: null });
  });

  it("[NEG-3] [SAFE-2] a hotel with the switch on offers drama with `enabled:false` (the runtime switch is off until an admin turns it on), and the session still opens on dialect 2 with the vendored vocab sha", () => {
    const neg = negotiate(hello(on?.expect[0]), { enabled: true });
    expect(neg).toMatchObject({ dialect: 2, ackProto: 2, caps: ["drama.v1"], session: { enabled: false, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] }, warnings: [] });
  });

  it("[NEG-1] the golden hello of a hotel with the switch off is a valid hello of the real schema and a plain PROTO 1 session", () => {
    const golden = JSON.parse(readFileSync(join(HOTEL_FIXTURE_DIR, "hello-v1.json"), "utf8")) as Record<string, unknown>;
    expect(checkFrame("hotel_to_sidecar", { ...golden, session: "S" })).toEqual({ ok: true, errors: [] });
    expect(negotiate(hello(golden), { enabled: true }).dialect).toBe(1);
  });
});
