/**
 * One way to answer: an OpenAI-compatible endpoint with a key. The mock and
 * the local daemon were developer conveniences that put a "run" on screen
 * with nothing behind it.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROVIDER, ProviderForm } from "../ProviderForm.js";

describe("ProviderForm", () => {
  afterEach(cleanup);

  it("offers only an endpoint", () => {
    const { container, queryByText } = render(
      <ProviderForm value={DEFAULT_PROVIDER} onChange={vi.fn()} onRun={vi.fn()} ready />,
    );
    expect(queryByText("Mock")).toBeNull();
    expect(queryByText("Ollama")).toBeNull();
    expect(queryByText(/Ollama on this machine/)).toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(DEFAULT_PROVIDER.llm.providerType).toBe("openai-compatible");
  });

  it("needs a key before it will start", () => {
    const { getByText } = render(
      <ProviderForm value={{ ...DEFAULT_PROVIDER, llm: { ...DEFAULT_PROVIDER.llm, apiKey: "" } }} onChange={vi.fn()} onRun={vi.fn()} ready />,
    );
    expect((getByText("Start the run") as HTMLButtonElement).disabled).toBe(true);
  });
});
