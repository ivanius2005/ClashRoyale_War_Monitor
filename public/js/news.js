/*
 * news.js — Qué ha cambiado entre dos resúmenes de la carrera.
 * Lo usan el servidor (informe de las 08:00) y la web ("desde tu última visita").
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CWNews = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Punto de miles siempre (toLocaleString('es-ES') no lo pone en números de 4 cifras: 5670)
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const pct = (p) => (p == null ? '—' : p < 0.005 && p > 0 ? '<1 %' : `${Math.round(p * 100)} %`);

  // ¿Son de la misma carrera? (misma semana; en otra semana no tiene sentido comparar)
  // La clave se repite cada temporada, así que además deben estar a menos de 7 días
  function sameRace(a, b) {
    if (!(a && b && a.race && b.race && a.race.key === b.race.key)) return false;
    const ta = Date.parse(a.at), tb = Date.parse(b.at);
    return !(isFinite(ta) && isFinite(tb)) || Math.abs(tb - ta) < 7 * 86400e3;
  }

  // Lista de cambios de prev a cur, de más a menos importante.
  // Cada cambio: { kind, text, dir: 'up' | 'down' | '', own, good }
  // dir dice si el número sube o baja; good, si es buena noticia para nuestro clan
  // (que un rival baje sus opciones es bueno: flecha hacia abajo, en verde).
  function diff(prev, cur, opts) {
    opts = opts || {};
    const minPct = opts.minPct == null ? 0.03 : opts.minPct; // por debajo de 3 puntos es ruido
    const out = [];
    if (!prev || !cur) return out;
    if (!sameRace(prev, cur)) {
      out.push({ kind: 'race', text: 'Ha empezado una carrera nueva desde entonces.', dir: '', own: true, good: null });
      return out;
    }
    const byTag = new Map(prev.clans.map((c) => [c.tag, c]));
    const ownNow = cur.clans.find((c) => c.own);
    const ownBefore = ownNow && byTag.get(ownNow.tag);

    if (ownNow && ownBefore) {
      if (ownNow.position !== ownBefore.position) {
        const better = ownNow.position < ownBefore.position;
        out.push({ kind: 'position', own: true, dir: better ? 'up' : 'down', good: better,
          text: `Puesto: ${ownBefore.position}º → ${ownNow.position}º` });
      }
      if (!cur.race.colosseum && ownNow.progress !== ownBefore.progress) {
        out.push({ kind: 'progress', own: true, dir: 'up', good: true,
          text: `Avance: ${fmt(ownBefore.progress)} → ${fmt(ownNow.progress)} (+${fmt(ownNow.progress - ownBefore.progress)})` });
      }
      const a = ownBefore.week, b = ownNow.week;
      if (a && b && Math.abs(b.pFirst - a.pFirst) >= minPct) {
        out.push({ kind: 'chance', own: true, dir: b.pFirst > a.pFirst ? 'up' : 'down', good: b.pFirst > a.pFirst,
          text: `Opciones de terminar 1º: ${pct(a.pFirst)} → ${pct(b.pFirst)}` });
      }
      if (cur.race.battleDay === prev.race.battleDay && ownNow.decksToday !== ownBefore.decksToday) {
        out.push({ kind: 'decks', own: true, dir: 'up', good: true,
          text: `Mazos jugados hoy: ${ownBefore.decksToday} → ${ownNow.decksToday} de 200` });
      } else if (cur.race.battleDay !== prev.race.battleDay && cur.race.battleDay > 0) {
        out.push({ kind: 'day', own: true, dir: '', good: null, text: `Ya estamos en el día ${cur.race.battleDay} de 4.` });
      }
    }
    for (const c of cur.clans) {
      if (c.own) continue;
      const b = byTag.get(c.tag);
      if (!b || !b.week || !c.week) continue;
      if (Math.abs(c.week.pFirst - b.week.pFirst) >= Math.max(minPct, 0.05)) {
        out.push({ kind: 'rival', own: false, dir: c.week.pFirst > b.week.pFirst ? 'up' : 'down', good: c.week.pFirst < b.week.pFirst,
          text: `${c.name}: ${pct(b.week.pFirst)} → ${pct(c.week.pFirst)}` });
      }
      if (b.position > c.position && ownNow && c.position <= ownNow.position && b.position > (ownBefore ? ownBefore.position : 0)) {
        out.push({ kind: 'overtake', own: false, dir: 'down', good: false, text: `${c.name} nos ha adelantado.` });
      }
    }
    return out;
  }

  return { diff, sameRace, pct, fmt };
});
