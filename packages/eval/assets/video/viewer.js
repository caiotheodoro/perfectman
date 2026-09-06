// This controller runs only in viewer.html; the render timeline stays deterministic.
(() => {
  const data = window.VIDEO, timeline = window.__timelines['run-video'];
  const get = id => document.getElementById(id);
  const seek = get('seek'), play = get('play'), follow = get('follow'), history = get('channel-history');
  let browsing = null, bookmark = null, lastBeat = -1, lastChannel = -1;
  const stamp = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const indexAt = time => {
    let lo = 0, hi = data.beats.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (data.beats[mid].start <= time) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    return found;
  };
  function fit() {
    const viewport = get('viewer-viewport');
    get('stage').style.setProperty('--viewer-scale', String(Math.min(viewport.clientWidth / 1920, viewport.clientHeight / 1080)));
  }
  function status() {
    play.textContent = timeline.paused() ? 'Play' : 'Pause';
    play.setAttribute('aria-label', browsing === null ? `${play.textContent} story` : 'Resume chronological story');
    follow.hidden = browsing === null;
    get('conversation-picker').value = browsing === null ? '' : String(browsing);
    get('playback-status').textContent = browsing === null
      ? (timeline.paused() ? 'Story paused. Choose Play to continue.' : 'Following the story. Choose a channel to browse.')
      : `Browsing ${data.channels[browsing].name}. Follow story returns to ${stamp(bookmark)}.`;
  }
  function update() {
    const time = timeline.time(), index = indexAt(time), beat = data.beats[index];
    seek.value = String(time); get('clock').textContent = `${stamp(time)} / ${stamp(data.duration)}`;
    window.storyAudio.sync(time, !timeline.paused());
    if (index === lastBeat) return;
    lastBeat = index;
    get('reading-pane').textContent = beat ? [data.agents[beat.actor]?.name, get(`card-${index}`)?.querySelector('.body')?.textContent].filter(Boolean).join('\n') : '';
    const channelIndex = beat?.channelIndex ?? -1;
    for (const button of document.querySelectorAll('button[data-channel-index]')) button.setAttribute('aria-current', Number(button.dataset.channelIndex) === channelIndex ? 'page' : 'false');
    if (channelIndex !== lastChannel && browsing === null) get(`channel-${channelIndex}`)?.scrollIntoView({ block: 'nearest' });
    lastChannel = channelIndex;
    for (const button of get('history-list').querySelectorAll('button')) button.setAttribute('aria-current', Number(button.dataset.beatIndex) === index ? 'true' : 'false');
  }
  function jump(index) {
    const beat = data.beats[index];
    if (!beat) return;
    timeline.pause(Math.min(beat.start + .7, beat.start + beat.duration / 2));
    window.storyAudio.pause(); update(); status();
  }
  function resume() {
    if (browsing !== null) {
      const restore = bookmark;
      browsing = null; bookmark = null; history.hidden = true; fit();
      timeline.seek(restore);
    }
    if (timeline.time() >= data.duration - .1) timeline.seek(0);
    timeline.play(); update(); status();
  }
  function selectChannel(index) {
    const channel = data.channels[index];
    if (!channel || !channel.beatIndexes.length) return;
    if (browsing === null) bookmark = timeline.time();
    browsing = index; timeline.pause(); window.storyAudio.pause(); history.hidden = false;
    get('history-title').textContent = channel.name;
    const list = get('history-list'); list.replaceChildren();
    for (const beatIndex of channel.beatIndexes) {
      const beat = data.beats[beatIndex], card = get(`card-${beatIndex}`);
      const button = document.createElement('button'), title = document.createElement('strong');
      button.type = 'button'; button.dataset.beatIndex = String(beatIndex);
      title.textContent = [stamp(beat.start), data.agents[beat.actor]?.name, `Step ${beat.stepIndex + 1}`, beat.pageCount > 1 ? `Part ${beat.page + 1}/${beat.pageCount}` : ''].filter(Boolean).join(' · ');
      button.append(title, document.createTextNode(card?.querySelector('.body')?.textContent || 'Recorded event'));
      button.addEventListener('click', () => jump(beatIndex)); list.append(button);
    }
    lastBeat = -1; fit();
    const previous = channel.beatIndexes.filter(i => data.beats[i].start <= bookmark);
    jump(previous.at(-1) ?? channel.beatIndexes[0]);
    get(`channel-${index}`)?.scrollIntoView({ block: 'nearest' });
  }
  get('stage').addEventListener('click', event => {
    const button = event.target.closest('button[data-channel-index]');
    if (button) selectChannel(Number(button.dataset.channelIndex));
  });
  data.channels.forEach((channel, index) => {
    const option = document.createElement('option');
    option.value = String(index); option.textContent = channel.name; option.disabled = !channel.beatIndexes.length;
    get('conversation-picker').append(option);
  });
  get('conversation-picker').addEventListener('change', event => {
    if (event.target.value !== '') selectChannel(Number(event.target.value));
  });
  play.addEventListener('click', () => {
    if (timeline.paused() || browsing !== null) resume();
    else { timeline.pause(); window.storyAudio.pause(); status(); }
  });
  follow.addEventListener('click', resume);
  function advance(delta) {
    const indexes = browsing === null ? data.beats.map((_, i) => i) : data.channels[browsing].beatIndexes;
    const current = indexAt(timeline.time()), position = indexes.indexOf(current);
    jump(indexes[Math.max(0, Math.min(indexes.length - 1, position + delta))]);
  }
  get('previous').addEventListener('click', () => advance(-1)); get('next').addEventListener('click', () => advance(1));
  seek.max = String(data.duration);
  seek.addEventListener('input', () => {
    browsing = null; bookmark = null; history.hidden = true; fit();
    timeline.pause(Number(seek.value)); window.storyAudio.pause(); update(); status();
  });
  get('sound').addEventListener('click', () => {
    const enabled = window.storyAudio.toggle();
    get('sound').textContent = enabled ? 'Mute' : 'Enable sound'; get('sound').setAttribute('aria-pressed', String(enabled));
    update();
  });
  get('volume').addEventListener('input', event => { window.storyAudio.volume(event.target.value); update(); });
  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); play.click(); }
  });
  timeline.eventCallback('onUpdate', update);
  timeline.eventCallback('onComplete', () => { timeline.pause(); window.storyAudio.pause(); status(); });
  new ResizeObserver(fit).observe(get('viewer-viewport'));
  window.addEventListener('pagehide', () => window.storyAudio.pause());
  fit();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { timeline.pause(data.first + .7); update(); status(); }
  else resume();
})();
