/**
 * Write a story from nothing: a situation and a few people with something to hide.
 * The form writes ordinary markdown through `roomFiles`, so what it produces is
 * what the compiler already reads; there is no second format.
 */
import { useEffect, useRef, useState } from "react";
import { ROLES, roomFiles, type CharacterDraft, type RoomDraft, type RoomFiles } from "./room-draft.js";

export function StoryWriter({ initial, onChange }: {
  initial: RoomDraft;
  /** The files for the current draft, or the reason there are none yet. */
  onChange: (result: { files: RoomFiles } | { error: string }) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(initial);
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => {
    try { report.current({ files: roomFiles(draft) }); }
    catch (reason) { report.current({ error: reason instanceof Error ? reason.message : "Check the story and try again." }); }
  }, [draft]);
  const update = (index: number, values: Partial<CharacterDraft>): void => setDraft((current) => ({ ...current,
    people: current.people.map((person, at) => (at === index ? { ...person, ...values } : person)) }));

  return (
    <div className="writer">
      <label>
        <span>What is happening?</span>
        <textarea rows={3} maxLength={2000} value={draft.situation} onChange={(e) => setDraft({ ...draft, situation: e.target.value })} />
      </label>
      <label>
        <span>Name the story</span>
        <input maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </label>
      <div className="writer__people">
        {draft.people.map((person, index) => (
          <fieldset key={index}>
            <legend>Person {index + 1}</legend>
            <label><span>Name</span><input maxLength={48} value={person.name} onChange={(e) => update(index, { name: e.target.value })} /></label>
            <label>
              <span>Personality</span>
              <select value={person.role} onChange={(e) => { const role = e.target.value; if (role === "connector" || role === "skeptic" || role === "performer") update(index, { role }); }}>
                {Object.entries(ROLES).map(([value, role]) => <option key={value} value={value}>{role.label}</option>)}
              </select>
              <em>{ROLES[person.role].voice}</em>
            </label>
            <label><span>What do they secretly want?</span><textarea rows={3} maxLength={400} value={person.goal} onChange={(e) => update(index, { goal: e.target.value })} /></label>
            <button type="button" className="btn--bare" disabled={draft.people.length <= 2} aria-label={`Remove person ${index + 1}`}
              onClick={() => setDraft((current) => ({ ...current, people: current.people.filter((_, at) => at !== index) }))}>Remove</button>
          </fieldset>
        ))}
      </div>
      <button type="button" className="btn btn--quiet writer__add" disabled={draft.people.length >= 6}
        onClick={() => setDraft((current) => ({ ...current, people: [...current.people, { name: "", role: "connector", goal: "" }] }))}>Add a person</button>
    </div>
  );
}
