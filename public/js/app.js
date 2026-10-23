/*
 * app.js — Interfaz. Toda la lógica de cálculo vive en calc.js y sim.js;
 * aquí solo se piden datos al servidor y se pintan.
 */
(() => {
'use strict';

const { RULES, buildModel } = window.CWCalc;
const Sim = window.CWSim;
const { WIN, LOSS, DECKS, CAP_DECKS, CAP_PLAYERS } = RULES;
const REFRESH_MS = 60000;
const TAG_RE = /^[0289PYLQGRJCUV]{3,12}$/;
const RISK_MID = 0.15, RISK_HI = 0.4;
const CFG = window.CW_CONFIG || {};
const $ = (id) => document.getElementById(id);

const state = {
  model: null, lastPayload: null, tag: null, selected: null, view: 'day', viewByUser: false, timer: null,
  demo: null, demoSeed: null, loading: false, locked: null, tab: 'live',
  history: null, historyKey: null, historyState: 'idle', rels: {}, today: null,
  sim: null, plClan: null, plSort: { key: 'risk', dir: -1 }, colors: {}, riverKey: null,
  demoName: null, kickClan: null, kick: loadKickPrefs(),
  conf: null, summary: null, report: null, reportFetchedAt: 0, seenTag: null, prevSeen: null, prevSeenAt: null,
};

// Ajustes de la pestaña de expulsiones (se recuerdan en este navegador)
function loadKickPrefs() {
  // Ajustes nuevos (cw:kick2): los de la fórmula anterior ya no valen
  const def = { weeks: 10, medal: 1, target: window.CWSim.KICK.medalTarget, thr: window.CWSim.KICK.threshold, coef: window.CWSim.DEFAULT_DECK_COEF.slice() };
  try {
    const saved = JSON.parse(localStorage.getItem('cw:kick2') || 'null');
    if (saved && Array.isArray(saved.coef) && saved.coef.length === 5) return Object.assign(def, saved);
  } catch {}
  return def;
}
function saveKickPrefs() { try { localStorage.setItem('cw:kick2', JSON.stringify(state.kick)); } catch {} }

/* ---------- formato ---------- */
const fmt = (n) => (n == null || !isFinite(n)) ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dec = (n, d = 1) => (n == null || !isFinite(n)) ? '—' : n.toFixed(d).replace('.', ',');
const pct = (p) => {
  if (p == null || !isFinite(p)) return '—';
  if (p <= 0) return '0\u00a0%';
  if (p < 0.01) return '<1\u00a0%';
  if (p > 0.99 && p < 1) return '>99\u00a0%';
  return `${Math.round(p * 100)}\u00a0%`;
};
const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${fmt(n)} ${Math.round(n) === 1 ? one : many}`;
const normTag = (raw) => String(raw || '').trim().toUpperCase().replace(/^#+/, '').replace(/\s+/g, '').replace(/O/g, '0');
const apiUrl = (p) => (CFG.apiBase ? CFG.apiBase.replace(/\/+$/, '') + '/' : '') + p;
const riskClass = (r) => r == null ? 'r-na' : r >= RISK_HI ? 'r-hi' : r >= RISK_MID ? 'r-mid' : 'r-lo';
const probClass = (p) => p >= 0.5 ? 'p-hi' : p >= 0.15 ? 'p-mid' : 'p-lo';
const ord = (n) => `${n}º`;

/* ---------- piezas gráficas ---------- */
const ic = (id, cls) => `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const BOAT = '<svg viewBox="0 0 36 36" aria-hidden="true"><path class="sail" d="M17 5v17H8.5Z"/><path class="sail" d="M19.5 9 27 22h-7.5Z"/><path class="hull" d="M4 24h28l-3.6 6.2a2 2 0 0 1-1.7 1H9.3a2 2 0 0 1-1.7-1Z"/></svg>';
const CLAN_VARS = ['var(--clan-1)', 'var(--clan-2)', 'var(--clan-3)', 'var(--clan-4)'];
const colorOf = (tag) => (state.colors && state.colors[tag]) || 'var(--muted)';

function assignColors(m) {
  // Tu clan siempre en verde; los rivales, en el orden de la carrera
  state.colors = {};
  let k = 0;
  for (const c of m.clans) state.colors[c.tag] = c.tag === m.own ? 'var(--green)' : CLAN_VARS[k++ % CLAN_VARS.length];
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((w) => w.length);
  if (!words.length) return '?';
  const s = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2).join('');
  return s.toUpperCase();
}

// Escudo propio con las iniciales del clan (no usa los emblemas del juego)
const shield = (c) => `<svg class="shield" viewBox="0 0 32 36" style="color:${colorOf(c.tag)}" aria-hidden="true"><path d="M16 2 29 6.5v10.5c0 7.8-5.3 13.6-13 17C8.3 30.6 3 24.8 3 17V6.5Z"/><text x="16" y="23">${esc(initials(c.name))}</text></svg>`;

const clanLabel = (c) => `<span class="cn">${shield(c)}<span><span class="cname">${esc(c.name)}</span><span class="csub">${state.model && c.tag === state.model.own ? '<span class="own">Tu clan</span>' : esc(c.tag)}</span></span></span>`;

// Defensas del barco: una torre por cada defensa en pie y lo que suman al día
function defsHtml(st) {
  if (!st || st.defenses == null) return '<span class="defs none">defensas: se sabrán al cerrar el día</span>';
  const est = st.defenseSource === 'estimado';
  const towers = Array.from({ length: st.defenses }, () => '<i></i>').join('');
  const tip = est ? 'Estimado con la semana anterior: las defensas se reponen cada semana' : 'Defensas en pie al cerrar el último día jugado';
  return `<span class="defs" title="${tip}"><span class="towers" aria-hidden="true">${towers}</span>${st.defenses} defensas${est ? '*' : ''}, +${fmt(st.defenseBonus)} al día</span>`;
}

function tile({ icon, k, v, d, tone, extra, style }) {
  return `<div class="tile${tone ? ` t-${tone}` : ''}"${style ? ` style="${style}"` : ''}><div class="tk">${icon ? ic(icon) : ''}${k}</div><div class="tv">${v}</div>${d ? `<div class="td">${d}</div>` : ''}${extra || ''}</div>`;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function seedFrom(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
function recall(k) { try { return localStorage.getItem(k); } catch { return null; } }
function setUrl(params) {
  try {
    const q = new URLSearchParams(params).toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  } catch {}
}
async function getJson(path) {
  const res = await fetch(apiUrl(path), { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error((body && body.error) || `El servidor respondió ${res.status}.`);
  return body;
}

/* ---------- mensajes ---------- */
function setLed(kind, text) { $('led').className = `led ${kind || ''}`; $('liveText').textContent = text; }

function setMsg(el, text, kind, action) {
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = `msg${kind ? ` ${kind}` : ''}`;
  el.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'link'; b.textContent = action.label;
    b.addEventListener('click', action.fn);
    el.append(b);
  }
}

/* ---------- datos derivados ---------- */
const historyKeyNow = () => (state.demo ? `demo:${state.demo}:${state.demoSeed == null ? '' : state.demoSeed}:${state.demoName || ''}` : state.tag);
const today = (c) => (state.today && state.today.clans[c.tag]) || null;
const relOf = (tag) => state.rels[tag] || null;
const historyReady = () => state.historyState === 'ok' || state.historyState === 'error';

// Valores de un clan en la vista actual ("day", o "week" en coliseo)
function viewVals(c, key) {
  const m = state.model;
  const t = today(c);
  const v = c[key];
  let exp = null;
  if (t) exp = m.colosseum ? (key === 'week' ? t.expected : t.expected - c.fame + c.dayPoints) : t.expected;
  return { now: v.now, min: v.min, max: v.max, exp };
}

function playerRisk(clanTag, playerTag) {
  const rel = relOf(clanTag);
  if (!rel) return { risk: null, known: false, low: true };
  const p = rel.players.get(playerTag);
  return { risk: rel.riskFor(playerTag), known: !!p, low: p ? p.lowData : true };
}

function computeRels() {
  state.rels = {};
  if (!state.history || !state.model) return;
  for (const c of state.model.clans) {
    const entry = state.history.clans ? state.history.clans[c.tag] : null;
    state.rels[c.tag] = Sim.reliability(Sim.prepareHistory(entry && entry.weeks));
  }
}

function computeToday() {
  const m = state.model;
  state.today = (!m || m.training || !historyReady())
    ? null
    : Sim.runToday(m, state.rels, { runs: 8000, seed: seedFrom(state.demo ? historyKeyNow() : m.fetchedAt) });
}

function avgDaily(tag) {
  const entry = state.history && state.history.clans ? state.history.clans[tag] : null;
  const weeks = Sim.prepareHistory(entry && entry.weeks);
  return weeks.length ? weeks.reduce((s, w) => s + w.daily, 0) / weeks.length : null;
}

function rosterOf(tag) {
  const payload = state.lastPayload;
  const roster = payload && payload.rosters ? payload.rosters[tag] : null;
  if (roster) return roster;
  const race = payload.race;
  const c = (race.clans || []).find((x) => x.tag === tag) || race.clan;
  return (c.participants || []).map((p) => ({ tag: p.tag, name: p.name }));
}

/* ---------- pestañas ---------- */
const TABS = ['live', 'players', 'kick', 'sim'];
function setTab(tab) {
  state.tab = tab;
  TABS.forEach((t) => {
    const btn = $(`tab-${t}`);
    btn.setAttribute('aria-selected', String(t === tab));
    btn.tabIndex = t === tab ? 0 : -1;
    $(`panel-${t}`).hidden = t !== tab || !state.model;
  });
  if (!state.model) return;
  if (tab === 'players') renderPlayers();
  if (tab === 'kick') renderKick();
  if (tab === 'sim') openSim();
}

/* =========================================================
 * HOY EN DIRECTO
 * ========================================================= */
function render() {
  $('intro').hidden = true;
  $('tabs').hidden = false;
  renderChips();
  renderSummary();
  renderRiver();
  renderPoints();
  renderRace();
  renderDetail();
  renderPending();
  setTab(state.tab);
}

function renderChips() {
  const m = state.model;
  const chips = [`<span class="chip">Semana ${m.week}</span>`, `<span class="chip">${ic(m.training ? 'clock' : 'flag')}${esc(m.dayLabel)}</span>`];
  if (m.colosseum) chips.push(`<span class="chip amber">${ic('crown')}Coliseo: gana quien sume más medallas en la semana</span>`);
  if (m.training) chips.push('<span class="chip amber">Entrenamiento: hoy no se suman medallas</span>');
  if (state.historyState === 'loading') chips.push('<span class="chip dim">Cargando historial…</span>');
  if (state.historyState === 'ok') {
    const own = relOf(m.own);
    chips.push(`<span class="chip dim">${ic('chart')}Historial de ${own ? own.clan.weeks : 0} semanas</span>`);
  }
  if (state.historyState === 'error') chips.push('<span class="chip amber">Sin historial: previsiones aproximadas</span>');
  if (state.demo) chips.push(CFG.snapshot ? `<span class="chip green">Foto real: ${esc(CFG.snapshot.label)}</span>` : '<span class="chip green">Datos de demostración</span>');
  $('chips').innerHTML = chips.join('');
}

function orderBy(key) {
  return [...state.model.clans].sort((a, b) => (b[key].now - a[key].now) ||
    ((viewVals(b, key).exp || 0) - (viewVals(a, key).exp || 0)));
}

function renderSummary() {
  const m = state.model;
  const o = m.clans.find((c) => c.tag === m.own) || m.clans[0];
  const n = m.clans.length;
  const rel = relOf(o.tag);

  if (m.training) {
    const days = Sim.weekProgress(m).daysToStart;
    $('sumText').innerHTML = `Entrenamiento · la carrera empieza ${days <= 1 ? '<b>mañana</b>' : `en <b>${days} días</b>`}`;
    const c = rel && rel.clan;
    $('sumKpis').innerHTML = [
      tile({ icon: 'users', k: 'Miembros', v: o.done == null ? '—' : fmt(o.done + o.pending.length), d: 'en el clan ahora' }),
      tile({ icon: 'cards', k: 'Mazos jugados', v: c && c.participation != null ? pct(c.participation) : '—', d: 'media de las últimas semanas', tone: 'green' }),
      tile({ icon: 'alert', k: 'Días con fallos', v: c && c.hasData ? pct(c.dayRisk) : '—', d: 'días en que alguien se dejó mazos' }),
      tile({ icon: 'medal', k: 'Media por día', v: state.history ? fmt(avgDaily(o.tag)) : '—', d: 'medallas por día de batalla' }),
      tile({ icon: 'chart', k: 'Historial', v: rel ? `${rel.clan.weeks}<small> sem.</small>` : '—', d: 'semanas analizadas' }),
    ].join('');
    return;
  }

  const key = m.colosseum ? 'week' : 'day';
  const sorted = orderBy(key);
  const pos = 1 + m.clans.filter((c) => c[key].now > o[key].now).length;
  const t = today(o);
  const usable = o.usedTotal + o.remaining;
  const ctx = m.colosseum ? 'en el total de la semana' : 'hoy';

  // Una línea: lo esencial. El detalle está en las tarjetas de debajo
  const parts = [`<b class="hl">${esc(o.name)}</b> <b>${ord(pos)} de ${n}</b> ${ctx}`, `<b>${fmt(o[key].now)}</b> medallas`];
  parts.push(o.remaining ? `faltan <b>${o.remaining}</b> mazos` : 'todos los mazos jugados');
  if (t) parts.push(`${m.colosseum ? '1º al cerrar' : 'ganar el día'}: <b class="${t.pWin >= 0.5 ? 'hl' : 'hla'}">${pct(t.pWin)}</b>`);
  else if (!historyReady()) parts.push('<span class="csub" style="display:inline">calculando…</span>');
  const text = parts.join(' · ');
  $('sumText').innerHTML = text;

  const gap = pos === 1
    ? (sorted[1] ? `${signed(o[key].now - sorted[1][key].now)} sobre el 2º` : '')
    : `a ${fmt(sorted[0][key].now - o[key].now)} del 1º`;
  const expAdd = t ? Math.min(o.remaining, t.expDecks) : 0;
  const usedW = usable ? Math.min(100, o.usedTotal / usable * 100) : 0;
  const meter = `<div class="meter" title="Verde: jugados. Ámbar: los que se espera que se jueguen"><i style="width:${usedW}%"></i><i class="exp" style="left:${usedW}%;width:${usable ? Math.min(100 - usedW, expAdd / usable * 100) : 0}%"></i></div>`;
  $('sumKpis').innerHTML = [
    tile({ icon: 'flag', k: m.colosseum ? 'Puesto en la semana' : 'Puesto hoy', v: `${ord(pos)}<small> de ${n}</small>`, d: gap }),
    tile({ icon: 'medal', k: 'Medallas hoy', v: fmt(o.dayPoints), d: o.avg != null ? `${fmt(o.avg)} por mazo de media` : 'nadie ha jugado aún', tone: 'green' }),
    tile({ icon: 'cards', k: 'Mazos jugados', v: pct(usable ? o.usedTotal / usable : 0), d: `${o.usedTotal} de ${usable}, quedan ${o.remaining}`, extra: meter }),
    tile({ icon: 'target', k: m.colosseum ? 'Total esperado' : 'Final esperado', v: t ? fmt(t.expected) : '…', d: t ? `entre ${fmt(t.p10)} y ${fmt(t.p90)}` : 'calculando', tone: 'amber' }),
    tile({ icon: 'crown', k: m.colosseum ? '1º al cerrar el día' : 'Gana el día', v: t ? pct(t.pWin) : '…', d: t ? `puesto esperado ${dec(t.expectedRank)}` : '', tone: t && t.pWin >= 0.5 ? 'green' : 'amber' }),
  ].join('');
}

/* ---------- el río: la carrera de barcos de la semana ---------- */
function renderRiver() {
  const m = state.model;
  const wk = Sim.weekProgress(m);
  // Avance al cerrar cada día de esta semana (un tramo de la barra por día)
  const race = m.race || {};
  const pi = race.periodIndex || 0;
  const weekStart = pi - (((pi % 7) + 7) % 7);
  const logs = (race.periodLogs || []).filter((l) => l.periodIndex >= weekStart + 3 && l.periodIndex < pi)
    .sort((a, b) => a.periodIndex - b.periodIndex);
  const rows = m.clans.map((c) => {
    const st = wk.clans[c.tag];
    const t = today(c);
    const now = wk.colosseum ? c.fame : st.progress;
    let next = null;
    if (t) next = wk.colosseum ? t.expected : (t.expPoints != null ? now + t.expPoints : null);
    const ends = wk.colosseum ? [] : logs.map((l) => {
      const e = (l.items || []).find((x) => x.clan && x.clan.tag === c.tag);
      return e && e.progressEndOfDay != null ? e.progressEndOfDay : null;
    }).filter((v) => v != null);
    return { c, st, t, now, next, ends };
  });
  const scale = wk.colosseum
    ? niceMax(Math.max(1, ...rows.map((r) => Math.max(r.now, r.next || 0))))
    : Sim.RULES.finishLine;
  rows.sort((a, b) => (b.now - a.now) || ((b.next || 0) - (a.next || 0)));

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const p100 = (v) => (v * 100).toFixed(2);
  $('river').className = 'river';
  $('river').innerHTML = rows.map(({ c, st, t, now, next, ends }, idx) => {
    const x = clamp01(now / scale);
    const gx = next != null ? clamp01(next / scale) : x;
    const ghost = !m.training && next != null && gx - x > 0.004;
    // Tramos: uno por día cerrado (en coliseo, uno solo con las medallas de la semana)
    const pts = ends.length ? ends.slice() : [];
    if (!pts.length || pts[pts.length - 1] < now) pts.push(now);
    let prev = 0;
    const segs = pts.map((v, i) => {
      const a0 = clamp01(prev / scale), b0 = clamp01(v / scale);
      const day = ends.length && i < ends.length ? i + 1 : null;
      const html = b0 > a0 ? `<span class="day" style="left:${p100(a0)}%;width:${p100(b0 - a0)}%" title="${day ? `Día ${day}: +${fmt(v - prev)}` : fmt(v)}">${day && b0 - a0 > 0.07 ? `<span class="dlab">D${day}</span>` : ''}</span>` : '';
      prev = v;
      return html;
    }).join('');
    const ticks = wk.colosseum ? '' : [0.25, 0.5, 0.75].map((f) => `<span class="tick" style="left:${f * 100}%"></span>`).join('');
    let val;
    let sub;
    if (m.training) { val = '0'; sub = 'aún sin empezar'; }
    else if (!wk.colosseum && st.finished) { val = '¡Meta!'; sub = `${fmt(now)} de avance`; }
    else if (wk.colosseum) { val = fmt(now); sub = next != null ? `<em>+${fmt(next - now)}</em> hoy` : 'medallas'; }
    else { val = fmt(now); sub = t && t.expPoints != null ? `<em>+${fmt(t.expPoints)}</em> hoy` : `de ${fmt(scale)}`; }
    const aria = `${c.name}: ${m.training ? 'aún sin empezar' : `${fmt(now)}${wk.colosseum ? ' medallas' : ` de ${fmt(scale)}`}`}${ghost ? `, se espera llegar a ${fmt(next)} al cerrar hoy` : ''}`;
    const crown = idx === 0 && now > 0 ? '<svg class="ic crown" aria-hidden="true"><use href="#i-crown"/></svg>' : '';
    const label = wk.colosseum
      ? clanLabel(c)
      : `<span class="cn">${shield(c)}<span><span class="cname">${crown}${esc(c.name)}</span>${defsHtml(st)}</span></span>`;
    return `<div class="lane${c.tag === m.own ? ' own' : ''}" style="--c:${colorOf(c.tag)}" role="listitem" aria-label="${esc(aria)}">
      ${label}
      <div class="track" aria-hidden="true">${ticks}${segs}${ghost ? `<span class="exp" style="left:${p100(x)}%;width:${p100(gx - x)}%"></span>` : ''}${wk.colosseum ? '' : '<span class="goal"></span>'}</div>
      <div class="lval"><b>${val}</b><small>${sub}</small></div>
    </div>`;
  }).join('');
  $('river').setAttribute('role', 'list');

  $('riverSub').textContent = m.training
    ? 'Días de entrenamiento: la carrera empieza con el primer día de batalla.'
    : wk.colosseum
      ? 'En coliseo no hay meta: cuentan las medallas de toda la semana. La parte rayada es lo que se espera que sume cada clan al cerrar hoy.'
      : 'Cada día, el orden por medallas da puntos de avance y cada defensa del barco que sigue en pie suma un extra; gana quien llega antes a 10.000. Cada tramo es un día (D1, D2…) y la parte rayada, lo que se espera sumar al cerrar hoy.';
  const legend = ['<span><i class="lg"></i>Avance hasta ahora</span>'];
  if (!m.training) legend.push('<span><i class="lg exp"></i>Esperado al cerrar hoy</span>');
  if (!wk.colosseum) legend.push(`<span><i class="lg goal"></i>Meta: ${fmt(Sim.RULES.finishLine)} puntos de avance</span>`);
  legend.push('<span><svg class="ic crown"><use href="#i-crown"/></svg>Va primero</span>');
  if (wk.missingLogs && !wk.colosseum) legend.push('<span class="warn">Sin datos del avance de días anteriores</span>');
  $('riverLegend').innerHTML = legend.join('');
}

/* ---------- puntos de avance de hoy: puesto + defensas ---------- */
function renderPoints() {
  const m = state.model;
  const wk = Sim.weekProgress(m);
  $('figPoints').hidden = wk.colosseum;
  if (wk.colosseum) return;
  const moves = Sim.RULES.movement;
  const n = m.clans.length;
  const rows = m.clans.map((c) => ({ c, st: wk.clans[c.tag], t: today(c) }))
    .sort((a, b) => (b.st.progress - a.st.progress) || ((b.t ? b.t.expPoints : 0) - (a.t ? a.t.expPoints : 0)));

  $('ptsSub').textContent = m.training
    ? 'Lo que avanzará cada barco en cada día de batalla según el puesto en que quede por medallas, más lo que suman sus defensas en pie. La carrera aún no ha empezado.'
    : 'Lo que avanzará cada barco al cerrar el día: los puntos de su puesto por medallas más los de sus defensas en pie. Debajo de cada cifra, la probabilidad de quedar en ese puesto.';

  $('ptsTitle').textContent = m.training ? 'Puntos de avance por día' : 'Puntos de avance de hoy';
  const head = Array.from({ length: n }, (_, k) => `<th scope="col">${ord(k + 1)}<small>+${fmt(moves[k] || 0)}</small></th>`).join('');
  $('ptsTable').innerHTML = `<thead><tr><th scope="col">Clan</th><th scope="col">Defensas</th>${head}${m.training ? '' : '<th scope="col" style="text-align:right;padding-right:12px">Esperado hoy</th>'}</tr></thead>
    <tbody>${rows.map(({ c, st, t }) => {
      const bonus = st.finished ? 0 : (st.defenseBonus || 0);
      const best = t ? t.p.indexOf(Math.max(...t.p.slice(1))) : -1;
      const cells = Array.from({ length: n }, (_, i) => {
        const k = i + 1;
        const pts = st.finished ? 0 : (moves[i] || 0) + bonus;
        const p = t ? t.p[k] : null;
        const cls = ['pcell', p != null && k === best ? 'best' : '', p != null && p < 0.005 ? 'zero' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}" style="--p:${p == null ? 0 : p.toFixed(3)}" title="${esc(`${c.name} ${ord(k)}: ${fmt(moves[i] || 0)} del puesto + ${fmt(bonus)} de defensas`)}"><span class="pl">${ord(k)}</span><b>${st.finished ? '—' : fmt(pts)}</b>${p != null ? `<small>${pct(p)}</small>` : ''}</td>`;
      }).join('');
      const exp = st.finished
        ? '<b>¡Meta!</b><small>ya no suma</small>'
        : t && t.expPoints != null
          ? `<span class="pl">Esperado hoy</span><b>+${fmt(t.expPoints)}</b><small>quedará en ${fmt(st.progress + t.expPoints)}</small>`
          : `<b>—</b><small>${m.training ? 'la carrera aún no empieza' : 'sin previsión'}</small>`;
      const defs = st.defenses == null
        ? '<b>?</b>sin datos aún'
        : `<b>${st.defenses}${st.defenseSource === 'estimado' ? '*' : ''}<span class="dsuf"> defensas</span></b>+${fmt(bonus)} al día`;
      return `<tr style="--c:${colorOf(c.tag)}"><td class="clan">${clanLabel(c)}</td><td class="dcell">${defs}</td>${cells}${m.training ? '' : `<td class="ecell">${exp}</td>`}</tr>`;
    }).join('')}</tbody>`;

  const notes = ['Cada defensa en pie suma entre 59 y 5 puntos al cerrar el día: las primeras que se construyeron valen más. Con las 15 son 435.'];
  const anyReal = rows.some((r) => r.st.defenseSource === 'real');
  const anyEst = rows.some((r) => r.st.defenseSource === 'estimado');
  const anyNone = rows.some((r) => r.st.defenses == null);
  if (anyReal) notes.push('Las defensas son las que seguían en pie al cerrar ayer: se supone que hoy no cae ninguna más.');
  if (anyEst) notes.push('* Estimado con la semana anterior, porque las defensas se reponen cada semana. El dato real llega al cerrar el primer día de batalla.');
  if (anyNone) notes.push('Aún no hay datos de defensas de algunos clanes: se sabrán al cerrar el primer día de batalla.');
  $('ptsNotes').innerHTML = notes.map((x) => `<li>${esc(x)}</li>`).join('');
}

function versus(c, own, key) {
  if (!own || c.tag === own.tag || state.model.training) return null;
  const a = c[key], b = own[key];
  if (a.max < b.now) return { t: 'Ya no os alcanza hoy', cls: 'good' };
  if (a.now > b.max) return { t: 'Fuera de vuestro alcance hoy', cls: 'bad' };
  return null;
}

function renderRace() {
  const m = state.model;
  const key = m.colosseum ? state.view : 'day';
  $('viewSeg').hidden = !m.colosseum;
  $('viewSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === key)));
  $('raceTitle').textContent = key === 'week' ? 'Medallas de la semana' : 'Medallas de hoy';
  $('raceSub').textContent = m.colosseum
    ? 'En coliseo cuenta el total de la semana. Toca un clan para ver su detalle.'
    : 'El orden de hoy decide cuánto avanza cada barco al cerrar el día. Toca un clan para ver su detalle.';
  $('probHead').textContent = m.colosseum ? '1º al cerrar' : 'Gana el día';

  const own = m.clans.find((c) => c.tag === m.own);
  const clans = orderBy(key);
  const top = niceMax(Math.max(1, ...clans.map((c) => c[key].max)));
  const x = (v) => Math.max(0, Math.min(100, (v / top) * 100));

  $('ticks').innerHTML = m.training ? '' : [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${fmt(top * f)}</span>`).join('');

  $('race').innerHTML = clans.map((c, i) => {
    const v = viewVals(c, key);
    const t = today(c);
    const vs = versus(c, own, key);
    const isOwn = c.tag === m.own;
    const usable = c.usedTotal + c.remaining;
    const label = `${c.name}: ${fmt(v.now)} medallas, final esperado ${fmt(v.exp)}, ${plural(c.remaining, 'mazo pendiente', 'mazos pendientes')}${t ? `, ${pct(t.pWin)} de ganar el día` : ''}`;
    return `<button type="button" class="rrow grid-row" data-tag="${esc(c.tag)}" style="--c:${colorOf(c.tag)}" aria-pressed="${c.tag === state.selected}" aria-label="${esc(label)}">
      <span class="pos">${i + 1}</span>
      <span class="cn">${shield(c)}<span>
        <span class="cname">${esc(c.name)}</span>
        <span class="csub">${isOwn ? '<span class="own">Tu clan</span>' : esc(c.tag)}${c.finished ? ' <span class="fin">ha cruzado la meta</span>' : ''}</span>
        ${vs ? `<span class="vs ${vs.cls}">${vs.t}</span>` : ''}
      </span></span>
      <span class="bar-wrap">
        <span class="bar" aria-hidden="true">
          <i class="b-range" style="left:${x(v.now)}%;width:${x(v.max) - x(v.now)}%"></i>
          <i class="b-now" style="width:${x(v.now)}%"></i>
          ${v.exp != null && !m.training ? `<i class="b-proj" style="left:${x(v.exp)}%"></i>` : ''}
        </span>
        <span class="decks" title="Mazos jugados hoy: ${c.usedTotal} de ${usable}"><i style="width:${usable ? c.usedTotal / usable * 100 : 0}%"></i></span>
        <span class="dtext">${pct(usable ? c.usedTotal / usable : 0)} de mazos jugados, quedan ${c.remaining}</span>
      </span>
      <span class="nums">
        <span class="n">${fmt(v.now)}</span>
        ${m.training ? '' : `<span class="s">esperado <b>${v.exp != null ? fmt(v.exp) : '…'}</b></span>`}
      </span>
      <span class="prob ${t ? probClass(t.pWin) : 'p-lo'}">${ic('crown')}<b>${t ? pct(t.pWin) : m.training ? '—' : '…'}</b><small>${m.colosseum ? '1º al cerrar' : 'gana el día'}</small></span>
    </button>`;
  }).join('');

  const note = $('raceNote');
  note.hidden = !m.training;
  note.textContent = m.training ? 'Hoy es día de entrenamiento: las batallas solo dan oro. Los mazos pendientes sí se muestran.' : '';
}

