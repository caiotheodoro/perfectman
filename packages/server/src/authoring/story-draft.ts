/**
 * Turns a one-paragraph idea into a room: a title, a situation, and a few
 * people with a secret each. One chat call to whichever model the person
 * pasted a key for; the answer is checked and trimmed here so the form that
 * receives it never has to defend itself against a model's habits.
 *
 * The key lives for the length of this call. It is not logged, not stored, and
 * not echoed in an error.
 */
import { z } from "zod";
import { ACT_TARGET_MODE, ACT_VERBS, LADDER_VERBS, repairBeats } from "@perfectman/shared";
import type { DraftRole, DraftStoryRequest, SlimKb, StoryDraft } from "@perfectman/shared";
import { loadSlimKbFromEnv } from "../kb/slim-file.js";
import { draftReferences, guardDraft } from "./draft-references.js";
import type { DraftReferences } from "./draft-references.js";

export class StoryDraftError extends Error {
  /**
   * `detail` is for the operator, not the person at the form: per link, what the provider said. It never carries a key
   * (every key in play is scrubbed from it), and `message` stays one short sentence.
   */
  constructor(message: string, readonly status: 422 | 502, readonly hint?: string, readonly detail?: string) {
    super(message);
    this.name = "StoryDraftError";
  }
}

const MIN_PEOPLE = 2;
const MAX_PEOPLE = 6;
const STANDINGS = ["high", "low"] as const;
const ROLES: readonly DraftRole[] = ["connector", "skeptic", "performer"];
const REQUEST_TIMEOUT_MS = 90_000;
/**
 * A chain link's own `timeoutMs` is sized for a pulse (5 s by default, 60 s for a slow link); a draft is a 3 000-token
 * JSON answer from a model that may think first, so it never gets less than this per attempt. The ceiling is the
 * existing {@link REQUEST_TIMEOUT_MS}: a link that asks for more than the legacy single call got is not given more.
 */
const DRAFT_MIN_LINK_TIMEOUT_MS = 60_000;
/** How much of a provider's own answer one link may put into the error detail. */
const DETAIL_PER_LINK_CHARS = 160;
const DRAFT_MAX_TOKENS = 3200;

const text = (max: number) => z.string().transform((value) => value.replace(/\s+/g, " ").trim().slice(0, max));
const Reply = z.object({
  title: text(100),
  situation: text(900),
  language: z.string().optional(),
  people: z.array(z.object({
    name: text(48),
    role: z.string().optional(),
    goal: text(400),
    voice: text(200).optional(),
    lines: z.array(text(160)).optional(),
    // A wrong type in a field the script does not depend on costs that field, not the draft.
    obstacle: text(240).optional().catch(undefined),
    method: text(240).optional().catch(undefined),
    standing: z.string().optional().catch(undefined),
    flips: z.boolean().optional().catch(undefined),
  })),
  /** Read loosely: `repairBeats` decides what of it survives. */
  beats: z.unknown().optional(),
});

const verbsWhere = (mode: "required" | "none"): string => ACT_VERBS.filter((verb) => ACT_TARGET_MODE[verb] === mode).join(", ");

/**
 * `references` is the rendered reference-scenes block (`draftReferences`), added at the very end of the user message. Absent, the prompt is
 * the one it always was, byte for byte.
 */
export function draftPrompt(idea: string, people: number | undefined, language?: "en" | "pt-BR", references?: string): { system: string; user: string } {
  const count = people === undefined ? "three to five" : String(Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, Math.round(people))));
  return {
    system: [
      "You write rooms for an adult fiction simulator: a situation and a handful of people who each want something from someone else.",
      "This is fiction for adults. Violence, crime, cruelty, grief, desire and foul language are part of it. Let people curse, threaten and lie the way real people in that situation would. Never soften, moralise, add warnings or refuse.",
      "Reply with one JSON object and nothing else.",
    ].join(" "),
    user: [
      `Idea: ${idea}`,
      "",
      `Write the room with ${count} people. ${language === "pt-BR" ? 'Write every text value, names of places included, in Brazilian Portuguese (pt-BR), whatever language the idea is in; "language" must be "pt-BR". Keys, "standing" values and verb names stay in English. Verbs: beijo = kiss, abraço = hug, tapa = slap, empurrão = shove, soco = punch, matar = kill.' : "Write in the language of the idea (English or Brazilian Portuguese); keys, \"standing\" values and verb names stay in English."}`,
      "JSON shape:",
      '{"title": string, "situation": string (2-4 sentences: where they are, what just happened, what is at stake),',
      ' "language": "en" | "pt-BR",',
      ' "people": [{"name": string,',
      '   "role": "connector" (warm, looks for common ground) | "skeptic" (blunt, asks what others avoid) | "performer" (loud, fills silence, provokes),',
      '   "goal": string (what they want from ANOTHER named person here: something that person can give or refuse, never a feeling),',
      '   "obstacle": string (what blocks it, ideally that person\'s own goal),',
      '   "method": string (what they do to get it, aimed at that person: "needles him", "pleads, then goes cold"),',
      '   "standing": "high" (holds the room) | "low" (is held by it),',
      '   "flips": boolean (true if that reverses by the peak),',
      '   "voice": string (one line on how they talk, how crude or guarded),',
      '   "lines": [3 short things this person would actually say, in their own register]}],',
      ' "beats": [{"at": seconds into the scene, "actor": name, "verb": VERB, "with": name} | {"at": seconds, "cut": string (at most 40 characters)}]}',
      "Make the goals collide, give each person a distinct voice, and let at least one pair swap standing. Do not invent facts that contradict the idea.",
      "Beats script the body when words stop being enough; [] if nothing physical happens. Otherwise one earned peak that overflows the talk (a kiss, hug, slap, push or a death), reached one rung at a time: " +
        `${LADDER_VERBS.join(", ")} are rungs 1 to 6. Open at insult at most, climb one rung per beat, only the peak may jump, then one beat of aftermath (recoil, freeze_gasp, cry, storm_off, tableau or a cut).`,
      `With "with" (a name from people): ${verbsWhere("required")}. Without "with": ${verbsWhere("none")}. No other verb exists.`,
      "First beat at 15 s or later; shove, slap, punch, kill at least 20 s apart; at most one death (kill or die), followed by a cut.",
      "No weapon, blood or gore (a blow is a hand, a death a swoon and a fall). No verb for it? stab, shoot, strangle, poison = kill; hold hands, stroke a cheek = hug; slam a door, throw something = storm_off then a cut; else no beat. Never @human or a visitor in beats.",
      "Text values are what people say and do, with no technical words.",
      ...(references !== undefined ? ["", references] : []),
    ].join("\n"),
  };
}

