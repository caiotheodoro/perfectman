import { describe, it, expect } from "vitest";
import { buildJoinIntent, buildLeaveIntent, makeCommandResult } from "../command-handlers.js";

describe("command-handlers", () => {
  it("buildJoinIntent creates an invite_agent intent", () => {
    const intent = buildJoinIntent("agent_1", "ch_1");
    expect(intent.intentType).toBe("invite_agent");
    expect(intent.actorId).toBe("agent_1");
    expect(intent.channelTarget).toBe("ch_1");
    expect(intent.personTargets).toContain("agent_1");
  });

  it("buildLeaveIntent creates a leave_channel intent", () => {
    const intent = buildLeaveIntent("agent_1", "ch_1");
    expect(intent.intentType).toBe("leave_channel");
    expect(intent.actorId).toBe("agent_1");
    expect(intent.channelTarget).toBe("ch_1");
  });

  it("makeCommandResult ok=true has no reason", () => {
    const result = makeCommandResult(true);
    expect(result.ok).toBe(true);
    expect(result.commandId).toBeTruthy();
  });

  it("makeCommandResult ok=false has a reason", () => {
    const result = makeCommandResult(false, "not found");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not found");
    }
  });
});
