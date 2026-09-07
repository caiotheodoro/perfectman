/**
 * The faces under the cards are the cast as it is now — edited, uploaded or
 * picked — not the preset that was clicked, and they stay up while the editor
 * is open. Add a file and a face appears; drop one and it goes.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickStep } from "../PickStep.js";

const persona = (id: string, name: string) => ({
  filename: `${id}.persona.md`,
  text: `---\npersonaId: ${id}\ndisplayName: ${name}\narchetype: x\n---\n`,
});

function step(files: ReturnType<typeof persona>[]) {
  return (
    <PickStep
      title="Who is in the room?"
      lede=""
      presets={[]}
      selection={{ presetId: null, files }}
      onSelect={() => undefined}
      accept=".md"
      emptyHint=""
    >
      <span />
    </PickStep>
  );
}

describe("PickStep", () => {
  afterEach(cleanup);

  it("shows a face for each character in the current files, and follows edits", () => {
    const { container, rerender } = render(step([persona("iris", "Íris"), persona("bruno", "Bruno")]));
    expect(container.querySelectorAll(".cast-row .figure")).toHaveLength(2);
    rerender(step([persona("iris", "Íris"), persona("bruno", "Bruno"), persona("marcela", "Marcela")]));
    expect(container.querySelectorAll(".cast-row .figure")).toHaveLength(3);
    rerender(step([persona("marcela", "Marcela")]));
    expect(container.querySelectorAll(".cast-row .figure")).toHaveLength(1);
    expect(container.querySelector(".cast-row")?.textContent).toContain("Marcela");
  });

  it("keeps the faces up while the editor is open", () => {
    const { container, getByText } = render(step([persona("iris", "Íris")]));
    fireEvent.click(getByText("Edit as markdown"));
    expect(container.querySelectorAll(".cast-row .figure")).toHaveLength(1);
    expect(container.querySelector(".editor")).not.toBeNull();
  });
});


it("shows the actual cast a scene requires before selecting it", () => {
  const cast = { id: "partners", title: "The partners", blurb: "", files: [persona("iris", "Iris"), persona("bruno", "Bruno")] };
  const scene = { id: "scene", title: "The disagreement", blurb: "They disagree.", cast: cast.id, files: [{ filename: "room.scenario.md", text: "" }] };
  const onSelect = vi.fn();
  const { getByRole, getByText } = render(
    <PickStep kind="scene" title="Choose a scene" lede="" presets={[scene]} casts={[cast]}
      activeCast={{ presetId: "another", files: [] }} selection={{ presetId: null, files: [] }}
      onSelect={onSelect} accept=".md" emptyHint=""><span /></PickStep>,
  );
  expect(getByText("Changes cast to The partners").textContent).toContain("Changes cast to The partners");
  expect(getByText("Iris · Bruno").textContent).toBe("Iris · Bruno");
  fireEvent.click(getByRole("button", { name: /The disagreement/ }));
  expect(onSelect).toHaveBeenCalledWith({ presetId: scene.id, files: scene.files });
  cleanup();
});

it("reports an unreadable upload without replacing the current files", async () => {
  const onSelect = vi.fn();
  const { container, getByRole } = render(
    <PickStep title="Cast" lede="" presets={[]} selection={{ presetId: null, files: [] }}
      onSelect={onSelect} accept=".md" emptyHint=""><span /></PickStep>,
  );
  const picker = container.querySelector('input[type="file"]');
  expect(picker).not.toBeNull();
  await act(async () => {
    fireEvent.change(picker!, {
      target: { files: [{ name: "persona.md", text: () => Promise.reject(new Error("unreadable")) }] },
    });
  });
  expect(getByRole("alert").textContent).toContain("Could not read those files");
  expect(onSelect).not.toHaveBeenCalled();
  cleanup();
});
