'use strict';
/*
 * Resumen de la carrera calculado en el servidor con el mismo motor que la web
 * (calc.js + sim.js). Lo usan la tarjeta del dashboard, el informe de las 08:00 y
 * el bloque de novedades de la página.
 */
const CWCalc = require('../public/js/calc.js');
const CWSim = require('../public/js/sim.js');

function rank(values) {
  // Ranking de competición (empates comparten puesto): [10, 8, 8, 5] → [1, 2, 2, 4]
  return values.map((v) => 1 + values.filter((w) => w > v).length);
}

const ROLE_ES = { leader: 'Líder', coLeader: 'Colíder', elder: 'Veterano', member: 'Miembro' };

// Jugadores del clan propio: hoy, la semana, día a día (si hay registro) y semanas anteriores
function buildPlayers(war, model, wk, history, daily, rel) {
  const race = war.race;
  const own = race.clan;
  if (!own || !Array.isArray(own.participants)) return null;
  const roster = war.rosters && war.rosters[own.tag];
  const roleOf = new Map((roster || []).map((m) => [m.tag, m.role]));
  const pi = race.periodIndex || 0;
  const weekStart = pi - (((pi % 7) + 7) % 7);

  // Días de batalla de esta semana en el registro (índice 0-3)
  const days = [null, null, null, null];
  for (const d of daily || []) {
    if (d.sectionIndex !== race.sectionIndex) continue;
    const k = d.periodIndex - weekStart - 3;
    if (k < 0 || k > 3 || d.periodIndex > pi) continue;
    if (Date.parse(war.fetchedAt) - d.start > 8 * 86400e3) continue; // de otra temporada
    days[k] = d;
  }

  // Semanas anteriores (las 3 más recientes del historial del clan propio)
  const h = history && history.clans ? history.clans[own.tag] : null;
  const prevWeeks = (h && Array.isArray(h.weeks) ? h.weeks : []).slice(0, 3).map((w) => ({
    label: `T${w.seasonId} S${(w.sectionIndex || 0) + 1}${w.colosseum ? ' (coliseo)' : ''}`,
    by: new Map((w.players || []).map(([tag, decks, fame]) => [tag, { decks, medals: fame }])),
  }));

  // Media por ataque del historial (todas las semanas guardadas)
  const hist = new Map();
  for (const w of (h && Array.isArray(h.weeks) ? h.weeks : [])) {
    for (const [tag, decks, fame] of w.players || []) {
      const e = hist.get(tag) || { decks: 0, medals: 0 };
      e.decks += decks || 0; e.medals += fame || 0;
      hist.set(tag, e);
    }
  }
  const clanPerDeck = rel && rel.clan.perDeck;

  const base = roster || own.participants.map((p) => ({ tag: p.tag, name: p.name, role: null }));
  const byTag = new Map(own.participants.map((p) => [p.tag, p]));
  // Miembros actuales + quien ya se fue pero jugó esta semana (para que cuadren los totales)
  const tags = [...base.map((m) => m.tag), ...own.participants.filter((p) => !roleOf.has(p.tag) && (p.decksUsed || 0) > 0).map((p) => p.tag)];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    const p = byTag.get(tag) || {};
    const m = base.find((x) => x.tag === tag) || {};
    const member = roster ? roleOf.has(tag) : true;
    const todayDecks = Math.min(4, p.decksUsedToday || 0);
    const weekDecks = p.decksUsed || 0;
    const weekMedals = p.fame || 0;
    const perDayArr = days.map((d) => (d && tag in d.counts ? { decks: d.counts[tag], medals: d.medals && tag in d.medals ? d.medals[tag] : null } : null));
    // Hoy: el registro da las medallas exactas; si no, se dejan sin calcular
    const todayRec = wk.battleDay > 0 ? perDayArr[wk.battleDay - 1] : null;
    const daysPlayed = perDayArr.some((d) => d) ? perDayArr.filter((d) => d && d.decks > 0).length : Math.ceil(weekDecks / 4);
    const prev = prevWeeks.map((w) => {
      const e = w.by.get(tag);
      return e ? { label: w.label, decks: e.decks, medals: e.medals } : null;
    });
    const prevPlayed = prev.filter((x) => x && x.decks > 0);
    // Ataques: riesgo de dejarse mazos hoy (modelo del simulador) y media por ataque
    const left = member && !model.training ? 4 - todayDecks : 0;
    const rp = rel ? rel.players.get(tag) : null;
    const dayRisk = rel ? rel.riskFor(tag) : null;
    const risk = left > 0 && dayRisk != null ? dayRisk : 0;
    const expMissed = left > 0 ? CWSim.expectedDecks(left, 0) - CWSim.expectedDecks(left, risk) : 0; // = risk·(left+1)/2
    const hs = hist.get(tag);
    const perDeckHist = hs && hs.decks ? hs.medals / hs.decks : null;
    const perDeckWeek = weekDecks ? weekMedals / weekDecks : null;
    const rate = perDeckHist || perDeckWeek || clanPerDeck || null;
    out.push({
      tag, name: p.name || m.name || tag, role: member ? ROLE_ES[roleOf.get(tag)] || null : null, member,
      today: { decks: todayDecks, left: member && !model.training ? 4 - todayDecks : 0, medals: todayRec ? todayRec.medals : null },
      week: {
        decks: weekDecks, medals: weekMedals,
        perDeck: weekDecks ? weekMedals / weekDecks : null,
        perDay: daysPlayed ? weekMedals / daysPlayed : null,
        daysPlayed,
      },
      days: perDayArr.some((d) => d) ? perDayArr : null,
      prev,
      prevAvg: prevPlayed.length ? prevPlayed.reduce((s, x) => s + x.medals, 0) / prevPlayed.length : null,
      attack: {
        left, risk, expMissed,
        dayRisk,                                            // riesgo de un día cualquiera (suavizado)
        missDays: rp ? rp.missDays : 0, days: rp ? rp.days : 0, lowData: rp ? !!rp.lowData : true,
        perDeckWeek, perDeckHist, histDecks: hs ? hs.decks : 0,
        expMedals: left > 0 && rate ? (left - expMissed) * rate : 0,
      },
    });
  }
  out.sort((a, b) => (b.member - a.member) || b.week.medals - a.week.medals || a.name.localeCompare(b.name, 'es'));
  // Resumen de lo que queda por atacar hoy
  const pend = out.filter((p) => p.attack.left > 0);
  const attacks = {
    decksLeft: pend.reduce((s, p) => s + p.attack.left, 0),
    players: pend.length,
    expMissed: pend.reduce((s, p) => s + p.attack.expMissed, 0),
    pAll: pend.reduce((s, p) => s * (1 - p.attack.risk), 1), // nadie se deja ningún mazo
    expMedals: pend.reduce((s, p) => s + p.attack.expMedals, 0),
    clanPerDeck: clanPerDeck || null,
    hasHistory: !!rel,
  };
  return { list: out, weekLabels: prevWeeks.map((w) => w.label), daily: days.some(Boolean), attacks };
}

