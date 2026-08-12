/**
 * roleplay.html renderer — the spectator novela view.
 *
 * Self-contained dark page: header stats, category chapters, chat-style
 * transcripts with PRIVATE-CHANNEL panels (🔒), narrator recaps, character
 * state cards, and a persona-focus select (default: the full history).
 * All UI labels in pt-BR.
 */

import type { ScenarioEvidence } from "../cli/evidence.js";
import type { Narration } from "../narrator/narrator.js";

const AGENT_COLORS: Record<string, string> = {
  goulart: "#ff6b6b",
  bruno: "#6b8cff",
  caio: "#4ecdc4",
  mariana: "#f5a623",
  leo: "#ffd93d",
};

const AGENT_NAMES: Record<string, string> = {
  goulart: "Goulart",
  bruno: "Bruno",
  caio: "Caio",
  mariana: "Mariana",
  leo: "Léo",
};

export type HtmlPageData = {
  evidence: ScenarioEvidence[];
  narrations: Record<string, Narration>;
  novela?: ScenarioEvidence;
  novelaNarration?: Narration;
  mode: string;
  model?: string;
  generatedAt: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function agentColor(agent: string): string {
  return AGENT_COLORS[agent] ?? "#9b9b9b";
}

function agentName(agent: string): string {
  return AGENT_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** Renders transcript entries, grouping consecutive private-channel events
 *  into 🔒 panels. Each msg carries data-agent for the persona filter. */
function transcriptHtml(evidence: ScenarioEvidence): string {
  const parts: string[] = [];
  let inPrivate = false;
  let privateChannel = "";

  const closePanel = () => {
    if (inPrivate) {
      parts.push(`</div>`);
      inPrivate = false;
      privateChannel = "";
    }
  };

  for (const t of evidence.transcript) {
    const color = agentColor(t.agent);
    const name = agentName(t.agent);
    const agentAttr = `data-agent="${esc(t.agent)}"`;

    if (t.private && t.type !== "channel_created") {
      if (!inPrivate) {
        parts.push(
          `<div class="private-panel"><div class="private-header">🔒 canal privado${t.channelId ? ` · ${esc(t.channelId)}` : ""}</div>`,
        );
        inPrivate = true;
        privateChannel = t.channelId ?? "";
      }
    } else {
      closePanel();
    }

    switch (t.type) {
      case "message_sent":
      case "reply_sent":
        parts.push(
          `<div class="msg" ${agentAttr}><span class="who" style="color:${color}">${name}</span>` +
            `<span class="tag">${t.type === "reply_sent" ? "responde" : "diz"}</span>` +
            `<span class="text">${esc(t.content ?? "")}</span>` +
            (t.privateMotive ? `<span class="motive">${esc(t.privateMotive)}</span>` : "") +
            `</div>`,
        );
        break;
      case "reaction_sent":
        parts.push(
          `<div class="msg react" ${agentAttr}><span class="who" style="color:${color}">${name}</span>` +
            `<span class="tag">reage</span><span class="emoji">${esc(t.content ?? "👍")}</span></div>`,
        );
        break;
      case "no_op_recorded":
        parts.push(
          `<div class="msg noop" ${agentAttr}><span class="who" style="color:${color}">${name}</span>` +
            `<span class="tag">escolhe o silêncio</span>` +
            (t.privateMotive ? `<span class="motive">${esc(t.privateMotive)}</span>` : "") +
            `</div>`,
        );
        break;
      case "channel_created":
        parts.push(
          `<div class="msg system">🔒 <b>${name}</b> abre um canal privado${t.channelId ? ` (${esc(t.channelId)})` : ""} — longe da sala</div>`,
        );
        break;
      case "memory_written":
        parts.push(
          `<div class="msg system">🧠 <b>${name}</b> guarda uma memória${t.privateMotive ? ` — <span class="motive">${esc(t.privateMotive)}</span>` : ""}</div>`,
        );
        break;
      case "typing_started":
        break;
      default:
        if (t.content) {
          parts.push(
            `<div class="msg system"><b>${name}</b> · ${esc(t.type)} · ${esc(t.content)}</div>`,
          );
        }
    }
  }
  closePanel();
  return parts.join("\n");
}

function stateCard(agent: string, state: Record<string, number>): string {
  const color = agentColor(agent);
  const top = Object.entries(state)
    .filter(([k]) => !["valence", "arousal", "stability", "energy"].includes(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const bar = (v: number, label: string, max = 1) => {
    const pct = Math.round((Math.abs(v) / max) * 100);
    return `<div class="bar-row"><span class="bar-label">${label}</span><span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-val">${v.toFixed(2)}</span></div>`;
  };
  return `<div class="card" style="--accent:${color}">
    <div class="card-name">${agentName(agent)}</div>
    ${bar(state.valence ?? 0, "valência", 1)}
    ${bar(state.arousal ?? 0, "excitação")}
    ${top.map(([k, v]) => `<div class="emotion">${k}: <b>${v.toFixed(2)}</b></div>`).join("")}
  </div>`;
}

const CATEGORY_LABELS: Record<string, string> = {
  v1_behavior: "Os Beatos do V1",
  motive_archetype: "Os Dezessete Motivos",
  stagnation_attractor: "Salas Que Travam",
  edge_chaos: "O Andar Desmiolado",
  calibration: "Salas Calmas",
};

function chapter(evidence: ScenarioEvidence, narration?: Narration, idPrefix = ""): string {
  const signalsOk = evidence.signals.filter(s => s.passed).length;
  const signalsTotal = evidence.signals.length;
  const probesOk = evidence.probes.filter(p => p.passed).length;
  const probesTotal = evidence.probes.length;
  const judges = Object.entries(evidence.judge)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  const channels = evidence.channelsCreated.join(", ") || "—";

  return `<section class="chapter" id="${idPrefix}${evidence.scenarioId}">
    <div class="chapter-head">
      <div class="chapter-title">${esc(narration?.title ?? evidence.name)}</div>
      <div class="chapter-sub">${esc(evidence.name)} · ${esc(CATEGORY_LABELS[evidence.category] ?? evidence.category)}</div>
      ${narration ? `
      <div class="narration"><p>${esc(narration.recap)}</p>
      <p class="hidden"><b>o que a sala não viu:</b> ${esc(narration.hiddenShift)}</p>
      <div class="narration-meta">${narration.narrator === "llm" ? "✨ narrado" : "📄 narração mecânica"}${narration.model ? ` · ${esc(narration.model)}` : ""}</div></div>` : ""}
      <div class="meta">
        <span class="chip">✅ sinais ${signalsOk}/${signalsTotal}</span>
        <span class="chip">📊 sondas ${probesOk}/${probesTotal}</span>
        <span class="chip">🔒 canais: ${esc(channels)}</span>
        <span class="chip">⚙️ ${judges}</span>
      </div>
    </div>
    <div class="chat">${transcriptHtml(evidence)}</div>
    <div class="states">
      ${Object.entries(evidence.finalStates).map(([a, s]) => stateCard(a, s)).join("")}
    </div>
  </section>`;
}

/** Aggregates per-persona stats across all scenes (for the focus select). */
function personaStats(evidence: ScenarioEvidence[]): Record<string, { msgs: number; noops: number; reacts: number; scenes: number }> {
  const stats: Record<string, { msgs: number; noops: number; reacts: number; scenes: number }> = {};
  const seen = new Set<string>();
  for (const e of evidence) {
    for (const t of e.transcript) {
      stats[t.agent] ??= { msgs: 0, noops: 0, reacts: 0, scenes: 0 };
      if (t.type === "message_sent" || t.type === "reply_sent") stats[t.agent]!.msgs++;
      if (t.type === "no_op_recorded") stats[t.agent]!.noops++;
      if (t.type === "reaction_sent") stats[t.agent]!.reacts++;
    }
    for (const agent of Object.keys(e.finalStates)) {
      if (!seen.has(e.scenarioId + agent)) {
        seen.add(e.scenarioId + agent);
        stats[agent] ??= { msgs: 0, noops: 0, reacts: 0, scenes: 0 };
        stats[agent]!.scenes++;
      }
    }
  }
  return stats;
}

export function renderHtmlPage(data: HtmlPageData): string {
  const categoryOrder = ["v1_behavior", "motive_archetype", "stagnation_attractor", "edge_chaos", "calibration"] as const;
  const byCategory = new Map<string, ScenarioEvidence[]>();
  for (const e of data.evidence) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const nav = categoryOrder
    .map(cat => {
      const items = (byCategory.get(cat) ?? [])
        .map(e => `<li><a href="#${e.scenarioId}">${esc(e.name)}</a></li>`)
        .join("");
      return `<div class="nav-group"><div class="nav-label">${CATEGORY_LABELS[cat] ?? cat}</div><ul>${items}</ul></div>`;
    })
    .join("");

  const chapters = categoryOrder
    .map(cat =>
      (byCategory.get(cat) ?? [])
        .map(e => chapter(e, data.narrations[e.scenarioId]))
        .join("\n"),
    )
    .join("\n");

  const novelaSection = data.novela
    ? `<section class="chapter novela" id="novela_one_long_afternoon">${chapter(data.novela, data.novelaNarration)}</section>`
    : "";

  const totalMessages = data.evidence.reduce(
    (s, e) => s + e.transcript.filter(t => t.type === "message_sent" || t.type === "reply_sent").length,
    0,
  );
  const totalNoops = data.evidence.reduce(
    (s, e) => s + e.transcript.filter(t => t.type === "no_op_recorded").length,
    0,
  );
  const totalChannels = data.evidence.reduce(
    (s, e) => s + e.transcript.filter(t => t.type === "channel_created").length,
    0,
  );
  const totalPrivate = data.evidence.reduce(
    (s, e) => s + e.transcript.filter(t => t.private).length,
    0,
  );
  const signalsPassed = data.evidence.reduce(
    (s, e) => s + e.signals.filter(x => x.passed).length,
    0,
  );
  const signalsTotal = data.evidence.reduce((s, e) => s + e.signals.length, 0);

  const stats = personaStats(data.evidence);
  const personaOptions = Object.keys(stats)
    .sort()
    .map(a => {
      const s = stats[a]!;
      return `<option value="${esc(a)}">${esc(agentName(a))} — ${s.msgs} msg · ${s.noops} silêncios · ${s.scenes} cenas</option>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Perfectman — o estranho novela de socket-chat</title>
<style>
:root { --bg:#0f1115; --panel:#171a21; --panel2:#1d212b; --border:#2a2f3a; --text:#e6e6e6; --muted:#8b93a3; --accent:#ff6b6b; --priv:#3a2d17; --priv-border:#8a6d2f; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace; font-size:14px; line-height:1.55; }
header { position:sticky; top:0; z-index:10; background:rgba(15,17,21,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--border); padding:12px 24px; display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; }
header h1 { font-size:18px; margin:0; color:var(--accent); letter-spacing:.5px; }
header .stats { color:var(--muted); font-size:12px; }
header .stats b { color:var(--text); }
header .focus { margin-left:auto; display:flex; align-items:center; gap:8px; }
header .focus label { color:var(--muted); font-size:12px; }
header select { background:var(--panel2); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:5px 8px; font-family:inherit; font-size:12.5px; }
.focus-banner { display:none; padding:8px 24px; background:var(--panel2); border-bottom:1px solid var(--border); color:var(--muted); font-size:12.5px; }
.focus-banner b { color:var(--text); }
.layout { display:grid; grid-template-columns:260px 1fr; gap:24px; padding:24px; max-width:1400px; margin:0 auto; }
nav { position:sticky; top:70px; align-self:start; max-height:calc(100vh - 100px); overflow-y:auto; padding-right:8px; }
nav .nav-group { margin-bottom:14px; }
nav .nav-label { color:var(--accent); font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
nav ul { list-style:none; margin:0; padding:0; }
nav a { color:var(--muted); text-decoration:none; display:block; padding:2px 0; font-size:12.5px; }
nav a:hover { color:var(--text); }
main { min-width:0; }
.chapter { background:var(--panel); border:1px solid var(--border); border-radius:12px; margin-bottom:28px; overflow:hidden; }
.chapter-head { padding:18px 20px 12px; border-bottom:1px solid var(--border); }
.chapter-title { font-size:19px; font-weight:700; color:var(--accent); }
.chapter-sub { color:var(--muted); font-size:12px; margin-top:2px; }
.narration { margin-top:10px; padding:10px 12px; background:var(--panel2); border-left:3px solid var(--accent); border-radius:6px; color:#d8d8d8; }
.narration .hidden { color:#f5a623; margin-top:4px; }
.narration-meta { color:var(--muted); font-size:11px; margin-top:6px; }
.meta { margin-top:10px; display:flex; flex-wrap:wrap; gap:6px; }
.chip { background:var(--panel2); border:1px solid var(--border); color:var(--muted); font-size:11px; padding:2px 8px; border-radius:10px; }
.chat { padding:14px 20px; }
.private-panel { background:var(--priv); border:1px solid var(--priv-border); border-radius:10px; margin:8px 0; padding:10px 14px; }
.private-header { color:#e6b86b; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
.msg { padding:3px 0; }
.msg .who { font-weight:700; }
.msg .tag { color:var(--muted); font-size:11px; margin:0 6px 0 8px; }
.msg .text { color:#eef0f4; }
.msg .motive { display:block; color:#6b8cff; font-style:italic; font-size:12px; padding-left:20px; }
.msg.noop { color:var(--muted); }
.msg.system { color:var(--muted); padding:2px 0; }
.msg.react { color:var(--muted); }
.msg.react .emoji { margin-left:6px; }
.states { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; padding:0 20px 18px; }
.card { background:var(--panel2); border:1px solid var(--border); border-top:3px solid var(--accent); border-radius:8px; padding:10px; }
.card-name { font-weight:700; margin-bottom:6px; color:var(--accent); }
.bar-row { display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--muted); }
.bar { flex:1; background:#0b0d10; border-radius:3px; height:6px; overflow:hidden; }
.bar-fill { display:block; height:100%; background:var(--accent); }
.bar-val { width:36px; text-align:right; }
.emotion { font-size:11px; color:var(--muted); margin-top:2px; }
.emotion b { color:#e6b86b; }
.chapter.novela { border-color:#f5a623; }
footer { text-align:center; color:var(--muted); font-size:12px; padding:20px 0 40px; }
@media (max-width:900px) { .layout { grid-template-columns:1fr; } nav { position:static; max-height:none; } }
</style>
</head>
<body>
<header>
  <h1>PERFECTMAN</h1>
  <div class="stats">
    <b>${data.evidence.length}</b> cenas · <b>${totalMessages}</b> mensagens · <b>${totalNoops}</b> silêncios ·
    <b>${totalChannels}</b> canais privados (${totalPrivate} msg privadas) · sinais <b>${Math.round((signalsPassed / Math.max(1, signalsTotal)) * 100)}%</b> ·
    modelo <b>${esc(data.model ?? data.mode)}</b>
  </div>
  <div class="focus">
    <label for="persona-focus">Focar em</label>
    <select id="persona-focus">
      <option value="__all__">Todos — a história completa</option>
      ${personaOptions}
    </select>
  </div>
</header>
<div class="focus-banner" id="focus-banner"></div>
<div class="layout">
<nav>${nav}${data.novela ? `<div class="nav-group"><div class="nav-label">A Tarde Longa</div><ul><li><a href="#novela_one_long_afternoon">Uma tarde comprida</a></li></ul></div>` : ""}</nav>
<main>
  <section class="chapter"><div class="chapter-head"><div class="chapter-title">Sobre esta página</div>
  <div class="narration"><p>Cada cena abaixo é uma execução ao vivo do motor social do Perfectman — atenção, interpretação, motivação, emoção, pressão, inibição, intenção — com o LLM decidindo o que cada persona faz com o que sente. As <span class="hidden">itálicas azuis</span> são os motivos privados dos agentes: o que a sala nunca viu. Painéis <b>🔒 canal privado</b> marcam o que aconteceu fora dos olhos do resto.</p>
  <p>Use o seletor <b>Focar em</b> para acompanhar a história de uma única persona.</p>
  <p class="narration-meta">Gerado em ${esc(data.generatedAt)} · suíte de evidência, sementes determinísticas</p></div></div></section>
  ${chapters}
  ${novelaSection}
</main>
</div>
<footer>Perfectman — um estranho servidor de socket-chat virando novela, devagar</footer>
<script>
(function () {
  var select = document.getElementById("persona-focus");
  var banner = document.getElementById("focus-banner");
  var stats = ${JSON.stringify(stats)};
  var names = ${JSON.stringify(AGENT_NAMES)};
  function apply() {
    var sel = select.value;
    var msgs = 0, noops = 0, reacts = 0;
    document.querySelectorAll(".msg").forEach(function (m) {
      var keep = sel === "__all__" || m.dataset.agent === sel;
      m.style.display = keep ? "" : "none";
      if (keep && m.dataset.agent === sel) {
        if (m.classList.contains("noop")) noops++;
        else if (m.classList.contains("react")) reacts++;
        else msgs++;
      }
    });
    if (sel === "__all__") {
      banner.style.display = "none";
    } else {
      var s = stats[sel] || { msgs: 0, noops: 0, reacts: 0, scenes: 0 };
      banner.style.display = "block";
      banner.innerHTML = "Focando em <b style='color:" + window.__colors[sel] + "'>" + (names[sel] || sel) + "</b> — " +
        s.msgs + " mensagens no total · " + s.noops + " silêncios · " + s.reacts + " reações · presente em " + s.scenes + " cenas. " +
        "Nesta cena: " + msgs + " mensagens, " + noops + " silêncios, " + reacts + " reações. <a href='#' id='focus-clear' style='color:var(--muted)'>limpar foco</a>";
      var clear = document.getElementById("focus-clear");
      if (clear) clear.addEventListener("click", function (e) { e.preventDefault(); select.value = "__all__"; apply(); });
    }
  }
  window.__colors = ${JSON.stringify(AGENT_COLORS)};
  select.addEventListener("change", apply);
  apply();
})();
</script>
</body>
</html>`;
}
