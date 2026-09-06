/**
 * Everything the old shell showed at once.
 *
 * None of it was wrong — the compiled config, the diagnostics and the raw frame
 * stream are exactly what you want when something looks off. They just are not
 * what you want while a scene is playing, so they wait behind a summary.
 */
import type { CompileResponse } from "@perfectman/shared";
import type { RunStream } from "../api/useRunStream.js";
import { CompiledConfigPanel } from "../components/CompiledConfigPanel.js";
import { DiagnosticList } from "../components/DiagnosticList.js";
import { FrameLog } from "../components/FrameLog.js";

export function DetailsDrawer({
  compiled,
  stream,
  runId,
}: {
  compiled: CompileResponse | null;
  stream: RunStream;
  runId: string | null;
}): JSX.Element {
  const notices = stream.notices;

  return (
    <details className="drawer">
      <summary>
        Details
        <span className="u-dim">
          {stream.raw.length} frame{stream.raw.length === 1 ? "" : "s"}
          {notices.length > 0 ? ` · ${notices.length} notice${notices.length === 1 ? "" : "s"}` : ""}
        </span>
      </summary>

      <div className="drawer__body">
        {runId ? (
          <p className="u-dim">
            Saved to <code>out/runs/{runId}/</code> — the uploaded markdown, the
            compiled config with secrets removed, and the full replay.
          </p>
        ) : null}

        {notices.length > 0 ? (
          <DiagnosticList
            diagnostics={notices.map((n) => ({
              level: "warning" as const,
              file: n.agentId ?? "run",
              message: `${n.type}: ${n.detail}`,
            }))}
          />
        ) : null}

        <FrameLog raw={stream.raw} />
        <CompiledConfigPanel result={compiled} pending={false} />
      </div>
    </details>
  );
}
