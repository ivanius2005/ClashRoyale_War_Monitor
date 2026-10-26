'use strict';
// Índice de participación en guerra por jugador, en todos los clanes que el servidor ha visto.
//
// La API oficial no da el historial de guerra de un jugador, solo el de cada clan (riverracelog). Pero cada semana
// del historial de un clan trae a los jugadores de los 5 clanes de esa carrera, con sus mazos y medallas. Este índice
// guarda todo lo que pasa por el servidor, así que con el uso va cubriendo a más jugadores y más clanes.
// Límites: 14 semanas y 80.000 jugadores (los menos recientes se olvidan). Se guarda en disco cada 10 minutos.

const fs = require('fs');
const path = require('path');

const MAX_WEEKS = 14;
const MAX_PLAYERS = 80000;

// '20261019T093505.000Z' → '2026-10-19' (todas las carreras de una semana acaban el mismo lunes)
function weekKey(createdDate) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(createdDate || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

class WarIndex {
  constructor(file) {
    this.file = file;
    this.weeks = {};   // '2026-10-19' → { label: 'T137·S2', colosseum }
    this.players = {}; // '#TAG' → { seen, w: { '2026-10-19': [clanTag, clanName, decks, medals] } }
    this.meta = {};    // { crawledAt }: última ronda por los clanes del ranking
    this.dirty = false;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.weeks = d.weeks || {};
      this.players = d.players || {};
      this.meta = d.meta || {};
    } catch { /* primera vez */ }
  }

  ingest(log) {
    const items = (log && Array.isArray(log.items)) ? log.items : [];
    const now = Date.now();
    for (const item of items) {
      const key = weekKey(item.createdDate);
      if (!key) continue;
      const colosseum = (item.standings || []).some((s) => [100, 50, -25, -50, -100].includes(s.trophyChange));
      this.weeks[key] = { label: `T${item.seasonId}·S${(item.sectionIndex || 0) + 1}`, colosseum };
      for (const st of item.standings || []) {
        const c = st.clan || {};
        for (const p of c.participants || []) {
          const e = this.players[p.tag] || (this.players[p.tag] = { seen: now, w: {} });
          e.seen = now;
          e.w[key] = [c.tag, c.name, p.decksUsed || 0, p.fame || 0];
        }
      }
      this.dirty = true;
    }
    if (this.dirty) this.prune();
  }

  prune() {
    const keep = Object.keys(this.weeks).sort().reverse().slice(0, MAX_WEEKS);
    const keepSet = new Set(keep);
    for (const k of Object.keys(this.weeks)) if (!keepSet.has(k)) delete this.weeks[k];
    const tags = Object.keys(this.players);
    for (const t of tags) {
      const w = this.players[t].w;
      for (const k of Object.keys(w)) if (!keepSet.has(k)) delete w[k];
      if (!Object.keys(w).length) delete this.players[t];
    }
    const left = Object.keys(this.players);
    if (left.length > MAX_PLAYERS) {
      left.sort((a, b) => this.players[a].seen - this.players[b].seen)
        .slice(0, left.length - MAX_PLAYERS).forEach((t) => { delete this.players[t]; });
    }
  }

  get(tag) {
    const e = this.players[tag];
    return e ? e.w : {};
  }

  save() {
    if (!this.dirty || !this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ meta: this.meta, weeks: this.weeks, players: this.players }));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      console.error('No se pudo guardar el índice de guerra:', e.message);
    }
  }
}

// Las últimas n semanas terminadas: los lunes de cierre, de la más reciente a la más antigua
function lastWeekKeys(n, now = Date.now()) {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7; // días desde el lunes
  let monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 10);
  if (monday > now) monday -= 7 * 86400000; // aún no ha cerrado la semana de este lunes
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(monday - i * 7 * 86400000).toISOString().slice(0, 10));
  return out;
}

module.exports = { WarIndex, weekKey, lastWeekKeys };
