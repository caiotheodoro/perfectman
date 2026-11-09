import type { ActVerb } from "@perfectman/shared";
import { LADDER_VERBS } from "@perfectman/shared";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { actFrames } from "./fake-drama.js";
import { A, B, C, H, ROOM, RUN, makeRig } from "./drama-rig.js";
import type { Rig } from "./drama-rig.js";
import type { HotelRow } from "./hotel-fixtures.js";

type GivenActor = { ref?: string; pos: [number, number]; posture: string; moving: boolean; opt_in?: boolean; chip?: "free" | "busy" | "cooldown" };
type GivenAct = { verb: ActVerb; actor: number; with: number; ago_ms: number };
type Given = {
  switch: "on" | "off";
  calm: boolean;
  paused: boolean;
  harm_in_window: number;
  actors: Record<string, GivenActor>;
  humans: Record<string, GivenActor>;
  witnesses: number;
  drama: { max_rung: number; may_target: Array<[string, string]>; may_die: string[] } | null;
  ladder?: GivenAct[];
  fallen?: number[];
};

/**
 * The hotel's structured `given` (its fixtures README: the model world a row ran in), built into a director rig of this
 * side: the same positions and postures, the same switches, scenario block, ladder history, harm window, chip state and
 * fallen set. The hotel's own words for the world are the input; nothing here decides what the answer is. Test support only.
 */
export async function rigFromGiven(row: HotelRow): Promise<{ rig: Rig; cmd: { verb: ActVerb; with?: number; authored_skip?: boolean } }> {
  const g = row.given as unknown as Given;
  const block: ScenarioDrama | undefined = g.drama ? { ...g.drama, permadeath: false } : undefined;
  const rig = makeRig(block ? { block } : {});
  const cmd = (row.in?.["cmd"] ?? {}) as { verb: ActVerb; with?: number; authored_skip?: boolean };

  for (const [id, a] of Object.entries({ ...g.actors, ...g.humans })) {
    const wire = Number(id);
    rig.world.put(wire, { tile: a.pos, state: a.posture === "lay" ? "lay" : a.moving ? "walk" : "stand", ...(wire > 0 ? { human: true } : {}) });
  }

  // RES-1: the sidecar only proposes a `restrain` at someone who has used a rung in the scene; the hotel's row does not say so, its gate does not care.
  if (cmd.verb === "restrain" && cmd.with !== undefined) rig.act({ actId: "aggressor", verb: "glare", actor: cmd.with, with: A, outcome: "landed" });

  // "Absent means the pair stands one rung below the verb" (hotel README): feed that earlier act, long enough ago to be outside every window.
  const rung = LADDER_VERBS.indexOf(cmd.verb as (typeof LADDER_VERBS)[number]);
  const history: GivenAct[] = g.ladder ?? (rung > 0 && cmd.with !== undefined ? [{ verb: LADDER_VERBS[rung - 1] as ActVerb, actor: A, with: cmd.with, ago_ms: 600_000 }] : []);
  const maxAgo = Math.max(0, ...history.map((h) => h.ago_ms));
  const ordered = [...history].sort((x, y) => y.ago_ms - x.ago_ms);
  let elapsed = 0;
  for (const h of ordered) {
    await rig.clock.advance(maxAgo - h.ago_ms - elapsed);
    elapsed = maxAgo - h.ago_ms;
    rig.act({ actId: `h${h.ago_ms}-${h.verb}`, verb: h.verb, actor: h.actor, with: h.with, outcome: "landed" });
  }
  await rig.clock.advance(maxAgo - elapsed);

  const humanId = Number(Object.keys(g.humans)[0] ?? H);
  const human = g.humans[String(humanId)];
  if (human?.chip === "cooldown") rig.act({ actId: "chipcd", verb: "hug", actor: C, with: humanId, outcome: "dodged", chip: true, answer: "dodge" });
  if (human?.chip === "busy") rig.hotel(actFrames({ actId: "chipbusy", verb: "kiss", actor: C, with: humanId, run: RUN, room: ROOM, scene: rig.dir.scene, outcome: "landed", chip: true, answer: "take" }).slice(0, 2));
  for (let i = 0; i < g.harm_in_window; i++) rig.act({ actId: `harm${i}`, verb: "shove", actor: [A, B, C][i % 3] as number, with: humanId, outcome: "landed", chip: true, answer: "take" });
  if (g.witnesses === 0) {
    rig.world.remove(C);
    if (cmd.with !== humanId) rig.world.remove(humanId);
  }
  if (g.fallen?.length) rig.hotel(g.fallen.map((id) => ({ t: "actor_death", run: RUN, room: ROOM, actor: id, cause: "kill", act_id: "x", killer: C, scene: rig.dir.scene, at: 1 })));
  rig.state({ enabled: g.switch === "on", calm: g.calm, paused: g.paused, optIn: human?.opt_in ? [humanId] : [] });
  return { rig, cmd };
}
