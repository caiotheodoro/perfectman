import type {
  AvatarState,
  BodyGroupLine,
  BodyPerception,
  BodyPersonLine,
  DistanceBand,
  FacingKind,
  HearingLevel,
} from "@perfectman/shared";
import { blockedReasonLine } from "../body/blocked-reason-lines.js";
import { escapeAngles, quoteText, type BodyLanguage } from "../space/text.js";

/**
 * Pure text for the "your body and the place" block (embodiment.md 5.4) plus
 * its size controls. Nothing here may say what anyone is (D43): no AI, bot,
 * model, agent, simulation, run, pulse, badge, "real person".
 */

export const BODY_BLOCK_HEADING: Record<BodyLanguage, string> = {
  "pt-BR": "Seu corpo e o lugar",
  en: "Your body and the place",
};

export function estimateBodyTokens(lines: readonly string[]): number {
  return Math.ceil(lines.join("\n").length / 4);
}

// ── compression ──────────────────────────────────────────────────────────────

export type CompressionLevel = 0 | 1 | 2 | 3;

const MAX_INDIVIDUAL_PEOPLE = 6;
const BAND_ORDER: DistanceBand[] = ["intimate", "personal", "social", "public", "out_of_sight"];

function fold(groups: BodyGroupLine[], dropped: BodyPersonLine[]): BodyGroupLine[] {
  const out = groups.map((g) => ({ ...g }));
  for (const p of dropped) {
    const hit = out.find((g) => g.band === p.band && g.activity === p.activity && g.where === undefined);
    if (hit) hit.count += 1;
    else out.push({ count: 1, band: p.band, ...(p.activity !== undefined ? { activity: p.activity } : {}) });
  }
  return out.sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || b.count - a.count);
}

/**
 * L1 collapse people beyond 6 into group lines; L2 also drop social/public
 * people who are neither pinned nor too close, and keep at most 4 places;
 * L3 also cut reach and rooms to the top 2. Never dropped: the self line, the
 * plan and ETA, blocked reasons, pinned people. Pure; the input is untouched.
 */
export function compressBodyPerception(body: BodyPerception, level: CompressionLevel): BodyPerception {
  if (level === 0) return body;
  let people = body.people;
  let groups = body.groups;
  let dropped: BodyPersonLine[] = [];

  const keepPinnedFirst = (list: BodyPersonLine[], max: number): { kept: BodyPersonLine[]; out: BodyPersonLine[] } => {
    const pinned = list.filter((p) => p.pinned);
    const rest = list.filter((p) => !p.pinned);
    const room = Math.max(0, max - pinned.length);
    const keptSet = new Set([...pinned, ...rest.slice(0, room)]);
    return { kept: list.filter((p) => keptSet.has(p)), out: list.filter((p) => !keptSet.has(p)) };
  };

  const l1 = keepPinnedFirst(people, MAX_INDIVIDUAL_PEOPLE);
  people = l1.kept;
  dropped = l1.out;

  let places = body.places;
  let reach = body.reach;
  let rooms = body.rooms;
  if (level >= 2) {
    const far = people.filter((p) => (p.band === "social" || p.band === "public") && !p.pinned && !p.tooClose);
    people = people.filter((p) => !far.includes(p));
    dropped = [...dropped, ...far];
    places = places.slice(0, 4);
  }
  if (level >= 3) {
    reach = reach.slice(0, 2);
    rooms = rooms.slice(0, 2);
  }
  groups = fold(groups, dropped);
  return { ...body, people, groups, places, reach, rooms };
}

// ── rendering ────────────────────────────────────────────────────────────────

type Dict = {
  youAreIn: (room: string, place?: string) => string;
  inTransit: string;
  degraded: string;
  posture: Record<AvatarState, string>;
  facingSelf: (label: string) => string;
  dwell: (s: number) => string;
  planMoving: (goal: string, etaS?: number) => string;
  planArrived: (goal: string) => string;
  planStopped: (goal: string) => string;
  blockedPrefix: string;
  peopleHeader: string;
  alone: string;
  band: Record<DistanceBand, string>;
  steps: (n: number) => string;
  facing: Record<FacingKind, string>;
  activity: Record<string, string>;
  tooClose: string;
  group: (count: number) => string;
  changesPrefix: string;
  arrived: (n: string) => string;
  left: (n: string, via?: string) => string;
  moved: (n: string) => string;
  gesture: (n: string, a: string) => string;
  hearingPrefix: string;
  hear: Record<HearingLevel, (n: string) => string>;
  reachPrefix: string;
  placesPrefix: string;
  seatsFree: (free: number, total: number) => string;
  roomsPrefix: string;
  places: Record<string, string>;
};

