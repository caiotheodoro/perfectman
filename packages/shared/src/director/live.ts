/**
 * A run that is still going, as something the director can film.
 *
 * The live stream carries each pulse's messages, thoughts and the strongest few
 * feelings, which is everything the director reads except the full per-pulse
 * state. So a growing run is filmed from a replay built here, and the same film
 * that plays a finished run plays this one as it arrives. Seeded history
 * (pulse -1) is context, not scene, and is left out.
 */
import type { ViewerReplay } from "../live/live-frame.types.js";
import type { DirectorPulse, DirectorReplay } from "./types.js";

export function liveToDirector(replay: ViewerReplay): DirectorReplay {
  const ids = replay.agents.map((a) => a.id);
  const pulses: DirectorPulse[] = replay.pulses
    .filter((p) => p.pulseIndex >= 0)
    .sort((a, b) => a.pulseIndex - b.pulseIndex)
    .map((p) => ({
      pulseIndex: p.pulseIndex,
      committedEvents: p.messages
        .filter((m) => m.eventType === "message_sent" || m.eventType === "reply_sent")
        .map((m) => ({
          id: m.eventId,
          channelId: m.channelId,
          actorId: m.actorId,
          type: m.eventType,
          payload: { content: m.text, ...(m.visibleToAgents.length > 0 ? { addresseeIds: m.visibleToAgents.filter((id) => id !== m.actorId) } : {}) },
        })),
      agentStates: Object.fromEntries(ids.map((id) => {
        const e = p.emotions[id];
        return [id, {
          coreMood: { valence: e?.valence ?? 0, arousal: e?.arousal ?? 0.3, energy: 1 },
          socialEmotions: Object.fromEntries((e?.top ?? []).map((t) => [t.key, t.value])),
        }];
      })),
      agentThinking: Object.fromEntries(Object.entries(p.thinking).map(([id, t]) => [id, {
        privateMotiveSummary: t.privateMotiveSummary,
        emotionDrivers: [...t.emotionDrivers, ...t.motivationDrivers],
        intentType: t.intentType,
      }])),
    }));
  return {
    agentIds: ids,
    agentNames: Object.fromEntries(replay.agents.map((a) => [a.id, a.displayName])),
    agentArchetypes: Object.fromEntries(replay.agents.map((a) => [a.id, a.archetype])),
    ...(replay.agentProfiles ? { agentProfiles: replay.agentProfiles } : {}),
    channels: replay.channels,
    pulses,
    ...(replay.storyClock ? { storyClock: replay.storyClock } : {}),
    ...(replay.look ? { look: replay.look } : {}),
  };
}
