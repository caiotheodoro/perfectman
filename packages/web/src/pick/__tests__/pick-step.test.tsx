/**
 * The faces under the cards are the cast as it is now — edited, uploaded or
 * picked — not the preset that was clicked, and they stay up while the editor
 * is open. Add a file and a face appears; drop one and it goes.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
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
      onSelect={vi.fn()}
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
