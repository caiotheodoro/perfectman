/** Attribution stays with the words. A free-standing balloon has no misleading tail. */
export function Bubble({ name, said, thought, visibility }: {
  name: string;
  said: string;
  thought?: string | undefined;
  visibility: string;
}): JSX.Element {
  const unspoken = thought !== undefined;
  return <div className="bubbles">
    <div className={`bubble bubble--${unspoken ? "thought" : "speech"}`}>
      <p className="bubble__speaker"><strong>{name}</strong><span> · {unspoken ? "Thought · viewer only" : visibility}</span></p>
      <p className={unspoken ? "bubble__thought u-hand" : "bubble__said u-serif"}>{unspoken ? thought : said}</p>
    </div>
  </div>;
}
