'use strict';
/*
 * Registro diario de mazos
 * ------------------------
 * La API solo da los mazos de cada jugador por semana (0-16), no por día. Este módulo
 * guarda una "foto" de la carrera cada pocos minutos y reconstruye los mazos exactos
 * de cada jugador en cada día:
 *
 *   mazos del día N = (usados antes de hoy, visto el día N+1) − (usados antes de hoy, visto el día N)
 *
 * Si falta la foto del día siguiente, se usa el máximo de "decksUsedToday" que se llegó a ver.
 */
const fs = require('node:fs');
const path = require('node:path');

const BATTLE = new Set(['warDay', 'colosseum']);
const MAX_PERIODS = 300;   // ~40 semanas de días guardados
const DAY_MS = 86400000;

function fileFor(dir, tag) {
  return path.join(dir, `daily-${String(tag).replace(/[^0-9A-Z]/gi, '')}.json`);
}

function load(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && Array.isArray(s.periods) ? s : { periods: [] };
  } catch {
    return { periods: [] };
  }
}

function save(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, file); // escritura atómica: nunca queda un archivo a medias
}

// Añade una observación de la carrera en curso (respuesta de currentriverrace)
function observe(store, race, nowMs) {
  const periods = store.periods || (store.periods = []);
  let cur = periods[periods.length - 1];
  const changed = !cur || cur.periodIndex !== race.periodIndex || cur.sectionIndex !== race.sectionIndex ||
    nowMs - cur.last > 1.5 * DAY_MS;
  if (changed) {
    cur = {
      start: nowMs, last: nowMs,
      periodIndex: race.periodIndex, sectionIndex: race.sectionIndex, periodType: race.periodType,
      players: {},
    };
    periods.push(cur);
    if (periods.length > MAX_PERIODS) periods.splice(0, periods.length - MAX_PERIODS);
  }
  cur.last = nowMs;
  for (const p of (race.clan && race.clan.participants) || []) {
    const today = p.decksUsedToday || 0;
    const before = Math.max(0, (p.decksUsed || 0) - today); // mazos de días anteriores de esta semana
    const e = cur.players[p.tag] || (cur.players[p.tag] = { before, today: 0 });
    e.today = Math.max(e.today, today);
    // Medallas de la semana hasta ahora: el día N = lo que tenía al cerrar N − al cerrar N-1
    e.fame = Math.max(e.fame || 0, p.fame || 0);
  }
  return store;
}

// Mazos (y medallas, si se registraron) de cada jugador en cada día registrado
function dailyCounts(store) {
  const ps = store.periods || [];
  return ps.map((cur, i) => {
    const next = ps[i + 1];
    const prev = ps[i - 1];
    const sameWeek = !!next && next.sectionIndex === cur.sectionIndex && next.periodIndex === cur.periodIndex + 1;
    const prevSameWeek = !!prev && prev.sectionIndex === cur.sectionIndex && prev.periodIndex === cur.periodIndex - 1;
    const firstBattleDay = ((cur.periodIndex % 7) + 7) % 7 === 3;
    const counts = {};
    const medals = {};
    for (const [tag, e] of Object.entries(cur.players)) {
      let d = e.today;
      if (sameWeek && next.players[tag]) d = Math.max(d, next.players[tag].before - e.before);
      counts[tag] = Math.min(4, Math.max(0, d));
      // Sin la foto del día anterior no se sabe qué parte de la semana es de hoy
      if (e.fame != null) {
        if (firstBattleDay) medals[tag] = e.fame;
        else if (prevSameWeek && prev.players[tag] && prev.players[tag].fame != null) medals[tag] = Math.max(0, e.fame - prev.players[tag].fame);
        else if (prevSameWeek && !prev.players[tag]) medals[tag] = e.fame; // entró ayer o hoy: todo es de hoy
      }
    }
    return {
      start: cur.start, last: cur.last, periodIndex: cur.periodIndex, sectionIndex: cur.sectionIndex,
      periodType: cur.periodType, closed: !!next, counts, medals,
    };
  });
}

// Formato de fechas de Supercell: 20260921T094512.000Z
function parseCrDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

/*
 * Añade a cada semana del historial los mazos de cada día, si el registro la cubre entera.
 * players pasa de [tag, mazos, medallas] a [tag, mazos, medallas, [d1, d2, d3, d4]].
 * Un null en un día significa que ese día el jugador aún no estaba en el clan.
 */
function attachDays(weeks, counts) {
  const battle = counts.filter((c) => BATTLE.has(c.periodType));
  let covered = 0;
  for (const w of weeks) {
    const end = parseCrDate(w.createdDate);
    if (!isFinite(end)) continue;
    const days = battle.filter((c) => c.start < end && c.start > end - 7 * DAY_MS).sort((a, b) => a.start - b.start);
    if (days.length < 4) continue; // semana sin registrar entera: se queda con la estimación
    const four = days.slice(0, 4);
    w.players = (w.players || []).map(([tag, decks, fame]) => {
      const arr = four.map((d) => (tag in d.counts ? d.counts[tag] : null));
      // El último día cuadra con el total semanal de la API (la última foto puede ser de antes
      // del cierre). Los días en que aún no estaba en el clan no suman nada a ese total.
      if (arr[3] != null) {
        const before = arr.slice(0, 3).reduce((s, v) => s + (v || 0), 0);
        arr[3] = Math.min(4, Math.max(0, (decks || 0) - before));
      }
      return [tag, decks, fame, arr.some((v) => v != null) ? arr : null];
    });
    w.exactDays = true;
    covered += 1;
  }
  return covered;
}

module.exports = { fileFor, load, save, observe, dailyCounts, attachDays, parseCrDate, BATTLE };