function selectedClan() { const m = state.model; return m.clans.find((x) => x.tag === state.selected) || m.clans[0]; }

function dayTiles(c, vals, now, t, training) {
  const used = c.usedTotal;
  const usable = used + c.remaining;
  const inc = (v) => (now > 0 && v > now) ? `<span class="pc">+${Math.round((v - now) / now * 100)}\u00a0%</span>` : '';
  const expTxt = !t ? 'calculando…'
    : c.remaining ? `${signed(vals.exp - now)} con ~${fmt(t.expDecks)} de ${c.remaining} mazos (${pct(t.expDecks / c.remaining)}) a ${fmt(t.perDeck)} por mazo`
      : 'no quedan mazos por jugar';
  const meter = `<div class="meter"><i style="width:${usable ? used / usable * 100 : 0}%"></i></div>`;
  return `<div class="tiles t4">${[
    tile({ icon: 'cards', k: 'Mazos jugados', v: pct(usable ? used / usable : 0), d: `${used} de ${usable} posibles, quedan ${c.remaining}`, extra: meter }),
    tile({ icon: 'target', k: 'Final esperado', v: training ? '—' : t ? `${fmt(vals.exp)}${inc(vals.exp)}` : '…', d: training ? 'no aplica hoy' : expTxt, tone: 'amber' }),
    tile({ icon: 'medal', k: 'Si juegan y ganan todo', v: training ? '—' : `${fmt(vals.max)}${inc(vals.max)}`, d: training ? 'no aplica hoy' : `${c.remaining} mazos · máx. 900 por jugador (duelo solo con 3+ mazos)` }),
    tile({ icon: 'medal', k: 'Si juegan y pierden todo', v: training ? '—' : `${fmt(vals.min)}${inc(vals.min)}`, d: training ? 'no aplica hoy' : `${c.remaining} mazos a ${LOSS} medallas` }),
  ].join('')}</div>`;
}

