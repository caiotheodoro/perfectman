/**
 * Where everyone stands, for every beat at once.
 *
 * Seating is sticky per room: a figure that jumps to a different spot between
 * two lines reads as a different person. The stage used to remember that in a
 * ref keyed by channel, which broke twice — a silence renders the same channel
 * as a one-seat thought room and overwrote the public room's memory, and
 * seeking backwards replayed with whatever the memory held by then.
 *
 * So the whole list is placed in one pure pass. The room, not the channel, is
 * the unit of memory, and the same list always produces the same seating. The
 * contact sheet reads the same result the stage does, so they cannot disagree.
 */
import type { LiveChannel } from "../live/live-frame.types.js";
import type { StageBeat } from "./beat.js";
import { assignSlots, slotsFor, type ChannelKind, type StageSlot } from "./slots.js";

export type PlacementAgent = { id: string };

export type PlacedMark = {
  agentId: string;
  /** Index into the agents list the placement was made from. */
  agentIndex: number;
  slot: number;
  point: StageSlot;
};

export type Placement = {
  kind: ChannelKind;
  channelId: string;
  /** The room as drawn. A change here is a change of page. */
  roomKey: string;
  /** Sorted by slot, so DOM order is front to back. */
  marks: readonly PlacedMark[];
  speaker?: PlacedMark;
};

export function roomKeyOf(kind: ChannelKind, channelId: string): string {
  return `${kind}/${channelId}`;
}

export function kindOf(channelType: string | undefined, beat: StageBeat | undefined): ChannelKind {
  if (beat?.kind === "silence") return "thought";
  if (channelType === "private_channel") return "private";
  if (channelType === "operator_channel" || channelType === "spectator_channel") return "operator";
  return "public";
}

/** Who stands where before anything has been said: members in channel order, nobody lit. */
export function idlePlacement(channel: LiveChannel | undefined, agents: readonly PlacementAgent[]): Placement {
  const kind = kindOf(channel?.type, undefined);
  const channelId = channel?.id ?? "";
  const indexById = indexes(agents);
  const order = (channel?.memberAgentIds ?? []).map((id) => indexById.get(id)).filter((i): i is number => i !== undefined);
  const slots = assignSlots(order, kind, new Map());
  return { kind, channelId, roomKey: roomKeyOf(kind, channelId), marks: marksOf(slots, kind, agents) };
}

export function placeBeats(
  beats: readonly StageBeat[],
  agents: readonly PlacementAgent[],
  channels: readonly LiveChannel[],
  options: { seed?: Placement } = {},
): Placement[] {
  const indexById = indexes(agents);
  const held = new Map<string, Map<number, number>>();
  if (options.seed) {
    held.set(options.seed.roomKey, new Map(options.seed.marks.map((m) => [m.agentIndex, m.slot])));
  }

  return beats.map((beat) => {
    const channel = channels.find((c) => c.id === beat.channelId);
    const kind = kindOf(channel?.type, beat);
    const roomKey = roomKeyOf(kind, beat.channelId);
    const slots = assignSlots(presentOrder(beat, indexById), kind, held.get(roomKey) ?? new Map());
    held.set(roomKey, slots);
    const marks = marksOf(slots, kind, agents);
    const speaker = marks.find((m) => m.agentId === beat.actorId);
    return { kind, channelId: beat.channelId, roomKey, marks, ...(speaker ? { speaker } : {}) };
  });
}

/**
 * Who stands where, most important first: the speaker, then whoever the line
 * is aimed at, then everyone else in the room. `assignSlots` caps it.
 */
function presentOrder(beat: StageBeat, indexById: ReadonlyMap<string, number>): number[] {
  const ids = [...(beat.actorId ? [beat.actorId] : []), ...beat.audienceIds, ...beat.participantIds];
  const seen = new Set<number>();
  const order: number[] = [];
  for (const id of ids) {
    const at = indexById.get(id);
    if (at === undefined || seen.has(at)) continue;
    seen.add(at);
    order.push(at);
  }
  return order;
}

function marksOf(slots: ReadonlyMap<number, number>, kind: ChannelKind, agents: readonly PlacementAgent[]): PlacedMark[] {
  const points = slotsFor(kind);
  return [...slots]
    .map(([agentIndex, slot]) => ({ agentIndex, slot, agentId: agents[agentIndex]?.id ?? "", point: points[slot] }))
    .filter((m): m is PlacedMark => m.point !== undefined && m.agentId !== "")
    .sort((a, b) => a.slot - b.slot);
}

function indexes(agents: readonly PlacementAgent[]): Map<string, number> {
  return new Map(agents.map((a, i) => [a.id, i]));
}