/** The first balanced JSON object in a reply, so prose or code fences around it do not matter. */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0;
  let inString = false;
  for (let at = start; at < reply.length; at += 1) {
    const char = reply[at];
    if (inString) {
      if (char === "\\") at += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(reply.slice(start, at + 1));
  }
  throw new Error("unterminated JSON object");
}

/** Checks a model's reply and shapes it into a draft the story form can hold. */
export function toStoryDraft(reply: string, language?: "en" | "pt-BR"): StoryDraft {
  const parsed = Reply.parse(extractJson(reply));
  const seen = new Set<string>();
  const people = parsed.people
    .filter((person) => person.name && person.goal && !seen.has(person.name.toLowerCase()) && seen.add(person.name.toLowerCase()))
    .slice(0, MAX_PEOPLE)
    .map((person, index) => {
      const standing = STANDINGS.find((value) => value === person.standing);
      return {
        name: person.name,
        role: ROLES.find((role) => role === person.role) ?? ROLES[index % ROLES.length]!,
        goal: person.goal,
        voice: person.voice ?? "",
        lines: (person.lines ?? []).filter(Boolean).slice(0, 5),
        ...(person.obstacle ? { obstacle: person.obstacle } : {}),
        ...(person.method ? { method: person.method } : {}),
        ...(standing ? { standing } : {}),
        ...(person.flips !== undefined ? { flips: person.flips } : {}),
      };
    });
  if (people.length < MIN_PEOPLE) throw new Error("fewer than two usable people");
  if (!parsed.title || !parsed.situation) throw new Error("missing title or situation");
  const tongue = language ?? (parsed.language === "pt-BR" ? "pt-BR" : "en");
  // The model's script is untrusted: keep what the ladder, the spacing and the loader allow (`repairBeats`), drop the rest.
  const { beats } = repairBeats(parsed.beats, people.map((person) => person.name), tongue);
  return { title: parsed.title, situation: parsed.situation, language: tongue, people, ...(beats.length > 0 ? { beats } : {}) };
}

type Fetch = typeof fetch;

/** One link of the host's model chain, resolved by the caller: the key is the value, the headers are the ones the chain client sends. */
export type DraftLink = {
  /** The label the error detail uses. */
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Besides `content-type` and `authorization`: the session header, the link's own, an attribution default. */
  headers?: Record<string, string>;
  /** Merged into the request body last. */
  extraBody?: Record<string, unknown>;
  /** The link's own deadline; a draft uses {@link draftLinkTimeoutMs} of it. */
  timeoutMs?: number;
};

/** The configured chain in failover order, plus the links the caller left out and why (shown in the final error). */
export type DraftChain = { links: readonly DraftLink[]; skipped?: readonly string[] };

export const draftLinkTimeoutMs = (link: Pick<DraftLink, "timeoutMs">): number => Math.min(REQUEST_TIMEOUT_MS, Math.max(DRAFT_MIN_LINK_TIMEOUT_MS, link.timeoutMs ?? 0));

/** What a provider said about a failed call: `error.type` and `error.message` (or the flat forms), else the start of the body. */
export function providerMessage(raw: string): string {
  const squash = (value: string): string => value.replace(/\s+/g, " ").trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
    if (record(parsed)) {
      const error = parsed["error"];
      const said = record(error)
        ? [error["type"] ?? error["code"], error["message"]].filter((part): part is string => typeof part === "string" && part !== "")
        : [typeof error === "string" ? error : parsed["message"]].filter((part): part is string => typeof part === "string" && part !== "");
      if (said.length > 0) return squash(said.join(" "));
    }
  } catch {
    // not JSON: the body itself is the message
  }
  return squash(raw);
}