function renderDetail() {
  const m = state.model;
  const c = selectedClan();
  const t = today(c);
  $('dShield').innerHTML = shield(c);
  $('dName').textContent = c.name;
  $('dTag').textContent = c.tag;
  $('dOwn').hidden = c.tag !== m.own;
  $('dSwitch').hidden = c.tag === m.own || !!state.locked;
  $('dHero').style.setProperty('--c', colorOf(c.tag));
  $('dNow').textContent = fmt(c.dayPoints);

  let avg;
  if (m.training) avg = 'Día de entrenamiento: las batallas no dan medallas.';
  else if (c.avg != null) avg = `Media de ${fmt(c.avg)} medallas por mazo en ${plural(c.usedTotal, 'mazo jugado', 'mazos jugados')}.`;
  else avg = 'Nadie ha jugado aún hoy.';
  $('dAvg').textContent = avg;
  $('dSide').innerHTML = t
    ? `<span class="prob ${probClass(t.pWin)}">${ic('crown')}<b>${pct(t.pWin)}</b><small>${m.colosseum ? '1º al cerrar' : 'gana el día'}</small></span>
       <span class="prob p-lo">${ic('flag')}<b>${dec(t.expectedRank)}</b><small>puesto esperado</small></span>`
    : '';

  $('dDay').innerHTML = `<div class="block-label">Hoy</div>${dayTiles(c, viewVals(c, 'day'), c.dayPoints, t, m.training)}`;
  $('dWeek').innerHTML = m.colosseum
    ? `<div class="block-label">Total de la semana de coliseo: ${fmt(c.fame)} medallas ahora</div>${dayTiles(c, viewVals(c, 'week'), c.fame, t, false)}`
    : '';

  const notes = [];
  if (c.capped) notes.push(`Quedan ${plural(c.pendingRaw, 'mazo', 'mazos')} en la lista, pero el tope diario de ${CAP_DECKS} mazos o ${CAP_PLAYERS} jugadores deja jugar solo ${c.remaining}.`);
  if (c.rosterMissing) notes.push('No se pudo leer la lista de miembros; se usan los participantes de la semana, que pueden incluir a gente que ya salió del clan.');
  if (c.aggregateOnly) notes.push('De este clan solo se conocen los totales (mazos y medallas), no su lista de jugadores: la previsión trata sus mazos pendientes como un bloque con un riesgo medio del 15 %.');
  if (t && !t.hasHistory && state.historyState === 'ok') notes.push('Este clan no tiene historial: la previsión usa un riesgo medio del 15 % por jugador.');
  $('dNotes').innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join('');
}

