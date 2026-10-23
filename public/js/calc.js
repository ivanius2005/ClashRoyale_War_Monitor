/*
 * calc.js — Cálculos de la carrera en directo
 * Funciona en el navegador (window.CWCalc) y en Node (require) para los tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CWCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = {
    WIN: 250,        // medallas por mazo en un duelo ganado (el máximo posible)
    LOSS: 100,       // medallas por mazo perdido en batalla o duelo
    DECKS: 4,        // mazos por jugador y día
    CAP_DECKS: 200,  // mazos máximos por clan y día
    CAP_PLAYERS: 50, // jugadores distintos por clan y día
  };

  function isFinished(finishTime) {
    const y = parseInt(String(finishTime || '').slice(0, 4), 10);
    return y >= 2020; // la API usa 1969 como "sin terminar"
  }

  function analyzeClan(c, roster, training) {
    const parts = Array.isArray(c.participants) ? c.participants : [];
    // Solo se conoce el total del clan (mazos y medallas), no sus jugadores:
    // los mazos que faltan se tratan como huecos anónimos de 4 para la simulación.
    if (!parts.length && c.aggregate) {
      const used = Math.min(RULES.CAP_DECKS, c.aggregate.decksUsedToday || 0);
      const remaining = training ? 0 : Math.max(0, RULES.CAP_DECKS - used);
      const slots = Math.ceil(remaining / RULES.DECKS);
      const pending = Array.from({ length: slots }, (_, i) => ({
        tag: `${c.tag}:hueco${i}`, name: '', used: 0,
        left: i === slots - 1 && remaining % RULES.DECKS ? remaining % RULES.DECKS : RULES.DECKS,
      }));
      const dayPoints = training ? 0 : (c.periodPoints || 0);
      return {
        tag: c.tag, name: c.name || c.tag, fame: c.fame || 0, dayPoints, usedTotal: used, remaining,
        pendingRaw: remaining, capped: false, pending, started: 0, fresh: slots, done: null,
        rosterMissing: false, aggregateOnly: true, finished: isFinished(c.finishTime), finishTime: c.finishTime || null,
        avg: (!training && used > 0) ? dayPoints / used : null,
      };
    }
    const byTag = new Map(parts.map((p) => [p.tag, p]));
    // Medallas y mazos de toda la semana (incluido hoy): la forma real del clan
    const weekMedals = parts.reduce((s, p) => s + (p.fame || 0), 0);
    const weekDecks = parts.reduce((s, p) => s + (p.decksUsed || 0), 0);
    const weekBoatAttacks = parts.reduce((s, p) => s + (p.boatAttacks || 0), 0);
    const usedTotal = parts.reduce((s, p) => s + (p.decksUsedToday || 0), 0);
    const activeToday = parts.filter((p) => (p.decksUsedToday || 0) > 0).length;

    const base = roster || parts.map((p) => ({ tag: p.tag, name: p.name }));
    const members = base.map((m) => {
      const used = Math.min(RULES.DECKS, (byTag.get(m.tag) || {}).decksUsedToday || 0);
      return { tag: m.tag, name: m.name, used, left: RULES.DECKS - used };
    });
    const pending = members.filter((m) => m.left > 0)
      .sort((a, b) => b.left - a.left || String(a.name).localeCompare(String(b.name), 'es'));
    const started = pending.filter((m) => m.used > 0);
    const fresh = pending.filter((m) => m.used === 0);

    // Topes diarios: 50 jugadores distintos y 200 mazos por clan
    const pendingRaw = pending.reduce((s, m) => s + m.left, 0);
    const freeSlots = Math.max(0, RULES.CAP_PLAYERS - activeToday);
    let remaining = started.reduce((s, m) => s + m.left, 0) + Math.min(fresh.length, freeSlots) * RULES.DECKS;
    remaining = Math.min(remaining, Math.max(0, RULES.CAP_DECKS - usedTotal));

    const dayPoints = training ? 0 : (c.periodPoints || 0);
    return {
      tag: c.tag, name: c.name || c.tag, fame: c.fame || 0, dayPoints, usedTotal, remaining,
      pendingRaw, capped: remaining < pendingRaw, pending,
      started: started.length, fresh: fresh.length, done: members.length - pending.length,
      rosterMissing: !roster, finished: isFinished(c.finishTime), finishTime: c.finishTime || null,
      avg: (!training && usedTotal > 0) ? dayPoints / usedTotal : null,
      weekMedals, weekDecks, weekBoatAttacks,
    };
  }

  function range(now, remaining, avg, training) {
    if (training) return { now: 0, min: 0, max: 0, proj: 0 };
    return {
      now,
      min: now + remaining * RULES.LOSS,
      max: now + remaining * RULES.WIN,
      proj: avg == null ? null : now + remaining * avg,
    };
  }

  function buildModel(payload) {
    const { race, rosters, fetchedAt } = payload;
    const type = race.periodType;
    const training = type === 'training';
    const colosseum = type === 'colosseum';
    const list = [...(race.clans || [])];
    if (race.clan && !list.some((c) => c.tag === race.clan.tag)) list.push(race.clan);

    const clans = list.map((c) => analyzeClan(c, rosters ? rosters[c.tag] : null, training));
    const tot = clans.reduce((a, c) => ({ p: a.p + c.dayPoints, d: a.d + c.usedTotal }), { p: 0, d: 0 });
    const raceAvg = (!training && tot.d > 0) ? tot.p / tot.d : null;

    for (const c of clans) {
      c.avgUsed = c.avg != null ? c.avg : raceAvg;
      c.avgSource = c.avg != null ? 'propia' : raceAvg != null ? 'carrera' : null;
      c.day = range(c.dayPoints, c.remaining, c.avgUsed, training);
      c.week = colosseum ? range(c.fame, c.remaining, c.avgUsed, false) : null;
    }

    const d = (((race.periodIndex || 0) % 7) + 7) % 7;
    const dayLabel = training ? `Entrenamiento, día ${d + 1} de 3` : `Día de batalla ${Math.max(1, d - 2)} de 4`;
    return {
      race, own: race.clan && race.clan.tag, clans, training, colosseum, raceAvg, dayLabel,
      week: (race.sectionIndex || 0) + 1, fetchedAt,
    };
  }

  function versus(c, own, key, training) {
    if (!own || c.tag === own.tag || training) return null;
    const a = c[key], b = own[key];
    if (a.max < b.now) return { t: 'Ya no os alcanza', cls: 'ok' };
    if (a.now > b.max) return { t: 'Fuera de vuestro alcance', cls: 'bad' };
    if (a.proj != null && b.proj != null) {
      return a.proj > b.proj ? { t: 'Os supera en proyección', cls: 'warn' } : { t: 'Por detrás en proyección', cls: '' };
    }
    return null;
  }

  return { RULES, isFinished, analyzeClan, buildModel, versus };
});
