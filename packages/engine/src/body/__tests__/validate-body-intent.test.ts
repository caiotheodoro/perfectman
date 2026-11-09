import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BLOCKED_REASON_CODES, type BodyHandleMap, type BodyIntent, type SpaceView } from "@perfectman/shared";
import { applySpaceAction } from "../../space/space-reducer.js";
import { loungeModel, person, T0, viewOf } from "../../space/__tests__/fixture.js";
import { buildBodyPerception } from "../../perception/build-body-perception.js";
import { blockedReasonLine } from "../blocked-reason-lines.js";
import { speechNeedsDeferral, validateBodyIntent } from "../validate-body-intent.js";

const NOW = T0 + 1000;

function world(extra: ReturnType<typeof person>[] = [], over: Parameters<typeof loungeModel>[2] = {}, selfTile: [number, number] = [6, 5]) {
  const model = loungeModel([person("a1", "Ana", selfTile, { dir: 2 }), person("a2", "Duda", [7, 5]), ...extra], ["a1"], over);
  const view = viewOf(model, "a1", NOW);
  const { handles: base } = buildBodyPerception({ view, targetTokens: 100_000 });
  // The perception only mints furniture handles for what is in reach; tests address any piece.
  const handles: BodyHandleMap = { ...base };
  for (const f of view.room!.furni) handles[`f${100 + f.id}`] = { kind: "furni", roomId: "lounge", furniId: f.id };
  return { model, view, handles };
}

const handleOf = (handles: BodyHandleMap, pred: (t: BodyHandleMap[string]) => boolean): string =>
  Object.entries(handles).find(([, t]) => pred(t))![0];
const zone = (h: BodyHandleMap, id: string) => handleOf(h, (t) => t.kind === "zone" && t.zoneId === id);
const furniH = (_h: BodyHandleMap, id: number) => `f${100 + id}`;
const body = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
const codes = (r: { blocked: { code: string }[] }) => r.blocked.map((b) => b.code);