function riskChip(r, info) {
  if (r == null) return '<span class="risk r-na">…</span>';
  const flag = info && (!info.known || info.low);
  const tip = info && !info.known ? 'Sin historial: se usa la media del clan' : flag ? 'Pocas semanas de datos' : '';
  return `<span class="risk ${riskClass(r)}" title="${tip}">${pct(r)} riesgo${flag ? '*' : ''}</span>`;
}

function pendingWithRisk(c) {
  return c.pending.map((p) => ({ ...p, ...playerRisk(c.tag, p.tag) }))
    .sort((a, b) => ((b.risk || 0) - (a.risk || 0)) || (b.left - a.left) || String(a.name).localeCompare(String(b.name), 'es'));
}

function renderPending() {
  const c = selectedClan();
  const t = today(c);
  $('pTitle').textContent = c.tag === state.model.own ? 'Faltan por jugar' : `Faltan por jugar en ${c.name}`;
  $('copy').hidden = c.pending.length === 0 || !!c.aggregateOnly;
  if (c.aggregateOnly) {
    $('pSum').innerHTML = `Le quedan <b>${plural(c.remaining, 'mazo', 'mazos')}</b> de ${CAP_DECKS} por jugar hoy.${t && c.remaining ? ` Se esperan <b class="warn">~${fmt(t.expDecks)}</b>.` : ''}`;
    $('pList').innerHTML = '<li class="empty" style="display:block;border:0">De este clan solo hay datos de conjunto: su lista de jugadores no está disponible en esta foto.</li>';
    return;
  }
  if (!c.pending.length) {
    $('pSum').textContent = '';
    $('pList').innerHTML = '<li class="empty" style="display:block;border:0">¡Todo el clan ha jugado sus 4 mazos!</li>';
    return;
  }
  const list = pendingWithRisk(c);
  const high = list.filter((p) => p.risk != null && p.risk >= RISK_HI).length;
  let sum = `<b>${plural(c.pending.length, 'jugador', 'jugadores')}</b> con <b>${plural(c.pendingRaw, 'mazo', 'mazos')}</b> por jugar: ${c.fresh} sin empezar y ${c.started} a medias. `;
  if (t && c.remaining) sum += `Por su historial se esperan <b class="warn">~${fmt(t.expDecks)}</b> (${pct(t.expDecks / c.remaining)}). `;
  if (historyReady()) sum += high ? `<b class="bad">${high}</b> con riesgo alto de dejarse mazos.` : 'Nadie con riesgo alto.';
  $('pSum').innerHTML = sum;
  $('pList').innerHTML = list.map((p) => {
    const pips = Array.from({ length: DECKS }, (_, i) => `<i class="pip${i < p.used ? ' used' : ''}"></i>`).join('');
    return `<li><span class="pname" title="${esc(p.tag)}">${esc(p.name)}</span><span class="pips" aria-label="${p.used} de ${DECKS} mazos jugados">${pips}</span><span class="left">${p.left === 1 ? 'queda 1' : `quedan ${p.left}`}</span>${riskChip(p.risk, p)}</li>`;
  }).join('');
}

/* =========================================================
 * JUGADORES
 * ========================================================= */
