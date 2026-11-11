import { CLIMAX_MAX_MS, INCITING_MAX_MS, SHEET_COST_CAP_USD, SHEET_TIMEOUT_MS, SHEET_VERSION, ACT_VERBS, ACT_TARGET_MODE, mockBeatSheet } from "@perfectman/shared";
import type { ActVerb, BeatSheet, RoomBrief, SheetIssue, SlimKb } from "@perfectman/shared";
import { draftReferences, referenceCopy } from "@perfectman/server/hotel";
import type { DraftReferences } from "@perfectman/server/hotel";
import { compileBeatSheet, sheetInputHash } from "./beat-sheet.js";
import type { ScenarioDrama } from "./scenario-drama.js";

/**
 * The director step of the hybrid beat sheet (Contract A): from the scenario, one model call writes the sheet (setup, inciting incident, escalation,
 * reversal, climax, aftermath, with blocking, props, planted information, camera intent and the pre-authored acts) and the actors improvise every word
 * inside it. The reply is untrusted: `compileBeatSheet` (the contract's invariants) and the reference guard (no run of five words of a scene the model was shown)
 * decide, a failure is told back to the model once with the error list, and a second failure is the caller's to handle (the old spine plays).
 *
 * Cost: $0.30 a scene, enforced before every call (the worst case of its prompt and its output cap must fit what is left) and after it (the provider's
 * own usage). Time: each call is cut at 25 s and the whole step at `deadlineMs`. Nothing is logged but counts: no key, no prompt, no reply.
 */

export type SheetBrief = {
  title: string;
  situation: string;
  language: "en" | "pt-BR";
  cast: Array<{
    id: string;
    name: string;
    goal?: string | undefined;
    voice?: string | undefined;
    objective?: { description?: string | undefined; constraint?: string | undefined; costOfExposure?: string | undefined; breakingPoint?: string | undefined } | undefined;
  }>;
  /** What the scene allows: its block, or `"derive"` when it wrote none (everything on the ladder is open and the compile widens the block). */
  drama?: ScenarioDrama | "derive" | undefined;
  room?: RoomBrief | undefined;
  mayTargetHumans?: boolean | undefined;
};

/** One model to call: the shape of a chain link with its key resolved (see `AuthoringService.draftChain`). */
export type SheetLink = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  headers?: Record<string, string> | undefined;
  extraBody?: Record<string, unknown> | undefined;
  /** USD per million tokens. Absent: a conservative stand-in (`ASSUMED_PRICE`) so the cap still holds. */
  price?: { inUsdPerMTok: number; outUsdPerMTok: number } | undefined;
};

export type SheetDeps = {
  links: readonly SheetLink[];
  fetchImpl?: typeof fetch | undefined;
  /** The reference KB for the craft context; absent: none (the prompt then has no reference block). */
  kb?: SlimKb | null | undefined;
  /** The deterministic mock (tests, `PERFECTMAN_LLM_PROVIDER=mock`): no call, no cost. */
  mock?: boolean | undefined;
  /** The whole step, retries included. Default 35 s for a compile (one call of up to 32 s), 25 s for a step at run start. */
  deadlineMs?: number | undefined;
  /** Output cap of a call. Default 3600 tokens. */
  maxTokens?: number | undefined;
  now?: (() => number) | undefined;
};

export type SheetFailure = "no_model" | "http" | "timeout" | "invalid" | "cost";

export type SheetResult =
  | { ok: true; sheet: BeatSheet; warnings: SheetIssue[]; attempts: number; cost_usd: number; ms: number; model: string; promptChars: number }
  | { ok: false; reason: SheetFailure; detail: string; errors: SheetIssue[]; attempts: number; cost_usd: number; ms: number; model?: string };

/** USD per million tokens assumed for a model with no listed price: high enough that the cap is a cap, not a hope. */
export const ASSUMED_PRICE = { inUsdPerMTok: 3, outUsdPerMTok: 15 } as const;
export const SHEET_MAX_TOKENS = 2600;
/** The whole compile-time step by default: a model that cannot write a sheet in this fails fast and the scene falls back to the spine, instead of holding the Save button for a minute. */
export const SHEET_DEADLINE_MS = 35_000;
/** One call may use nearly all of it: the first model is the one chosen for speed, and a failover with a few seconds left could not finish anyway. */
export const SHEET_CALL_CAP_MS = 32_000;
/** pt-BR splits finer than English; chars per token for the pre-call estimate. */
const CHARS_PER_TOKEN = 3.2;
const RETRY_MIN_MS = 8_000;

