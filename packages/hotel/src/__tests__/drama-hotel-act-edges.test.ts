import { describe, expect, it } from "vitest";
import { validateActCmd } from "../director/act-cmd.js";

const ctx = { run: 7, actor: -701 };
const check = (cmd: Record<string, unknown>) => validateActCmd({ k: "act", ...cmd }, ctx, new Set());

/**
 * Where the hotel's own ACT-4 reader (`act_fields` in `crates/sim/src/drama.rs`, hotel branch drama/h1-contract) is looser or counts
 * differently than the sidecar's pre-send check did. Each case is a command the hotel accepts, so the sidecar must not refuse it
 * before the socket, or one the hotel refuses with a detail the sidecar must give the same way.
 */
describe("the sidecar's pre-send check against the hotel's act_fields", () => {
  it("[ACT-4] reads a null optional field as absent, as the hotel does (the real schema types them `T | null`)", () => {
    expect(check({ act_id: "n1", verb: "slap", with: 9, intensity: null, origin: null, authored_skip: null, text: null })).toBeUndefined();
    expect(check({ act_id: "n2", verb: "cry", with: null })).toBeUndefined();
    expect(check({ act_id: "n3", verb: "slap", with: null })).toEqual({ code: "target_required", detail: "slap" });
  });

  it("[ACT-4] counts the 200 characters of `text` as characters, not UTF-16 units: 200 emoji pass, 201 do not", () => {
    expect(check({ act_id: "t1", verb: "insult", with: 9, text: "😀".repeat(200) })).toBeUndefined();
    expect(check({ act_id: "t2", verb: "insult", with: 9, text: "😀".repeat(201) })).toEqual({ code: "bad_message", detail: "act.text" });
  });

  it("[ACT-6] cuts the verb in an unknown_verb detail at 40 characters without splitting a character", () => {
    const got = check({ act_id: "u1", verb: "😀".repeat(50), with: 9 });
    expect(got).toEqual({ code: "unknown_verb", detail: "😀".repeat(40) });
  });
});
