/**
 * The raw stream, newest first.
 *
 * This is the milestone-5 viewer: before the transcript exists, being able to
 * see that frames arrive — in order, with the right shape — is what proves the
 * whole path works. It stays afterwards as the debugging view.
 */
import { useState } from "react";
import type { LiveEvent } from "@perfectman/shared";

export function FrameLog({ raw }: { raw: Array<{ seq: number; event: LiveEvent }> }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);

  if (raw.length === 0) {
    return <section className="panel panel--muted">No frames yet.</section>;
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Stream</h2>
        <span className="dim">{raw.length} frames</span>
      </header>
      <ol className="frames">
        {[...raw].reverse().map(({ seq, event }) => (
          <li key={seq}>
            <button type="button" className="frame" onClick={() => setOpen(open === seq ? null : seq)}>
              <span className={`pill pill--${event.type}`}>{event.type}</span>
              <span className="dim">{summarize(event)}</span>
            </button>
            {open === seq ? <pre className="code">{JSON.stringify(event, null, 2)}</pre> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function summarize(event: LiveEvent): string {
  switch (event.type) {
    case "hello":
      return `${event.agents.length} agents · ${event.channels.length} channels · ${event.priorEvents.length} prior events`;
    case "status":
      return `${event.status.state} · ${event.status.pulsesRun} pulses`;
    case "pulse":
      return `pulse ${event.frame.pulseIndex} · ${event.frame.messages.length} messages · ${event.frame.agentsCalled} agents called`;
    case "channel":
      return `${event.channel.name} · ${event.channel.memberAgentIds.length} members`;
    case "notice":
      return `${event.notice.type}${event.notice.agentId ? ` · ${event.notice.agentId}` : ""}`;
    case "stopped":
      return event.stopReason ?? "finished";
    case "error":
      return event.message;
    default:
      return "";
  }
}