function renderPlayers() {
  setPdfButton($('plPdf'), `api/players.pdf?${kickQuery()}`);
  const m = state.model;
  if (!state.plClan || !m.clans.some((c) => c.tag === state.plClan)) state.plClan = state.selected || m.own;
  $('plClan').innerHTML = m.clans.map((c) => `<option value="${esc(c.tag)}"${c.tag === state.plClan ? ' selected' : ''}>${esc(c.name)}${c.tag === m.own ? ' (tu clan)' : ''}</option>`).join('');

  const c = m.clans.find((x) => x.tag === state.plClan);
  const rel = relOf(c.tag);
  if (!historyReady()) {
    $('plKpis').innerHTML = '';
    $('plTable').innerHTML = '<tbody><tr><td class="muted">Cargando el historial…</td></tr></tbody>';
    return;
  }
  if (!rel || !rel.clan.hasData) {
    $('plKpis').innerHTML = '';
    $('plTable').innerHTML = '<tbody><tr><td class="muted">No hay historial de este clan: no se puede calcular la fiabilidad de sus jugadores.</td></tr></tbody>';
    return;
  }

  // Miembros actuales + lo que llevan hoy + su historial
  const todayUsed = new Map(c.pending.map((p) => [p.tag, p.used]));
  const rows = rosterOf(c.tag).map((mb) => {
    const p = rel.players.get(mb.tag);
    return {
      tag: mb.tag, name: mb.name,
      used: todayUsed.has(mb.tag) ? todayUsed.get(mb.tag) : DECKS,
      weeks: p ? p.weeks : 0,
      part: p ? p.participation : null,
      dayMiss: p ? p.rawDayRisk : null,
      weekMiss: p ? p.weekMissRate : null,
      risk: rel.riskFor(mb.tag),
      low: p ? p.lowData : true, known: !!p,
    };
  });

  const reliable = rows.filter((r) => r.risk < RISK_MID).length;
  const risky = rows.filter((r) => r.risk >= RISK_HI).length;
  $('plKpis').innerHTML = [
    tile({ icon: 'cards', k: 'Mazos jugados', v: pct(rel.clan.participation), d: 'media del clan en guerra', tone: 'green' }),
    tile({ icon: 'alert', k: 'Días con fallos', v: pct(rel.clan.dayRisk), d: 'días en que alguien se dejó mazos' }),
    tile({ icon: 'users', k: 'Jugadores fiables', v: `${reliable}<small> de ${rows.length}</small>`, d: `riesgo por debajo del ${Math.round(RISK_MID * 100)}\u00a0%`, tone: 'green' }),
    tile({ icon: 'alert', k: 'Riesgo alto', v: `${risky}<small> de ${rows.length}</small>`, d: `más del ${Math.round(RISK_HI * 100)}\u00a0% de dejarse mazos`, tone: risky ? 'red' : '' }),
  ].join('');

  const { key, dir } = state.plSort;
  const val = (r) => (key === 'name' ? String(r.name).toLowerCase() : r[key] == null ? -1 : r[key]);
  rows.sort((a, b) => ((val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir) || String(a.name).localeCompare(String(b.name), 'es'));

  const cols = [
    ['name', 'Jugador'], ['used', 'Hoy'], ['weeks', 'Semanas'], ['part', 'Mazos jugados'],
    ['dayMiss', 'Días con fallos'], ['weekMiss', 'Semanas con fallos'], ['risk', 'Riesgo hoy'],
  ];
  const requested = (state.history && state.history.weeksRequested) || 10;
  $('plTable').innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th scope="col"${k === key ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${k}">${l}${k === key ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => {
      const pips = Array.from({ length: DECKS }, (_, i) => `<i class="pip${i < r.used ? ' used' : ''}"></i>`).join('');
      return `<tr>
        <td title="${esc(r.tag)}">${esc(r.name)}${!r.known ? '<span class="lowd">nuevo</span>' : r.low ? '<span class="lowd">pocos datos</span>' : ''}</td>
        <td><span class="pips">${pips}</span></td>
        <td>${r.weeks}<span class="muted"> / ${requested}</span></td>
        <td>${r.part == null ? '—' : pct(r.part)}<span class="minibar"><i style="width:${(r.part || 0) * 100}%"></i></span></td>
        <td>${r.dayMiss == null ? '—' : pct(r.dayMiss)}</td>
        <td>${r.weekMiss == null ? '—' : pct(r.weekMiss)}</td>
        <td>${riskChip(r.risk, r)}</td>
      </tr>`;
    }).join('')}</tbody>`;
}

/* =========================================================
 * SIMULACIÓN
 * ========================================================= */
function simOptions() {
  return {
    runs: 500000,                    // fijas; se hacen por tandas con barra de progreso
    dayCv: Sim.MODEL.futureDayCv,     // fija: la variabilidad real del clan
    // recency sin indicar: las semanas pesan 1 · 0,9 … 0,1 (la más reciente, 1)
    weekType: $('simType').value,
  };
}

function renderSimState() {
  const m = state.model;
  $('simTypeBox').hidden = !m.training;
  let t;
  if (m.training) t = 'La carrera aún no ha empezado: se simulan los 4 días de batalla con el historial de cada clan. Si esta es la última semana de la temporada, elige «Coliseo».';
  else {
    const d = Math.max(1, (((m.race.periodIndex || 0) % 7) + 7) % 7 - 2);
    t = `Día de batalla ${d} de 4. ${d > 1 ? 'Los días ya jugados cuentan con su resultado real. ' : ''}Hoy parte de las medallas actuales y de los mazos pendientes${d < 4 ? `, y se simula${4 - d === 1 ? ' el día que falta' : `n los ${4 - d} días que faltan`}` : ''}.`;
  }
  $('simState').textContent = t;
}

function openSim() {
  renderSimState();
  if (state.historyState === 'loading' || state.historyState === 'idle') { setMsg($('simMsg'), 'Descargando el historial de los 5 clanes…', ''); return; }
  if (state.historyState === 'error') {
    setMsg($('simMsg'), `${state.historyError || 'No se pudo descargar el historial'}. Sin historial no se puede simular.`, 'err',
      { label: 'Reintentar', fn: () => { state.historyKey = null; ensureHistory(); } });
    return;
  }
  if (!state.sim) runSim();
}

// 500.000 simulaciones por tandas de 25.000, dejando respirar al navegador y mostrando el progreso
async function runSim() {
  if (!state.model || state.historyState !== 'ok' || state.simBusy) return;
  const opts = simOptions();
  const CHUNK = 25000;
  const prog = (f) => {
    const v = Math.round(f * 100);
    $('simProgBar').style.width = `${v}%`;
    $('simProgTxt').textContent = f >= 1 ? 'Calculando resultados…' : `Simulando… ${v} % (${fmt(Math.round(f * opts.runs))} de ${fmt(opts.runs)})`;
    $('simProg').setAttribute('aria-valuenow', String(v));
  };
  let res;
  state.simBusy = true;
  $('simRun').disabled = true;
  $('simProg').hidden = false;
  prog(0);
  try {
    const inputs = Sim.buildInputs(state.model, state.history, opts);
    const t0 = performance.now();
    const parts = [];
    const n = Math.ceil(opts.runs / CHUNK);
    const seed0 = (Date.now() % 1e9) | 0;
    for (let k = 0; k < n; k++) {
      parts.push(Sim.run(inputs, Object.assign({}, opts, { runs: Math.min(CHUNK, opts.runs - k * CHUNK), seed: seed0 + k * 7919 })));
      prog((k + 1) / n);
      await new Promise((r) => setTimeout(r, 0));
    }
    res = Sim.mergeRuns(parts);
    res.ms = performance.now() - t0;
    res.inputs = inputs;
    res.at = state.model.fetchedAt;
  } catch (e) {
    setMsg($('simMsg'), e.message, 'err');
    $('simOut').hidden = true;
    return;
  } finally {
    state.simBusy = false;
    $('simRun').disabled = false;
    $('simProg').hidden = true;
  }
  state.sim = res;
  const warn = [];
  const fallback = res.clans.filter((c) => c.usedFallback).map((c) => c.name);
  if (fallback.length) warn.push(`Sin historial para ${fallback.join(', ')}: se usa el de los demás clanes de la carrera.`);
  if (res.inputs.missingLogs) warn.push('La API no ha devuelto el registro de los días ya jugados; esos días se simulan desde cero.');
  setMsg($('simMsg'), warn.join(' '), '');
  renderSim(res);
}

function renderSim(res) {
  const n = res.clans.length;
  const own = res.clans.find((c) => c.own) || res.clans[0];
  const rival = res.clans.filter((c) => !c.own).sort((a, b) => b.p[1] - a.p[1])[0];
  const what = res.colosseum ? 'la semana de coliseo' : 'la carrera';
  const clanOf = (tag) => state.model.clans.find((c) => c.tag === tag) || { tag, name: tag };

  $('simOut').hidden = false;
  $('simBig').textContent = pct(own.p[1]);
  $('simCapTitle').textContent = `probabilidad de que ${own.name} gane ${what}`;
  $('simCapSub').textContent = `${fmt(res.runs)} simulaciones en ${dec(res.ms / 1000, 2)} s, con los datos de las ${new Date(res.at || Date.now()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`;

  $('simKpis').innerHTML = [
    tile({ icon: 'crown', k: 'Top 2', v: pct(own.p[1] + (own.p[2] || 0)), d: 'acabar 1º o 2º', tone: 'green' }),
    tile({ icon: 'alert', k: 'Último puesto', v: pct(own.p[n]), d: `acabar ${ord(n)}` }),
    tile({ icon: 'flag', k: 'Puesto esperado', v: dec(own.expectedRank), d: 'media de todas las simulaciones' }),
    tile({ icon: 'medal', k: 'Medallas esperadas', v: fmt(own.medals.mean), d: `entre ${fmt(own.medals.p10)} y ${fmt(own.medals.p90)}`, tone: 'amber' }),
    tile({ icon: 'swords', k: 'Rival más peligroso', v: rival ? pct(rival.p[1]) : '—', d: rival ? `de que gane ${esc(rival.name)}` : '', tone: 'clan', style: rival ? `--c:${colorOf(rival.tag)}` : '' }),
  ].join('');

  const sorted = [...res.clans].sort((a, b) => a.expectedRank - b.expectedRank);

  $('simDist').innerHTML = sorted.map((c) => {
    const segs = [];
    for (let k = 1; k <= n; k++) {
      const p = c.p[k];
      if (p <= 0) continue;
      segs.push(`<i class="r${Math.min(k, 5)}" style="width:${p * 100}%" title="${ord(k)}: ${pct(p)}">${p >= 0.09 ? `${ord(k)} ${Math.round(p * 100)}%` : ''}</i>`);
    }
    const aria = `${c.name}: ` + Array.from({ length: n }, (_, i) => `${ord(i + 1)} ${pct(c.p[i + 1])}`).join(', ');
    return `<div class="drow${c.own ? ' own' : ''}" role="img" aria-label="${esc(aria)}">
      ${clanLabel(clanOf(c.tag))}<span class="stack">${segs.join('')}</span>
      <span class="exp"><b>${pct(c.p[1])}</b>gana</span>
    </div>`;
  }).join('');
  $('simLegend').innerHTML = Array.from({ length: n }, (_, i) => `<span><i class="sw r${Math.min(i + 1, 5)}"></i>${ord(i + 1)} puesto</span>`).join('');

  // Escala con números redondos: 4 tramos iguales que cubren todas las franjas
  const rawHi = Math.max(1, ...res.clans.map((c) => c.medals.p90));
  const rawLo = Math.max(0, Math.min(...res.clans.map((c) => c.medals.p10)));
  let step = niceMax(Math.max(1, (rawHi - rawLo) / 4));
  let lo = Math.floor(rawLo / step) * step;
  if (lo + step * 4 < rawHi) { step = niceMax((rawHi - lo) / 4); lo = Math.floor(rawLo / step) * step; }
  const hi = lo + step * 4;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const byScore = [...res.clans].sort((a, b) => b.medals.mean - a.medals.mean);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${fmt(lo + (hi - lo) * f)}</span>`).join('');
  $('simScore').innerHTML = `<div class="drow axis" aria-hidden="true"><span></span><div class="ticks">${ticks}</div><span></span></div>` +
    byScore.map((c) => `<div class="drow${c.own ? ' own' : ''}" style="--c:${colorOf(c.tag)}" role="img" aria-label="${esc(`${c.name}: ${fmt(c.medals.mean)} medallas esperadas, entre ${fmt(c.medals.p10)} y ${fmt(c.medals.p90)}`)}">
      ${clanLabel(clanOf(c.tag))}
      <span class="pband" title="Pesimista ${fmt(c.medals.p10)}, optimista ${fmt(c.medals.p90)}">
        <i class="band" style="left:${x(c.medals.p10)}%;width:${x(c.medals.p90) - x(c.medals.p10)}%"></i>
        <i class="mean" style="left:${x(c.medals.mean)}%"></i>
      </span>
      <span class="exp"><b>${fmt(c.medals.mean)}</b>esperadas</span>
    </div>`).join('');

  const withProgress = !res.colosseum;
  $('simTable').innerHTML = `<thead><tr>
      <th scope="col">Clan</th><th scope="col">Gana</th><th scope="col">Top 2</th><th scope="col">Último</th>
      <th scope="col">Puesto esperado</th>${withProgress ? '<th scope="col">Avance final</th><th scope="col">Cruza la meta</th>' : ''}<th scope="col">Medallas esperadas</th><th scope="col">Pesimista</th><th scope="col">Optimista</th>
    </tr></thead><tbody>${sorted.map((c) => `<tr class="${c.own ? 'own' : ''}">
      <td title="${esc(c.tag)}">${esc(c.name)}</td><td>${pct(c.p[1])}</td><td>${pct(c.p[1] + (c.p[2] || 0))}</td><td>${pct(c.p[n])}</td>
      <td>${dec(c.expectedRank)}</td>${withProgress ? `<td>${fmt(c.progress.mean)}</td><td>${pct(c.pFinish)}</td>` : ''}<td>${fmt(c.medals.mean)}</td><td class="muted">${fmt(c.medals.p10)}</td><td class="muted">${fmt(c.medals.p90)}</td>
    </tr>`).join('')}</tbody>`;
}

