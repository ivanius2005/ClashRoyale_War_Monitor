'use strict';
// Índice de participación en guerra por jugador, en todos los clanes que el servidor ha visto.
//
// La API oficial no da el historial de guerra de un jugador, solo el de cada clan (riverracelog). Pero cada semana
// del historial de un clan trae a los jugadores de los 5 clanes de esa carrera, con sus mazos y medallas. Este índice
// guarda todo lo que pasa por el servidor (y la ronda diaria por los rankings), así que cubre miles de clanes.
//
// Formato compacto para que quepan muchos jugadores en la memoria de la Raspberry:
//   clans:   [[tag, nombre], …]                      (cada clan una vez)
//   players: { '#TAG': [visto, 'semana,clan,mazos,medallas,puesto,barco;…'] }
// Límites: 14 semanas y 120.000 jugadores (~80 MB) (los menos recientes se olvidan). Se guarda en disco cada 10 minutos.

const fs = require('fs');
const path = require('path');

const MAX_WEEKS = 14;
const MAX_PLAYERS = 120000;

// '20261019T093505.000Z' → '2026-10-19' (todas las carreras de una semana acaban el mismo lunes)
function weekKey(createdDate) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(createdDate || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

class WarIndex {
  constructor(file) {
    this.file = file;
    this.meta = {};
    this.weeks = {};   // '2026-10-19' → { label: 'T137·S2', colosseum }
    this.clans = [];   // [[tag, nombre]]
    this.clanIdx = new Map();
    this.players = {};
    this.imports = {}; // '#TAG' → { at, w: { '2026-10-26': {…} } }: semanas traídas de RoyaleAPI con el marcador
    this.dirty = false;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(d.clans)) { // formato compacto
        this.meta = d.meta || {};
        this.weeks = d.weeks || {};
        this.clans = d.clans;
        this.clans.forEach(([t], i) => this.clanIdx.set(t, i));
        this.players = d.players || {};
        this.imports = d.imports || {};
      }
    } catch { /* primera vez o formato antiguo: se reconstruye solo */ }
  }

  clanId(tag, name) {
    let i = this.clanIdx.get(tag);
    if (i == null) { i = this.clans.push([tag, name || tag]) - 1; this.clanIdx.set(tag, i); } else if (name) this.clans[i][1] = name;
    return i;
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
        const ci = this.clanId(c.tag, c.name);
        for (const p of c.participants || []) {
          const rec = `${key},${ci},${p.decksUsed || 0},${p.fame || 0},${st.rank || 0},${p.boatAttacks || 0}`;
          const e = this.players[p.tag];
          if (!e) { this.players[p.tag] = [now, rec]; continue; }
          e[0] = now;
          const parts = e[1] ? e[1].split(';') : [];
          const old = parts.find((x) => x.startsWith(`${key},`));
          // Si cambió de clan a mitad de semana sale en los dos: vale el clan donde más jugó
          if (old) {
            const [, oci, od, of] = old.split(',');
            const sameClan = +oci === ci;
            const better = (p.decksUsed || 0) > +od || ((p.decksUsed || 0) === +od && (p.fame || 0) >= +of);
            if (!sameClan && !better) continue;
          }
          e[1] = parts.filter((x) => !x.startsWith(`${key},`)).concat(rec).join(';');
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
    const oldest = keep[keep.length - 1];
    for (const t of Object.keys(this.players)) {
      const e = this.players[t];
      if (oldest && e[1]) e[1] = e[1].split(';').filter((r) => r.slice(0, 10) >= oldest).join(';');
      if (!e[1]) delete this.players[t];
    }
    const tags = Object.keys(this.players);
    if (tags.length > MAX_PLAYERS) {
      tags.sort((a, b) => this.players[a][0] - this.players[b][0])
        .slice(0, tags.length - MAX_PLAYERS).forEach((t) => { delete this.players[t]; });
    }
  }

  // { '2026-10-19': { clan: { tag, name }, decks, medals, rank, boat } }
  get(tag) {
    const e = this.players[tag];
    const out = {};
    if (!e || !e[1]) return out;
    for (const r of e[1].split(';')) {
      const [k, ci, d, f, rank, boat] = r.split(',');
      const c = this.clans[+ci] || [];
      out[k] = { clan: { tag: c[0], name: c[1] }, decks: +d, medals: +f, rank: +rank || null, boat: +boat || 0 };
    }
    return out;
  }

  // Semanas de un jugador traídas de RoyaleAPI (el marcador las lee en el navegador de quien lo usa)
  importRows(tag, rows) {
    const w = {};
    for (const r of rows) w[r.date] = { label: r.label, clan: r.clan, decks: r.decks, medals: r.medals, rank: r.rank, boat: r.boat };
    this.imports[tag] = { at: Date.now(), w };
    const tags = Object.keys(this.imports);
    if (tags.length > 5000) tags.sort((a, b) => this.imports[a].at - this.imports[b].at).slice(0, tags.length - 5000).forEach((t) => { delete this.imports[t]; });
    this.dirty = true;
  }

  getImported(tag) {
    return (this.imports[tag] && this.imports[tag].w) || {};
  }

  save() {
    if (!this.dirty || !this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ meta: this.meta, weeks: this.weeks, clans: this.clans, players: this.players, imports: this.imports }));
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
