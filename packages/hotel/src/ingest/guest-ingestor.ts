import type { EventVisibility, Presence, SpeechMode } from "@perfectman/shared";
import { parseMentionedAgentIds } from "@perfectman/server/hotel";
import type { GuestIngest, GuestLineInput } from "@perfectman/server/hotel";
import type { Clock } from "../clock/clock.js";
import type { HotelFrame } from "../director/index.js";
import { chebyshev } from "../space/geometry.js";
import { computeHearing } from "../space/hearing.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import { sanitizeName, sanitizeText, MAX_CHAT_CHARS } from "../util/text.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";

type HumanChat = Extract<HotelFrame, { t: "human_chat" }>;

/** Social band of the distance bands (embodiment.md 2): up to 6 tiles. */
export const SOCIAL_BAND_TILES = 6;
/** `lines` is the whole room's cap; `perSpeakerLines` keeps one chatty guest from using it all. */
export const INGEST_CAP = { lines: 8, perSpeakerLines: 3, windowMs: 5000 };

export type IngestOutcome =
  | { kind: "dropped"; reason: "no_actor_here" | "unknown_speaker" | "rate_cap" | "no_channel" | "empty" | "bad_mode" }
  | { kind: "ingested"; eventId: string; addressed: string[]; heardBy: string[]; operatorOnly: boolean };

export type IngestorDeps = {
  mirror: HotelSpaceMirror;
  clock: Clock;
  simulationId: string;
  /** agentId -> scene display name, for the run's actors. */
  names: Readonly<Record<string, string>>;
  homeRoom: string;
  channelIdForRoom(room: string): string | undefined;
  guests: GuestIngest;
  /** Arbiter hook: the line's id, time and addressees (ADR-0021). */
  noteHumanLine(roomChannelId: string, line: { eventId: string; at: number; addressedIds: string[]; whisper?: boolean }): void;
  /** Focused pulse request for the addressed actors. */
  requestFocused(agentIds: string[]): void;
  logger?: Logger;
};

/**
 * Guest ingestion (ADR-0022, ADR-0023, hotel-package.md 12). Everything that
 * reaches the prompt is sanitized here; `h:<userId>` stays internal. Admin
 * commands never come through this path.
 */
export class GuestIngestor {
  private readonly recent: number[] = [];
  private readonly recentBySpeaker = new Map<string, number[]>();
  private readonly log: Logger;
  dropped = { rate_cap: 0, other: 0 };

  constructor(private readonly deps: IngestorDeps) {
    this.log = deps.logger ?? silentLogger;
  }

