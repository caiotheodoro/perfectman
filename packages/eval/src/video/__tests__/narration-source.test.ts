import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { readVideoSource } from "../read-source.js";

const narration = { title: "The room changed", recap: "Ada asked. Nox left.", hiddenShift: "Ada wanted him to stay.", narrator: "llm" };
const evidence = {
  scenarioId: "room", name: "Raw room", transcript: [
    { pulse: 2, agent: "ada", type: "message_sent", content: "Anyone here?" },
    { pulse: 0, agent: "nox", type: "agent_left" },
  ],
};
const directories: string[] = [];
async function fixture(narrations: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "perfectman-narration-"));
  directories.push(directory);
  const input = join(directory, "narrations.json");
  await mkdir(join(directory, "scenarios"));
  await writeFile(input, JSON.stringify({ version: "narrations-v1", narrations }, null, 2));
  return { directory, input };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("saved narration companions", () => {
  it("chooses the sole ID, retains transcript order, and appends exact labelled summaries", async () => {
    const { directory, input } = await fixture({ room: narration });
    const companion = join(directory, "scenarios/room.json");
    await writeFile(companion, JSON.stringify(evidence));
    const { story, sourceSha256 } = await readVideoSource(input);
    expect(story.title).toBe(narration.title);
    expect(story.steps.map(step => step.text)).toEqual(["Anyone here?", "agent left", narration.recap, narration.hiddenShift]);
    expect(story.steps.slice(0, 2).map(step => step.pulse)).toEqual([2, 0]);
    expect(story.steps[0]?.sourceRefs).toEqual(["scenarios/room.json#/transcript/0"]);
    expect(story.steps[2]).toMatchObject({ phase: "Narrator summary", action: "narrator recap", visibility: "operator" });
    expect(story.steps[3]).toMatchObject({ phase: "Narrator summary", action: "narrator hidden shift", visibility: "private" });
    expect(story.steps[3]?.sourceRefs).toEqual(["narrations.json#/narrations/room/hiddenShift"]);
    expect(story.steps.every(step => !step.emotion)).toBe(true);
    expect(story.sources).toHaveLength(2);
    for (const source of story.sources ?? []) {
      expect(source.sha256).toBe(createHash("sha256").update(await readFile(source.file)).digest("hex"));
    }
    expect(story.sources?.[0]?.sha256).toBe(sourceSha256);
  });

  it("requires selection for multiple IDs and loads only the chosen companion", async () => {
    const { directory, input } = await fixture({ room: narration, elsewhere: { ...narration, title: "Elsewhere" } });
    await expect(readVideoSource(input)).rejects.toThrow("--scenario <id>. Available IDs: room, elsewhere");
    await writeFile(join(directory, "scenarios/room.json"), JSON.stringify(evidence));
    expect((await readVideoSource(input, "room")).story.title).toBe(narration.title);
    await expect(readVideoSource(input, "absent")).rejects.toThrow("No narration for absent");
  });

  it("loads a matching novela file and rejects missing or mismatched companions", async () => {
    const { directory, input } = await fixture({ room: narration });
    await expect(readVideoSource(input)).rejects.toThrow("Missing transcript for room");
    await writeFile(join(directory, "novela-run.json"), JSON.stringify({ ...evidence, scenarioId: "other" }));
    await expect(readVideoSource(input)).rejects.toThrow("mismatched scenarioId");
    await writeFile(join(directory, "novela-run.json"), JSON.stringify(evidence));
    expect((await readVideoSource(input)).story.steps[0]?.sourceRefs).toEqual(["novela-run.json#/transcript/0"]);
  });

  it("rejects unsafe IDs and companion symlinks outside the artifact directory", async () => {
    const unsafe = await fixture({ "../outside": narration });
    await expect(readVideoSource(unsafe.input)).rejects.toThrow("Unsafe narration scenario ID");
    const outside = await fixture({});
    await writeFile(join(outside.directory, "other.json"), JSON.stringify(evidence));
    const safe = await fixture({ room: narration });
    await symlink(join(outside.directory, "other.json"), join(safe.directory, "scenarios/room.json"));
    await expect(readVideoSource(safe.input)).rejects.toThrow("must stay inside its artifact directory");
  });
});
