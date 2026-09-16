import { useEffect, useRef, useState } from "react";
import { INITIAL_ROOM, ROLES, roomFiles, type CharacterDraft, type RoomFiles } from "./room-draft.js";

export function RoomBuilder({ onCreate, onBack }: { onCreate: (files: RoomFiles) => void; onBack: () => void }): JSX.Element {
  const [draft, setDraft] = useState(INITIAL_ROOM);
  const [step, setStep] = useState<"people" | "scene">("people");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const update = (index: number, values: Partial<CharacterDraft>) => setDraft(current => ({ ...current,
    people: current.people.map((person, at) => at === index ? { ...person, ...values } : person) }));
  return <main className="room-builder">
    <button className="btn--bare" type="button" onClick={onBack}>← Back to the demo</button>
    <p className="u-dim">{step === "people" ? "1 of 2 · Your characters" : "2 of 2 · Your situation"}</p>
    <h1 ref={heading} tabIndex={-1}>{step === "people" ? "Who is in your story?" : "What brings them together?"}</h1>
    <p>{step === "people" ? "Start with these three, or change them. A private goal gives each person something they may not say out loud."
      : "Give them a situation to respond to. You set the starting point; the model decides what happens next."}</p>
    <form onSubmit={event => {
      event.preventDefault(); setError("");
      try {
        const files = roomFiles(step === "people" ? { ...draft, title: INITIAL_ROOM.title, situation: INITIAL_ROOM.situation } : draft);
        if (step === "people") setStep("scene"); else onCreate(files);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your scene and try again."); }
    }}>
      {step === "people" ? <>
        <div className="room-builder__people">{draft.people.map((person, index) => <fieldset key={index}>
          <legend>Character {index + 1}</legend>
          <label>Name<input required maxLength={48} value={person.name} onChange={event => update(index, { name: event.target.value })} /></label>
          <label>Personality<select value={person.role} onChange={event => {
            const role = event.target.value;
            if (role === "connector" || role === "skeptic" || role === "performer") update(index, { role });
          }}>{Object.entries(ROLES).map(([value, role]) => <option key={value} value={value}>{role.label}</option>)}</select></label>
          <p className="u-dim">{ROLES[person.role].voice}</p>
          <label>What do they secretly want?<textarea required maxLength={400} rows={3} value={person.goal} onChange={event => update(index, { goal: event.target.value })} /></label>
          <button type="button" className="btn--bare" disabled={draft.people.length <= 2} aria-label={`Remove character ${index + 1}`}
            onClick={() => setDraft(current => ({ ...current, people: current.people.filter((_, at) => at !== index) }))}>Remove</button>
        </fieldset>)}</div>
        <button type="button" className="btn btn--quiet" disabled={draft.people.length >= 6} onClick={() => setDraft(current => ({ ...current,
          people: [...current.people, { name: "", role: "connector", goal: "" }] }))}>Add a character</button>
      </> : <div className="room-builder__scene">
        <label>Scene name<input required maxLength={100} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>What is happening?<textarea required maxLength={2000} rows={5} value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value })} /></label>
        <p><strong>Your cast:</strong> {draft.people.map(person => person.name).join(", ")}. They start in one shared room and can choose to speak, stay quiet, or start private conversations.</p>
        <p className="u-dim">Next: review your scene, then connect your model with an API key. Nothing runs or makes a model request yet.</p>
      </div>}
      {error ? <p role="alert" className="alert-inline">{error}</p> : null}
      <footer className="step__foot">
        {step === "scene" ? <button type="button" className="btn btn--quiet" onClick={() => setStep("people")}>Back to characters</button> : null}
        <button className="btn" type="submit">{step === "people" ? "Set the situation" : "Review my simulation"}</button>
      </footer>
    </form>
  </main>;
}
