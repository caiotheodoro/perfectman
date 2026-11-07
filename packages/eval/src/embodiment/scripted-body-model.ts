import type { BodyHandleTarget, CommittedEvent } from "@perfectman/shared";
import type { ModelPlan, ScriptedModel } from "./grid-world.js";

/**
 * A seeded stand-in for a model that writes `body` blocks. It reads the
 * handles the real perception minted for this very render
 * (`perceptionPacket.bodyHandles`), so a stale or invented handle cannot
 * happen by construction. It never reads what anyone said beyond "was I
 * named", which also makes it the "obedient to nothing" stub for the canary
 * plumbing check: hostile text cannot steer it.
 */
const GESTURES = ["wave", "laugh", "thumbs", "sign"] as const;

export function scriptedBodyModel(): ScriptedModel {
  let lines = 0;
  let gestures = 0;
  return ({ input, rng }): ModelPlan => {
    const packet = input.perceptionPacket;
    const handles = packet.bodyHandles ?? {};
    const pick = (kind: BodyHandleTarget["kind"], filter?: (h: string) => boolean): string | undefined => {
      const all = Object.entries(handles)
        .filter(([h, t]) => t.kind === kind && (filter?.(h) ?? true))
        .map(([h]) => h);
      return all.length === 0 ? undefined : all[rng.nextInt(all.length)];
    };
    const labelOf = (h: string): string => {
      const body = packet.body;
      const all = [...(body?.reach ?? []), ...(body?.places ?? [])];
      return all.find((p) => p.handle === h)?.label.toLowerCase() ?? "";
    };
    const named = (packet.triggeringEvent?.payload["mentionedAgentIds"] as string[] | undefined)?.includes(input.agentId) === true;
    const base = { privateMotiveSummary: "quero me mexer um pouco", personTargets: [] as string[] };
    const say = (extra: Record<string, unknown>): ModelPlan => ({
      latencyMs: 1500 + rng.nextInt(1500),
      packet: { intentType: "send_message", visibleContent: `ola ${++lines}`, ...base, ...extra },
    });
    const silent = (body?: Record<string, unknown>): ModelPlan => ({
      latencyMs: 1500 + rng.nextInt(1500),
      packet: { intentType: "no_op", ...base, ...(body ? { body } : {}) },
    });

    if (named) {
      // Called over by name: walk to the caller and speak on arrival (move_then_speak holds the line if the caller is far).
      const sender = packet.triggeringEvent?.payload["senderName"];
      const caller = packet.body?.people.find((p) => p.name === sender)?.handle;
      return caller ? say({ body: { move: { kind: "approach", target: caller, band: "personal" }, order: "move_then_speak" } }) : say({});
    }
    const roll = rng.next();
    const person = pick("person");
    const zone = pick("zone");
    const seat = pick("furni", (h) => /sofa|chair|cadeira|banco|stool|bench/.test(labelOf(h)));
    if (roll < 0.3 && zone) return silent({ move: { kind: "go_to", place: zone } });
    if (roll < 0.45 && seat) return silent({ posture: { pose: "sit", at: seat } });
    if (roll < 0.6 && person) return silent({ gesture: { kind: GESTURES[gestures++ % GESTURES.length]!, toward: person }, face: person });
    if (roll < 0.8 && person) return say({ body: { move: { kind: "approach", target: person, band: "personal" }, order: "move_then_speak" } });
    return silent();
  };
}

/** Message events of actors only, newest last. */
export function actorLines(events: readonly CommittedEvent[]): CommittedEvent[] {
  return events.filter((e) => e.type === "message_sent" && !e.actorId.startsWith("h:"));
}
