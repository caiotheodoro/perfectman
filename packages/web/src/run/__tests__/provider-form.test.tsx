/**
 * One way to answer: an OpenAI-compatible endpoint with a key. For a model we
 * know, the form is one pasted key.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROVIDER, isProviderReady, ProviderForm } from "../ProviderForm.js";

describe("ProviderForm", () => {
  afterEach(cleanup);

  it("offers only an endpoint", () => {
    const { container, queryByText } = render(<ProviderForm value={DEFAULT_PROVIDER} onChange={vi.fn()} />);
    expect(queryByText("Mock")).toBeNull();
    expect(queryByText("Ollama")).toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(DEFAULT_PROVIDER.llm.providerType).toBe("openai-compatible");
  });

  it("is ready only once a key is pasted", () => {
    expect(isProviderReady(DEFAULT_PROVIDER)).toBe(false);
    expect(isProviderReady({ ...DEFAULT_PROVIDER, llm: { ...DEFAULT_PROVIDER.llm, apiKey: "k" } })).toBe(true);
  });

  it("clears the endpoint for another model so it has to be typed", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<ProviderForm value={DEFAULT_PROVIDER} onChange={onChange} />);
    fireEvent.click(getByLabelText(/Another model/));
    expect(onChange.mock.calls[0]![0].llm).toMatchObject({ baseUrl: "", modelName: "" });
  });
});
