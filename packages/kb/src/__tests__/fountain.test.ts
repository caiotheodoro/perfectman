import { describe, expect, it } from "vitest";
import { parseFountain } from "../ingest/fountain.js";

const SCRIPT = `Title: Test
Author: Nobody

INT. KITCHEN - NIGHT

MARA stands at the sink. /* cut this */ She does not turn.

MARA
(without turning)
You are late.

@Tom
I know.

[[note: stress the pause]]

JOE ^
Wait!

MARA ^
No!

CUT TO:

.THE ROOF

TOM kisses her.

TOM (V.O.)
Forgive me.
`;

describe("parseFountain", () => {
  const scenes = parseFountain(SCRIPT, "f");
  it("splits on scene headings, forced headings included, and skips the title page", () => {
    expect(scenes.map((s) => s.heading)).toEqual(["INT. KITCHEN - NIGHT", "THE ROOF"]);
  });
  it("reads cues, forced cues, parentheticals as directions, and strips extensions and ^", () => {
    const items = scenes[0]!.items;
    expect(items).toContainEqual({ kind: "speech", speaker: "MARA", text: "You are late." });
    expect(items).toContainEqual({ kind: "direction", text: "without turning" });
    expect(items).toContainEqual({ kind: "speech", speaker: "Tom", text: "I know." });
    expect(items.filter((i) => i.kind === "speech" && i.speaker === "JOE")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "speech" && i.speaker === "MARA")).toHaveLength(2);
  });
  it("keeps action as directions, drops boneyard, notes and transitions", () => {
    const all = JSON.stringify(scenes);
    expect(all).not.toContain("cut this");
    expect(all).not.toContain("stress the pause");
    expect(all).not.toContain("CUT TO");
    expect(scenes[1]!.items[0]).toEqual({ kind: "direction", text: "TOM kisses her." });
    expect(scenes[1]!.items[1]).toEqual({ kind: "speech", speaker: "TOM", text: "Forgive me." });
  });
});