const PT: Dict = {
  youAreIn: (room, place) => `Você está em ${room}${place ? ` (${place})` : ""}.`,
  inTransit: "Você está a caminho de outro lugar.",
  degraded: "Você não está enxergando direito agora.",
  posture: { stand: "Em pé", walk: "Andando", sit: "Sentado(a)", lay: "Deitado(a)", dance: "Dançando" },
  facingSelf: (l) => `virado(a) para ${l}`,
  dwell: (s) => `Faz ${s}s que está aí.`,
  planMoving: (g, e) => `Você está indo para ${g}${e !== undefined ? ` (cerca de ${e}s)` : ""}.`,
  planArrived: (g) => `Você acabou de chegar em ${g}.`,
  planStopped: (g) => `Seu trajeto até ${g} foi interrompido.`,
  blockedPrefix: "Bloqueado:",
  peopleHeader: "Quem está aqui:",
  alone: "Não há mais ninguém por perto.",
  band: { intimate: "ao seu lado", personal: "perto", social: "a poucos passos", public: "longe", out_of_sight: "fora de vista" },
  steps: (n) => `${n} ${n === 1 ? "passo" : "passos"}`,
  facing: { facing: "de frente pra você", side_on: "de lado pra você", back_turned: "de costas pra você" },
  activity: {
    wave: "acenando", blow: "mandando um beijo", kiss: "mandando um beijo", laugh: "rindo", thumbs: "fazendo joinha",
    sign: "mostrando uma placa", dance: "dançando", typing: "digitando", talking: "falando", stop: "fazendo sinal de pare", fallen: "no chão, sem reagir",
  },
  tooClose: "alguém muito perto",
  group: (c) => `+${c} ${c === 1 ? "pessoa" : "pessoas"}`,
  changesPrefix: "Mudou desde a última vez:",
  arrived: (n) => `${n} entrou.`,
  left: (n, via) => `${n} saiu${via ? ` por ${via}` : ""}.`,
  moved: (n) => `${n} mudou de lugar.`,
  gesture: (n, a) => `${n} está ${a}.`,
  hearingPrefix: "Você ouve:",
  hear: {
    clear: (n) => `${n} (claro).`,
    garbled: (n) => `${n} falou algo mas está longe demais (não deu pra entender).`,
    notice: (n) => `${n} cochicha com alguém (sem texto).`,
  },
  reachPrefix: "Ao seu alcance:",
  placesPrefix: "Lugares:",
  seatsFree: (f, t) => `${f} de ${t} lugares livres`,
  roomsPrefix: "Outros quartos:",
  places: {
    bar: "o bar", sofa: "o sofá", sofas: "os sofás", seats: "os assentos", chair: "a cadeira", "table with chairs": "a mesa com cadeiras",
    window: "a janela", door: "a porta", bed: "a cama", corner: "o canto", "middle of the room": "o meio da sala",
    "dance floor": "a pista", tv: "a TV", piano: "o piano", jukebox: "a jukebox", table: "a mesa", plant: "a planta", rug: "o tapete",
  },
};

const EN: Dict = {
  youAreIn: (room, place) => `You are in ${room}${place ? ` (${place})` : ""}.`,
  inTransit: "You are on your way to another place.",
  degraded: "You cannot see clearly right now.",
  posture: { stand: "Standing", walk: "Walking", sit: "Sitting", lay: "Lying down", dance: "Dancing" },
  facingSelf: (l) => `facing ${l}`,
  dwell: (s) => `${s}s here.`,
  planMoving: (g, e) => `You are heading to ${g}${e !== undefined ? ` (about ${e}s)` : ""}.`,
  planArrived: (g) => `You just got to ${g}.`,
  planStopped: (g) => `Your way to ${g} was interrupted.`,
  blockedPrefix: "Blocked:",
  peopleHeader: "Who is here:",
  alone: "Nobody else is around.",
  band: { intimate: "right next to you", personal: "close", social: "a few steps away", public: "far", out_of_sight: "out of sight" },
  steps: (n) => `${n} ${n === 1 ? "step" : "steps"}`,
  facing: { facing: "facing you", side_on: "side-on to you", back_turned: "back turned to you" },
  activity: {
    wave: "waving", blow: "blowing a kiss", kiss: "blowing a kiss", laugh: "laughing", thumbs: "giving a thumbs up",
    sign: "holding up a sign", dance: "dancing", typing: "typing", talking: "talking", stop: "signalling stop", fallen: "on the floor, not responding",
  },
  tooClose: "someone is very close",
  group: (c) => `+${c} ${c === 1 ? "person" : "people"}`,
  changesPrefix: "Changed since last time:",
  arrived: (n) => `${n} came in.`,
  left: (n, via) => `${n} left${via ? ` through ${via}` : ""}.`,
  moved: (n) => `${n} moved.`,
  gesture: (n, a) => `${n} is ${a}.`,
  hearingPrefix: "You hear:",
  hear: {
    clear: (n) => `${n} (clearly).`,
    garbled: (n) => `${n} said something but is too far away (you could not make it out).`,
    notice: (n) => `${n} whispers to someone (no text).`,
  },
  reachPrefix: "Within reach:",
  placesPrefix: "Places:",
  seatsFree: (f, t) => `${f} of ${t} seats free`,
  roomsPrefix: "Other rooms:",
  places: {
    bar: "the bar", sofa: "the sofa", sofas: "the sofas", seats: "the seats", chair: "the chair", "table with chairs": "the table with chairs",
    window: "the window", door: "the door", bed: "the bed", corner: "a corner", "middle of the room": "the middle of the room",
    "dance floor": "the dance floor", tv: "the TV", piano: "the piano", jukebox: "the jukebox", table: "the table", plant: "the plant", rug: "the rug",
  },
};

