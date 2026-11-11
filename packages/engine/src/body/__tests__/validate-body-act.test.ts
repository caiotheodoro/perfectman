import { describe, expect, it } from "vitest";
import { ACT_VERBS, BLOCKED_REASON_CODES, type BodyHandleMap, type BodyIntent, type SpaceView } from "@perfectman/shared";
import { applySpaceAction } from "../../space/space-reducer.js";
import { loungeModel, person, T0, viewOf } from "../../space/__tests__/fixture.js";
import { buildBodyPerception } from "../../perception/build-body-perception.js";
import { blockedReasonLine } from "../blocked-reason-lines.js";
import { validateBodyIntent } from "../validate-body-intent.js";

const NOW = T0 + 1000;

function world() {
  const model = loungeModel([person("a1", "Ana", [6, 5], { dir: 2 }), person("a2", "Duda", [7, 5])], ["a1"], {});
  const view = viewOf(model, "a1", NOW);
  const { handles } = buildBodyPerception({ view, targetTokens: 100_000 });
  const duda = Object.entries(handles).find(([, t]) => t.kind === "person")![0];
  const bar = Object.entries(handles).find(([, t]) => t.kind === "zone")![0];
  return { model, view, handles: handles as BodyHandleMap, duda, bar };
}

const body = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
const codes = (r: { blocked: { code: string }[] }) => r.blocked.map((b) => b.code);

