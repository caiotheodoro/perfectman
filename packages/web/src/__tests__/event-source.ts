import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { LiveEvent } from "@perfectman/shared";

/** Delivery stays available after close so tests can exercise late events. */
export function stubEventSource() {
  const sources: EventTarget[] = [];
  vi.stubGlobal("EventSource", class extends EventTarget {
    static readonly CLOSED = 2;
    readyState = 0;
    constructor() { super(); sources.push(this); }
    close() { this.readyState = 2; }
  });
  return {
    sources,
    send(event: LiveEvent, at = 0) {
      const source = sources[at];
      if (!source) throw new Error(`EventSource ${at} has not connected`);
      act(() => {
        source.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }));
      });
    },
  };
}
