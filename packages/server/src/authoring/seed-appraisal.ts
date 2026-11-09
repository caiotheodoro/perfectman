import type { AgentState, RelationalState } from "@perfectman/shared";

/**
 * What a scene's prior messages do to the people they were said to. The scenario authors them (`priorEvents`, with a `tone`) as the cause of
 * the scene's grievance, but they are only appended to the event log: nothing in the engine reads a tone, so without this the actors start the
 * run with no resentment toward each other and the drama director's motive gate (LAD-6, a grievance from rung 2 up) never opens for a model that
 * only talks (issue #262). The run's seed seam (`applySeeds`) and the offline drama sim both go through here.
 */

/** What a prior message does to the people it was said to, by the tone its author gave it (`payload.tone`, `payload.personTargets`). */
export type PriorEvent = { actorId: string; minutesAgo: number; tone: string; targets: readonly string[] };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Turns the scene's prior messages into what the director reads: a grievance (`resentment`, `lastNegativeAt`) toward whoever said the thing, or
 * warmth. The tones are `hostile`, `accusing`, `betrayal`, `humiliating`, `tender` and `romantic`; any other tone changes nothing. `startMs` is the sim's
 * clock at the start, so `minutesAgo` becomes a time the director's window (LAD-6, 300 s) can count from.
 */
export function appraise(states: ReadonlyMap<string, AgentState>, events: readonly PriorEvent[], startMs: number): Map<string, AgentState> {
  const out = new Map([...states].map(([ref, s]) => [ref, { ...s, socialEmotions: { ...s.socialEmotions }, relationalStates: new Map([...s.relationalStates].map(([k, v]) => [k, { ...v }])) }]));
  for (const e of events) {
    const at = startMs - e.minutesAgo * 60_000;
    for (const ref of e.targets) {
      const s = out.get(ref);
      const rel = s?.relationalStates.get(e.actorId);
      if (!s || !rel || ref === e.actorId) continue;
      const move = (d: Partial<Record<keyof RelationalState, number>>): void => {
        for (const [k, v] of Object.entries(d) as Array<[keyof RelationalState, number]>) {
          const prev = rel[k];
          if (typeof prev === "number") (rel as Record<string, unknown>)[k] = k === "trust" ? Math.max(-1, Math.min(1, prev + v)) : clamp01(prev + v);
        }
      };
      switch (e.tone) {
        case "hostile":
          move({ resentment: 0.3, threat: 0.1, trust: -0.25 });
          rel.lastNegativeAt = Math.max(rel.lastNegativeAt ?? at, at);
          break;
        case "accusing":
          move({ resentment: 0.25, suspicion: 0.3, trust: -0.3 });
          rel.lastNegativeAt = Math.max(rel.lastNegativeAt ?? at, at);
          break;
        case "betrayal":
          move({ resentment: 0.5, threat: 0.15, trust: -0.5 });
          s.socialEmotions.humiliation = clamp01(s.socialEmotions.humiliation + 0.1);
          rel.lastNegativeAt = Math.max(rel.lastNegativeAt ?? at, at);
          break;
        case "humiliating":
          move({ resentment: 0.2, trust: -0.2 });
          s.socialEmotions.humiliation = clamp01(s.socialEmotions.humiliation + 0.5);
          s.socialEmotions.shame = clamp01(s.socialEmotions.shame + 0.2);
          rel.lastNegativeAt = Math.max(rel.lastNegativeAt ?? at, at);
          break;
        case "tender":
          move({ affection: 0.3, comfort: 0.2, trust: 0.15, attraction: 0.15 });
          rel.lastPositiveAt = Math.max(rel.lastPositiveAt ?? at, at);
          break;
        case "romantic":
          move({ affection: 0.2, comfort: 0.1, trust: 0.1, attraction: 0.6 });
          rel.lastPositiveAt = Math.max(rel.lastPositiveAt ?? at, at);
          break;
        default:
          break;
      }
    }
  }
  return out;
}