/** A known keyword label translates; anything else is externally authored and quoted. */
function place(d: Dict, label: string): string {
  return d.places[label] ?? quoteText(label);
}

/** Render the block as text lines (no heading; see BODY_BLOCK_HEADING). */
export function renderBodyBlock(body: BodyPerception, opts: { language: BodyLanguage }): string[] {
  const d = opts.language === "pt-BR" ? PT : EN;
  const lines: string[] = [];

  if (body.self.room === "") {
    lines.push(d.inTransit);
  } else {
    lines.push(d.youAreIn(quoteText(body.self.room), body.self.zone ? place(d, body.self.zone) : undefined));
    const facing = body.self.facing ? `, ${d.facingSelf(place(d, body.self.facing))}` : "";
    lines.push(`${d.posture[body.self.posture]}${facing}. ${d.dwell(body.self.dwellS)}`);
  }
  if (body.degraded) lines.push(d.degraded);

  if (body.plan) {
    const goal = place(d, body.plan.goal);
    if (body.plan.status === "moving") {
      lines.push(d.planMoving(goal, body.plan.etaMs !== undefined ? Math.max(0, Math.round(body.plan.etaMs / 1000)) : undefined));
    } else if (body.plan.status === "arrived") lines.push(d.planArrived(goal));
    else lines.push(d.planStopped(goal));
  }

  const blockedLines = body.blocked.map((b) => blockedReasonLine(b, opts.language)).filter((l): l is string => l !== undefined);
  if (blockedLines.length > 0) lines.push(`${d.blockedPrefix} ${blockedLines.join(" ")}`);

  if (body.self.room !== "") {
    if (body.people.length === 0 && body.groups.length === 0) {
      lines.push(d.alone);
    } else {
      lines.push(d.peopleHeader);
      for (const p of body.people) lines.push(`- ${personLine(d, p)}`);
      for (const g of body.groups) lines.push(`- ${groupLine(d, g)}`);
    }
  }

  if (body.changes.length > 0) {
    const parts = body.changes.map((c) => {
      const n = quoteText(c.name);
      switch (c.kind) {
        case "arrived": return d.arrived(n);
        case "left": return d.left(n, c.via ? quoteText(c.via) : undefined);
        case "moved": return d.moved(n);
        case "gesture": return d.gesture(n, d.activity[c.a] ?? escapeAngles(c.a));
      }
    });
    lines.push(`${d.changesPrefix} ${parts.join(" ")}`);
  }

  if (body.hearing.length > 0) {
    lines.push(`${d.hearingPrefix} ${body.hearing.map((h) => d.hear[h.level](quoteText(h.name))).join(" ")}`);
  }

  if (body.reach.length > 0) {
    lines.push(`${d.reachPrefix} ${body.reach.map((r) => `${place(d, r.label)} (${r.handle})`).join(", ")}.`);
  }
  if (body.places.length > 0) {
    const parts = body.places.map((p) => {
      const bits = [p.handle];
      if (p.steps !== undefined) bits.push(d.steps(p.steps));
      if (p.totalSeats !== undefined && p.freeSeats !== undefined) bits.push(d.seatsFree(p.freeSeats, p.totalSeats));
      return `${place(d, p.label)} (${bits.join(", ")})`;
    });
    lines.push(`${d.placesPrefix} ${parts.join(", ")}.`);
  }
  if (body.rooms.length > 0) {
    lines.push(`${d.roomsPrefix} ${body.rooms.map((r) => `${quoteText(r.name)} (${r.handle}, ~${r.travelS}s)`).join(", ")}.`);
  }
  return lines;
}

function personLine(d: Dict, p: BodyPersonLine): string {
  const dist = `${d.band[p.band]}${p.steps !== undefined ? ` (${d.steps(p.steps)})` : ""}`;
  const bits = [dist, d.posture[p.posture].toLowerCase()];
  if (p.facing) bits.push(d.facing[p.facing]);
  if (p.activity) bits.push(d.activity[p.activity] ?? escapeAngles(p.activity));
  if (p.tooClose) bits.push(d.tooClose);
  return `${p.handle} ${quoteText(p.name)}: ${bits.join(", ")}.`;
}

function groupLine(d: Dict, g: BodyGroupLine): string {
  const bits = [d.band[g.band]];
  if (g.where) bits.unshift(place(d, g.where));
  if (g.activity) bits.push(d.activity[g.activity] ?? escapeAngles(g.activity));
  return `${d.group(g.count)}: ${bits.join(", ")}.`;
}