// Miembro del mes = quien más medallas suma en la temporada (cada temporada dura ~un mes).
// Actual: semanas cerradas de la temporada en curso + lo que va de esta semana.
// Terminada: la temporada anterior completa.
function buildMonthly(war, history, training) {
  const race = war.race;
  const own = race.clan;
  const h = history && history.clans && own ? history.clans[own.tag] : null;
  const weeks = h && Array.isArray(h.weeks) ? h.weeks : [];
  if (!weeks.length) return null;
  const roster = war.rosters && war.rosters[own.tag];
  const members = roster ? new Set(roster.map((m) => m.tag)) : null;
  const current = (race.sectionIndex || 0) === 0 ? weeks[0].seasonId + 1 : weeks[0].seasonId;

  function table(seasonId, includeLive) {
    const acc = new Map();
    const add = (tag, name, decks, medals) => {
      const e = acc.get(tag) || { tag, name: name || tag, medals: 0, decks: 0, weeks: 0 };
      if (name) e.name = name;
      e.medals += medals || 0; e.decks += decks || 0; if (decks > 0) e.weeks += 1;
      acc.set(tag, e);
    };
    const ws = weeks.filter((w) => w.seasonId === seasonId);
    for (const w of ws) for (const [tag, decks, fame] of w.players || []) add(tag, w.names && w.names[tag], decks, fame);
    let live = false;
    if (includeLive && !training) {
      for (const p of own.participants || []) add(p.tag, p.name, p.decksUsed || 0, p.fame || 0);
      live = true;
    }
    const list = [...acc.values()].filter((e) => e.medals > 0)
      .sort((a, b) => b.medals - a.medals || a.decks - b.decks || a.name.localeCompare(b.name, 'es'));
    list.forEach((e, i) => {
      e.rank = i && list[i - 1].medals === e.medals && list[i - 1].decks === e.decks ? list[i - 1].rank : i + 1;
      e.member = members ? members.has(e.tag) : true;
    });
    const sections = ws.map((w) => w.sectionIndex);
    return {
      seasonId, weeksCounted: ws.length + (live ? 1 : 0), live,
      complete: !includeLive && sections.includes(0), // ¿están todas sus semanas en el historial?
      top: list.slice(0, 5),
    };
  }
  return { current: table(current, true), previous: table(current - 1, false) };
}

