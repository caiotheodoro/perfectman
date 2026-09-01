/**
 * snapshot-html-generator — self-contained single-file HTML replay viewer.
 *
 * Layout: story-first vertical feed (story-col ~70%) + compact agent panel (~30%)
 * Each pulse section shows messages → inline thinking → dreaming asides for silent agents.
 * No external dependencies — system fonts only.
 */
import type { SimulationReplay } from "./replay-types.js";

export function generateHtml(replay: SimulationReplay): string {
  const dataJson = JSON.stringify(replay, null, 0);

  const goals = replay.goals;
  const hasGoals = !!goals && goals.length > 0;
  const endLine = replay.endReason
    ? `  <div class="goal-panel-ended">Fim: ${escapeHtml(replay.endReason)}${replay.endingOffer?.epilogue ? ` — ${escapeHtml(replay.endingOffer.epilogue)}` : ""}</div>\n`
    : "";
  // Static shell + appended CSS/JS only when the run had goals: a no-goal
  // run's artifact stays byte-identical.
  const goalPanelMarkup = hasGoals
    ? `\n<section class="goal-panel" id="goal-panel">\n  <div class="goal-panel-head">🎯 camada de objetivos</div>\n${endLine}</section>\n`
    : "";

  const agentOptions = replay.agentIds
    .map(id => `<option value="${escapeHtml(id)}">${escapeHtml(replay.agentNames[id] ?? id)}</option>`)
    .join("\n        ");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(replay.simulationName)} — Replay da Simulação</title>
<style>
${CSS}${hasGoals ? GOAL_CSS : ""}
</style>
</head>
<body>

<header class="top-bar">
  <div class="top-bar-row1">
    <div class="sim-title">[REPLAY] ${escapeHtml(replay.simulationName)}</div>
    <button class="nav-btn" onclick="prevPulse()">◀</button>
    <div class="scrubber" id="scrubber"></div>
    <button class="nav-btn" onclick="nextPulse()">▶</button>
  </div>
  <div class="top-bar-row2">
    <div class="ch-tabs" id="ch-tabs"></div>
    <div class="perspective-wrap">
      <span>POV</span>
      <select id="perspective-select" onchange="setPerspective(this.value)">
        <option value="omniscient">⊕ onisciente</option>
        ${agentOptions}
      </select>
    </div>
  </div>
</header>

<div class="main-layout">
  <div class="story-col" id="story-col"></div>
  <div class="agent-panel" id="agent-panel"></div>
