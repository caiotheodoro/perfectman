import { useMemo } from "react";
import { placeMarkup, chipIndexFor } from "@perfectman/shared";
import { Figure } from "../stage/Figure.js";
import type { Preset } from "../pick/usePresets.js";
import { charactersIn, sceneLookIn } from "../pick/preview.js";

/** A story, shown as the place it happens in, at the hour it happens, with the people in it. */
export function StoryCard({ preset, cast, chosen, onPick }: {
  preset: Preset;
  cast: Preset | undefined;
  chosen: boolean;
  onPick: () => void;
}): JSX.Element {
  const look = useMemo(() => sceneLookIn(preset.files), [preset.files]);
  const art = useMemo(() => placeMarkup(look.setting, look.minute, `card-${preset.id}`), [look, preset.id]);
  const people = useMemo(() => charactersIn(cast?.files ?? []), [cast]);
  const ids = people.map((p) => p.id);
  return (
    <button type="button" className={`story${chosen ? " story--on" : ""}`} aria-pressed={chosen} onClick={onPick}>
      <span className="story__stage" aria-hidden="true">
        <span className="story__art" dangerouslySetInnerHTML={{ __html: art }} />
        <span className="story__cast">
          {people.slice(0, 5).map((p) => (
            <Figure key={p.id} index={chipIndexFor(p.id, ids)} name={p.name} face="neutral" energy={0.3} speaking={false} attentive />
          ))}
        </span>
      </span>
      <span className="story__copy">
        <span className="story__title">{preset.title}</span>
        <span className="story__blurb">{preset.blurb}</span>
        <span className="story__who">{people.map((p) => p.name).join(", ")}</span>
      </span>
      {chosen ? <span className="story__tick" aria-hidden="true">✓</span> : null}
    </button>
  );
}
