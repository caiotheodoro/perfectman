import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadSimulationConfig } from "../simulation-config.js";
import { llm, persona, promptProfile } from "./fixtures.js";

async function loadWithSnapshotGateway(outputPath: string): Promise<{
  root: string;
  resolved: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "perfectman-ws-"));
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  const configDir = join(root, "config");
  await mkdir(configDir);
  const configPath = join(configDir, "index.json");
  await writeFile(
    configPath,
    JSON.stringify({
      simulation: {
        id: "snapshot_path_test",
        name: "Snapshot Path Test",
        seed: 42,
        settings: {
          omniscientSpectatorMode: false,
          allowPrivateChannels: true,
          maxPrivateChannelsPerAgent: 3,
          maxMessagesPerMinutePerAgent: 30,
          llmCallBudgetPerMinute: 100,
          pulseIntervalMs: 1000,
          tokenBudgetPerHour: 1_000_000,
        },
      },
      persistence: { type: "memory" },
      deliveryGateways: [{ id: "html", type: "html-snapshot", outputPath }],
      channels: [{
        id: "general",
        type: "public_channel",
        name: "general",
        default: true,
        memberAgentIds: ["ana"],
      }],
      agents: [{ id: "ana", persona, promptProfile, llm }],
    }, null, 2),
  );
  const config = await loadSimulationConfig(configPath);
  const gateway = config.deliveryGateways.find((g) => g.type === "html-snapshot");
  return {
    root,
    resolved: (gateway as { outputPath: string }).outputPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

describe("html-snapshot outputPath resolution", () => {
  it("anchors a relative outputPath to the workspace root, not the config dir or cwd", async () => {
    const { root, resolved, cleanup } = await loadWithSnapshotGateway("tmp/snapshot.html");
    try {
      expect(resolved).toBe(join(root, "tmp/snapshot.html"));
      expect(resolved).not.toContain(join("config", "tmp"));
    } finally {
      await cleanup();
    }
  });

  it("leaves an absolute outputPath untouched", async () => {
    const abs = join(tmpdir(), "perfectman-abs-snapshot.html");
    const { resolved, cleanup } = await loadWithSnapshotGateway(abs);
    try {
      expect(isAbsolute(resolved)).toBe(true);
      expect(resolved).toBe(abs);
    } finally {
      await cleanup();
    }
  });
});