  async handleHumanChat(frame: HumanChat): Promise<IngestOutcome> {
    const { mirror, clock } = this.deps;
    const now = clock.now();
    const room = String(frame.room);
    const mode = frame.mode;
    if (mode !== "say" && mode !== "shout" && mode !== "whisper") return this.drop("bad_mode");

    // 1. Drop frames from rooms with none of this run's actors.
    const here = mirror.peopleIn(room, now);
    const actors = here.filter((p) => this.deps.names[p.ref] !== undefined);
    if (actors.length === 0) return this.drop("no_actor_here");

    const speakerRef = `h:${frame.from.id}`;
    const speaker = here.find((p) => p.ref === speakerRef);
    if (!speaker) {
      this.log.warn("human_chat from an id not in the mirror", { room });
      return this.drop("unknown_speaker");
    }
    const channelId = this.deps.channelIdForRoom(room);
    if (!channelId) return this.drop("no_channel");

    // 2. Sanitize.
    const content = sanitizeText(frame.text, MAX_CHAT_CHARS);
    if (content.length === 0) return this.drop("empty");
    const senderName = sanitizeName(frame.from.name, frame.from.id);

    // 6a. Ingestion cap (8 lines per 5 s per run).
    while (this.recent.length > 0 && now - (this.recent[0] ?? 0) > INGEST_CAP.windowMs) this.recent.shift();
    for (const [ref, times] of this.recentBySpeaker) {
      while (times.length > 0 && now - (times[0] ?? 0) > INGEST_CAP.windowMs) times.shift();
      if (times.length === 0) this.recentBySpeaker.delete(ref);
    }
    const mine = this.recentBySpeaker.get(speakerRef) ?? [];
    if (this.recent.length >= INGEST_CAP.lines || mine.length >= INGEST_CAP.perSpeakerLines) {
      this.dropped.rate_cap++;
      return { kind: "dropped", reason: "rate_cap" };
    }
    this.recent.push(now);
    this.recentBySpeaker.set(speakerRef, [...mine, now]);

    // 3. Addressing.
    const targetRef = mode === "whisper" && frame.to !== null && frame.to !== undefined ? mirror.refOfAvatar(frame.to) : undefined;
    const mentioned = parseMentionedAgentIds(content, this.namesIn(actors));
    const addressed = this.addressed(mode, targetRef, mentioned, speaker, here);

    // 4. Hearing, from the mirror: distance, never from the prompt.
    const heard = computeHearing(
      { tile: speaker.tile, mode, ...(targetRef ? { target: targetRef } : {}) },
      actors,
    );
    // Called by name: the person who is named hears it whatever the distance, as in a real room. Without this a
    // guest at the door who addresses an actor across the room was never answered (the line reached nobody).
    const hearing = { ...heard.hearing };
    if (mode === "say") for (const id of addressed) if (hearing[id] !== "clear" && actors.some((a) => a.ref === id)) hearing[id] = "clear";
    const visibleToAgents = Object.keys(hearing);
    const operatorOnly = visibleToAgents.length === 0;
    const visibility: EventVisibility = operatorOnly
      ? { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "unheard" }
      : {
          visibleToAgents,
          // A whisper is private to whoever hears it; spectators never see it.
          visibleToSpectators: mode !== "whisper",
          visibleToOperators: true,
          visibilityReason: "distance",
        };

    // 5. Append message_sent with untrusted: true.
    const line: GuestLineInput = {
      simulationId: this.deps.simulationId,
      roomChannelId: channelId,
      actorId: speakerRef,
      visibility,
      salience: addressed.length > 0 || mode === "shout" ? "high" : "medium",
      content,
      senderKind: room === this.deps.homeRoom ? "guest" : "passerby",
      senderName,
      // The engine reads `mentionedAgentIds` as "this line is for you". A whisper to Rafa that names Gabi is for Rafa alone:
      // with only the names in the text, Rafa was never asked and the whisper went unanswered (the flaky whisper check).
      mentionedAgentIds: mode === "whisper" ? addressed : [...new Set([...mentioned, ...addressed])],
      addresseeIds: addressed,
      hearing,
      speakerTile: [speaker.tile[0], speaker.tile[1]],
      mode: mode satisfies SpeechMode,
    };
    const committed = await this.deps.guests.ingest(line);

    // 6b. Arbiter and focused pulse for the addressed actors who actually heard it.
    const heardAddressed = addressed.filter((id) => hearing[id] === "clear" || hearing[id] === "garbled");
    this.deps.noteHumanLine(channelId, { eventId: committed.id, at: now, addressedIds: heardAddressed, ...(mode === "whisper" ? { whisper: true } : {}) });
    if (heardAddressed.length > 0) this.deps.requestFocused(heardAddressed);
    return { kind: "ingested", eventId: committed.id, addressed, heardBy: visibleToAgents, operatorOnly };
  }

  private drop(reason: Extract<IngestOutcome, { kind: "dropped" }>["reason"]): IngestOutcome {
    this.dropped.other++;
    return { kind: "dropped", reason };
  }

  private namesIn(actors: readonly Presence[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of actors) {
      const name = this.deps.names[a.ref];
      if (name !== undefined) out[a.ref] = name;
    }
    return out;
  }

  private addressed(
    mode: SpeechMode,
    targetRef: string | undefined,
    mentioned: string[],
    speaker: Presence,
    here: readonly Presence[],
  ): string[] {
    if (mode === "whisper") return targetRef && this.deps.names[targetRef] !== undefined ? [targetRef] : [];
    if (mentioned.length > 0) return mentioned;
    // Else: the only other person within the social band.
    const near = here.filter((p) => p.ref !== speaker.ref && chebyshev(p.tile, speaker.tile) <= SOCIAL_BAND_TILES);
    const only = near.length === 1 ? near[0] : undefined;
    return only && this.deps.names[only.ref] !== undefined ? [only.ref] : [];
  }
}