const TACTICS = "to accuse, to press, to demand, to threaten, to plead, to confess, to expose, to stall, to deflect, to evade, to bargain, to humiliate, to provoke, to confront, to seduce, to comfort, to refuse, to propose";
const ladderLine = "glare (1), insult (2), shove (3), slap (4), punch (5), kill (6)";

const clip = (s: string | undefined, max: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The prompt, split in the system and the user message. Exported for tests and for the benchmark. */
export function buildSheetPrompt(brief: SheetBrief, references?: string): { system: string; user: string } {
  const pt = brief.language === "pt-BR";
  const names = brief.cast.map((c) => c.name);
  const who = brief.cast
    .map((c) => {
      const o = c.objective;
      const bits = [
        `- ${c.name} (id ${c.id})`,
        c.goal ? `wants: ${clip(c.goal, 200)}` : o?.description ? `wants: ${clip(o.description, 200)}` : "",
        o?.constraint ? `held back by: ${clip(o.constraint, 140)}` : "",
        o?.costOfExposure ? `fears exposure of: ${clip(o.costOfExposure, 140)}` : "",
        o?.breakingPoint ? `breaks when: ${clip(o.breakingPoint, 120)}` : "",
        c.voice ? `voice: ${clip(c.voice, 100)}` : "",
      ].filter(Boolean);
      return bits.join("; ");
    })
    .join("\n");
  const room = brief.room;
  const roomLines = room && ((room.furni?.length ?? 0) + (room.zones?.length ?? 0) + (room.places?.length ?? 0) > 0)
    ? [
        room.furni?.length ? `Furniture (use these labels for props and "near"): ${room.furni.slice(0, 24).map((f) => clip(f.label, 30)).join(", ")}.` : "",
        room.zones?.length ? `Zones (for "zone"): ${room.zones.slice(0, 12).map((z) => clip(z.label, 30)).join(", ")}.` : "",
        room.places?.length ? `Named places: ${room.places.slice(0, 12).map((p) => clip(p, 30)).join(", ")}.` : "",
      ].filter(Boolean)
    : [`The room is not known yet: use ordinary names (${pt ? "mesa, sofá, janela, porta, balcão" : "table, sofa, window, door, counter"}); a name that is not there is mimed.`];
  const block = brief.drama;
  const allowed =
    block === undefined || block === "derive"
      ? "Everything on the ladder is open, one kill or die per scene at most (and then a cut)."
      : `The scene allows up to rung ${block.max_rung}${block.max_rung >= 4 ? `; blows of rung 4 or more only at: ${block.may_target.map(([a, v]) => `${a} to ${v}`).join(", ") || "nobody"}` : ""}; who may die: ${block.may_die.join(", ") || "nobody (no kill, no die)"}.`;

  return {
    system: [
      "You are the director of a short dramatic scene in an adult fiction simulator. You plan its shape; the actors will improvise every word.",
      "This is fiction for adults. Conflict, cruelty, lies, desire and violence between characters are part of it. Never soften, moralise or refuse.",
      "Reply with one JSON object and nothing else.",
    ].join(" "),
    user: [
      `Scene: ${clip(brief.title, 100)}`,
      `Situation: ${clip(brief.situation, 900)}`,
      "People (refer to them by NAME in the JSON):",
      who,
      ...roomLines,
      `Language: write every text value in ${pt ? "Brazilian Portuguese (pt-BR)" : "English"}; keys, enums, verbs and tactics stay in English.`,
      "",
      "Write the beat sheet as this JSON (times in ms from the moment everyone is in the room):",
      '{"version":1,"premise":string (one line),"stakes":string (what is won or lost; it must have changed by the end),',
      ' "arc":{"inciting_at_ms":number,"reversal_at_ms":number,"climax_at_ms":number,"aftermath_until_ms":number},',
      ' "beats":[{"id":string,"at_ms":number,"phase":"setup"|"inciting"|"escalation"|"reversal"|"climax"|"aftermath","gist":string (what this moment is FOR),"kind":...}]}',
      "Beat kinds (fields besides id, at_ms, phase, gist):",
      '- act: {"actor":NAME,"verb":VERB,"with":NAME (only for verbs that take a target),"authored_skip":true (only the one peak),"climax":true (exactly one act)}',
      '- cut: {"reason":string, at most 40 characters}',
      '- block: {"actor":NAME,"to":{"zone":string}|{"near":string (a furniture label or a person NAME)}|{"tile":[x,y]},"how":"walk"|"enter"|"exit"|"storm"}',
      '- prop: {"actor":NAME,"prop":string (furniture label or a named object),"op":"take"|"hand"|"place"|"show"|"break"|"read","to":NAME or place}',
      '- reveal: {"fact":string,"to":[NAME],"from":NAME,"via":"say"|"show"|"overhear"} (information planted in someone\'s head: it reaches them as a private note)',
      '- note: {"actor":NAME,"objective":string,"tactic":string,"subtext":string,"until_ms":number} (steers what that person plays for a stretch)',
      '- pause: {"ms":number, 500 to 15000} (authored silence: nobody speaks)',
      '- expression: {"actor":NAME,"face":"neutral"|"smile"|"angry"|"sad"|"surprised"|"sleepy"|"fear"|"disgust"|"smug","ms":number}',
      '- camera: {"intent":{"shot":"establishing"|"two_shot"|"close_up"|"tracking"|"reaction"|"insert","on":NAME or [NAME,NAME],"zoom":number,"move":"dolly_in"|"dolly_out"|"shake"|"slowmo"|"vignette"|"hitstop","amount":0..1,"ms":number}}',
      `Verbs (act): ${ACT_VERBS.join(", ")}. Verbs that take "with": ${ACT_VERBS.filter((v) => ACT_TARGET_MODE[v] === "required").join(", ")} (every other verb takes no "with").`,
      `Tactics (note): ${TACTICS}.`,
      "",
      "Hard rules (a sheet that breaks one is thrown back to you):",
      `1. Exactly one act has "climax":true, phase "climax": a PHYSICAL act (slap, punch, kill, die, shove, restrain, hug or kiss) at arc.climax_at_ms, which is at most ${CLIMAX_MAX_MS} ms. Aim for 130000 to 210000. The scene must be heading there from the first beat.`,
      `2. The inciting incident (first beat with phase "inciting") is at most ${INCITING_MAX_MS} ms. Before it, 2 to 5 setup beats (notes, blocking, a prop, the establishing camera).`,
      `3. The ladder is ${ladderLine}: for the same pair, climb one rung per act, or mark the one peak "authored_skip":true. Physical acts (shove, slap, punch, kill) are at least 20000 ms apart; the same verb at the same person at least 60000 ms apart; at most one kill or die in the scene, followed by a cut 20 s or more later. ${allowed}`,
      "4. At least one reveal or note with phase \"reversal\" before the climax: who has the power changes. Then the climax follows from it.",
      "5. Before the first act, at least one note or reveal. After the climax, at least two beats with phase \"aftermath\", spread over 45 to 90 seconds (a reaction, a face, a pause, a note about what each wants now, a cut), and set aftermath_until_ms to match. The quiet after the blow is part of the scene.",
      "6. At least 4 block, prop or camera beats in total, spread through the scene, so it is not all talk. Props and places use the labels given above.",
      "7. 12 to 20 beats in all, sorted by time, phases in order (setup, inciting, escalation, reversal, climax, aftermath). Unique ids. Be brief: every gist, objective, subtext and fact under 12 words. Reply with the JSON object only, no prose and no markdown.",
      "8. NO DIALOGUE. Never write what a person says, no quoted lines, no keys named text, say or line. gist, objective, subtext and fact describe intent and information; the actors find the words.",
      "9. Give each person a different objective and a hidden fact they can use. Make the goals collide and let the power change hands before the blow.",
      "10. Do not copy any reference scene's lines or names.",
      "",
      "Craft: the best scenes build pressure in small physical beats (a hand on a glass, a step closer, an object held up), plant one fact early that pays off at the reversal, and end the climax in a gesture, not a speech.",
      ...(references ? ["", references] : []),
      `The people are: ${names.join(", ")}.`,
    ].join("\n"),
  };
}

/** The first balanced JSON object in a reply, so prose or a code fence around it does not matter. */
export function extractSheetJson(reply: string): unknown {
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

const proseOf = (sheet: BeatSheet): string[] => [
  sheet.premise,
  sheet.stakes,
  ...sheet.beats.flatMap((b) => [b.gist ?? "", ...(b.kind === "note" ? [b.objective, b.subtext ?? ""] : []), ...(b.kind === "reveal" ? [b.fact] : [])]),
].filter((t) => t !== "");

/** Rounds to a millionth of a dollar: the unit the meter reports in. */
const usd = (n: number): number => Math.round(n * 1e6) / 1e6;
const priceOf = (link: SheetLink): { inUsdPerMTok: number; outUsdPerMTok: number } => link.price ?? ASSUMED_PRICE;
const costOf = (link: SheetLink, tokensIn: number, tokensOut: number): number => (tokensIn * priceOf(link).inUsdPerMTok + tokensOut * priceOf(link).outUsdPerMTok) / 1e6;

/** The deterministic sheet for a brief (what `deps.mock` answers). */
export function mockSheetFor(brief: SheetBrief): BeatSheet {
  const folded = brief.situation.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const ceiling = brief.drama === undefined || brief.drama === "derive" ? 6 : brief.drama.max_rung;
  let climax: ActVerb = /beij|kiss/.test(folded) ? "kiss" : /abrac|hug/.test(folded) ? "hug" : /soco|punch/.test(folded) ? "punch" : "slap";
  if (climax === "punch" && ceiling < 5) climax = "slap";
  if (climax === "slap" && ceiling < 4) climax = "shove";
  const furni = brief.room?.furni?.map((f) => f.label) ?? [];
  const place = (re: RegExp): string | undefined => [...furni, ...(brief.room?.zones?.map((z) => z.label) ?? [])].find((l) => re.test(l.toLowerCase()));
  const sheet = mockBeatSheet({
    cast: brief.cast.map((c) => ({ id: c.id, name: c.name, ...(c.goal ?? c.objective?.description ? { objective: clip(c.goal ?? c.objective?.description, 120) } : {}) })),
    language: brief.language,
    climax,
    places: { ...(place(/mesa|table/) ? { table: place(/mesa|table/)! } : {}), ...(place(/janela|window/) ? { window: place(/janela|window/)! } : {}) },
  });
  return { ...sheet, generated_by: { model: "mock", cost_usd: 0, ms: 0, mock: true, input_hash: sheetInputHashOf(brief) } };
}

export function sheetInputHashOf(brief: SheetBrief): string {
  return sheetInputHash({
    situation: brief.situation,
    language: brief.language,
    cast: brief.cast.map((c) => ({ name: c.name, goal: c.goal, objective: [c.objective?.description, c.objective?.costOfExposure, c.objective?.constraint].filter(Boolean).join(" | "), voice: c.voice })),
    drama: brief.drama ?? null,
    room: brief.room ?? null,
    version: SHEET_VERSION,
  });
}

/** Whether a sheet is the one `brief` would produce now: written by us (it names its inputs) and from these inputs. */
export function sheetIsCurrent(sheet: BeatSheet, brief: SheetBrief): boolean {
  return sheet.generated_by?.input_hash === sheetInputHashOf(brief);
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * One brief to one valid sheet, or a reason it could not be had. Never throws.
 */
export async function generateBeatSheet(brief: SheetBrief, deps: SheetDeps): Promise<SheetResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const cast = brief.cast.map((c) => ({ id: c.id, displayName: c.name }));
  const opts = { drama: brief.drama, room: brief.room, mayTargetHumans: brief.mayTargetHumans };
  const hash = sheetInputHashOf(brief);

  if (deps.mock === true) {
    const made = compileBeatSheet(mockSheetFor(brief), cast, opts);
    if (made.sheet) return { ok: true, sheet: made.sheet, warnings: made.warnings, attempts: 1, cost_usd: 0, ms: now() - started, model: "mock", promptChars: 0 };
    return { ok: false, reason: "invalid", detail: made.errors.slice(0, 3).map((e) => e.message).join("; "), errors: made.errors, attempts: 1, cost_usd: 0, ms: 0, model: "mock" };
  }
  if (deps.links.length === 0) return { ok: false, reason: "no_model", detail: "no model with a key for the beat sheet", errors: [], attempts: 0, cost_usd: 0, ms: 0 };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const deadline = started + (deps.deadlineMs ?? SHEET_DEADLINE_MS);
  const maxTokens = deps.maxTokens ?? SHEET_MAX_TOKENS;
  const kb = deps.kb === null ? undefined : deps.kb;
  const refs: DraftReferences | undefined = kb ? draftReferences(kb, brief.situation, brief.cast.length, brief.language) : undefined;
  const prompt = buildSheetPrompt(brief, refs?.block);

  let cost = 0;
  let attempts = 0;
  let lastErrors: SheetIssue[] = [];
  let lastFail: { reason: SheetFailure; detail: string; model?: string } = { reason: "http", detail: "no model answered" };
  let firstFail: { reason: SheetFailure; detail: string; model?: string } | undefined;
  const secrets = deps.links.map((l) => l.apiKey).filter(Boolean);
  const scrub = (s: string): string => secrets.reduce((t, secret) => t.split(secret).join("[key]"), s);

  for (const link of deps.links) {
    let messages: ChatMessage[] = [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }];
    for (let round = 0; round < 2; round += 1) {
      const left = deadline - now();
      if (left < (round === 0 ? 3_000 : RETRY_MIN_MS)) {
        lastFail = { reason: "timeout", detail: `${round === 0 ? "no time left" : "no time left for a second try"} (${Math.round(left / 100) / 10} s)`, model: link.model };
        firstFail ??= lastFail;
        break;
      }
      const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
      const worst = costOf(link, Math.ceil(promptChars / CHARS_PER_TOKEN), maxTokens);
      // The cap holds before the call: shrink the output allowance to what is left, and give up if not even a short sheet fits.
      const room = SHEET_COST_CAP_USD - cost - costOf(link, Math.ceil(promptChars / CHARS_PER_TOKEN), 0);
      const allowance = priceOf(link).outUsdPerMTok > 0 ? Math.floor((room * 1e6) / priceOf(link).outUsdPerMTok) : maxTokens;
      const callTokens = Math.min(maxTokens, allowance);
      if (callTokens < 1_800) {
        lastFail = { reason: "cost", detail: `a call would cost up to $${worst.toFixed(3)} against the $${SHEET_COST_CAP_USD.toFixed(2)} cap ($${cost.toFixed(3)} spent)`, model: link.model };
        firstFail ??= lastFail;
        break;
      }
      attempts += 1;
      const body = {
        model: link.model,
        messages,
        temperature: 0.8,
        max_tokens: callTokens,
        response_format: { type: "json_object" },
        ...(link.extraBody ?? {}),
      };
      let reply = "";
      try {
        const response = await fetchImpl(`${link.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { ...(link.headers ?? {}), "content-type": "application/json", authorization: `Bearer ${link.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(SHEET_CALL_CAP_MS, left)),
        });
        if (!response.ok) {
          const said = await response.text().catch(() => "");
          lastFail = { reason: "http", detail: scrub(`${link.name}: ${response.status} ${said.replace(/\s+/g, " ").slice(0, 120)}`), model: link.model };
          firstFail ??= lastFail;
          break;
        }
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        reply = payload.choices?.[0]?.message?.content ?? "";
        const tin = payload.usage?.prompt_tokens ?? Math.ceil(promptChars / CHARS_PER_TOKEN);
        const tout = payload.usage?.completion_tokens ?? Math.ceil(reply.length / CHARS_PER_TOKEN);
        cost += costOf(link, tin, tout);
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        // A call that timed out was still billed for its prompt: count the prompt so a loop of timeouts cannot walk past the cap.
        cost += costOf(link, Math.ceil(promptChars / CHARS_PER_TOKEN), 0);
        lastFail = { reason: timedOut ? "timeout" : "http", detail: scrub(`${link.name}: ${timedOut ? `timed out after ${Math.round(Math.min(SHEET_CALL_CAP_MS, left) / 1000)} s` : "could not be reached"}`), model: link.model };
        firstFail ??= lastFail;
        break;
      }
      if (reply.trim() === "") {
        lastFail = { reason: "invalid", detail: `${link.name}: empty reply`, model: link.model };
        firstFail ??= lastFail;
        break;
      }
      let errors: SheetIssue[];
      let made: ReturnType<typeof compileBeatSheet> | undefined;
      let sheetRaw: unknown;
      try {
        const json = extractSheetJson(reply);
        const unwrapped = typeof json === "object" && json !== null && "beat_sheet" in json ? (json as { beat_sheet: unknown }).beat_sheet : json;
        sheetRaw = unwrapped;
        const withOrigin = typeof unwrapped === "object" && unwrapped !== null ? { ...(unwrapped as Record<string, unknown>), generated_by: { model: link.model, cost_usd: usd(cost), ms: now() - started, input_hash: hash, attempts } } : unwrapped;
        made = compileBeatSheet(withOrigin, cast, opts);
        errors = [...made.errors];
        if (made.sheet && refs) {
          const copied = referenceCopy(proseOf(made.sheet), refs.guard, brief.situation);
          if (copied) errors.push({ path: "beat_sheet", message: `beat_sheet.copy: ${copied}` });
        }
      } catch (error) {
        errors = [{ path: "beat_sheet", message: `the reply is not a JSON object (${error instanceof Error ? error.message : "unreadable"})` }];
      }
      if (errors.length === 0 && made?.sheet) {
        const ms = now() - started;
        const sheet: BeatSheet = { ...made.sheet, generated_by: { model: link.model, cost_usd: usd(cost), ms, input_hash: hash, attempts } };
        return { ok: true, sheet, warnings: made.warnings, attempts, cost_usd: usd(cost), ms, model: link.model, promptChars: prompt.user.length + prompt.system.length };
      }
      lastErrors = errors;
      lastFail = { reason: "invalid", detail: `${link.name}: ${errors.slice(0, 3).map((e) => e.message.replace(/^beat_sheet\.\w+: /, "")).join("; ")}${offendingBeat(errors, sheetRaw)}`.slice(0, 520), model: link.model };
      firstFail ??= lastFail;
      // Told once what was wrong, with the sheet it wrote, and asked for the whole sheet again.
      messages = [
        ...messages.slice(0, 2),
        { role: "assistant", content: reply.slice(0, 12_000) },
        { role: "user", content: `That sheet breaks these rules:\n${errors.slice(0, 14).map((e) => `- ${e.path}: ${e.message}`).join("\n")}\nReply with the whole corrected JSON object, nothing else. Keep what was fine.` },
      ];
    }
  }
  const shown = firstFail && firstFail.detail !== lastFail.detail ? { ...lastFail, reason: firstFail.reason, detail: `${firstFail.detail}; then ${lastFail.detail}` } : lastFail;
  return { ok: false, reason: shown.reason, detail: shown.detail, errors: lastErrors, attempts, cost_usd: usd(cost), ms: now() - started, ...(lastFail.model ? { model: lastFail.model } : {}) };
}

/** The first beat a validation error points at, as the model wrote it (cut short), so a stored failure shows what the model got wrong and not only that it did. */
function offendingBeat(errors: readonly SheetIssue[], sheet: unknown): string {
  const index = /beats\[(\d+)\]/.exec(errors[0]?.path ?? "")?.[1];
  const beats = typeof sheet === "object" && sheet !== null ? (sheet as { beats?: unknown }).beats : undefined;
  if (index === undefined || !Array.isArray(beats)) return "";
  return ` | beat ${index}: ${JSON.stringify(beats[Number(index)] ?? null).slice(0, 180)}`;
}
