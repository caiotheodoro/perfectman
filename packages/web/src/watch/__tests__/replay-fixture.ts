import type { DirectorEvent, DirectorReplay } from "@perfectman/shared";

export const ids = ["ana", "bruno", "carla"];
const mood = (arousal = 0.4) => ({ valence: 0, arousal, energy: 1 });
const state = (social: Record<string, number> = {}) => ({ coreMood: mood(), socialEmotions: social });
const say = (id: string, actor: string, channelId: string, content: string): DirectorEvent => ({ id, channelId, actorId: actor, type: "message_sent", payload: { content } });

export function tinyReplay(): DirectorReplay {
  const states = { ana: state({ affection: 0.5 }), bruno: state(), carla: state({ resentment: 0.4 }) };
  const thinking = { ana: { privateMotiveSummary: "I want to say this without anyone else hearing it.", emotionDrivers: ["need to be heard"] } };
  return {
    agentIds: ids,
    agentNames: { ana: "Ana", bruno: "Bruno", carla: "Carla" },
    agentArchetypes: { ana: "organizer", bruno: "trickster", carla: "gatekeeper" },
    channels: [
      { id: "room", name: "room", type: "public_channel", memberAgentIds: ids },
      { id: "pair", name: "pair", type: "private_channel", memberAgentIds: ["ana", "bruno"] },
    ],
    storyClock: { start: "23:40", minutesPerPulse: 4 },
    pulses: [
      { pulseIndex: 0, committedEvents: [say("e1", "ana", "room", "Good evening everyone, this is a long enough line to need some reading time.")], agentStates: states, agentThinking: thinking },
      { pulseIndex: 1, committedEvents: [say("e2", "ana", "pair", "Bruno, can we talk away from the others for a second?")], agentStates: states, agentThinking: thinking },
      { pulseIndex: 2, committedEvents: [], agentStates: states },
      { pulseIndex: 3, committedEvents: [say("e3", "bruno", "room", "Back in the room, fine.")], agentStates: states },
    ],
  };
}