function sparkline(values) {
  if (values.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 29 - ((v - min) / span) * 26]);
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.map((p) => p.map((q) => q.toFixed(1)).join(',')).join(' ')}"></polyline>
    <circle cx="${last[0]}" cy="${last[1]}" r="1.8"></circle></svg>`;
}

function renderHistory() {
  const m = state.model;
  const h = state.history;
  if (!h) { $('hist').innerHTML = ''; return; }
  const rows = m.clans.map((c) => {
    const entry = h.clans ? h.clans[c.tag] : null;
    const weeks = Sim.prepareHistory(entry && entry.weeks);
    const avg = weeks.length ? weeks.reduce((s, w) => s + w.daily, 0) / weeks.length : null;
    const wins = weeks.filter((w) => w.rank === 1).length;
    const rel = relOf(c.tag);
    return { c, weeks, avg, wins, part: rel ? rel.clan.participation : null, error: entry && entry.error };
  }).sort((a, b) => (b.avg || 0) - (a.avg || 0));

  const requested = h.weeksRequested || 10;
  $('hist').innerHTML = `<div class="hrow head"><span>Clan</span><span>Media por día</span><span>Semanas 1º</span><span>Mazos jugados</span><span>Medallas por semana</span><span>Puestos</span></div>` +
    rows.map(({ c, weeks, avg, wins, part, error }) => {
      const chrono = [...weeks].reverse();
      const ranks = chrono.map((w) => {
        const tip = `Temporada ${w.seasonId}, semana ${(w.sectionIndex || 0) + 1}${w.colosseum ? ' (coliseo)' : ''}: ${fmt(w.medals)} medallas, ${ord(w.rank)}`;
        return `<span class="rk r${Math.min(w.rank || 5, 5)}${w.colosseum ? ' col' : ''}" title="${esc(tip)}">${w.rank || '?'}</span>`;
      }).join('');
      return `<div class="hrow" style="--c:${colorOf(c.tag)}">
        ${clanLabel(c)}
        <span class="stat h-avg">${fmt(avg)}<small>${error ? 'sin historial' : `${weeks.length} de ${requested} semanas`}</small></span>
        <span class="stat h-top">${weeks.length ? pct(wins / weeks.length) : '—'}<small>${wins} de ${weeks.length}</small></span>
        <span class="stat h-part">${part == null ? '—' : pct(part)}<small>de sus mazos</small></span>
        ${sparkline(chrono.map((w) => w.medals))}
        <span class="ranks">${ranks || '<span class="rk none">–</span>'}</span>
      </div>`;
    }).join('');
}

/* =========================================================
 * BÚSQUEDA DE CLANES
 * ========================================================= */
function looksLikeTag(raw) {
  const s = String(raw).trim();
  if (s.startsWith('#')) return TAG_RE.test(normTag(s));
  // Sin #: solo si parece un tag (letras del alfabeto de tags, con algún número y 6+ caracteres)
  return /^[0-9A-Za-z]{6,12}$/.test(s) && /\d/.test(s) && TAG_RE.test(normTag(s));
}

// Color estable para clanes que aún no están en la carrera (resultados, recientes)
function hashColor(tag) {
  let h = 0;
  for (const ch of String(tag)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLAN_VARS[h % CLAN_VARS.length];
}
const miniShield = (tag, name) => shield({ tag, name }).replace(/style="color:[^"]*"/, `style="color:${hashColor(tag)}"`);
const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...Array.from(cc).map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65)) + ' ' : '');

function hideResults() { $('results').hidden = true; $('results').innerHTML = ''; }

async function searchClans(q) {
  const box = $('results');
  box.hidden = false;
  box.innerHTML = '<div class="rempty">Buscando…</div>';
  $('go').setAttribute('aria-busy', 'true');
  let items;
  try {
    items = CFG.demoOnly ? window.CWDemo.search(q).items : (await getJson(`api/search?q=${encodeURIComponent(q)}`)).items;
  } catch (e) {
    box.innerHTML = `<div class="rempty">${esc(e instanceof TypeError ? 'No hay conexión con el servidor del monitor.' : e.message)}</div>`;
    return;
  } finally {
    $('go').removeAttribute('aria-busy');
  }
  if (!items.length) { box.innerHTML = `<div class="rempty">No hay clanes con «${esc(q)}» en el nombre. Prueba con otra parte del nombre o con su tag.</div>`; return; }
  box.innerHTML = `<div class="rhead">${items.length} ${items.length === 1 ? 'clan' : 'clanes'} con «${esc(q)}»${CFG.demoOnly ? ' (inventados: esto es una demo)' : ''}</div>` +
    items.map((c) => `<button type="button" class="ritem" role="option" data-tag="${esc(c.tag)}" data-name="${esc(c.name)}">
      <span class="cn">${miniShield(c.tag, c.name)}<span><span class="cname">${esc(c.name)}</span><span class="csub">${esc(c.tag)}${c.location ? `, ${flag(c.countryCode)}${esc(c.location)}` : ''}</span></span></span>
      <span class="rmeta"><b>${ic('crown')}${fmt(c.clanWarTrophies || 0)}</b>${c.members != null ? `${c.members}/50 miembros` : ''}</span>
    </button>`).join('');
}

function openClan({ tag, name }) {
  hideResults();
  $('tag').value = '';
  if (CFG.demoOnly) {
    runDemo(state.demo || 'guerra', seedFrom(tag), name || null);
    addRecent({ tag, name: name || state.model.clans.find((c) => c.tag === state.model.own).name });
    return;
  }
  load(normTag(tag));
}

function recents() { try { return JSON.parse(localStorage.getItem('cw:recent') || '[]').slice(0, 6); } catch { return []; } }
function addRecent(c) {
  const list = [c, ...recents().filter((r) => r.tag !== c.tag)].slice(0, 6);
  try { localStorage.setItem('cw:recent', JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  const list = recents();
  $('recent').hidden = !list.length || !!state.locked;
  $('recent').innerHTML = list.length
    ? `<span>Recientes:</span>${list.map((r) => `<button type="button" class="rchip" data-tag="${esc(r.tag)}" data-name="${esc(r.name || '')}">${miniShield(r.tag, r.name || r.tag)}${esc(r.name || r.tag)}</button>`).join('')}`
    : '';
}

/* =========================================================
 * CANDIDATOS A EXPULSIÓN
 * ========================================================= */
const VERDICT = {
  expulsar: { label: 'Expulsar', icon: 'userx' },
  vigilar: { label: 'Vigilar', icon: 'alert' },
  bien: { label: 'Bien', icon: 'users' },
  nuevo: { label: 'Sin evaluar', icon: 'clock' },
};
const DAY_ORDER = [4, 3, 0, 2, 1]; // de mejor a peor con los coeficientes por defecto
const sdec = (n, d = 2) => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n).toFixed(d).replace('.', ',');

function kickSummary(counts) {
  const parts = [];
  if (counts[4]) parts.push(`${counts[4]} ${counts[4] === 1 ? 'completo' : 'completos'}`);
  if (counts[3]) parts.push(`${counts[3]} con 3 mazos`);
  if (counts[1] + counts[2]) parts.push(`${counts[1] + counts[2]} a medias (1-2)`);
  if (counts[0]) parts.push(`${counts[0]} sin jugar`);
  return parts.join(', ') || 'sin días';
}

// Enlaces a los PDF de jugadores con los ajustes de expulsión que se ven en la web
const pdfOn = () => !!state.demo || !!(state.conf && state.conf.pdf);
// ¿El clan que se ve es el de casa? (los PDF y el informe de las 08:00 son solo suyos)
const isHomeClan = () => !!state.demo || !!(state.conf && state.conf.homeTag && normTag(state.conf.homeTag) === state.tag);
// Botón de PDF: activo para el clan de casa, «bloqueado» para los demás
function setPdfButton(el, href) {
  if (!el) return;
  el.hidden = !pdfOn();
  const home = isHomeClan();
  el.classList.toggle('locked', !home);
  if (home) { el.href = href; el.removeAttribute('aria-disabled'); el.removeAttribute('title'); }
  else { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); el.title = 'Por ahora los PDF solo están disponibles para Furia Ibérica'; }
}
function kickQuery(tag) {
  const k = state.kick;
  const q = new URLSearchParams({ weeks: k.weeks, medal: k.medal, target: k.target, thr: k.thr, coef: k.coef.join(',') });
  if (tag) q.set('tag', tag);
  return q.toString();
}

function renderKick() {
  const m = state.model;
  if (!state.kickClan || !m.clans.some((c) => c.tag === state.kickClan)) state.kickClan = m.own;
  $('kClan').innerHTML = m.clans.map((c) => `<option value="${esc(c.tag)}"${c.tag === state.kickClan ? ' selected' : ''}>${esc(c.name)}${c.tag === m.own ? ' (tu clan)' : ''}</option>`).join('');

  const k = state.kick;
  $('kCoefs').querySelectorAll('input[data-k]').forEach((inp) => {
    if (document.activeElement !== inp) inp.value = String(k.coef[+inp.dataset.k]);
  });
  $('kMedal').value = k.medal; $('kMedalOut').textContent = `×${dec(k.medal, k.medal % 1 ? 2 : 0)}`;
  $('kThr').value = k.thr; $('kThrOut').textContent = sdec(k.thr, 1).replace(/^\+/, '');
  if (document.activeElement !== $('kTarget')) $('kTarget').value = k.target;
  $('kFormula').innerHTML = `<b>Nota</b> = media de los mazos de cada día <em>+ ${dec(k.medal, k.medal % 1 ? 2 : 0)} × (0,5 + (medallas/semana − ${fmt(k.target)}) × 0,001)</em><br>` +
    `Expulsar por debajo de <b>${sdec(k.thr, 1).replace(/^\+/, '')}</b> · vigilar hasta <b>${sdec(k.thr + Sim.KICK.watchMargin, 1).replace(/^\+/, '')}</b> · bien por encima · hacen falta ${Sim.KICK.minWeeks} semanas con datos`;
  $('kLegend').innerHTML = DAY_ORDER.map((d) => `<span><i class="sw d${d}"></i>${d} ${d === 1 ? 'mazo' : 'mazos'} (${sdec(k.coef[d], Number.isInteger(k.coef[d]) ? 0 : Number.isInteger(k.coef[d] * 10) ? 1 : 2)})</span>`).join('');

  if (!historyReady()) {
    $('kTiles').innerHTML = ''; $('kNotes').innerHTML = '';
    $('kList').innerHTML = '<p class="rempty">Cargando el historial…</p>';
    return;
  }
  const entry = state.history && state.history.clans ? state.history.clans[state.kickClan] : null;
  const weeks = Sim.prepareHistory(entry && entry.weeks);
  if (!weeks.length) {
    $('kTiles').innerHTML = ''; $('kNotes').innerHTML = '';
    $('kList').innerHTML = '<p class="rempty">No hay historial de este clan: no se puede calcular.</p>';
    return;
  }
  const maxW = Math.max(1, Math.min(weeks.length, (state.history && state.history.weeksRequested) || 10));
  const nW = Math.min(k.weeks, maxW);
  $('kWeeks').max = maxW; $('kWeeks').value = nW;
  $('kWeeksOut').textContent = nW === 1 ? '1 semana' : `${nW} semanas`;

  const rep = Sim.kickReport(weeks, rosterOf(state.kickClan), { weeks: nW, medalWeight: k.medal, medalTarget: k.target, threshold: k.thr, coef: k.coef });
  const ownPdf = pdfOn() && isHomeClan() && state.kickClan === m.own; // los PDF son del clan de casa
  setPdfButton($('kPdf'), `api/players.pdf?${kickQuery()}`);
  if (state.kickClan !== m.own) $('kPdf').hidden = true;
  if (!rep.rows.length) {
    $('kTiles').innerHTML = ''; $('kNotes').innerHTML = '';
    $('kList').innerHTML = '<p class="rempty">No hay datos de los jugadores de este clan: no se puede calcular.</p>';
    return;
  }
  const count = (v) => rep.rows.filter((r) => r.verdict === v).length;
  $('kTiles').innerHTML = [
    tile({ icon: 'userx', k: 'Expulsar', v: String(count('expulsar')), d: `nota por debajo de ${sdec(k.thr, 1).replace(/^\+/, '')}`, tone: count('expulsar') ? 'red' : '' }),
    tile({ icon: 'alert', k: 'Vigilar', v: String(count('vigilar')), d: 'cerca del límite', tone: count('vigilar') ? 'amber' : '' }),
    tile({ icon: 'users', k: 'Bien', v: String(count('bien')), d: 'cumplen de sobra', tone: 'green' }),
    tile({ icon: 'clock', k: 'Sin evaluar', v: String(count('nuevo')), d: `menos de ${Sim.KICK.minWeeks} semanas con datos` }),
  ].join('');

  // Una línea por jugador; el detalle va al tooltip y a la ficha PDF
  const row = (r) => {
    const v = VERDICT[r.verdict];
    const total = r.days || 1;
    const segs = DAY_ORDER.map((d) => (r.counts[d] ? `<i class="d${d}" style="width:${(r.counts[d] / total) * 100}%"></i>` : '')).join('');
    const est = r.exactShare != null && r.exactShare < 1 ? ` · ${r.exactShare === 0 ? 'estimado' : `${pct(1 - r.exactShare)} estimado`}` : '';
    const tip = `${r.days} días en ${r.weeks} ${r.weeks === 1 ? 'semana' : 'semanas'}${est}`;
    const scoreTip = r.score == null ? 'pocos datos' : `mazos ${sdec(r.deckScore)}, medallas ${sdec(r.medalScore)}`;
    const pdf = ownPdf ? `<a class="kpdf" href="api/player.pdf?${esc(kickQuery(r.tag))}" target="_blank" rel="noopener" title="Ficha PDF de ${esc(r.name)}" aria-label="Ficha PDF de ${esc(r.name)}"><svg class="ic"><use href="#i-download"/></svg></a>` : '';
    return `<div class="krow v-${r.verdict}">
      <div class="kv"><span class="verdict ${r.verdict}">${ic(v.icon)}${v.label}</span></div>
      <div class="kname"><span class="cname" title="${esc(tip)}">${esc(r.name)}</span>${pdf}</div>
      <div class="kdays"><span class="dbar" title="${esc(kickSummary(r.counts))}" aria-label="${esc(kickSummary(r.counts))}">${segs}</span></div>
      <div class="kmed"><b>${r.medalsPerWeek != null ? fmt(r.medalsPerWeek) : '—'}</b><small>medallas/sem.</small></div>
      <div class="kscore" title="${esc(scoreTip)}"><b>${r.score == null ? '—' : sdec(r.score).replace(/^\+/, '')}</b></div>
    </div>`;
  };
  const flagged = rep.rows.filter((r) => r.verdict === 'expulsar' || r.verdict === 'vigilar');
  const fine = rep.rows.filter((r) => r.verdict === 'bien');
  const fresh = rep.rows.filter((r) => r.verdict === 'nuevo');
  $('kList').innerHTML = (flagged.length ? flagged.map(row).join('') : '<p class="rempty">Nadie por debajo de la nota ni en zona de vigilancia.</p>')
    + (fine.length ? `<details class="kmore"><summary>Ver los ${fine.length} que están bien</summary>${fine.map(row).join('')}</details>` : '')
    + (fresh.length ? `<details class="kmore"><summary>Sin evaluar: ${fresh.length} con pocos datos</summary>${fresh.map(row).join('')}</details>` : '');

  const notes = [`Se tienen en cuenta las ${nW === 1 ? 'última semana' : `${nW} últimas semanas`} ya terminadas; la semana en curso cuenta cuando acaba.`];
  if (rep.exactWeeks < rep.weeksUsed) {
    notes.push(CFG.demoOnly
      ? `En esta demo, ${rep.exactWeeks} de las ${rep.weeksUsed} semanas tienen registro diario con los mazos reales de cada día; el resto se estima.`
      : `${rep.weeksUsed - rep.exactWeeks} de ${rep.weeksUsed} semanas se estiman: la API solo da el total semanal, así que se reparte en días completos (13 mazos = 4+4+4+1). Con el registro diario del servidor (TRACK_CLANS) se usan los mazos reales de cada día.`);
  } else {
    notes.push('Todas las semanas usan los mazos reales de cada día (registro diario).');
  }
  if (entry && entry.daily && entry.daily.since) notes.push(`Registro diario activo desde el ${new Date(entry.daily.since).toLocaleDateString('es-ES')}.`);
  notes.push(`Quien tenga menos de ${Sim.KICK.minWeeks} semanas con datos en el periodo sale como «sin evaluar». Si un clan cruzó la meta antes del último día, esos días no cuentan.`);
  $('kNotes').innerHTML = notes.map((x) => `<li>${esc(x)}</li>`).join('');
}

function kickInput() {
  const k = state.kick;
  k.weeks = Number($('kWeeks').value);
  k.medal = Number($('kMedal').value);
  const tg = Number($('kTarget').value);
  if (isFinite(tg) && tg >= 0 && tg <= 6000) k.target = Math.round(tg);
  k.thr = Math.round(Number($('kThr').value) * 10) / 10;
  $('kCoefs').querySelectorAll('input[data-k]').forEach((inp) => {
    const v = parseFloat(String(inp.value).replace(',', '.'));
    if (isFinite(v)) k.coef[+inp.dataset.k] = v;
  });
  saveKickPrefs();
  renderKick();
}

/* =========================================================
 * DATOS
 * ========================================================= */
function accept(payload) {
  state.lastPayload = payload;
  state.model = buildModel(payload);
  assignColors(state.model);
  if (!state.model.clans.some((c) => c.tag === state.selected)) state.selected = state.model.own;
  if (!state.model.colosseum) state.view = 'day';
  else if (!state.viewByUser) state.view = 'week';
  if (state.historyKey !== historyKeyNow()) { state.historyState = 'idle'; state.rels = {}; state.history = null; }
  else if (state.historyState === 'ok') computeRels();
  computeToday();
  render();
  const t = new Date(payload.fetchedAt || Date.now()).toLocaleTimeString('es-ES');
  setLed('on', state.demo ? (CFG.snapshot ? `foto ${CFG.snapshot.time}` : 'demo') : `actualizado ${t}`);
  ensureHistory();
}

function ensureHistory() {
  const key = historyKeyNow();
  if (!key || state.historyKey === key) return;
  state.historyKey = key;
  state.history = null; state.sim = null; state.rels = {};
  $('simOut').hidden = true;
  $('hist').innerHTML = '';

  if (state.demo) { onHistory(window.CWDemo.history(state.demo, state.demoSeed, state.demoName), key); return; }

  state.historyState = 'loading';
  renderChips();
  getJson(`api/history/${encodeURIComponent(state.tag)}`)
    .then((h) => onHistory(h, key))
    .catch((e) => {
      if (state.historyKey !== key) return;
      state.historyState = 'error';
      state.historyError = e instanceof TypeError ? 'No hay conexión con el servidor del monitor' : e.message.replace(/\.$/, '');
      computeToday();
      render();
    });
}

function onHistory(h, key) {
  if (state.historyKey !== key) return; // llegó tarde: el usuario ya cambió de clan
  state.history = h;
  state.historyState = 'ok';
  setMsg($('simMsg'), null);
  computeRels();
  computeToday();
  render();
  renderHistory();
}

async function load(tag, quiet = false) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) { $('go').disabled = true; $('go').setAttribute('aria-busy', 'true'); }
  try {
    const body = await getJson(`api/war/${encodeURIComponent(tag)}`);
    if (state.tag !== tag) { state.selected = null; state.plClan = null; state.kickClan = null; state.viewByUser = false; }
    state.demo = null;
    state.tag = tag;
    accept(body);
    loadNews(tag);
    setMsg($('msg'), null);
    hideResults();
    if (!state.locked) {
      store('cw:lastTag', tag);
      setUrl({ tag });
      const own = state.model.clans.find((c) => c.tag === state.model.own);
      if (own) addRecent({ tag: own.tag, name: own.name });
    }
  } catch (e) {
    const offline = e instanceof TypeError;
    setMsg($('msg'), offline
      ? 'No hay conexión con el servidor del monitor. Si has abierto el archivo directamente, arranca server.js o prueba la demo.'
      : e.message, 'err', offline ? { label: 'Ver la demo', fn: () => runDemo('guerra') } : null);
    setLed('warn', 'error al actualizar');
  } finally {
    state.loading = false;
    $('go').disabled = false; $('go').removeAttribute('aria-busy');
    schedule();
  }
}

function schedule() {
  clearInterval(state.timer);
  state.timer = null;
  if ($('auto').checked && state.tag && !state.demo) {
    state.timer = setInterval(() => { if (!document.hidden) load(state.tag, true); }, REFRESH_MS);
  }
}

function runDemo(kind, seed, name) {
  $('figNews').hidden = true;
  state.demo = kind;
  state.demoSeed = seed == null ? null : seed;
  state.demoName = name || null;
  state.tag = null;
  state.selected = null; state.plClan = null; state.kickClan = null; state.viewByUser = false;
  accept(window.CWDemo.payload(kind, state.demoSeed, state.demoName));
  $('demoBar').querySelectorAll('[data-demo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.demo === kind)));
  setMsg($('msg'), CFG.snapshot ? CFG.snapshot.note : CFG.demoOnly
    ? 'Demo con clanes y jugadores inventados. Cambia el momento de la semana arriba o genera otra carrera para ver otros casos.'
    : 'Datos inventados para ver cómo funciona. Escribe un tag real para ver tu clan.', '');
  setUrl({ demo: kind });
  schedule();
}

/* =========================================================
 * EVENTOS
 * ========================================================= */
$('query').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('tag').value.trim();
  if (!raw) return;
  if (looksLikeTag(raw)) { openClan({ tag: `#${normTag(raw)}`, name: null }); return; }
  if (raw.length < 3) {
    setMsg($('msg'), 'Escribe al menos 3 letras del nombre del clan, o su tag con #.', 'err');
    return;
  }
  searchClans(raw);
});
$('tag').addEventListener('input', () => { if (!$('tag').value.trim()) hideResults(); });
$('tag').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResults();
  if (e.key === 'ArrowDown') { const first = $('results').querySelector('.ritem'); if (first) { e.preventDefault(); first.focus(); } }
});
$('results').addEventListener('click', (e) => {
  const it = e.target.closest('.ritem');
  if (it) openClan({ tag: it.dataset.tag, name: it.dataset.name || null });
});
$('results').addEventListener('keydown', (e) => {
  const it = e.target.closest('.ritem');
  if (!it) return;
  if (e.key === 'ArrowDown' && it.nextElementSibling) { e.preventDefault(); it.nextElementSibling.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (it.previousElementSibling && it.previousElementSibling.classList.contains('ritem') ? it.previousElementSibling : $('tag')).focus(); }
  if (e.key === 'Escape') { hideResults(); $('tag').focus(); }
});
$('recent').addEventListener('click', (e) => {
  const chip = e.target.closest('.rchip');
  if (chip) openClan({ tag: chip.dataset.tag, name: chip.dataset.name || null });
});
$('dSwitch').addEventListener('click', () => {
  const c = state.model && selectedClan();
  if (c) { openClan({ tag: c.tag, name: c.name }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

$('race').addEventListener('click', (e) => {
  const row = e.target.closest('.rrow');
  if (!row || !state.model) return;
  state.selected = row.dataset.tag;
  state.plClan = row.dataset.tag;
  renderRace(); renderDetail(); renderPending();
  if (window.matchMedia('(max-width:760px)').matches) $('dName').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b || !state.model) return;
  state.view = b.dataset.view;
  state.viewByUser = true;
  renderRace();
});

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});
$('tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const i = TABS.indexOf(state.tab);
  const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  setTab(next);
  $(`tab-${next}`).focus();
});

