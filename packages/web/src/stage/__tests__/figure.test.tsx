/**
 * A character is a face. The body never carried information — the face does
 * all of it — and at the sizes the stage and the cards draw, a body only made
 * the face smaller.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Figure } from "../Figure.js";

function draw(face: Parameters<typeof Figure>[0]["face"], speaking = false) {
  return render(<Figure index={0} name="íris" face={face} energy={0.5} speaking={speaking} attentive />);
}

describe("Figure", () => {
  it("draws a face and a name, and no body", () => {
    const { container } = draw("neutral");
    expect(container.querySelector(".figure__head")).not.toBeNull();
    expect(container.querySelector(".figure__torso")).toBeNull();
    expect(container.querySelector(".figure__arm")).toBeNull();
    expect(container.textContent).toBe("íris");
  });

  it("names the expression so the face can be styled by it", () => {
    const { container } = draw("worried");
    expect(container.querySelector(".figure--worried")).not.toBeNull();
    expect(container.querySelector(".figure")?.getAttribute("data-face")).toBe("worried");
  });

  it("opens the mouth while speaking", () => {
    const { container } = draw("neutral", true);
    expect(container.querySelector(".figure--speaking .figure__mouth")).not.toBeNull();
  });
});
