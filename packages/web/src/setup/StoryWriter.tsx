/**
 * Write a story from nothing: a situation and a few people with something to hide.
 * The form writes ordinary markdown through `roomFiles`, so what it produces is
 * what the compiler already reads; there is no second format.
 */
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, draftStory } from "../api/client.js";
import { isProviderReady, parseExtraBody, type ProviderValue } from "../run/ProviderForm.js";
import { draftFromStory, ROLES, roomFiles, type CharacterDraft, type RoomDraft, type RoomFiles } from "./room-draft.js";

/** Room for a whole cast to be written out; the run's own limit is much smaller. */
const DRAFT_OUTPUT_TOKENS = 2400;
const MIN_IDEA = 8;

export function StoryWriter({ initial, provider, onChange }: {
  initial: RoomDraft;
  /** The model and key the person has set up; the draft is written by this one. */
  provider: ProviderValue;
  /** The files for the current draft, or the reason there are none yet. */
  onChange: (result: { files: RoomFiles } | { error: string }) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(initial);
  const [idea, setIdea] = useState(initial.idea ?? "");
  const [drafting, setDrafting] = useState(false);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);
  const latest = useRef(0);
  useEffect(() => () => { latest.current = -1; }, []);
  const canDraft = isProviderReady(provider) && idea.trim().length >= MIN_IDEA && !drafting;

  async function writeDraft(): Promise<void> {
    const ticket = ++latest.current;
    setDrafting(true);
    setProblem(null);
    try {
      const extra = parseExtraBody(provider.extraBodyText).value;
      const { draft: written } = await draftStory({ idea: idea.trim(), llm: { ...provider.llm, maxOutputTokens: DRAFT_OUTPUT_TOKENS, ...(extra ? { extraBody: extra } : {}) } });
      if (ticket === latest.current) setDraft(draftFromStory(written, idea.trim()));
    } catch (reason) {
      if (ticket !== latest.current) return;
      setProblem(reason instanceof ApiRequestError ? { message: reason.message, hint: reason.hint } : { message: "Could not reach the server.", hint: "Try again in a moment." });
    } finally {
      if (ticket === latest.current) setDrafting(false);
    }
  }
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
      <div className="writer__idea">
        <label>
          <span>Describe your idea</span>
          <textarea rows={3} maxLength={2000} value={idea} placeholder="Four friends in a cabin, one of them just killed a man, everybody is drunk…" onChange={(e) => setIdea(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={!canDraft} onClick={() => void writeDraft()}>{drafting ? "Drafting…" : "Draft it with my model"}</button>
        <em>{isProviderReady(provider)
          ? "Your model writes the title, the situation and the people, each with a secret. Everything stays editable."
          : "Pick a model and paste its key below first: that model writes the draft."} Crime, violence and strong language are fine; a permissive model handles the roughest stories best.</em>
        {problem ? <p className="alert-inline" role="alert">{problem.message}{problem.hint ? ` ${problem.hint}` : ""}</p> : null}
      </div>
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
              <em>{person.voice || ROLES[person.role].voice}</em>
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
