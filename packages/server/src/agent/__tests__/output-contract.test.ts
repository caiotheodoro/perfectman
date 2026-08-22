import { describe, it, expect } from "vitest";
import { renderIntentOutputContract } from "../output-contract.js";
import { ACTION_INTENT_JSON_SCHEMA } from "@perfectman/shared";

const properties = (ACTION_INTENT_JSON_SCHEMA.properties ?? {}) as Record<
  string,
  Record<string, unknown>
>;

describe("renderIntentOutputContract (#49 drift guard)", () => {
  const contract = renderIntentOutputContract("");

  it("renders every non-engine-stamped schema field exactly once", () => {
    for (const [name, prop] of Object.entries(properties)) {
      if (name === "id" || name === "actorId") continue;
      const needle = `"${name}":`;
      const count = contract.split(needle).length - 1;
      expect(count, `${needle} appears once`).toBeGreaterThanOrEqual(1);
      expect(prop).toBeDefined();
    }
  });

  it("never requests engine-stamped fields or hardcodes their values", () => {
    expect(contract).not.toContain('"id":');
    expect(contract).not.toContain('"actorId":');
    // The old hardcoded prose asked the model to invent ids and emit
    // 'preferredDelay: 0' — those literal delegations must stay gone.
    expect(contract).not.toContain('"preferredDelay": 0');
    expect(contract).not.toContain("copy from the inputs");
  });

  it("renders enum choices exhaustively", () => {
    const intentEnum = properties.intentType?.enum as string[];
    expect(intentEnum).toBeDefined();
    for (const value of intentEnum) {
      expect(contract, `enum value ${value}`).toContain(`"${value}"`);
    }
  });

  it("documents every field either via note or type placeholder", () => {
    // Every rendered line must correspond to a real schema property —
    // catches typos in curated notes drifting away from the schema.
    const rendered = [...contract.matchAll(/"([a-zA-Z]+)":/g)].map(m => m[1]!);
    for (const name of rendered) {
      expect(properties[name], `"${name}" is a schema property`).toBeDefined();
    }
  });
});
