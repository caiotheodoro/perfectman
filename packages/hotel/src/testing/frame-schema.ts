import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";

/**
 * Runtime validation of Director frames against the vendored `director.schema.json`, the very file `generated.ts`
 * is made from, so "this example parses with our types" is a check that can fail, not a cast. Test support only.
 *
 * Stricter than the hotel's own parser on purpose: every object schema that does not say otherwise rejects
 * unknown keys, so a misspelt field in a fixture or in a spec example is caught. `seq` (the connection's
 * envelope, which the schema leaves out) is stripped first.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const DIRECTOR_SCHEMA_PATH = join(HERE, "../../schema/director.schema.json");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function strictify(node: Json): Json {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== "object") return node;
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === "properties" && v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictify(pv)])) : strictify(v);
  if (out["type"] === "object" && out["properties"] && out["additionalProperties"] === undefined) out["additionalProperties"] = false;
  return out;
}

export type FrameDirection = "hotel_to_sidecar" | "sidecar_to_hotel";

export type FrameCheck = { ok: boolean; errors: string[] };

function build() {
  const schema = strictify(JSON.parse(readFileSync(DIRECTOR_SCHEMA_PATH, "utf8")) as Json) as { definitions: Record<string, Json> };
  const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
  ajv.addSchema({ $id: "director", definitions: schema.definitions });
  const compile = (name: string) => ajv.compile({ $ref: `director#/definitions/${name}` });
  return { hotel: compile("HotelMsg"), sidecar: compile("SidecarMsg") };
}

let compiled: ReturnType<typeof build> | undefined;
const schemas = () => (compiled ??= build());

/** Checks one frame of either direction; the envelope `seq` is ignored. */
export function checkFrame(direction: FrameDirection, frame: unknown): FrameCheck {
  const validate = direction === "hotel_to_sidecar" ? schemas().hotel : schemas().sidecar;
  const body = frame && typeof frame === "object" ? Object.fromEntries(Object.entries(frame).filter(([k]) => k !== "seq")) : frame;
  const ok = validate(body) as boolean;
  return { ok, errors: ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`) };
}

/** The members of a closed enum definition of the schema (`ActVerb`, `DramaBlockedReason`, `ActorErrorCode`, ...). */
export function schemaEnum(name: string): string[] {
  const raw = JSON.parse(readFileSync(DIRECTOR_SCHEMA_PATH, "utf8")) as { definitions: Record<string, { enum?: string[] }> };
  const members = raw.definitions[name]?.enum;
  if (!members) throw new Error(`no enum ${name} in director.schema.json`);
  return members;
}
