import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Intro } from "../../onboarding/Intro.js";

vi.mock("../../watch/FilmPlayer.js", () => ({ FilmPlayer: ({ title }: { title: string }) => <div data-testid="film">{title}</div> }));
afterEach(cleanup);

const starters = [{ id: "cat", title: "The cat on the roof" }, { id: "lift", title: "Elevator at midnight" }];

describe("the landing page", () => {
  it("plays the scripted film and leads with the idea", () => {
    render(<Intro starters={starters} onStart={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Nobody says everything." })).toBeTruthy();
    expect(screen.getByTestId("film").textContent).toBe("The party nobody mentioned");
  });

  it("starts a room from a sentence", () => {
    const onStart = vi.fn();
    render(<Intro starters={starters} onStart={onStart} />);
    fireEvent.change(screen.getByLabelText("What is going on in the room?"), { target: { value: " a leaked screenshot " } });
    fireEvent.click(screen.getByRole("button", { name: "Start a room" }));
    expect(onStart).toHaveBeenCalledWith({ story: "a leaked screenshot" });
  });

  it("starts empty with no sentence, and from a starter or a surprise", () => {
    const onStart = vi.fn();
    render(<Intro starters={starters} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a room" }));
    expect(onStart).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole("button", { name: "Elevator at midnight" }));
    expect(onStart).toHaveBeenLastCalledWith({ presetId: "lift" });
    fireEvent.click(screen.getByRole("button", { name: "Surprise me" }));
    expect(["cat", "lift"]).toContain(onStart.mock.lastCall![0].presetId);
  });
});
