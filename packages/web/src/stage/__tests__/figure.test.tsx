import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FACE_POSES } from "@perfectman/shared";
import { Figure, agentColor } from "../Figure.js";

function draw(face: Parameters<typeof Figure>[0]["face"], speaking = false) {
  return render(<Figure index={0} name="íris" face={face} energy={0.5} speaking={speaking} attentive />);
}

describe("Figure", () => {
  it("gives six arbitrary agents distinct silhouettes and colors", () => {
    const { container } = render(<>{Array.from({ length: 6 }, (_, i) => <Figure key={i} index={i} name={`Agent ${i}`} face="neutral" energy={.3} speaking={false} attentive />)}</>);
    const shapes = [...container.querySelectorAll(".figure__silhouette > path:first-child")].map((p) => p.getAttribute("d"));
    expect(new Set(shapes).size).toBe(6);
    expect(new Set(Array.from({ length: 6 }, (_, i) => agentColor(i))).size).toBe(6);
    expect(container.querySelectorAll(".figure__name")).toHaveLength(6);
  });

  it("names the recorded expression so it can be styled", () => {
    const { container } = draw("worried");
    expect(container.querySelector(".figure")?.getAttribute("data-face")).toBe("worried");
    expect(container.querySelector(".figure__mouth")?.getAttribute("d")).toBe(FACE_POSES.worried.mouth);
  });

  it("preserves the angry mouth while speaking instead of turning it into a smile", () => {
    const { container } = draw("angry", true);
    expect(container.querySelector(".figure__mouth")?.getAttribute("d")).toBe(FACE_POSES.angry.mouth);
    expect(container.querySelector(".figure__mouth")?.getAttribute("opacity")).toBe("1");
    expect(container.querySelector(".figure__gasp")?.getAttribute("opacity")).toBe("0");
  });

  it("opens a neutral speaking mouth without changing the expression", () => {
    const { container } = draw("neutral", true);
    expect(container.querySelector(".figure")?.getAttribute("data-face")).toBe("neutral");
    expect(container.querySelector(".figure__gasp")?.getAttribute("opacity")).toBe("1");
  });
});
