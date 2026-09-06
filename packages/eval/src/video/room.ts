/** An illustrated set, independent of recorded membership and dialogue. */
export const roomMarkup = `<div id="room-camera" data-layout-allow-overflow>
  <svg id="room-set" viewBox="0 0 1920 1080" aria-hidden="true">
    <g id="public-set"><path d="M330 590L470 460H830L990 590V870H330Z" fill="#f0efed"/>
      <path d="M330 590H990M470 460V590M830 460V590" fill="none" stroke="#deddda" stroke-width="2"/>
      <path d="M371 568V337H471V568" fill="#e8e7e4" stroke="#c5c4c0" stroke-width="3"/>
      <path id="door-leaf" d="M377 343H465V568H377Z" fill="#fcfcfb" stroke="#cecdc8" stroke-width="2"/>
      <circle cx="450" cy="460" r="4" fill="#8c8b89"/>
      <path d="M346 870H976" stroke="#cccbc7" stroke-width="3"/>
    </g>
    <g id="private-set"><path d="M365 835V376Q365 291 445 291H872Q952 291 952 376V835" fill="#f1eef9" stroke="#d8d0ed" stroke-width="3"/>
      <path d="M387 817H929" stroke="#c5bbda" stroke-width="3"/><path d="M408 309V788M909 309V788" stroke="#e5deef" stroke-width="8"/>
    </g>
    <g id="thought-set"><ellipse cx="652" cy="820" rx="274" ry="70" fill="#f1eefb"/>
      <circle cx="828" cy="332" r="50" fill="#eee8ff"/><circle cx="781" cy="390" r="21" fill="#eee8ff"/><circle cx="747" cy="425" r="11" fill="#eee8ff"/>
    </g>
    <g id="operator-set"><path d="M375 815H947M410 827H912" stroke="#dad9d5" stroke-width="3"/>
      <path d="M480 329H842M510 351H812M541 373H781" stroke="#e1e0dd" stroke-width="3"/>
    </g>
  </svg>
  <div id="cast"></div>
  <svg id="table" viewBox="0 0 400 180" aria-hidden="true"><path d="M85 62L64 161M316 63L337 161" stroke="#c8c4bd" stroke-width="14" stroke-linecap="round"/>
    <ellipse cx="200" cy="60" rx="183" ry="54" fill="#e4e0d9" stroke="#cdc8c0" stroke-width="3"/><path d="M102 59H155M246 62H292" stroke="#faf8f4" stroke-width="6" stroke-linecap="round"/>
  </svg>
</div>`;