describe("validateBodyIntent", () => {
  it("accepts a clean go_to and reports the handle it used", () => {
    const { view, handles } = world();
    const bar = zone(handles, "bar-1");
    const r = validateBodyIntent(view, "a1", body({ move: { kind: "go_to", place: bar }, expression: "smile" }), NOW, handles);
    expect(r.blocked).toEqual([]);
    expect(r.accepted).toMatchObject({ move: { kind: "go_to", place: bar }, expression: "smile" });
    expect(r.targets[bar]).toMatchObject({ kind: "zone", zoneId: "bar-1" });
  });

  it("unknown_ref, target_elsewhere, room_unreachable, not_a_seat, cooldown, stale_space", () => {
    const { view, handles } = world();
    expect(codes(validateBodyIntent(view, "a1", body({ move: { kind: "go_to", place: "z99" } }), NOW, handles))).toEqual(["unknown_ref"]);

    const away = { ...handles, p77: { kind: "person" as const, ref: "ghost" } };
    const elsewhere = validateBodyIntent(view, "a1", body({ move: { kind: "approach", target: "p77", band: "personal" } }), NOW, away);
    expect(codes(elsewhere)).toEqual(["target_elsewhere"]);
    expect(elsewhere.accepted.move).toBeUndefined();
    expect(JSON.stringify(elsewhere.blocked)).not.toContain("ghost");

    const attic = { ...handles, r9: { kind: "room" as const, roomId: "attic" } };
    expect(codes(validateBodyIntent(view, "a1", body({ move: { kind: "leave", to: "r9" } }), NOW, attic))).toEqual(["room_unreachable"]);

    const juke = furniH(handles, 9);
    const sit = validateBodyIntent(view, "a1", body({ posture: { pose: "sit", at: juke } }), NOW, handles);
    expect(codes(sit)).toEqual(["not_a_seat"]);
    expect(sit.accepted.posture).toEqual({ pose: "sit" });

    const recent: SpaceView = { ...view, body: { ...view.body, dwell: { ...view.body.dwell, lastGestureAt: { wave: NOW - 3000 } } } };
    const cd = validateBodyIntent(recent, "a1", body({ gesture: { kind: "wave" } }), NOW, handles);
    expect(codes(cd)).toEqual(["cooldown"]);
    expect(cd.accepted.gesture).toBeUndefined();

    const stale: SpaceView = { ...view, room: { ...view.room!, stale: true } };
    const st = validateBodyIntent(stale, "a1", body({ move: { kind: "stay" }, expression: "sad" }), NOW, handles);
    expect(codes(st)).toEqual(["stale_space"]);
    expect(st.accepted).toEqual({ order: "move_then_speak" });
  });

  it("seat_taken: picks the nearest free seat of the cluster, else blocks naming who is there", () => {
    const { view, handles } = world([person("a3", "Rafa", [2, 3], { state: "sit", seatId: 2 })]);
    const picked = validateBodyIntent(view, "a1", body({ posture: { pose: "sit", at: furniH(handles, 2) } }), NOW, handles);
    expect(picked.blocked).toEqual([]);
    expect(typeof picked.accepted.posture!.at).toBe("string");
    expect(picked.targets[picked.accepted.posture!.at!]).toMatchObject({ kind: "furni" });
    expect(picked.targets[picked.accepted.posture!.at!]).not.toMatchObject({ furniId: 2 });

    const full = world([
      person("a3", "Rafa", [2, 3], { state: "sit", seatId: 2 }),
      person("a4", "Léo", [3, 3], { state: "sit", seatId: 3 }),
      person("a5", "Bia", [4, 3], { state: "sit", seatId: 4 }),
    ]);
    const blocked = validateBodyIntent(full.view, "a1", body({ posture: { pose: "sit", at: furniH(full.handles, 2) } }), NOW, full.handles);
    expect(blocked.blocked[0]).toMatchObject({ code: "seat_taken", detail: "Rafa" });
    expect(blocked.accepted.posture).toBeUndefined();
    expect(blockedReasonLine(blocked.blocked[0]!, "pt-BR")).toContain("\"Rafa\"");
  });

  it("no_route and busy_moving", () => {
    const sealedHeights = new Array<number>(12 * 8).fill(255);
    sealedHeights[5 * 12 + 6] = 0;
    sealedHeights[5 * 12 + 7] = 0;
    const sealed = world([], { heights: sealedHeights });
    const r = validateBodyIntent(sealed.view, "a1", body({ move: { kind: "go_to", place: zone(sealed.handles, "door-1") } }), NOW, sealed.handles);
    expect(codes(r)).toEqual(["no_route"]);

    const { model, handles } = world();
    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { plan: { id: "p", kind: "go_to", goal: "bar-1", startedAt: NOW - 2000, etaMs: 3000, status: "moving" } } });
    const view = viewOf(model, "a1", NOW);
    const busy = validateBodyIntent(view, "a1", body({ move: { kind: "go_to", place: zone(handles, "bar-1") } }), NOW, handles);
    expect(codes(busy)).toEqual(["busy_moving"]);
  });

  it("slow_down drops facing, expression and gesture before posture, and never a move; too_far auto-approaches a kiss", () => {
    const { model, handles } = world();
    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { budget: { cmdTimes: [NOW - 1000, NOW - 900, NOW - 800] } } });
    const view = viewOf(model, "a1", NOW);
    const r = validateBodyIntent(
      view, "a1",
      body({ move: { kind: "go_to", place: zone(handles, "bar-1") }, gesture: { kind: "laugh" }, expression: "smile", face: handleOf(handles, (t) => t.kind === "person") }),
      NOW, handles,
    );
    expect(r.accepted.move).toBeDefined();
    expect(r.accepted.gesture).toBeUndefined();
    expect(r.blocked.filter((b) => b.code === "slow_down").map((b) => b.part)).toEqual(["gesture", "expression", "face"]);

    const far = world([person("a3", "Léo", [1, 1])]);
    const leo = handleOf(far.handles, (t) => t.kind === "person" && t.ref === "a3");
    const kiss = validateBodyIntent(far.view, "a1", body({ gesture: { kind: "kiss", toward: leo } }), NOW, far.handles);
    expect(codes(kiss)).toEqual(["too_far"]);
    expect(kiss.accepted.move).toEqual({ kind: "approach", target: leo, band: "intimate" });
    expect(kiss.accepted.gesture).toMatchObject({ kind: "kiss", toward: leo });
  });

  it("every code has a line or is explicitly silent", () => {
    for (const code of BLOCKED_REASON_CODES) {
      const line = blockedReasonLine({ code, ref: "X" }, "pt-BR");
      const silent = ["slow_down", "too_far", "cooldown", "kill_switch", "calm_room", "consent_off", "ladder", "budget", "dead_target", "no_scenario_gate", "rate_limit"];
      expect(silent.includes(code) ? line === undefined : typeof line === "string").toBe(true);
    }
  });

  it("property: never throws, never invents parts, keeps the order, only known codes", () => {
    const { view, handles } = world([person("a3", "Léo", [1, 1])]);
    const stale: SpaceView = { ...view, room: { ...view.room!, stale: true } };
    const ref = fc.constantFrom(...Object.keys(handles), "p99", "z0", "f1007", "r9", "zz");
    const bodyArb = fc.record(
      {
        move: fc.oneof(
          fc.record({ kind: fc.constant("approach" as const), target: ref, band: fc.constantFrom("intimate", "personal", "social") }),
          fc.record({ kind: fc.constant("go_to" as const), place: ref }),
          fc.record({ kind: fc.constant("follow" as const), target: ref }),
          fc.record({ kind: fc.constant("keep_distance" as const), target: ref, min: fc.integer({ min: 2, max: 10 }) }),
          fc.record({ kind: fc.constant("leave" as const), to: fc.option(ref, { nil: undefined }) }),
          fc.constant({ kind: "stay" as const }),
        ),
        posture: fc.record({ pose: fc.constantFrom("stand", "sit", "lay"), at: fc.option(ref, { nil: undefined }) }),
        gesture: fc.record({ kind: fc.constantFrom("wave", "kiss", "laugh", "thumbs", "dance", "sign", "stop"), toward: fc.option(ref, { nil: undefined }) }),
        expression: fc.constantFrom("neutral", "smile", "angry", "sad", "surprised", "sleepy"),
        face: ref,
        order: fc.constantFrom("move_then_speak", "speak_then_move", "together"),
      },
      { requiredKeys: ["order"] },
    );
    fc.assert(
      fc.property(bodyArb, fc.boolean(), (raw, useStale) => {
        const input = raw as BodyIntent;
        const r = validateBodyIntent(useStale ? stale : view, "a1", input, NOW, handles);
        expect(r.accepted.order).toBe(input.order);
        for (const key of ["posture", "gesture", "expression", "face"] as const) {
          if (r.accepted[key] !== undefined) expect(input[key]).toBeDefined();
        }
        if (r.accepted.move && !input.move) expect(input.gesture?.kind).toBe("kiss");
        for (const b of r.blocked) expect(BLOCKED_REASON_CODES).toContain(b.code);
        if (useStale) expect(r.accepted).toEqual({ order: input.order });
      }),
      { numRuns: 300 },
    );
  });
});

