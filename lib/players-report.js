'use strict';
/*
 * Informe de desempeño de los jugadores del clan propio en las últimas 10 semanas:
 * medallas y mazos de cada semana, medias, tendencia (mejora o empeora) y el
 * veredicto de expulsión con la misma nota que la pestaña «Expulsiones» de la web.
 */
const CWSim = require('../public/js/sim.js');

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Opciones de expulsión desde la URL (las mismas que se ajustan en la web)
function parseKickOpts(q) {
  // Ausente o vacío → valor por defecto (Number(null) sería 0 y colaría como número válido)
  const num = (v, lo, hi, def) => { if (v == null || v === '') return def; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  let coef = CWSim.DEFAULT_DECK_COEF.slice();
  if (q && q.get('coef')) {
    const c = q.get('coef').split(',').map(Number);
    if (c.length === 5 && c.every((x) => Number.isFinite(x) && Math.abs(x) <= 10)) coef = c;
  }
  return {
    weeks: Math.round(num(q && q.get('weeks'), 1, 10, 10)),
    medalWeight: num(q && q.get('medal'), 0, 10, 1),
    medalTarget: num(q && q.get('target'), 0, 6000, CWSim.KICK.medalTarget),
    threshold: num(q && q.get('thr'), -10, 10, CWSim.KICK.threshold),
    coef,
  };
}

// Tendencia: media de sus últimas 4 semanas frente a las 6 anteriores (solo semanas en que jugó)
function trendOf(series) {
  const played = (w) => w && w.decks > 0;
  const recent = series.slice(0, 4).filter(played).map((w) => w.medals);
  const before = series.slice(4, 10).filter(played).map((w) => w.medals);
  if (recent.length < 2 || before.length < 2) return { label: 'pocos datos', delta: null, recent: mean(recent), before: mean(before) };
  const r = mean(recent), b = mean(before);
  const delta = b ? (r - b) / b : null;
  const label = delta == null ? 'pocos datos' : delta >= 0.05 ? 'mejora' : delta <= -0.05 ? 'empeora' : 'estable';
  return { label, delta, recent: r, before: b };
}

function buildPlayersReport(war, history, opts) {
  const own = war.race && war.race.clan;
  if (!own) throw new Error('No hay datos del clan propio');
  const tag = own.tag;
  const h = history && history.clans ? history.clans[tag] : null;
  const raw = (h && Array.isArray(h.weeks) ? h.weeks : []).slice(0, 10);
  if (!raw.length) throw new Error('Todavía no hay historial de semanas para el informe');
  const roster = (war.rosters && war.rosters[tag]) || [];

  const names = new Map();
  for (const w of raw.slice().reverse()) for (const [t, n] of Object.entries(w.names || {})) if (n) names.set(t, n);
  for (const p of own.participants || []) if (p.name) names.set(p.tag, p.name);
  for (const m of roster) if (m.name) names.set(m.tag, m.name);
  const ROLE = { leader: 'Líder', coLeader: 'Colíder', elder: 'Veterano', member: 'Miembro' };

  const labels = raw.map((w) => `T${w.seasonId} S${(w.sectionIndex || 0) + 1}${w.colosseum ? ' (coliseo)' : ''}`);
  const byWeek = raw.map((w) => new Map((w.players || []).map(([t, decks, fame]) => [t, { decks: decks || 0, medals: fame || 0 }])));

  // Media del clan por semana (jugadores con algún mazo) y puesto de cada uno dentro del clan
  const clanAvg = byWeek.map((m) => mean([...m.values()].filter((x) => x.decks > 0).map((x) => x.medals)));
  const rankIn = byWeek.map((m) => {
    const sorted = [...m.entries()].filter(([, x]) => x.decks > 0).sort((a, b) => b[1].medals - a[1].medals);
    const r = new Map(); sorted.forEach(([t, x], i) => r.set(t, 1 + sorted.filter(([, y]) => y.medals > x.medals).length));
    return r;
  });

  const kick = CWSim.kickReport(CWSim.prepareHistory(raw), roster.map((m) => ({ tag: m.tag, name: names.get(m.tag) || m.tag })), opts);
  const kickBy = new Map(kick.rows.map((r) => [r.tag, r]));

  const players = roster.map((m) => {
    const series = byWeek.map((wm, i) => {
      const x = wm.get(m.tag);
      return x ? { decks: x.decks, medals: x.medals, rank: rankIn[i].get(m.tag) || null } : null;
    });
    const present = series.filter(Boolean);
    const decks = present.reduce((s, w) => s + w.decks, 0);
    const medals = present.reduce((s, w) => s + w.medals, 0);
    const possible = present.length * 16;
    const k = kickBy.get(m.tag) || {};
    return {
      tag: m.tag, name: names.get(m.tag) || m.tag, role: ROLE[m.role] || '',
      series, weeks: present.length, medals, decks, possible, missed: Math.max(0, possible - decks),
      avgWeek: present.length ? medals / present.length : null,
      perDeck: decks ? medals / decks : null,
      trend: trendOf(series),
      kick: { verdict: k.verdict || 'nuevo', score: k.score == null ? null : k.score, counts: k.counts || [0, 0, 0, 0, 0], medalsPerDay: k.medalsPerDay || null, days: k.days || 0 },
    };
  });
  // Puesto del clan en las 10 semanas, por medallas totales
  const order = players.slice().sort((a, b) => b.medals - a.medals);
  order.forEach((p, i) => { p.rank = 1 + order.filter((q) => q.medals > p.medals).length; });

  return {
    generatedAt: war.fetchedAt,
    clan: { tag, name: own.name },
    labels, clanAvg,
    kickOpts: { weeks: opts.weeks, medalWeight: opts.medalWeight, medalTarget: opts.medalTarget, threshold: opts.threshold, coef: opts.coef, weeksUsed: kick.weeksUsed },
    players: order,
  };
}

module.exports = { buildPlayersReport, parseKickOpts, trendOf };
