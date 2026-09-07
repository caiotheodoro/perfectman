/**
 * A static host that has no run server behind it answers every path with its
 * own index page — status 200, body HTML. That must be an error with a hint,
 * not a null that crashes the first component to read it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, listPresets } from "../client.js";

function answer(body: string, type: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": type } });
}

describe("json requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an OK answer that is not JSON, and says what to check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("<!doctype html><html></html>", "text/html")));
    await expect(listPresets()).rejects.toMatchObject({
      name: "ApiRequestError",
      hint: expect.stringContaining("VITE_API_BASE"),
    });
  });

  it("passes a JSON answer through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer('{"casts":[],"scenes":[]}', "application/json")));
    await expect(listPresets()).resolves.toEqual({ casts: [], scenes: [] });
  });

  it("still reports a server error by status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer('{"error":{"message":"down"}}', "application/json", 503)));
    await expect(listPresets()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
