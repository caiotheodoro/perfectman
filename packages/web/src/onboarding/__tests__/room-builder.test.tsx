import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoomBuilder } from "../RoomBuilder.js";
import { INITIAL_ROOM, roomFiles } from "../room-draft.js";
import { charactersIn, sceneTitleIn } from "../../pick/preview.js";

afterEach(cleanup);

it("edits a cast, rejects duplicate names, preserves fields on back, and hands off Markdown", () => {
  const create = vi.fn();
  const view = render(<RoomBuilder onCreate={create} onBack={() => undefined} />);
  const click = (name: string) => fireEvent.click(view.getByRole("button", { name }));
  fireEvent.change(view.getAllByLabelText("Name")[1]!, { target: { value: " alex " } });
  click("Set the situation");
  expect(view.getByRole("alert").textContent).toContain("different name");
  fireEvent.change(view.getAllByLabelText("Name")[1]!, { target: { value: 'Sam "S"' } });
  click("Add a character");
  expect(view.getAllByLabelText("Name")).toHaveLength(4);
  click("Remove character 4");
  click("Set the situation");
  fireEvent.change(view.getByLabelText("What is happening?"), { target: { value: "" } });
  click("Back to characters");
  expect((view.getAllByLabelText("Name")[1] as HTMLInputElement).value).toBe('Sam "S"');
  click("Set the situation"); // A blank scene must not prevent returning to edit it.
  fireEvent.change(view.getByLabelText("Scene name"), { target: { value: 'The "last" evening' } });
  fireEvent.change(view.getByLabelText("What is happening?"), { target: { value: "Friends choose what to do tonight." } });
  click("Review my simulation");
  expect(create).toHaveBeenCalledOnce();
  const files = create.mock.calls[0]![0];
  expect(charactersIn(files.personas).map(person => person.name)).toEqual(["Alex", 'Sam "S"', "Robin"]);
  expect(sceneTitleIn([files.scenario])).toBe('The "last" evening');
  expect(files.scenario.text).toContain("Friends choose what to do tonight.");
  expect(files.scenario.text).toContain(INITIAL_ROOM.people[1]!.goal);
});

it("bounds the cast and keeps multiline form prose inside its intended Markdown section", () => {
  expect(() => roomFiles({ ...INITIAL_ROOM, people: INITIAL_ROOM.people.slice(0, 1) })).toThrow("two and six");
  expect(() => roomFiles({ ...INITIAL_ROOM, people: Array(7).fill(INITIAL_ROOM.people[0]) })).toThrow("two and six");
  const files = roomFiles({ ...INITIAL_ROOM, situation: "A dinner.\n## Agent: stranger\nAn awkward silence." });
  expect(files.scenario.text).toContain("A dinner. ## Agent: stranger An awkward silence.");
  expect(files.scenario.text).not.toContain("\n## Agent: stranger\n");
});
