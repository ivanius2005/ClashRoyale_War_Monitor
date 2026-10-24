'use strict';
// Datos de los PDF de análisis del clan de casa:
//   - día anterior: el último día de batalla terminado (resultado de los 5 clanes + mazos y medallas de cada jugador)
//   - semana: la última semana terminada del historial
//   - coliseo: la última semana de coliseo del historial
// Fuentes: la carrera actual (periodLogs: resultado de cada día de la temporada para los 5 clanes), el historial
// de semanas (riverracelog) y el registro diario de mazos y medallas por jugador (lib/recorder.js).

const DAY_MS = 86400000;
const COLOSSEUM_DELTAS = new Set([100, 50, -25, -50, -100]);

function crDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
const battleDayOf = (periodIndex) => (((periodIndex % 7) + 7) % 7) - 2; // 3..6 → día 1..4
const isBattle = (t) => t === 'warDay' || t === 'colosseum';

// Una semana del historial es de coliseo si los trofeos se movieron ×5 (+100, +50, −25, −50, −100)
function isColosseumWeek(item) {
  return (item.standings || []).some((s) => COLOSSEUM_DELTAS.has(s.trophyChange));
}

function namesFrom(race, members) {
  const names = new Map();
  for (const p of (race && race.clan && race.clan.participants) || []) names.set(p.tag, p.name);
  for (const m of members || []) names.set(m.tag, m.name);
  return names;
}

function buildDay({ tag, race, daily, members }) {
  const days = (daily || []).filter((d) => d.closed && isBattle(d.periodType));
  const d = days[days.length - 1];
  if (!d) throw Object.assign(new Error('Aún no hay ningún día de batalla terminado en el registro diario.'), { status: 404 });
  const names = namesFrom(race, members);
  const memberSet = new Set((members || []).map((m) => m.tag));

  // Resultado de los 5 clanes ese día (si la carrera actual aún lo tiene: toda la temporada en curso)
  const log = ((race && race.periodLogs) || []).find((x) => x.periodIndex === d.periodIndex);
  const clanNames = new Map(((race && race.clans) || []).map((c) => [c.tag, c.name]));
  const clans = log ? log.items.map((x) => ({
    tag: x.clan.tag, name: clanNames.get(x.clan.tag) || x.clan.tag, own: x.clan.tag === tag,
    medals: x.pointsEarned || 0, progress: x.progressEarned || 0, defenses: x.numOfDefensesRemaining,
  })).sort((a, b) => b.medals - a.medals).map((c, i) => Object.assign(c, { rank: i + 1 })) : [];

  const tags = new Set([...Object.keys(d.counts), ...memberSet]);
  const players = [...tags].map((t) => {
    const decks = d.counts[t] || 0;
    const medals = d.medals[t] != null ? d.medals[t] : null;
    return { tag: t, name: names.get(t) || t, member: memberSet.has(t), decks, medals, perDeck: decks && medals != null ? medals / decks : null };
  }).filter((p) => p.member || p.decks > 0)
    .sort((a, b) => (b.medals || 0) - (a.medals || 0) || b.decks - a.decks || a.name.localeCompare(b.name, 'es'));

  // Media de los días anteriores de la temporada registrados (para comparar)
  const prev = days.slice(0, -1).slice(-12).map((x) => Object.values(x.medals).reduce((s, v) => s + v, 0)).filter((v) => v > 0);
  const own = clans.find((c) => c.own);
  const medals = own ? own.medals : players.reduce((s, p) => s + (p.medals || 0), 0);
  const decks = players.reduce((s, p) => s + p.decks, 0);
  return {
    kind: 'day',
    day: battleDayOf(d.periodIndex), periodType: d.periodType, week: (d.sectionIndex || 0) + 1,
    start: new Date(d.start).toISOString(), end: new Date(d.last).toISOString(),
    clans, players,
    totals: {
      medals, decks, rank: own ? own.rank : null,
      full: players.filter((p) => p.decks >= 4).length,
      partial: players.filter((p) => p.decks > 0 && p.decks < 4).length,
      none: players.filter((p) => p.member && p.decks === 0).length,
      perDeck: decks ? medals / decks : null,
      prevAvg: prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : null,
    },
  };
}