describe("validateBodyIntent: the act key", () => {
  it("accepts a targeted verb on a person in the room and reports the handle it used", () => {
    const { view, handles, duda } = world();
    const r = validateBodyIntent(view, "a1", body({ act: { verb: "slap", target: duda, intensity: 0.6 } }), NOW, handles);
    expect(r.blocked).toEqual([]);
    expect(r.accepted.act).toEqual({ verb: "slap", target: duda, intensity: 0.6 });
    expect(r.targets[duda]).toMatchObject({ kind: "person", ref: "a2" });
  });

  it("accepts every solo verb without a target and every targeted verb with one", () => {
    const { view, handles, duda } = world();
    const solo = ACT_VERBS.filter((v) => ["die", "recoil", "freeze_gasp", "cry", "storm_off", "tableau", "faint", "slump", "kneel", "flee"].includes(v));
    for (const verb of solo) expect(validateBodyIntent(view, "a1", body({ act: { verb } }), NOW, handles).accepted.act, verb).toEqual({ verb });
    for (const verb of ACT_VERBS.filter((v) => !solo.includes(v))) {
      expect(validateBodyIntent(view, "a1", body({ act: { verb, target: duda } }), NOW, handles).accepted.act, verb).toEqual({ verb, target: duda });
    }
  });

  it("[ACT-7] drops the act of a required-target verb with no target and keeps the rest of the block", () => {
    const { view, handles } = world();
    const r = validateBodyIntent(view, "a1", body({ act: { verb: "shove" }, expression: "angry" }), NOW, handles);
    expect(r.accepted).toEqual({ order: "move_then_speak", expression: "angry" });
    expect(r.blocked).toEqual([{ code: "unknown_ref", part: "act", detail: "target_required" }]);
  });

  it("[ACT-8] drops the act of a solo verb that has a target, for every solo verb, and keeps the rest", () => {
    const { view, handles, duda } = world();
    for (const verb of ["die", "recoil", "freeze_gasp", "cry", "storm_off", "tableau", "faint", "slump", "kneel", "flee"] as const) {
      const r = validateBodyIntent(view, "a1", body({ act: { verb, target: duda }, expression: "sad" }), NOW, handles);
      expect(r.accepted.act, verb).toBeUndefined();
      expect(r.accepted.expression, verb).toBe("sad");
      expect(r.blocked, verb).toEqual([{ code: "unknown_ref", part: "act", ref: duda, detail: "target_forbidden" }]);
      expect(r.targets[duda], verb).toBeUndefined();
    }
  });

  it("drops an act whose handle is not a person, is not in the room, or is the actor itself", () => {
    const { view, handles, bar } = world();
    expect(codes(validateBodyIntent(view, "a1", body({ act: { verb: "glare", target: bar } }), NOW, handles))).toEqual(["unknown_ref"]);
    expect(codes(validateBodyIntent(view, "a1", body({ act: { verb: "glare", target: "p99" } }), NOW, handles))).toEqual(["unknown_ref"]);
    const away = { ...handles, p77: { kind: "person" as const, ref: "ghost" } };
    const gone = validateBodyIntent(view, "a1", body({ act: { verb: "glare", target: "p77" } }), NOW, away);
    expect(gone.blocked).toEqual([{ code: "target_elsewhere", part: "act", ref: "p77" }]);
    expect(JSON.stringify(gone.blocked)).not.toContain("ghost");
    const self = { ...handles, p78: { kind: "person" as const, ref: "a1" } };
    const me = validateBodyIntent(view, "a1", body({ act: { verb: "glare", target: "p78" } }), NOW, self);
    expect(me.accepted.act).toBeUndefined();
    expect(me.blocked).toEqual([{ code: "unknown_ref", part: "act", ref: "p78", detail: "self" }]);
  });

  it("[ACT-3] counts the act against the command budget: it ranks right after the move, and a move is never dropped", () => {
    const { model, handles, duda, bar } = world();
    const parts = body({ move: { kind: "go_to", place: bar }, act: { verb: "glare", target: duda }, expression: "angry" });
    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { budget: { cmdTimes: [NOW - 1000, NOW - 900] } } });
    const two = validateBodyIntent(viewOf(model, "a1", NOW), "a1", parts, NOW, handles);
    expect(two.accepted.move).toEqual({ kind: "go_to", place: bar });
    expect(two.accepted.act).toEqual({ verb: "glare", target: duda });
    expect(two.accepted.expression).toBeUndefined();
    expect(two.blocked).toEqual([{ code: "slow_down", part: "expression" }]);

    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { budget: { cmdTimes: [NOW - 1000, NOW - 900, NOW - 800] } } });
    const three = validateBodyIntent(viewOf(model, "a1", NOW), "a1", parts, NOW, handles);
    expect(three.accepted.move).toEqual({ kind: "go_to", place: bar });
    expect(three.accepted.act).toBeUndefined();
    expect(three.blocked).toEqual([{ code: "slow_down", part: "act" }, { code: "slow_down", part: "expression" }]);
  });

  it("drops the act on a stale room along with the rest of the body", () => {
    const { view, handles, duda } = world();
    const stale: SpaceView = { ...view, room: { ...view.room!, stale: true } };
    const r = validateBodyIntent(stale, "a1", body({ act: { verb: "glare", target: duda } }), NOW, handles);
    expect(r.accepted).toEqual({ order: "move_then_speak" });
    expect(codes(r)).toEqual(["stale_space"]);
  });
});

describe("the act contract's blocked reasons", () => {
  const SPEC = ["kill_switch", "calm_room", "consent_off", "ladder", "budget", "cooldown", "too_far", "dead_target", "no_scenario_gate", "rate_limit"];

  it("[GATE-1] [GATE-2] [GATE-3] [GATE-4] [GATE-5] [GATE-6] [GATE-7] [GATE-8] [GATE-9] [GATE-10] carries all ten of the spec's reasons, with the exact ids", () => {
    for (const reason of SPEC) expect(BLOCKED_REASON_CODES, reason).toContain(reason);
  });

  it("never tells the model any of them as text (the director decides, not the model)", () => {
    for (const code of ["kill_switch", "calm_room", "consent_off", "ladder", "budget", "dead_target", "no_scenario_gate", "rate_limit"] as const) {
      expect(blockedReasonLine({ code, part: "act", ref: "p1" }, "pt-BR"), code).toBeUndefined();
      expect(blockedReasonLine({ code, part: "act", ref: "p1" }, "en"), code).toBeUndefined();
    }
  });
});