$('plClan').addEventListener('change', (e) => { state.plClan = e.target.value; renderPlayers(); });
$('plTable').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sort]');
  if (!b) return;
  const k = b.dataset.sort;
  state.plSort = { key: k, dir: state.plSort.key === k ? -state.plSort.dir : (k === 'name' ? 1 : -1) };
  renderPlayers();
});

$('kClan').addEventListener('change', (e) => { state.kickClan = e.target.value; renderKick(); });
['kWeeks', 'kMedal', 'kThr', 'kTarget'].forEach((id) => $(id).addEventListener('input', kickInput));
// En la demo no hay servidor: los botones de PDF explican qué hacen en la web real
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.btn.pdf, a.kpdf');
  if (!a || !state.demo) return;
  e.preventDefault();
  let t = document.getElementById('demoToast');
  if (!t) { t = document.createElement('div'); t.id = 'demoToast'; t.className = 'demo-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = a.classList.contains('kpdf') ? 'En la web real, aquí se descarga la ficha PDF de este jugador.' : 'En la web real, aquí se descarga el informe de jugadores en PDF.';
  t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
});
$('kCoefs').addEventListener('change', kickInput);
$('kReset').addEventListener('click', () => { state.kick.coef = Sim.DEFAULT_DECK_COEF.slice(); saveKickPrefs(); renderKick(); });
$('kCopy').addEventListener('click', async () => {
  if (!state.model || !state.history) return;
  const clan = state.model.clans.find((c) => c.tag === state.kickClan) || state.model.clans[0];
  const entry = state.history.clans ? state.history.clans[clan.tag] : null;
  const k = state.kick;
  const rep = Sim.kickReport(Sim.prepareHistory(entry && entry.weeks), rosterOf(clan.tag), { weeks: k.weeks, medalWeight: k.medal, medalTarget: k.target, threshold: k.thr, coef: k.coef });
  const out = rep.rows.filter((r) => r.verdict === 'expulsar');
  const text = `${clan.name}: candidatos a expulsión (últimas ${rep.weeksUsed} semanas)\n` +
    (out.length ? out.map((r) => `- ${r.name}: nota ${sdec(r.score).replace(/^\+/, '')} (${kickSummary(r.counts)})`).join('\n') : 'Nadie por debajo del umbral.');
  const label = $('kCopy').querySelector('span');
  try { await navigator.clipboard.writeText(text); label.textContent = '¡Copiada!'; }
  catch { label.textContent = 'No se pudo copiar'; }
  setTimeout(() => { label.textContent = 'Copiar la lista'; }, 1800);
});

