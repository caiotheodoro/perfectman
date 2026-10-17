import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomFiles } from "../room-draft.js";
import { DEFAULT_PROVIDER, type ProviderValue } from "../../run/ProviderForm.js";
import { INITIAL_ROOM } from "../room-draft.js";
import { StoryWriter } from "../StoryWriter.js";

const keyed: ProviderValue = { ...DEFAULT_PROVIDER, llm: { ...DEFAULT_PROVIDER.llm, apiKey: "sk-test-key", baseUrl: "https://llm.test/v1", modelName: "m" } };
const DRAFT = {
  title: "Blood on the Snow", situation: "Snowed in with a body.", language: "en",
  people: [
    { name: "Mick", role: "performer", goal: "Pin it on Darla.", voice: "Loud and crude.", lines: ["Shut the fuck up."] },
    { name: "Darla", role: "skeptic", goal: "Find out who dug.", voice: "Flat.", lines: [] },
  ],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("drafting a story from an idea", () => {
  it("needs a key and an idea before it will ask the model", () => {
    render(<StoryWriter initial={INITIAL_ROOM} provider={DEFAULT_PROVIDER} onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "Draft it with my model" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Pick a model and paste its key below first/).textContent).toContain("that model writes the draft");
  });

  it("sends the idea with the pasted key, then fills the form and reports files for the new cast", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ draft: DRAFT }));
    vi.stubGlobal("fetch", fetcher);
    const onChange = vi.fn<(result: { files: RoomFiles } | { error: string }) => void>();
    render(<StoryWriter initial={INITIAL_ROOM} provider={keyed} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Describe your idea"), { target: { value: "a killing in a snowed-in cabin" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft it with my model" }));
    await waitFor(() => expect((screen.getByLabelText("Name the story") as HTMLInputElement).value).toBe("Blood on the Snow"));
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/draft");
    expect(JSON.parse(String(init?.body))).toMatchObject({ idea: "a killing in a snowed-in cabin", llm: { apiKey: "sk-test-key", maxOutputTokens: 2400 } });
    const last = onChange.mock.calls.at(-1)?.[0];
    const personas = last && "files" in last ? last.files.personas : [];
    expect(personas).toHaveLength(2);
    expect(personas[0]?.text).toContain("- Shut the fuck up.");
  });

  it("says what went wrong and keeps what was already there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "The model refused the key.", hint: "Check the key." } }, { status: 502 })));
    render(<StoryWriter initial={INITIAL_ROOM} provider={keyed} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Describe your idea"), { target: { value: "a killing in a snowed-in cabin" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft it with my model" }));
    expect((await screen.findByRole("alert")).textContent).toContain("refused the key");
    expect((screen.getByLabelText("Name the story") as HTMLInputElement).value).toBe(INITIAL_ROOM.title);
  });
});