</div>
${goalPanelMarkup}
<script id="REPLAY_DATA" type="application/json">
${dataJson}
</script>
<script>
${JS}${hasGoals ? GOAL_JS : ""}
</script>
</body>
</html>`;
}

// ── HTML escape ───────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #06060f;
  --surface:  #0d0d1c;
  --surface2: #12122a;
  --border:   #1e1e3c;
  --text:     #d0d0f0;
  --text2:    #7070a8;
  --text3:    #3a3a78;
  --accent:   #5050c8;
  --ana:      #4da8ff;
  --bruno:    #4ddb88;
  --carla:    #ff5540;
  --diego:    #ffaa30;
  --font-mono: 'Courier New', 'Consolas', 'Lucida Console', monospace;
  --font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

html, body {
  height: 100%; width: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  overflow: hidden;
}

body { display: flex; flex-direction: column; }

/* ── TOP BAR ── */
.top-bar {
  display: flex; flex-direction: column;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.top-bar-row1 {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; height: 44px;
}
.top-bar-row2 {
  display: flex; align-items: center; gap: 0;
  padding: 0 14px 6px;
}

.sim-title {
  font-family: var(--font-mono);
  font-weight: 700; font-size: 11px;
  color: var(--accent);
  letter-spacing: 0.1em; text-transform: uppercase;
  white-space: nowrap;
}

/* Scrubber / heatmap */
.scrubber {
  display: flex; gap: 2px; flex: 1; align-items: center;
}
.scrubber-tick {
  flex: 1; height: 20px; border-radius: 2px;
  cursor: pointer; border: 1px solid transparent;
  transition: border-color 0.1s; position: relative;
  min-width: 14px;
}
.scrubber-tick:hover { border-color: var(--text2); }
.scrubber-tick.active { border-color: var(--text) !important; }
.scrubber-tick-label {
  position: absolute; bottom: 1px; left: 50%;
  transform: translateX(-50%);
  font-size: 8px; color: rgba(255,255,255,0.45);
  font-family: var(--font-mono); pointer-events: none;
}

.nav-btn {
  background: var(--surface2); border: 1px solid var(--border);
  color: var(--text2); border-radius: 3px;
  padding: 3px 9px; cursor: pointer;
  font-family: var(--font-mono); font-size: 11px;
  flex-shrink: 0;
}
.nav-btn:hover { color: var(--text); border-color: var(--accent); }

/* Channel tabs */
.ch-tabs { display: flex; gap: 1px; }
.ch-tab {
  padding: 4px 12px;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text3); background: transparent;
  border: 1px solid transparent;
  border-bottom: 2px solid transparent;
  cursor: pointer; letter-spacing: 0.03em;
}
.ch-tab:hover { color: var(--text2); }
.ch-tab.active { color: var(--text); border-bottom-color: var(--accent); }

/* Perspective dropdown */
.perspective-wrap {
  margin-left: auto;
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; color: var(--text3);
}
.perspective-wrap select {
  background: var(--surface2); border: 1px solid var(--border);
  color: var(--text); border-radius: 3px;
  padding: 2px 6px;
  font-family: var(--font-mono); font-size: 10px;
}

/* ── MAIN LAYOUT ── */
.main-layout {
  display: flex; flex: 1; min-height: 0; overflow: hidden;
}

/* ── STORY COLUMN ── */
.story-col {
  flex: 7; overflow-y: auto;
  border-right: 1px solid var(--border);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.story-col::-webkit-scrollbar { width: 5px; }
.story-col::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Pulse section */
.pulse-section { border-bottom: 1px solid var(--border); }
.pulse-section.focused { background: rgba(80,80,200,0.025); }

.pulse-divider {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px 5px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 10;
}
.pulse-divider-label {
  font-family: var(--font-mono); font-size: 10px;
  color: var(--accent); letter-spacing: 0.12em;
  white-space: nowrap;
}
.pulse-divider-line { flex: 1; height: 1px; background: var(--border); }
.pulse-event-count {
  font-family: var(--font-mono); font-size: 9px;
  color: var(--text3); white-space: nowrap;
}

.pulse-body { padding: 4px 0 8px; }

/* Message row */
.msg-row { padding: 5px 14px 1px; }
.msg-row.hidden-by-channel,
.msg-row.hidden-by-perspective { display: none; }

.msg-line {
  display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap;
}
.msg-sigil { font-size: 11px; flex-shrink: 0; width: 14px; text-align: center; }
.msg-sender {
  font-family: var(--font-mono); font-weight: 700; font-size: 11px;
  flex-shrink: 0;
}
.msg-sender.ana   { color: var(--ana); }
.msg-sender.bruno { color: var(--bruno); }
.msg-sender.carla { color: var(--carla); }
.msg-sender.diego { color: var(--diego); }

.msg-channel-tag {
  font-size: 9px; color: var(--text3);
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 2px; padding: 0 4px; flex-shrink: 0;
}
.msg-content {
  font-family: var(--font-sans); font-size: 12px;
  color: var(--text); line-height: 1.5; word-break: break-word;
}
.msg-type-tag { font-size: 9px; color: var(--text3); font-style: italic; flex-shrink: 0; }

/* Inline thought bubble */
.thought-line {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 2px 14px 5px 35px;
}
.thought-line.hidden-by-channel,
.thought-line.hidden-by-perspective { display: none; }
.thought-sigil { font-size: 10px; flex-shrink: 0; color: var(--text3); margin-top: 1px; }
.thought-body { flex: 1; }
.thought-text {
  font-family: var(--font-sans); font-size: 11px;
  color: var(--text2); font-style: italic; line-height: 1.4;
}
.thought-drivers { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 3px; }
.driver-tag {
  font-size: 9px; padding: 0 4px; border-radius: 2px;
  font-family: var(--font-mono); font-style: normal;
}
.driver-tag.emo { border: 1px solid #818cf8; color: #818cf8; }
.driver-tag.mot { border: 1px solid #4ade80; color: #4ade80; }

/* Dreaming aside (silent agents) */
.dream-aside { padding: 3px 14px 3px 35px; }
.dream-aside.hidden-by-perspective { display: none; }
.dream-line { display: flex; align-items: baseline; gap: 6px; }
.dream-sigil { font-size: 10px; color: var(--text3); flex-shrink: 0; }
.dream-agent-name {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.dream-agent-name.ana   { color: #2a6499; }
.dream-agent-name.bruno { color: #2a7050; }
.dream-agent-name.carla { color: #7a2e26; }
.dream-agent-name.diego { color: #7a5820; }
.dream-text-content {
  font-family: var(--font-sans); font-size: 11px;
  color: var(--text3); font-style: italic;
}

.pulse-empty {
  padding: 8px 14px;
  font-size: 11px; color: var(--text3); font-style: italic;
}

/* ── AGENT PANEL ── */
.agent-panel {
  flex: 3; display: flex; flex-direction: column;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  min-width: 200px; max-width: 340px;
}
.agent-panel::-webkit-scrollbar { width: 4px; }
.agent-panel::-webkit-scrollbar-thumb { background: var(--border); }

.agent-mini-card { border-bottom: 1px solid var(--border); padding: 8px 10px; }

.agent-mini-header {
  display: flex; align-items: center; gap: 5px; margin-bottom: 6px;
}
.agent-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.agent-dot.ana   { background: var(--ana); }
.agent-dot.bruno { background: var(--bruno); }
.agent-dot.carla { background: var(--carla); }
.agent-dot.diego { background: var(--diego); }
.agent-mini-name {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
}
.agent-mini-name.ana   { color: var(--ana); }
.agent-mini-name.bruno { color: var(--bruno); }
.agent-mini-name.carla { color: var(--carla); }
.agent-mini-name.diego { color: var(--diego); }
.agent-mini-arch { font-size: 9px; color: var(--text3); }
.agent-mini-action {
  margin-left: auto; font-size: 9px; color: var(--text2);
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 2px; padding: 1px 4px;
}

.agent-mini-body { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 5px; }

/* Mini circumplex */
.mini-emo-bars { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.mini-emo-row { display: flex; align-items: center; gap: 4px; }
.mini-emo-name {
  width: 68px; font-size: 9px; color: var(--text3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-align: right;
}
.mini-emo-track {
  flex: 1; height: 4px; background: var(--surface2);
  border-radius: 2px; overflow: hidden;
}
.mini-emo-fill { height: 100%; border-radius: 2px; }
.mini-emo-fill.positive { background: #4ade80; }
.mini-emo-fill.negative { background: #f87171; }
.mini-emo-fill.neutral  { background: #818cf8; }

/* Mini thinking */
.agent-mini-thinking {
  padding: 4px 6px;
  background: var(--surface2);
  border-left: 2px solid var(--accent);
  border-radius: 0 3px 3px 0;
  font-family: var(--font-sans);
  font-size: 10px; color: var(--text2);
  font-style: italic; line-height: 1.4;
  min-height: 20px;
}
`;

