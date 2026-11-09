import type { AgentRuntimeInput, BlockedReason, BodyHandleMap, BodyPerception, BodyPersonLine, RelationalState, SocialEmotions } from "@perfectman/shared";

/**
 * What the mock model reads of a consult, and nothing more: the actor's id, its social emotions and relations, and the
 * body view with its handles. Test support only (`testing/` is not built).
 */
export type Others = Array<{
  /** The agent id of the other person, as the handle map names it. */
  ref: string;
  rel?: Partial<RelationalState>;
  fallen?: boolean;
  /** How far the person is; default `intimate`, beside the actor. */
  band?: BodyPersonLine["band"];
}>;

const REL: Omit<RelationalState, "targetAgentId"> = {
  trust: 0, affection: 0, resentment: 0, attraction: 0, suspicion: 0, admiration: 0, envy: 0, comfort: 0, threat: 0, curiosity: 0,
  desireForCloseness: 0, desireForDistance: 0, interactionCount: 0, lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
};

const SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0,
  neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
};

export function consult(o: { me?: string; others: Others; social?: Partial<SocialEmotions>; blocked?: BlockedReason[]; drama?: boolean; places?: number }): AgentRuntimeInput {
  const people: BodyPersonLine[] = o.others.map((p, i) => ({ handle: `p${i + 1}`, name: p.ref, band: p.band ?? "intimate", posture: "stand", ...(p.fallen ? { activity: "fallen" } : {}) }));
  const handles: BodyHandleMap = Object.fromEntries(o.others.map((p, i) => [`p${i + 1}`, { kind: "person", ref: p.ref }]));
  for (let i = 0; i < (o.places ?? 1); i++) handles[`z${i + 1}`] = { kind: "zone", roomId: "12", zoneId: `zone-${i}` };
  const body: BodyPerception = {
    self: { room: "Sala", posture: "stand", dwellS: 5 },
    blocked: o.blocked ?? [],
    people,
    groups: [],
    changes: [],
    hearing: [],
    reach: [],
    places: Array.from({ length: o.places ?? 1 }, (_, i) => ({ handle: `z${i + 1}`, label: "bar" })),
    rooms: [],
    ...(o.drama === false ? {} : { drama: true as const }),
  };
  const relationalStates = new Map(o.others.map((p) => [p.ref, { ...REL, targetAgentId: p.ref, ...p.rel }]));
  return {
    agentId: o.me ?? "person-1",
    perceptionPacket: { body, bodyHandles: handles },
    emotionalState: { socialEmotions: { ...SOCIAL, ...o.social }, relationalStates },
  } as never;
}
