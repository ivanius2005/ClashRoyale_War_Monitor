/*
 * demo.js — Datos inventados con la misma forma que las respuestas del servidor.
 * Sirven para ver la web sin API key (abriendo index.html o con ?demo=guerra).
 */
(function (root) {
  'use strict';

  const NAMES = ['Marea Negra', 'Los Barqueros', 'Norte Real', 'Eclipse ES', 'Tridente'];
  const SKILL = [0.58, 0.54, 0.47, 0.6, 0.45];  // prob. de ganar cada batalla
  const DISCIPLINE = [0.84, 0.8, 0.7, 0.62, 0.76]; // fiabilidad media de sus jugadores
  const SIZE = [44, 49, 41, 38, 47];
  // Escenarios: "entrenamiento" (la semana aún no ha empezado), "guerra" (día de batalla 2)
  // y "coliseo" (día 2 de la última semana de la temporada)
  const DEFAULT_SEEDS = { guerra: 1337, coliseo: 2026, entrenamiento: 77 };

  function rng(seed) {
    let s = seed;
    const rnd = () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    return { rnd, gauss };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const crDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00.000Z`;

  function build(kind, seed, ownName) {
    if (!(kind in DEFAULT_SEEDS)) kind = 'guerra';
    const colosseum = kind === 'coliseo';
    const training = kind === 'entrenamiento';
    const baseSeed = DEFAULT_SEEDS[kind];
    const { rnd, gauss } = rng(seed == null ? baseSeed : seed);
    // Con una semilla propia, cada clan tiene un nivel distinto en cada demo
    const custom = seed != null && seed !== baseSeed;
    const skill = custom ? NAMES.map(() => 0.44 + 0.16 * rnd()) : SKILL;
    const discipline = custom ? NAMES.map(() => 0.6 + 0.3 * rnd()) : DISCIPLINE;
    const size = custom ? NAMES.map(() => 34 + Math.floor(rnd() * 16)) : SIZE;
    const A = '0289PYLQGRJCUV';
    const tag = () => '#' + Array.from({ length: 8 }, () => A[Math.floor(rnd() * A.length)]).join('');
    const syl = ['Ka', 'ro', 'Lu', 'mi', 'Xa', 'vi', 'Neo', 'Zar', 'Pa', 'co', 'Ra', 'yo', 'Tor', 'in', 'Vex', 'Ul', 'ri', 'ko', 'Sa', 'nt'];
    const nick = () => { let n = ''; const k = 2 + Math.floor(rnd() * 2); for (let i = 0; i < k; i++) n += syl[Math.floor(rnd() * syl.length)]; return rnd() < 0.3 ? n + Math.floor(rnd() * 99) : n; };
    // Un día de un jugador con n mazos, como en el juego: si le quedan 3 o más, primero un duelo al mejor de 3
    // (250 por mazo ganado, 100 por perdido); el resto, batallas (200 ganada, 100 perdida). Máximo: 900.
    const dayMedals = (i, n) => {
      let left = n; let m = 0;
      if (left >= 3) {
        let w = 0; let l = 0;
        while (w < 2 && l < 2) { if (rnd() < skill[i]) { w++; m += 250; } else { l++; m += 100; } left--; }
      }
      for (; left > 0; left--) m += rnd() < skill[i] ? 200 : 100;
      return m;
    };

    // Jugadores: cada uno con su fiabilidad (prob. de jugar sus 4 mazos un día)
    // y las semanas que lleva en el clan
    const clanDefs = NAMES.map((name, i) => ({
      i, name, tag: tag(),
      members: Array.from({ length: size[i] }, () => {
        // Algunos juegan "a medias" (1 o 2 mazos al día) y otros casi nunca entran
        const r = rnd();
        const style = r < 0.07 ? 'mitad' : r < 0.12 ? 'fantasma' : 'normal';
        return {
          tag: tag(), name: nick(), role: 'member', style,
          rel: style === 'fantasma' ? 0.08 : Math.min(0.995, Math.max(0.05, discipline[i] + 0.22 * gauss())),
          tenure: rnd() < 0.15 ? 1 + Math.floor(rnd() * 3) : 10,
        };
      }),
    }));
    if (ownName) clanDefs[0].name = ownName;
    // Un día de un jugador: juega los 4 o se deja alguno
    const playDay = (m) => {
      if (m.style === 'mitad' && rnd() < 0.7) return 1 + Math.floor(rnd() * 2);
      if (m.style === 'fantasma') return rnd() < 0.08 ? 4 : 0;
      return rnd() < m.rel ? 4 : Math.floor(rnd() * 4);
    };

    // Hoy a media jornada: algunos aún no han entrado.
    // "entrenamiento" es la semana 2 de la temporada, para tener datos de la semana anterior.
    const periodIndex = training ? 8 : colosseum ? 25 : 4;
    const rosters = {};
    const clans = clanDefs.map((cd) => {
      const participants = []; let pts = 0;
      for (const m of cd.members) {
        const already = rnd() < 0.7; // ya ha pasado por la guerra hoy
        const used = already ? playDay(m) : 0;
        let p = 0;
        p += dayMedals(cd.i, used);
        pts += p;
        participants.push({ tag: m.tag, name: m.name, fame: p, repairPoints: 0, boatAttacks: 0, decksUsed: used, decksUsedToday: used });
      }
      rosters[cd.tag] = cd.members.map(({ tag: t, name, role }) => ({ tag: t, name, role }));
      // En entrenamiento las batallas no dan medallas
      if (training) participants.forEach((p) => { p.fame = 0; });
      return { tag: cd.tag, name: cd.name, fame: 0, repairPoints: 0, periodPoints: training ? 0 : pts, participants, finishTime: '19691231T235959.000Z' };
    });

    // Días de batalla ya jugados: puesto por medallas, defensas que caen y avance del barco
    const AWARD = [59, 53, 47, 43, 41, 37, 31, 29, 23, 19, 17, 13, 11, 7, 5];
    const MOVES = [3000, 1800, 1000, 600, 400];
    const maxDefs = custom ? NAMES.map(() => 11 + Math.floor(rnd() * 5)) : [15, 15, 14, 13, 15];
    const fullDay = (cd) => cd.members.reduce((s, m) => { return s + dayMedals(cd.i, playDay(m)); }, 0);
    function playedDays(firstIndex, days) {
      const intact = clanDefs.map((cd) => Array.from({ length: maxDefs[cd.i] }, () => true));
      const progress = clanDefs.map(() => 0);
      const logs = [];
      for (let d = 0; d < days; d++) {
        const pts = clanDefs.map((cd) => fullDay(cd));
        const order = pts.map((_, i) => i).sort((x, y) => pts[y] - pts[x]);
        const items = order.map((i, pos) => {
          // Los rivales tiran alguna defensa cada día; las caídas no vuelven hasta la semana siguiente
          for (let hits = Math.floor(rnd() * 3); hits > 0; hits--) {
            const alive = intact[i].map((v, j) => (v ? j : -1)).filter((j) => j >= 0);
            if (!alive.length) break;
            intact[i][alive[Math.floor(rnd() * alive.length)]] = false;
          }
          const bonus = intact[i].reduce((sum, v, j) => sum + (v ? AWARD[j] : 0), 0);
          const start = progress[i];
          progress[i] += MOVES[pos] + bonus;
          return {
            clan: { tag: clans[i].tag }, pointsEarned: pts[i],
            progressStartOfDay: start, progressEndOfDay: progress[i], endOfDayRank: pos,
            progressEarned: MOVES[pos] + bonus,
            numOfDefensesRemaining: intact[i].filter(Boolean).length, progressEarnedFromDefenses: bonus,
          };
        });
        logs.push({ periodIndex: firstIndex + d, items });
      }
      return logs;
    }

    // Guerra y coliseo: ayer fue el día de batalla 1. Entrenamiento: la semana anterior entera.
    const periodLogs = training ? playedDays(3, 4) : playedDays(periodIndex - 1, 1);
    if (!training) {
      for (const c of clans) {
        const y = periodLogs[0].items.find((it) => it.clan.tag === c.tag).pointsEarned;
        c.fame = colosseum ? y + c.periodPoints : c.periodPoints;
      }
    }

    const race = {
      state: 'full', clan: clans[0], clans,
      sectionIndex: training ? 1 : colosseum ? 3 : 0,
      periodIndex, periodType: training ? 'training' : colosseum ? 'colosseum' : 'warDay',
      periodLogs,
    };

    // Historial: 10 semanas con puestos coherentes y los mazos de cada jugador
    const history = { fetchedAt: new Date().toISOString(), weeksRequested: 10, clans: {} };
    clanDefs.forEach((cd) => { history.clans[cd.tag] = { weeks: [] }; });
    const end = new Date(Date.UTC(2026, 8, 21, 9, 50));
    for (let w = 0; w < 10; w++) {
      const created = new Date(end.getTime() - w * 7 * 86400000);
      // Semana de coliseo = última de cada temporada, según la semana en que estemos
      const isCol = colosseum ? (w === 4 || w === 9) : training ? (w === 1 || w === 6) : (w === 0 || w === 5);
      const weeks = clanDefs.map((cd) => {
        // Cada jugador: mazos y medallas de cada uno de los 4 días
        const players = [];
        for (const m of cd.members) {
          if (w >= m.tenure) continue; // aún no estaba en el clan
          const days = []; const fame = [];
          for (let d = 0; d < 4; d++) {
            const n = playDay(m);
            let f = 0;
            f += dayMedals(cd.i, n);
            days.push(n); fame.push(f);
          }
          players.push({ tag: m.tag, days, fame });
        }
        // Algún ex miembro que ya no está
        for (let k = 0; k < 3; k++) {
          const days = [0, 0, 0, 0].map(() => Math.floor(rnd() * 5));
          players.push({ tag: tag(), days, fame: days.map((n) => n * 150) });
        }
        return { i: cd.i, players, medals: players.reduce((s, p) => s + p.fame.reduce((a, b) => a + b, 0), 0) };
      });
      const order = [...weeks].sort((a, b) => b.medals - a.medals);
      order.forEach((wk, pos) => {
        let finishTime = '19691231T235959.000Z';
        let daysPlayed = 4;
        if (!isCol && pos === 0 && rnd() < 0.35) {
          // El líder cruzó la meta un día antes: el último día no jugó
          finishTime = crDate(new Date(created.getTime() - 86400000));
          daysPlayed = 3;
        } else if (!isCol && pos === 0) {
          finishTime = crDate(created);
        }
        // Las 3 últimas semanas tienen registro diario (como si el servidor llevara 3 semanas
        // guardándolo); las anteriores solo tienen el total semanal, como da la API
        const exact = w < 3;
        const players = wk.players.map((pl) => {
          const days = pl.days.slice(0, daysPlayed);
          const decks = days.reduce((a, b) => a + b, 0);
          const fame = pl.fame.slice(0, daysPlayed).reduce((a, b) => a + b, 0);
          return exact ? [pl.tag, decks, fame, days.concat(daysPlayed < 4 ? [0] : [])] : [pl.tag, decks, fame];
        });
        const medals = players.reduce((a, pl) => a + pl[2], 0);
        history.clans[clanDefs[wk.i].tag].weeks.push({
          seasonId: 130 - Math.floor(w / 5), sectionIndex: isCol ? 4 : 3 - (w % 5),
          createdDate: crDate(created), rank: pos + 1,
          trophyChange: [20, 10, 0, -5, -10][pos] * (isCol ? 5 : 1),
          medals, finishTime, colosseum: isCol, players, exactDays: exact || undefined,
        });
      });
    }

    return { payload: { fetchedAt: new Date().toISOString(), race, rosters }, history };
  }

  const cache = {};
  const get = (kind, seed, ownName) => {
    const key = `${kind}:${seed == null ? '' : seed}:${ownName || ''}`;
    return cache[key] || (cache[key] = build(kind, seed, ownName));
  };

  // Búsqueda de mentira: clanes inventados a partir de lo que se escriba
  function search(q) {
    const base = String(q || '').trim().slice(0, 20) || 'Clan';
    let h = 2166136261;
    for (const ch of base.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const { rnd } = rng(h >>> 0);
    const A = '0289PYLQGRJCUV';
    const names = [base, `${base} ES`, `Los ${base}`, `${base} Élite`, `Team ${base}`, `${base} Academy`];
    const places = [['España', 'ES'], ['México', 'MX'], ['Argentina', 'AR'], ['Colombia', 'CO'], ['Chile', 'CL'], ['Internacional', null]];
    return {
      items: names.map((name) => {
        const [location, countryCode] = places[Math.floor(rnd() * places.length)];
        return {
          tag: '#' + Array.from({ length: 8 }, () => A[Math.floor(rnd() * A.length)]).join(''),
          name, members: 20 + Math.floor(rnd() * 31), clanWarTrophies: Math.floor(rnd() * 4200),
          location, countryCode, type: 'open',
        };
      }),
    };
  }

  const api = {
    scenarios: Object.keys(DEFAULT_SEEDS),
    payload: (kind, seed, ownName) => get(kind, seed, ownName).payload,
    history: (kind, seed, ownName) => get(kind, seed, ownName).history,
    search,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CWDemo = api;
})(typeof self !== 'undefined' ? self : this);