// ── Goal panel ────────────────────────────────────────────────────────────────

const GOAL_CSS = `
/* ── GOAL PANEL ── */
.goal-panel {
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 10px 14px;
}
.goal-panel-head {
  font-size: 10px; color: var(--accent);
  letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 8px;
}
.goal-panel-ended {
  font-size: 10px; color: var(--ana);
  margin-bottom: 8px;
}
.goal-card {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 4px; padding: 8px 10px; margin-bottom: 8px;
}
.goal-card-head {
  display: flex; align-items: baseline; gap: 8px;
  flex-wrap: wrap; margin-bottom: 4px;
}
.goal-card-title {
  font-family: var(--font-sans); font-size: 12px;
  font-weight: 700; color: var(--text);
}
.goal-card-status {
  font-size: 9px; padding: 0 5px; border-radius: 2px;
  border: 1px solid var(--accent); color: var(--accent);
}
.goal-card-status.ended { border-color: #4ade80; color: #4ade80; }
.goal-card-status.declined { border-color: #f87171; color: #f87171; }
.goal-card-meta { font-size: 9px; color: var(--text3); margin-bottom: 5px; }
.goal-card-framing {
  font-family: var(--font-sans); font-size: 11px;
  color: var(--text2); font-style: italic; margin-bottom: 6px;
}
.goal-card-label {
  font-size: 8px; color: var(--text3);
  text-transform: uppercase; letter-spacing: 0.1em;
  margin: 6px 0 2px;
}
.goal-card-verdict { font-size: 11px; color: var(--text); }
.goal-card-objective { font-size: 10px; color: var(--text3); }
.goal-card-gaps { display: flex; flex-wrap: wrap; gap: 3px; }
.goal-gap-sample {
  font-size: 9px; color: var(--text2);
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 2px; padding: 0 4px;
}
.goal-card-epilogue {
  font-family: var(--font-sans); font-size: 11px;
  color: var(--text); line-height: 1.4;
}
.goal-card-reasons { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.goal-reason {
  font-size: 9px; color: var(--text3);
  border: 1px solid var(--border); border-radius: 2px; padding: 0 4px;
}
`;

