/**
 * Socket seam for the Director client. Node 22's global `WebSocket` (stable
 * since 22.4) takes a `headers` init option, which the Bearer upgrade needs,
 * answers the hotel's pings itself and has no ping control we need: reconnect
 * and liveness are the client's job. So no `ws` dependency in production; `ws`
 * is a dev dependency only (the fake Director server in tests).
 */
export type SocketHandlers = {
  open(): void;
  message(text: string): void;
  close(code: number): void;
  error(message: string): void;
};

export interface DirectorSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>, handlers: SocketHandlers) => DirectorSocket;

export const nodeSocketFactory: SocketFactory = (url, headers, handlers) => {
  const ws = new WebSocket(url, { headers });
  let opened = false;
  let closed = false;
  const closeOnce = (code: number): void => {
    if (closed) return;
    closed = true;
    handlers.close(code);
  };
  ws.addEventListener("open", () => {
    opened = true;
    handlers.open();
  });
  ws.addEventListener("message", (event) => {
    const data: unknown = event.data;
    // Binary frames are a protocol violation the hotel closes on; text only here.
    if (typeof data === "string") handlers.message(data);
  });
  ws.addEventListener("close", (event) => closeOnce(event.code));
  ws.addEventListener("error", () => {
    handlers.error("socket error");
    // Node 22's WebSocket fires only `error`, never `close`, when the upgrade is refused (a 401 on a wrong
    // secret, a dead host): the socket stays CONNECTING for good and the client would never retry. Node 24
    // fires both, so the close is reported once, whichever comes first.
    if (!opened) closeOnce(1006);
  });
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        // Already closing.
      }
    },
  };
};
