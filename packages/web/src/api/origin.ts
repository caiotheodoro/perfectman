/**
 * Where the run server is.
 *
 * Empty by default, which keeps every request relative: in dev Vite proxies
 * `/api` to the node process, and when that same process serves the built
 * bundle the two are the same origin. Neither case needs configuring.
 *
 * A split deployment does — the interface on a static host and the run server
 * somewhere that allows a process to stay alive for the length of a run. Then
 * `VITE_API_BASE` names that server, baked in at build time because a static
 * host has nothing to inject it at runtime.
 */
const RAW = import.meta.env["VITE_API_BASE"] ?? "";

/** No trailing slash, so callers can join with a leading-slash path. */
export const API_BASE = RAW.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** True when the interface is talking to a server on another origin. */
export const IS_SPLIT_DEPLOY = API_BASE !== "";