// ── JS ────────────────────────────────────────────────────────────────────────

const JS = `
const DATA = JSON.parse(document.getElementById('REPLAY_DATA').textContent);
const PULSES = DATA.pulses;
const AGENT_IDS = DATA.agentIds;
const AGENT_NAMES = DATA.agentNames;
const AGENT_ARCHETYPES = DATA.agentArchetypes;
const CHANNELS = DATA.channels;

const AGENT_COLORS = {ana:'#4da8ff',bruno:'#4ddb88',carla:'#ff5540',diego:'#ffaa30'};
const POSITIVE_EMOS = new Set(['pride','affection','admiration','desireForIntimacy']);
const NEGATIVE_EMOS = new Set(['jealousy','envy','humiliation','shame','resentment','suspicion','contempt','neediness','socialAnxiety','fearOfExclusion']);

let focusedPulse = 0;
let currentChannel = 'all';
let perspective = 'omniscient';
let scrollObserver = null;

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const STORY_EVENTS = {
  message_sent: { sigil: '💬', tag: '' },
  reply_sent: { sigil: '↩', tag: '<span class="msg-type-tag">↳reply</span>' },
  channel_created: { sigil: '📢', tag: '<span class="msg-type-tag">canal criado</span>' },
  reaction_sent: { sigil: '+', tag: '<span class="msg-type-tag">reação</span>' },
};
const isStoryEvent = evt => !!STORY_EVENTS[evt.type];

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  buildScrubber();
  buildChannelTabs();
  buildAgentPanel();
  renderStory();
  setupScrollObserver();
  updateAgentPanel(0);
  focusPulse(0, false);
}

// ── Scrubber ──────────────────────────────────────────────────────────────────

function buildScrubber() {
  const el = document.getElementById('scrubber');
  const counts = PULSES.map(f =>
    f.committedEvents.filter(e => e.type === 'message_sent' || e.type === 'reply_sent').length
  );
  const maxCount = Math.max(1, ...counts);

  PULSES.forEach((_, i) => {
    const tick = document.createElement('div');
    tick.className = 'scrubber-tick' + (i === 0 ? ' active' : '');
    tick.id = 'stk-' + i;
    tick.title = 'Pulso ' + i + ' — ' + counts[i] + ' evento(s)';

    const t = counts[i] / maxCount;
    const r = Math.round(12 + t * 68);
    const g = Math.round(12 + t * 68);
    const b = Math.round(26 + t * 174);
    tick.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
    tick.innerHTML = '<span class="scrubber-tick-label">' + i + '</span>';
    tick.onclick = () => focusPulse(i, true);
    el.appendChild(tick);
  });
}

// ── Channel tabs ──────────────────────────────────────────────────────────────

function buildChannelTabs() {
  const tabs = document.getElementById('ch-tabs');

  const allBtn = document.createElement('button');
  allBtn.className = 'ch-tab active';
  allBtn.id = 'chtab-all';
  allBtn.textContent = '# todos';
  allBtn.onclick = () => setChannel('all');
  tabs.appendChild(allBtn);

  CHANNELS.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'ch-tab';
    btn.id = 'chtab-' + ch.id;
    btn.textContent = (ch.type === 'private_channel' ? '🔒 ' : '# ') + (ch.name || ch.id);
    btn.onclick = () => setChannel(ch.id);
    tabs.appendChild(btn);
  });
}

function setChannel(id) {
  document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('active'));
  (document.getElementById('chtab-' + id) || document.getElementById('chtab-all'))?.classList.add('active');
  currentChannel = id;
  applyFilters();
}

function setPerspective(val) {
  perspective = val;
  applyFilters();
}

// ── Filter application ────────────────────────────────────────────────────────

function applyFilters() {
  document.querySelectorAll('.msg-row, .thought-line').forEach(el => {
    const chId = el.dataset.channelId || '';
    let visibleTo = [];
    try { visibleTo = JSON.parse(el.dataset.visibleTo || '[]'); } catch(e){}

    const channelOk = (currentChannel === 'all') || (chId === currentChannel);
    const perspOk = (perspective === 'omniscient') ||
      (visibleTo.length === 0 || visibleTo.includes(perspective));

    el.classList.toggle('hidden-by-channel', !channelOk);
    el.classList.toggle('hidden-by-perspective', !perspOk);
  });

  document.querySelectorAll('.dream-aside').forEach(el => {
    const silentAgent = el.dataset.silentAgent || '';
    const ok = (perspective === 'omniscient') || (silentAgent === perspective);
    el.classList.toggle('hidden-by-perspective', !ok);
  });
}

// ── Story rendering ───────────────────────────────────────────────────────────

function renderStory() {
  const col = document.getElementById('story-col');
  col.innerHTML = '';

  PULSES.forEach((frame, pi) => {
    const section = document.createElement('div');
    section.className = 'pulse-section';
    section.id = 'pulse-section-' + pi;
    section.dataset.pulse = String(pi);

    // Count meaningful events
    const visibleEvts = frame.committedEvents.filter(isStoryEvent);

    // ── Divider ──
    const divider = document.createElement('div');
    divider.className = 'pulse-divider';
    divider.innerHTML =
      '<span class="pulse-divider-label">PULSO ' + pi + '</span>' +
      '<span class="pulse-divider-line"></span>' +
      '<span class="pulse-event-count">' + visibleEvts.length + ' evento' + (visibleEvts.length !== 1 ? 's' : '') + '</span>';
    section.appendChild(divider);

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'pulse-body';

    const actedAgents = new Set();
    let hasContent = false;

    for (const evt of frame.committedEvents) {
      if (!isStoryEvent(evt)) continue;

      const agentId = evt.actorId || '';
      const agentName = AGENT_NAMES[agentId] || agentId;
      const thinking = frame.agentThinking ? frame.agentThinking[agentId] : null;
      const ch = CHANNELS.find(c => c.id === evt.channelId);
      const isPrivate = ch && ch.type === 'private_channel';
      const members = ch ? (ch.memberAgentIds || []) : AGENT_IDS;
      const visibleTo = (evt.visibility && evt.visibility.visibleToAgents && evt.visibility.visibleToAgents.length > 0)
        ? evt.visibility.visibleToAgents
        : members;

      // ── Message row ──
      const msgRow = document.createElement('div');
      msgRow.className = 'msg-row';
      msgRow.dataset.channelId = evt.channelId || '';
      msgRow.dataset.visibleTo = JSON.stringify(visibleTo);

      const storyStyle = STORY_EVENTS[evt.type];
      const sigil = storyStyle.sigil;
      const content = (evt.payload && (evt.payload.content || evt.payload.channelName || evt.payload.emoji)) || '';
      const typeTag = storyStyle.tag;
      const channelTag = isPrivate
        ? '<span class="msg-channel-tag">🔒 ' + escHtml(ch.name || ch.id) + '</span>'
        : '';

      msgRow.innerHTML =
        '<div class="msg-line">' +
          '<span class="msg-sigil">' + sigil + '</span>' +
          '<span class="msg-sender ' + escHtml(agentId) + '">' + escHtml(agentName) + '</span>' +
          channelTag + typeTag +
          '<span class="msg-content">' + escHtml(String(content)) + '</span>' +
        '</div>';
      body.appendChild(msgRow);
      actedAgents.add(agentId);
      hasContent = true;

      // ── Inline thought bubble ──
      if (thinking && thinking.privateMotiveSummary) {
        const thoughtRow = document.createElement('div');
        thoughtRow.className = 'thought-line';
        thoughtRow.dataset.channelId = evt.channelId || '';
        thoughtRow.dataset.visibleTo = JSON.stringify(visibleTo);

        const emoTags = (thinking.emotionDrivers || []).map(d =>
          '<span class="driver-tag emo">' + escHtml(d) + '</span>'
        ).join('');
        const motTags = (thinking.motivationDrivers || []).map(d =>
          '<span class="driver-tag mot">' + escHtml(d) + '</span>'
        ).join('');
        const driversHtml = (emoTags || motTags)
          ? '<div class="thought-drivers">' + emoTags + motTags + '</div>'
          : '';

        thoughtRow.innerHTML =
          '<span class="thought-sigil">💭</span>' +
          '<div class="thought-body">' +
            '<div class="thought-text">' + escHtml(thinking.privateMotiveSummary) + '</div>' +
            driversHtml +
          '</div>';
        body.appendChild(thoughtRow);
      }
    }

    // ── Dreaming asides for silent agents ──
    for (const agentId of AGENT_IDS) {
      if (actedAgents.has(agentId)) continue;

      const state = frame.agentStates ? frame.agentStates[agentId] : null;
      if (!state) continue;

      const accs = (state.initiativeAccumulators || [])
        .filter(a => a.value > 0.15)
        .sort((a, b) => (b.value / b.threshold) - (a.value / a.threshold));

      const topAcc = accs[0];
      if (!topAcc) continue;

      const pct = Math.min(100, Math.round((topAcc.value / topAcc.threshold) * 100));
      const accLabel = topAcc.source.replace(/_accumulator$/, '').replace(/_/g, ' ');

      let topEmoStr = '';
      const se = state.socialEmotions;
      if (se) {
        let topKey = null, topVal = 0;
        for (const [k, v] of Object.entries(se)) {
          if (v > topVal) { topKey = k; topVal = v; }
        }
        if (topKey && topVal > 0.15) {
          topEmoStr = topKey.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
        }
      }

      const agentName = AGENT_NAMES[agentId] || agentId;
      let dreamText = 'permanece em silêncio — ' + accLabel + ' crescendo (' + pct + '%).';
      if (topEmoStr) dreamText += ' Um ' + topEmoStr + ' silencioso.';

      const aside = document.createElement('div');
      aside.className = 'dream-aside';
      aside.dataset.silentAgent = agentId;
      aside.innerHTML =
        '<div class="dream-line">' +
          '<span class="dream-sigil">🌙</span>' +
          '<span class="dream-agent-name ' + escHtml(agentId) + '">' + escHtml(agentName) + '</span>' +
          '<span class="dream-text-content">' + escHtml(dreamText) + '</span>' +
        '</div>';
      body.appendChild(aside);
      hasContent = true;
    }

    if (!hasContent) {
      body.innerHTML = '<div class="pulse-empty">— sem eventos visíveis —</div>';
    }

    section.appendChild(body);
    col.appendChild(section);
  });

  applyFilters();
}

// ── Agent panel ───────────────────────────────────────────────────────────────

function buildAgentPanel() {
  const panel = document.getElementById('agent-panel');
  AGENT_IDS.forEach(id => {
    const card = document.createElement('div');
    card.className = 'agent-mini-card';
    card.id = 'mini-card-' + id;
    const name = AGENT_NAMES[id] || id;
    const arch = AGENT_ARCHETYPES ? (AGENT_ARCHETYPES[id] || '') : '';
    const color = AGENT_COLORS[id] || '#8888aa';

    card.innerHTML =
      '<div class="agent-mini-header">' +
        '<div class="agent-dot ' + id + '"></div>' +
        '<span class="agent-mini-name ' + id + '">' + escHtml(name) + '</span>' +
        '<span class="agent-mini-arch">' + escHtml(arch) + '</span>' +
        '<span class="agent-mini-action" id="mini-action-' + id + '">—</span>' +
      '</div>' +
      '<div class="agent-mini-body">' +
        '<svg width="52" height="52" viewBox="0 0 52 52" style="flex-shrink:0">' +
          '<rect width="52" height="52" fill="var(--surface2)" rx="3"/>' +
          '<line x1="26" y1="3" x2="26" y2="49" stroke="var(--border)" stroke-width="1"/>' +
          '<line x1="3" y1="26" x2="49" y2="26" stroke="var(--border)" stroke-width="1"/>' +
          '<circle cx="26" cy="26" r="16" fill="none" stroke="var(--border)" stroke-width="0.5"/>' +
          '<circle cx="26" cy="26" r="5" id="mini-cdot-' + id + '" fill="' + color + '" opacity="0.85"/>' +
        '</svg>' +
        '<div class="mini-emo-bars" id="mini-emo-' + id + '"></div>' +
      '</div>' +
      '<div class="agent-mini-thinking" id="mini-thinking-' + id + '">—</div>';
    panel.appendChild(card);
  });
}

function updateAgentPanel(pulseIdx) {
  const frame = PULSES[pulseIdx];
  if (!frame) return;

  AGENT_IDS.forEach(id => {
    const state = frame.agentStates ? frame.agentStates[id] : null;
    const thinking = frame.agentThinking ? frame.agentThinking[id] : null;

    // Action badge
    const badge = document.getElementById('mini-action-' + id);
    if (badge) {
      const actEvt = frame.committedEvents.find(e =>
        e.actorId === id && (e.type === 'message_sent' || e.type === 'reply_sent' || e.type === 'channel_created')
      );
      const noOpEvt = frame.committedEvents.find(e => e.actorId === id && e.type === 'no_op_recorded');
      badge.textContent = actEvt
        ? (actEvt.type === 'message_sent' ? '💬' : actEvt.type === 'reply_sent' ? '↩' : '📢')
        : (noOpEvt ? '🤫' : '—');
    }

    if (!state) return;

    // Circumplex dot
    const dot = document.getElementById('mini-cdot-' + id);
    if (dot && state.coreMood) {
      const x = 5 + ((state.coreMood.valence + 1) / 2) * 42;
      const y = 47 - (state.coreMood.arousal * 42);
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    }

    // Top 3 emotion bars
    const emoBarsEl = document.getElementById('mini-emo-' + id);
    if (emoBarsEl && state.socialEmotions) {
      const top3 = Object.entries(state.socialEmotions)
        .sort(([,a],[,b]) => b - a).slice(0, 3);
      emoBarsEl.innerHTML = top3.map(([k, v]) => {
        const cls = POSITIVE_EMOS.has(k) ? 'positive' : NEGATIVE_EMOS.has(k) ? 'negative' : 'neutral';
        const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
        return '<div class="mini-emo-row">' +
          '<span class="mini-emo-name">' + label + '</span>' +
          '<div class="mini-emo-track"><div class="mini-emo-fill ' + cls + '" style="width:' + (v*100).toFixed(0) + '%"></div></div>' +
        '</div>';
      }).join('');
    }

    // Mini thinking
    const thinkEl = document.getElementById('mini-thinking-' + id);
    if (thinkEl) {
      thinkEl.textContent = thinking ? thinking.privateMotiveSummary : '—';
    }
  });
}

// ── Focus / navigation ────────────────────────────────────────────────────────

function focusPulse(i, scroll) {
  document.getElementById('stk-' + focusedPulse)?.classList.remove('active');
  focusedPulse = Math.max(0, Math.min(i, PULSES.length - 1));
  const tick = document.getElementById('stk-' + focusedPulse);
  if (tick) {
    tick.classList.add('active');
    tick.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  document.querySelectorAll('.pulse-section').forEach(s => s.classList.remove('focused'));
  const section = document.getElementById('pulse-section-' + focusedPulse);
  if (section) {
    section.classList.add('focused');
    if (scroll) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  updateAgentPanel(focusedPulse);
}

function prevPulse() { focusPulse(focusedPulse - 1, true); }
function nextPulse() { focusPulse(focusedPulse + 1, true); }

// ── IntersectionObserver: sync panel when user scrolls ────────────────────────

function setupScrollObserver() {
  const col = document.getElementById('story-col');
  scrollObserver = new IntersectionObserver(entries => {
    // Find the topmost intersecting section
    let topEntry = null;
    for (const e of entries) {
      if (e.isIntersecting) {
        if (!topEntry || e.boundingClientRect.top < topEntry.boundingClientRect.top) {
          topEntry = e;
        }
      }
    }
    if (topEntry) {
      const pi = parseInt(topEntry.target.dataset.pulse || '0', 10);
      if (pi !== focusedPulse) {
        focusPulse(pi, false);
      }
    }
  }, { root: col, threshold: 0.3 });

  document.querySelectorAll('.pulse-section').forEach(s => scrollObserver.observe(s));
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextPulse(); }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); prevPulse(); }
});

init();
`;

