import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";

/**
 * The hotel's published Director schema (`packages/hotel/schema/director.schema.json`, vendored there) as a check a frame can fail: every object
 * that does not say otherwise rejects unknown keys, so a misspelt field in a frame a fake hotel writes is caught. `seq` (the connection's envelope,
 * which the schema leaves out) is stripped first. Test support only.
 */
const PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../hotel/schema/director.schema.json");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function strictify(node: Json): Json {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== "object") return node;
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === "properties" && v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictify(pv)])) : strictify(v);
  if (out["type"] === "object" && out["properties"] && out["additionalProperties"] === undefined) out["additionalProperties"] = false;
  return out;
}

function build() {
  const schema = strictify(JSON.parse(readFileSync(PATH, "utf8")) as Json) as { definitions: Record<string, Json> };
  const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
  ajv.addSchema({ $id: "director", definitions: schema.definitions });
  return { hotel: ajv.compile({ $ref: "director#/definitions/HotelMsg" }), sidecar: ajv.compile({ $ref: "director#/definitions/SidecarMsg" }) };
}

let compiled: ReturnType<typeof build> | undefined;

/** Why a frame is not one of the schema's, or an empty list when it is. */
export function frameErrors(direction: "hotel_to_sidecar" | "sidecar_to_hotel", frame: unknown): string[] {
  compiled ??= build();
  const validate = direction === "hotel_to_sidecar" ? compiled.hotel : compiled.sidecar;
  const body = frame && typeof frame === "object" ? Object.fromEntries(Object.entries(frame).filter(([k]) => k !== "seq")) : frame;
  const ok = validate(body) as boolean;
  return ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}