describe("speechNeedsDeferral", () => {
  it("defers move_then_speak to a far addressee with an ETA and expiry; not when near or speak_then_move", () => {
    const { view, handles } = world([person("a3", "Léo", [0, 0], { dir: 2 })], {}, [11, 7]);
    const leo = "p77"; // a far, unspoken-to person has no handle in a real render; the validator only needs the map
    handles[leo] = { kind: "person", ref: "a3" };
    const duda = handleOf(handles, (t) => t.kind === "person" && t.ref === "a2");
    const far = speechNeedsDeferral(view, "a1", body({ move: { kind: "approach", target: leo, band: "personal" } }), handles, { now: NOW });
    expect(far).toMatchObject({ targetRef: "a3", distance: 11 });
    expect(far!.etaMs).toBeGreaterThan(0);
    expect(far!.expiresAt).toBe(NOW + 2 * far!.etaMs + 5000);
    expect(speechNeedsDeferral(view, "a1", body({ move: { kind: "follow", target: leo } }), handles, { now: NOW })).not.toBeNull();
    expect(speechNeedsDeferral(view, "a1", body({ order: "together", move: { kind: "approach", target: leo, band: "personal" } }), handles)).not.toBeNull();
    expect(speechNeedsDeferral(view, "a1", body({ move: { kind: "approach", target: duda, band: "personal" } }), handles)).toBeNull();
    expect(speechNeedsDeferral(view, "a1", body({ order: "speak_then_move", move: { kind: "approach", target: leo, band: "personal" } }), handles)).toBeNull();
    expect(speechNeedsDeferral(view, "a1", body({}), handles)).toBeNull();
  });
});