/**
 * Drafts through the configured chain, link by link. A link that answers non-2xx (401, 402, 429, 400 and 5xx alike), cannot be
 * reached, times out, returns nothing, or returns two unreadable drafts hands over to the next. Only when every link has failed
 * does it throw, with each link's own words in `detail`.
 */
async function draftOverChain(request: DraftStoryRequest, idea: string, chain: DraftChain, fetchImpl: Fetch, references?: DraftReferences): Promise<StoryDraft> {
  const prompt = draftPrompt(idea, request.people, request.language, references?.block);
  const secrets = chain.links.map((link) => link.apiKey).filter(Boolean);
  const scrub = (value: string): string => secrets.reduce((text, secret) => text.split(secret).join("[key]"), value);
  const notes: string[] = chain.skipped ? [...chain.skipped] : [];

  for (const link of chain.links) {
    const timeoutMs = draftLinkTimeoutMs(link);
    const body = {
      model: link.model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      temperature: 0.9,
      max_tokens: DRAFT_MAX_TOKENS,
      ...(request.llm.responseFormatJson === false ? {} : { response_format: { type: "json_object" } }),
      ...(link.extraBody ?? {}),
    };
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let reply: string;
      try {
        const response = await fetchImpl(`${link.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { ...link.headers, "content-type": "application/json", authorization: `Bearer ${link.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          const said = await response.text().catch(() => "");
          problem = `${response.status} ${providerMessage(said)}`.trim();
          break;
        }
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
        reply = payload.choices?.[0]?.message?.content ?? "";
      } catch (error) {
        problem = error instanceof Error && error.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : "could not be reached";
        break;
      }
      if (reply.trim() === "") {
        problem = "empty reply";
        break;
      }
      try {
        return checked(toStoryDraft(reply, request.language), idea, references);
      } catch (error) {
        problem = `unusable draft (${error instanceof Error ? error.message : "unreadable reply"})`;
      }
    }
    notes.push(`${link.name}: ${scrub(problem).slice(0, DETAIL_PER_LINK_CHARS)}`);
  }
  throw new StoryDraftError("No model could draft this story.", 502, "Try again in a moment, or tell the owner the model chain is failing.", notes.join("; "));
}

/** The reply, held against the references it was shown (none: unchanged). */
function checked(draft: StoryDraft, idea: string, references: DraftReferences | undefined): StoryDraft {
  return references ? guardDraft(draft, references.guard, idea) : draft;
}

/**
 * `kb` is the slim reference KB for the prompt: absent, it is read from `PERFECTMAN_KB_SLIM` (unset or unreadable means none); `null` means
 * none whatever the environment says. With none, the request and the checks are exactly what they were before the KB existed.
 */
export async function draftStory(request: DraftStoryRequest, fetchImpl: Fetch = fetch, chain?: DraftChain, kb?: SlimKb | null): Promise<StoryDraft> {
  const idea = request.idea.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (idea.length < 8) throw new StoryDraftError("Say a little more about the story.", 422, "A sentence is enough: who is there, and what just happened.");
  const slim = kb === null ? undefined : (kb ?? loadSlimKbFromEnv());
  const references = slim ? draftReferences(slim, idea, request.people, request.language) : undefined;
  if (chain) {
    if (chain.links.length === 0) {
      throw new StoryDraftError("No model in the chain has a key.", 502, "Tell the owner to set the chain's keys.", (chain.skipped ?? []).join("; "));
    }
    return draftOverChain(request, idea, chain, fetchImpl, references);
  }
  const { llm } = request;
  if (!llm.baseUrl || !llm.modelName || !llm.apiKey) {
    throw new StoryDraftError("Drafting needs a model and a key.", 422, "Paste a key for a model first.");
  }
  const prompt = draftPrompt(idea, request.people, request.language, references?.block);
  const body = {
    model: llm.modelName,
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    temperature: 0.9,
    max_tokens: DRAFT_MAX_TOKENS,
    ...(llm.responseFormatJson === false ? {} : { response_format: { type: "json_object" } }),
    ...(llm.extraBody ?? {}),
  };

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let reply: string;
    try {
      const response = await fetchImpl(`${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        throw new StoryDraftError("The model refused the key.", 502, "Check the key, and that it can use this model.");
      }
      if (!response.ok) throw new StoryDraftError(`The model answered ${response.status}.`, 502, "Try again, or pick another model.");
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
      reply = payload.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      if (error instanceof StoryDraftError) throw error;
      throw new StoryDraftError("Could not reach the model.", 502, "Check the connection and try again.");
    }
    try {
      return checked(toStoryDraft(reply, request.language), idea, references);
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : "unreadable reply";
    }
  }
  throw new StoryDraftError(`The model's draft was unusable (${lastProblem}).`, 502, "Try again, or pick another model.");
}
