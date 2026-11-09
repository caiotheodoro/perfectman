import { ACT_ORIGINS, ACT_TARGET_MODE, ACT_VERBS } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";
import type { ActorErrorCode } from "./generated.js";
import { VOCAB_CONSTANTS } from "./verb-vocab.generated.js";

export type ActCmdError = { code: ActorErrorCode; detail?: string };

const ACT_ID = new RegExp(VOCAB_CONSTANTS.act_id_pattern);
const isVerb = (v: unknown): v is ActVerb => typeof v === "string" && (ACT_VERBS as readonly string[]).includes(v);
const fail = (code: ActorErrorCode, detail?: string): ActCmdError => (detail === undefined ? { code } : { code, detail });

/**
 * What the hotel will answer to an `actor_cmd{k:"act"}` before it looks at the world (act-contract.md 2.3, ACT-4 to
 * ACT-9 as far as the frame and the ids decide them). The sidecar runs it before the socket so a command the hotel
 * would refuse never spends one of the actor's 8 commands per 5 s (ACT-3 charges first). `consumed` is the run's set
 * of used `act_id`s; an id is consumed when the command passes the field checks, even if a later check refuses it
 * (ACT-5), so a retry takes a new id. The checks that need the world (bot, kind, not_fallen, room, posture) are the
 * hotel's and are not repeated here. Returns undefined when the command may go out.
 */
export function validateActCmd(cmd: unknown, ctx: { run: number; actor: number }, consumed: Set<string>): ActCmdError | undefined {
  if (cmd === null || typeof cmd !== "object") return fail("bad_message");
  const c = cmd as Record<string, unknown>;
  if (c["k"] !== "act") return fail("bad_message");

  // ACT-4: field types and ranges, the field path as detail.
  if (typeof c["act_id"] !== "string" || !ACT_ID.test(c["act_id"])) return fail("bad_message", "act.act_id");
  if (typeof c["verb"] !== "string") return fail("bad_message", "act.verb");
  if (c["intensity"] !== undefined && (typeof c["intensity"] !== "number" || !Number.isFinite(c["intensity"]) || c["intensity"] < 0 || c["intensity"] > 1)) return fail("bad_message", "act.intensity");
  if (c["with"] !== undefined && !Number.isInteger(c["with"])) return fail("bad_message", "act.with");
  if (c["text"] !== undefined && (typeof c["text"] !== "string" || c["text"].length > VOCAB_CONSTANTS.text_max_chars)) return fail("bad_message", "act.text");
  if (c["origin"] !== undefined && !(ACT_ORIGINS as readonly unknown[]).includes(c["origin"])) return fail("bad_message", "act.origin");
  if (c["authored_skip"] !== undefined && typeof c["authored_skip"] !== "boolean") return fail("bad_message", "act.authored_skip");

  // ACT-5: the id is consumed here, whatever happens next.
  if (consumed.has(c["act_id"])) return fail("bad_message", "act_id_reused");
  consumed.add(c["act_id"]);

  // ACT-6 to ACT-8.
  if (!isVerb(c["verb"])) return fail("unknown_verb", c["verb"].slice(0, 40));
  if (c["text"] !== undefined && c["verb"] !== "insult") return fail("bad_message", "act.text");
  const target = c["with"];
  if (ACT_TARGET_MODE[c["verb"]] === "required" && target === undefined) return fail("target_required", c["verb"]);
  if (ACT_TARGET_MODE[c["verb"]] === "none" && target !== undefined) return fail("target_forbidden", c["verb"]);

  // ACT-9, the two cases the ids alone decide: the actor itself, and slot 0 of the run (the narrator).
  if (target === ctx.actor) return fail("bad_target", "self");
  if (target === -(ctx.run * 100)) return fail("bad_target", "narrator");
  return undefined;
}
