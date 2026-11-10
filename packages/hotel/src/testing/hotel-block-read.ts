/**
 * The habbo hotel's read of a scenario version's `drama` (`tilehouse_sim::drama::parse_block`), restated so a test can hold a compiled body to it
 * without the Rust build. The hotel reads `body.drama` strictly (`deny_unknown_fields`): the four keys only, `max_rung` an integer 0 to 6, every
 * `may_target` entry a pair of strings whose first is not `@human`, `may_die` strings, `permadeath` a boolean. Anything else is `invalid` there:
 * the run is free play and the admin gets a `drama_block_invalid` notice. Unknown keys of the body itself (`drama_mode`, `beats`) are ignored.
 */
export type HotelBlockRead = { kind: "absent" } | { kind: "valid"; max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean } | { kind: "invalid"; why: string };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function hotelReadsBlock(body: unknown): HotelBlockRead {
  if (!isRecord(body) || !("drama" in body)) return { kind: "absent" };
  const block = body["drama"];
  if (!isRecord(block)) return { kind: "invalid", why: "not an object" };
  for (const key of Object.keys(block)) if (!["max_rung", "may_target", "may_die", "permadeath"].includes(key)) return { kind: "invalid", why: `unknown field ${key}` };
  const max_rung = block["max_rung"] ?? 3;
  if (typeof max_rung !== "number" || !Number.isInteger(max_rung) || max_rung < 0 || max_rung > 6) return { kind: "invalid", why: "max_rung" };
  const pairs = block["may_target"] ?? [];
  if (!Array.isArray(pairs)) return { kind: "invalid", why: "may_target" };
  const may_target: Array<[string, string]> = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") return { kind: "invalid", why: "may_target pair" };
    if (pair[0] === "@human") return { kind: "invalid", why: "@human cannot be an aggressor" };
    may_target.push([pair[0], pair[1]]);
  }
  const dying = block["may_die"] ?? [];
  if (!Array.isArray(dying) || dying.some((d) => typeof d !== "string")) return { kind: "invalid", why: "may_die" };
  const permadeath = block["permadeath"] ?? false;
  if (typeof permadeath !== "boolean") return { kind: "invalid", why: "permadeath" };
  return { kind: "valid", max_rung, may_target, may_die: dying as string[], permadeath };
}