// ── Goal panel render (appended to the main script only when the run had goals) ──

const GOAL_JS = `
(function () {
  const panel = document.getElementById('goal-panel');
  if (!panel) return;
  const statusLabel = { proposed: 'proposta', accepted: 'aceita', declined: 'declinada', ended: 'encerrada' };

  for (const goal of (DATA.goals || [])) {
    const card = document.createElement('div');
    card.className = 'goal-card';
    const agentName = AGENT_NAMES[goal.agentId] || goal.agentId;
    let inner = '<div class="goal-card-head">' +
      '<span class="goal-card-title">' + escHtml(goal.title) + '</span>' +
      '<span class="goal-card-status ' + escHtml(goal.status) + '">' + (statusLabel[goal.status] || goal.status) + '</span>' +
    '</div>';
    inner += '<div class="goal-card-meta">' + escHtml(agentName) + ' · ' + escHtml(goal.kind) +
      (goal.proposalPulse !== undefined ? ' · proposta no pulso ' + goal.proposalPulse : '') +
      (goal.acceptedPulse !== undefined ? ' · aceita no pulso ' + goal.acceptedPulse : '') + '</div>';
    if (goal.narrativeFraming) {
      inner += '<div class="goal-card-framing">' + escHtml(goal.narrativeFraming) + '</div>';
    }
    if (goal.latestVerdict) {
      const v = goal.latestVerdict;
      inner += '<div class="goal-card-label">veredito do mundo</div>' +
        '<div class="goal-card-verdict">' + escHtml(v.determination) + ' · ' + escHtml(v.consensus) + ' · confiança ' + Math.round(v.confidence * 100) + '%</div>' +
        '<div class="goal-card-objective">distância ' + v.distanceToTarget.toFixed(2) + ' · progresso ' + Math.round(v.progressRate * 100) + '%' + (v.plateaued ? ' · platô' : '') + '</div>';
    }
    if (goal.gapSamples && goal.gapSamples.length > 0) {
      const count = goal.gapSamples.length + (goal.gapSamples.length === 1 ? ' amostra' : ' amostras');
      inner += '<div class="goal-card-label">trajetória da lacuna (' + count + ')</div>' +
        '<div class="goal-card-gaps">' + goal.gapSamples.map(s =>
          '<span class="goal-gap-sample" title="pulso ' + s.pulseIndex + ' · log ' + s.divergenceFromLog.toFixed(2) + ' · mundo ' + s.divergenceFromWorld.toFixed(2) + '">' + s.pulseIndex + ' → ' + s.magnitude.toFixed(2) + '</span>'
        ).join('') + '</div>';
    }
    if (goal.ending && goal.ending.epilogue) {
      inner += '<div class="goal-card-label">epílogo</div>' +
        '<div class="goal-card-epilogue">' + escHtml(goal.ending.epilogue) + '</div>';
      if (goal.ending.reasons && goal.ending.reasons.length > 0) {
        inner += '<div class="goal-card-reasons">' + goal.ending.reasons.map(r => '<span class="goal-reason">' + escHtml(r) + '</span>').join(' ') + '</div>';
      }
    }
    card.innerHTML = inner;
    panel.appendChild(card);
  }
}());
`;