$('simForm').addEventListener('submit', (e) => { e.preventDefault(); runSim(); });

$('auto').addEventListener('change', schedule);
document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => runDemo(b.dataset.demo, state.demoSeed, state.demoName)));
$('demoNew').addEventListener('click', () => runDemo(state.demo || 'guerra', Math.floor(Math.random() * 1e9)));

$('copy').addEventListener('click', async () => {
  if (!state.model) return;
  const c = selectedClan();
  const list = pendingWithRisk(c);
  const text = `${c.name}: faltan ${plural(c.pendingRaw, 'mazo', 'mazos')} por jugar hoy\n`
    + list.map((p) => `- ${p.name}: ${plural(p.left, 'mazo', 'mazos')}${p.risk != null && p.risk >= RISK_HI ? ' ⚠' : ''}`).join('\n');
  const label = $('copy').querySelector('span');
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = '¡Copiada!';
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    label.textContent = ok ? '¡Copiada!' : 'No se pudo copiar';
  }
  setTimeout(() => { label.textContent = 'Copiar para el chat'; }, 1800);
});

/* =========================================================
 * ARRANQUE
 * ========================================================= */
/* ---------- FIG. 00 · Novedades ---------- */

const News = window.CWNews;
const SEEN_SESSION_MS = 15 * 60 * 1000; // dentro de este rato, una recarga sigue siendo la misma visita
const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function readSeen(tag) { try { return JSON.parse(localStorage.getItem(`cw:seen:${tag}`) || 'null'); } catch { return null; } }

// La primera vez que llega un resumen en esta visita, fija con qué se compara
function fixBaseline(tag) {
  if (state.seenTag === tag) return;
  state.seenTag = tag;
  const st = readSeen(tag);
  state.prevSeen = null; state.prevSeenAt = null;
  if (!st) return;
  // Si la última vez fue hace muy poco (una recarga), se conserva la referencia anterior
  if (Date.now() - st.at < SEEN_SESSION_MS && st.base) { state.prevSeen = st.base; state.prevSeenAt = st.baseAt; }
  else { state.prevSeen = st.summary; state.prevSeenAt = st.at; }
}

function saveSeen(tag, full) {
  const { players, ...summary } = full; // la lista de jugadores no hace falta para comparar
  try {
    localStorage.setItem(`cw:seen:${tag}`, JSON.stringify({
      at: Date.now(), summary, base: state.prevSeen || summary, baseAt: state.prevSeenAt || Date.now(),
    }));
  } catch { /* almacenamiento lleno o bloqueado: no pasa nada */ }
}

async function loadNews(tag) {
  if (state.demo || !state.conf) { $('figNews').hidden = true; return; }
  try {
    const sum = await getJson(`api/summary?tag=${encodeURIComponent(tag)}`);
    if (state.tag !== tag) return;
    fixBaseline(tag);
    state.summary = sum;
    if (!isHomeClan()) state.report = null; // el informe de las 08:00 es solo del clan de casa
    else if (state.conf.reports && Date.now() - state.reportFetchedAt > 5 * 60 * 1000) {
      state.reportFetchedAt = Date.now();
      try { state.report = await getJson('api/report/latest'); } catch { state.report = null; }
    }
    renderNews();
    saveSeen(tag, sum);
  } catch {
    $('figNews').hidden = !state.summary; // si ya había datos, se dejan los últimos
  }
}

function changeItems(list, emptyText) {
  if (!list.length) return `<li class="empty"><span class="arr">·</span>${esc(emptyText)}</li>`;
  return list.map((c) => {
    const arr = c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '•';
    const tone = c.good === true ? 'n-good' : c.good === false ? 'n-bad' : '';
    return `<li class="${tone}${c.own ? '' : ' rival'}"><span class="arr" aria-hidden="true">${arr}</span><span>${esc(c.text)}</span></li>`;
  }).join('');
}

function renderNews() {
  const sum = state.summary;
  $('figNews').hidden = !sum;
  if (!sum) return;
  $('pdfNow').hidden = !(state.conf && state.conf.pdf && isHomeClan());

  // Desde tu última visita
  if (!state.prevSeen) {
    $('seenWhen').textContent = 'Primera visita desde este dispositivo.';
    $('seenChanges').innerHTML = changeItems([], 'La próxima vez que entres verás aquí lo que haya cambiado: puesto, opciones de ganar, mazos jugados…');
  } else {
    $('seenWhen').textContent = `Tu última visita fue ${ago(Date.now() - state.prevSeenAt)}.`;
    $('seenChanges').innerHTML = changeItems(News.diff(state.prevSeen, sum), 'Nada importante ha cambiado desde entonces.');
  }

  // Informe de las 08:00 (solo si es de esta misma carrera)
  const r = state.report;
  const show = !!(r && r.summary && News.sameRace(r.summary, sum));
  $('newsReport').hidden = !show;
  if (!show) return;
  const d = new Date(r.generatedAt);
  const hh = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: r.tz || undefined });
  $('reportHour').textContent = hh;
  $('reportWhen').textContent = `${DAYS_ES[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} · ${r.summary.race.label.toLowerCase()}`;
  const ownAt = r.summary.clans.find((c) => c.own), ownNow = sum.clans.find((c) => c.own);
  const rows = [];
  const cell = (a, b, better) => `<td>${esc(a)}</td><td class="now ${better == null ? '' : better ? 'better' : 'worse'}">${esc(b)}</td>`;
  if (ownAt && ownNow) {
    rows.push(`<tr><td>Puesto</td>${cell(`${ownAt.position}º`, `${ownNow.position}º`, ownNow.position === ownAt.position ? null : ownNow.position < ownAt.position)}</tr>`);
    if (ownAt.week && ownNow.week) {
      const dp = ownNow.week.pFirst - ownAt.week.pFirst;
      rows.push(`<tr><td>Opciones de terminar 1º</td>${cell(News.pct(ownAt.week.pFirst), News.pct(ownNow.week.pFirst), Math.abs(dp) < 0.03 ? null : dp > 0)}</tr>`);
    }
    if (!sum.race.colosseum) rows.push(`<tr><td>Avance</td>${cell(News.fmt(ownAt.progress), News.fmt(ownNow.progress), null)}</tr>`);
  }
  if (r.summary.own && sum.own) {
    const sameDay = r.summary.race.battleDay === sum.race.battleDay;
    rows.push(`<tr><td>Mazos pendientes ${sameDay ? 'hoy' : '(ese día)'}</td>${cell(String(r.summary.own.decksLeft), sameDay ? String(sum.own.decksLeft) : '—', sameDay ? sum.own.decksLeft <= r.summary.own.decksLeft : null)}</tr>`);
  }
  $('reportCmp').innerHTML = `<thead><tr><th></th><th>${esc(hh)}</th><th>Ahora</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  $('reportPdf').hidden = !r.pdf;
  const ch = r.changes || [];
  $('reportChangesLabel').hidden = !ch.length;
  $('reportChanges').innerHTML = ch.length ? changeItems(ch, '') : '';
}

async function boot() {
  const q0 = new URLSearchParams(location.search);
  renderRecent();
  if (CFG.snapshot) {
    // Foto fija de datos reales: sin buscador ni escenarios
    $('query').hidden = true;
    $('demoBar').hidden = true;
    if (TABS.includes(q0.get('tab'))) state.tab = q0.get('tab');
    runDemo(window.CWDemo.scenarios[0]);
    return;
  }
  if (CFG.demoOnly) {
    // Versión de demostración: sin servidor, con selector de escenarios y búsqueda de mentira
    $('autoWrap').hidden = true;
    $('tagHelp').textContent = 'Es una demo: la búsqueda funciona, pero los clanes que salen son inventados.';
    $('demoBar').hidden = false;
    if (TABS.includes(q0.get('tab'))) state.tab = q0.get('tab');
    const kind = q0.get('demo');
    runDemo(window.CWDemo.scenarios.includes(kind) ? kind : 'guerra');
    return;
  }
  let conf = null;
  try { conf = await getJson('api/config'); } catch { /* sin servidor: solo demo */ }
  state.conf = conf;
  if (conf && conf.clanTag) {
    // El servidor solo admite un clan: no hace falta pedir el tag
    state.locked = normTag(conf.clanTag);
    $('query').querySelector('.qrow').hidden = true;
    $('query').querySelector('label.q').hidden = true;
    $('tagHelp').hidden = true;
    $('recent').hidden = true;
  }

  const q = new URLSearchParams(location.search);
  if (TABS.includes(q.get('tab'))) state.tab = q.get('tab');
  if (q.has('demo')) {
    runDemo(window.CWDemo.scenarios.includes(q.get('demo')) ? q.get('demo') : 'guerra');
  } else if (state.locked) {
    load(state.locked);
  } else {
    const t = normTag(q.get('tag') || recall('cw:lastTag') || (conf && conf.homeTag) || ''); // sin indicar: el clan de casa
    if (TAG_RE.test(t)) { $('tag').value = t; load(t); }
  }
}
boot();
})();