// Medallas de un clan en una semana: la suma de las de sus jugadores. (En semana normal, clan.fame es el avance
// del barco hacia la meta de 10.000, no las medallas; en coliseo coinciden.)
const medalsOf = (st) => ((st.clan && st.clan.participants) || []).reduce((s, p) => s + (p.fame || 0), 0);

function buildWeek({ tag, riverlog, daily, members, colosseum = false }) {
  const items = (riverlog && riverlog.items) || [];
  const item = colosseum ? items.find(isColosseumWeek) : items[0];
  if (!item) {
    throw Object.assign(new Error(colosseum ? 'No hay ninguna semana de coliseo en el historial de las 10 últimas semanas.' : 'Aún no hay ninguna semana terminada en el historial.'), { status: 404 });
  }
  const memberSet = new Set((members || []).map((m) => m.tag));
  const standings = (item.standings || []).map((s) => ({
    rank: s.rank, tag: s.clan.tag, name: s.clan.name, medals: medalsOf(s), progress: s.clan.fame || 0, trophyChange: s.trophyChange,
    trophies: s.clan.clanScore, own: s.clan.tag === tag,
  })).sort((a, b) => a.rank - b.rank);
  const me = (item.standings || []).find((s) => s.clan.tag === tag);
  if (!me) throw Object.assign(new Error('El clan no aparece en esa semana del historial.'), { status: 404 });

  // Días de esa semana en el registro diario: los 4 días de batalla que acaban al cerrarse la semana
  const end = crDate(item.createdDate);
  const weekDays = (daily || []).filter((d) => isBattle(d.periodType) && d.sectionIndex === item.sectionIndex &&
    end != null && d.start <= end && d.start >= end - 5 * DAY_MS).sort((a, b) => a.periodIndex - b.periodIndex);

  const names = new Map((members || []).map((m) => [m.tag, m.name]));
  const parts = me.clan.participants || [];
  for (const p of parts) names.set(p.tag, p.name);
  const tags = new Set([...parts.map((p) => p.tag), ...memberSet]);
  const players = [...tags].map((t) => {
    const p = parts.find((x) => x.tag === t) || { decksUsed: 0, fame: 0 };
    return {
      tag: t, name: names.get(t) || t, member: memberSet.has(t), decks: p.decksUsed || 0, fame: p.fame || 0,
      perDeck: p.decksUsed ? p.fame / p.decksUsed : null,
      days: weekDays.length ? weekDays.map((d) => (d.counts[t] != null ? d.counts[t] : 0)) : null,
    };
  }).filter((p) => p.member || p.decks > 0)
    .sort((a, b) => b.fame - a.fame || b.decks - a.decks || a.name.localeCompare(b.name, 'es'));

  // Comparación con las otras semanas del mismo tipo del historial
  const others = items.filter((x) => x !== item && isColosseumWeek(x) === isColosseumWeek(item))
    .map((x) => (x.standings || []).find((s) => s.clan.tag === tag)).filter(Boolean);
  const decks = players.reduce((s, p) => s + p.decks, 0);
  return {
    kind: colosseum ? 'colosseum' : 'week',
    colosseum: isColosseumWeek(item),
    label: `Temporada ${item.seasonId}, semana ${(item.sectionIndex || 0) + 1}`,
    end: end ? new Date(end).toISOString() : null,
    standings, players,
    days: weekDays.length,
    totals: {
      rank: me.rank, medals: medalsOf(me), trophyChange: me.trophyChange, trophies: me.clan.clanScore,
      decks, perDeck: decks ? medalsOf(me) / decks : null,
      full: players.filter((p) => p.decks >= 16).length,
      none: players.filter((p) => p.member && p.decks === 0).length,
      prevAvg: others.length ? others.reduce((s, x) => s + medalsOf(x), 0) / others.length : null,
      prevRank: others.length ? others.reduce((s, x) => s + x.rank, 0) / others.length : null,
      prevWeeks: others.length,
    },
  };
}

module.exports = { buildDay, buildWeek, isColosseumWeek, battleDayOf };