function buildSummary(war, history, opts) {
  opts = opts || {};
  const model = CWCalc.buildModel(war);
  const race = war.race;
  const wk = CWSim.weekProgress(model);
  const rels = {};
  if (history && history.clans) {
    for (const c of model.clans) {
      const h = history.clans[c.tag];
      const weeks = CWSim.prepareHistory(h && h.weeks);
      if (weeks.length) rels[c.tag] = CWSim.reliability(weeks);
    }
  }
  const seed = opts.seed == null ? 20261016 : opts.seed;
  const today = model.training ? null : CWSim.runToday(model, rels, { runs: opts.todayRuns || 6000, seed });
  let week = null;
  let weekError = null;
  if (history) {
    try { week = CWSim.run(CWSim.buildInputs(model, history), { runs: opts.runs || 10000, seed }); }
    catch (e) { weekError = e.message; }
  }
  const weekBy = new Map(week ? week.clans.map((c) => [c.tag, c]) : []);
  const n = model.clans.length;

  let clans = model.clans.map((c) => {
    const st = wk.clans[c.tag];
    const t = today ? today.clans[c.tag] : null;
    const w = weekBy.get(c.tag);
    return {
      tag: c.tag, name: c.name, own: c.tag === model.own,
      progress: st.progress, finished: st.finished, defenses: st.defenses,
      medalsToday: c.dayPoints, decksToday: c.usedTotal, decksLeft: c.remaining,
      weekMedals: model.colosseum ? c.fame : (c.weekMedals || null),
      weekDecks: c.weekDecks || null,
      boatAttacks: c.weekBoatAttacks || 0,
      perDeck: c.weekDecks ? c.weekMedals / c.weekDecks : null,
      today: t ? { pWin: t.pWin, expected: t.expected, p10: t.p10, p90: t.p90, p: t.p.slice(1, n + 1) } : null,
      week: w ? {
        p: w.p.slice(1, n + 1), // probabilidad de terminar 1º, 2º, … 5º
        pFirst: w.p[1], pWinAlone: w.pWinAlone, pTieFirst: w.pTieFirst,
        pTop2: w.p[1] + (w.p[2] || 0), pLast: w.p[n] || 0, expectedRank: w.expectedRank,
      } : null,
    };
  });
  // Posición actual: por avance del barco (en coliseo, por medallas de la semana)
  const key = (c) => (model.colosseum ? c.weekMedals || 0 : c.progress + (c.finished ? 1e6 : 0));
  const pos = rank(clans.map(key));
  clans.forEach((c, i) => { c.position = pos[i]; });
  clans = clans.sort((a, b) => a.position - b.position || (b.week ? b.week.pFirst : 0) - (a.week ? a.week.pFirst : 0));

  const own = model.clans.find((c) => c.tag === model.own);
  const pending = own ? own.pending.map((p) => ({ name: p.name, tag: p.tag, left: p.left })) : [];
  return {
    at: war.fetchedAt,
    race: {
      // Identifica la carrera: cambia cada semana (sectionIndex) y cada temporada (los logs)
      key: `${race.sectionIndex}:${Math.floor((race.periodIndex || 0) / 7)}`,
      week: (race.sectionIndex || 0) + 1, periodIndex: race.periodIndex, periodType: race.periodType,
      training: model.training, colosseum: model.colosseum, battleDay: wk.battleDay, label: model.dayLabel,
    },
    clans,
    own: own ? {
      tag: own.tag, name: own.name,
      decksLeft: own.remaining, playersPending: pending.length, pending,
      rosterMissing: !!own.rosterMissing,
    } : null,
    weekError,
    runs: week ? week.runs : 0,
    players: buildPlayers(war, model, wk, history, opts.daily, rels[model.own] || null),
    monthly: buildMonthly(war, history, model.training),
  };
}

module.exports = { buildSummary, buildMonthly, rank };
