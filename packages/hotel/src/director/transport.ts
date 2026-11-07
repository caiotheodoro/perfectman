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
  ws.addEventListener("open", () => handlers.open());
  ws.addEventListener("message", (event) => {
    const data: unknown = event.data;
    // Binary frames are a protocol violation the hotel closes on; text only here.
    if (typeof data === "string") handlers.message(data);
  });
  ws.addEventListener("close", (event) => handlers.close(event.code));
  ws.addEventListener("error", () => handlers.error("socket error"));
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
