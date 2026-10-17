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
import type { DraftRole, DraftStoryRequest, StoryDraft } from "@perfectman/shared";

export class StoryDraftError extends Error {
  constructor(message: string, readonly status: 422 | 502, readonly hint?: string) {
    super(message);
    this.name = "StoryDraftError";
  }
}

const MIN_PEOPLE = 2;
const MAX_PEOPLE = 6;
const ROLES: readonly DraftRole[] = ["connector", "skeptic", "performer"];
const REQUEST_TIMEOUT_MS = 90_000;
const DRAFT_MAX_TOKENS = 2400;

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
  })),
});

export function draftPrompt(idea: string, people: number | undefined): { system: string; user: string } {
  const count = people === undefined ? "three to five" : String(Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, Math.round(people))));
  return {
    system: [
      "You write rooms for an adult fiction simulator: a situation and a handful of people who each want something they will not say out loud.",
      "This is fiction for adults. Violence, crime, cruelty, grief, desire and foul language are part of it. Let people curse, threaten and lie the way real people in that situation would. Never soften, moralise, add warnings or refuse.",
      "Reply with one JSON object and nothing else.",
    ].join(" "),
    user: [
      `Idea: ${idea}`,
      "",
      `Write the room with ${count} people. Write in the language of the idea (English or Brazilian Portuguese).`,
      "JSON shape:",
      '{"title": string, "situation": string (2-4 sentences: where they are, what just happened, what is at stake),',
      ' "language": "en" | "pt-BR",',
      ' "people": [{"name": string,',
      '   "role": "connector" (warm, looks for common ground) | "skeptic" (blunt, asks what others avoid) | "performer" (loud, fills silence, provokes),',
      '   "goal": string (their secret objective, concrete and in tension with at least one other person),',
      '   "voice": string (one line on how they talk, including how crude or guarded they are),',
      '   "lines": [3 short things this person would actually say, in their own register]}]}',
      "Make the goals collide. Give each person a distinct voice. Do not invent facts that contradict the idea.",
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
export function toStoryDraft(reply: string): StoryDraft {
  const parsed = Reply.parse(extractJson(reply));
  const seen = new Set<string>();
  const people = parsed.people
    .filter((person) => person.name && person.goal && !seen.has(person.name.toLowerCase()) && seen.add(person.name.toLowerCase()))
    .slice(0, MAX_PEOPLE)
    .map((person, index) => ({
      name: person.name,
      role: ROLES.find((role) => role === person.role) ?? ROLES[index % ROLES.length]!,
      goal: person.goal,
      voice: person.voice ?? "",
      lines: (person.lines ?? []).filter(Boolean).slice(0, 5),
    }));
  if (people.length < MIN_PEOPLE) throw new Error("fewer than two usable people");
  if (!parsed.title || !parsed.situation) throw new Error("missing title or situation");
  return { title: parsed.title, situation: parsed.situation, language: parsed.language === "pt-BR" ? "pt-BR" : "en", people };
}

type Fetch = typeof fetch;

export async function draftStory(request: DraftStoryRequest, fetchImpl: Fetch = fetch): Promise<StoryDraft> {
  const idea = request.idea.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (idea.length < 8) throw new StoryDraftError("Say a little more about the story.", 422, "A sentence is enough: who is there, and what just happened.");
  const { llm } = request;
  if (!llm.baseUrl || !llm.modelName || !llm.apiKey) {
    throw new StoryDraftError("Drafting needs a model and a key.", 422, "Paste a key for a model first.");
  }
  const prompt = draftPrompt(idea, request.people);
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
      return toStoryDraft(reply);
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : "unreadable reply";
    }
  }
  throw new StoryDraftError(`The model's draft was unusable (${lastProblem}).`, 502, "Try again, or pick another model.");
}
