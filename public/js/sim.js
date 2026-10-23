/*
 * sim.js — Modelos estadísticos del monitor
 * Funciona en el navegador (window.CWSim) y en Node (require) para los tests.
 *
 *  reliability()  Fiabilidad de cada jugador con sus últimas semanas: qué parte de sus
 *                 mazos juega y con qué frecuencia se deja alguno.
 *  runToday()     Monte Carlo del día en curso: cuántos mazos pendientes se jugarán
 *                 (según la fiabilidad de cada jugador) y quién acaba el día primero.
 *  run()          Monte Carlo de la semana completa: cada simulación toma una semana
 *                 pasada de cada clan como su "forma" y aplica las reglas del juego.
 *
 * Reglas usadas (ajustables en RULES):
 *  - Carrera normal: cada día el orden por medallas da 3000/1800/1000/600/400 puntos
 *    de avance, más el bonus de las defensas del barco que siguen en pie; meta en
 *    10.000; quien la cruza deja de sumar y los que la cruzan el mismo día empatan.
 *  - Coliseo: gana quien sume más medallas en toda la semana.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CWSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = {
    battleDays: 4,
    decksPerDay: 4,
    finishLine: 10000,
    movement: [3000, 1800, 1000, 600, 400],
    // Puntos de avance de las defensas del barco que siguen en pie al cerrar el día:
    // con las 15 intactas son 435; cada defensa perdida quita la de más valor
    // (14 en pie = 435 - 59 = 376, comprobado con RoyaleAPI)
    defenseAward: [59, 53, 47, 43, 41, 37, 31, 29, 23, 19, 17, 13, 11, 7, 5],
    minPerDeck: 100,
    maxPerDeck: 250,       // media por mazo como mucho (un duelo 2-0 son 250 por mazo)
    maxPlayerDay: 900,     // máximo de un jugador en un día: duelo 2-0 (500) + 2 batallas (400)
    duelMinDecks: 3,       // el duelo solo se empieza con 3 mazos o más
  };
  const MODEL = {
    priorDays: 8,          // suavizado: 8 días (2 semanas) con la media del clan
    lowDataWeeks: 3,       // menos semanas que esto = "pocos datos"
    defaultDayRisk: 0.15,  // si no hay ningún historial
    defaultPerDeck: 175,   // medallas por mazo si no hay ningún dato
    deckSd: 60,            // desviación típica de las medallas de un mazo
    dayFormCv: 0.04,       // un clan entero puede tener un día mejor o peor (±4 % por mazo; lo real ronda el 1,5-3 %)
    minWeekDecks: 40,      // mazos de la semana a partir de los que se usa su media en vez de la de hoy
    dayRiskShock: 0.08,    // ...y un día en que entra más o menos gente (±8 puntos de riesgo)
    futureDayCv: 0.032,   // variabilidad diaria real de Furia Ibérica en sus 10 últimas semanas (CV semanal 1,58 % × 2)    // variación de las medallas de un día futuro (la real ronda el 3-3,5 %)
    formDays: 2,           // la forma de esta semana pesa como 2 días de historial (1 día jugado: 1/3, 2: 1/2, 3: 3/5)
  };
  const DAY_MS = 86400000;

  /* ---------- utilidades ---------- */

  // Formato de fechas de Supercell: 20260921T094512.000Z
  function parseCrDate(s) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandom(seed) {
    const rnd = mulberry32(seed == null ? (Date.now() ^ 0x5bd1e995) : seed);
    const gauss = () => {
      let u = 0;
      while (u === 0) u = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };
    return { rnd, gauss };
  }

  function percentile(sorted, q) {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function summarize(values) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
    return { mean, p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Bonus diario con n defensas en pie: las n de menos valor de la tabla
  const defenseBonusFor = (n) => {
    const k = clamp(Math.round(n || 0), 0, RULES.defenseAward.length);
    return RULES.defenseAward.slice(RULES.defenseAward.length - k).reduce((s, v) => s + v, 0);
  };

  /* ---------- historial ---------- */

  // Si un clan cruzó la meta antes del último día, dejó de sumar medallas:
  // sus medallas y mazos se reparten entre los días que realmente jugó.
  function daysPlayed(week) {
    if (week.colosseum) return RULES.battleDays;
    const fin = parseCrDate(week.finishTime);
    const end = parseCrDate(week.createdDate);
    if (!isFinite(fin) || !isFinite(end) || new Date(fin).getUTCFullYear() < 2020) return RULES.battleDays;
    const skipped = Math.round((end - fin) / DAY_MS);
    return Math.min(RULES.battleDays, Math.max(1, RULES.battleDays - skipped));
  }

  function prepareHistory(weeks) {
    return (Array.isArray(weeks) ? weeks : [])
      .filter((w) => w && isFinite(w.medals))
      .map((w) => {
        const days = daysPlayed(w);
        return Object.assign({}, w, { days, daily: w.medals / days });
      });
  }

  /* ---------- fiabilidad de los jugadores ---------- */

  // weeks: salida de prepareHistory, cada semana con players: [[tag, mazosUsados], ...]
  function reliability(weeks) {
    const players = new Map();
    const clan = { used: 0, max: 0, days: 0, missDays: 0, playerWeeks: 0, missWeeks: 0, medals: 0, decks: 0, weeks: 0 };

    for (const w of weeks) {
      if (!Array.isArray(w.players) || !w.players.length) continue;
      clan.weeks += 1;
      const cap = RULES.decksPerDay * w.days;
      let weekDecks = 0;
      for (const [tag, rawDecks] of w.players) {
        const used = clamp(rawDecks || 0, 0, cap);
        const missed = cap - used;
        // Días con algún mazo sin jugar: lo habitual es dejarse días enteros
        const missDays = Math.min(w.days, Math.ceil(missed / RULES.decksPerDay));
        weekDecks += used;
        let p = players.get(tag);
        if (!p) players.set(tag, (p = { weeks: 0, used: 0, max: 0, days: 0, missDays: 0, missWeeks: 0 }));
        p.weeks += 1; p.used += used; p.max += cap; p.days += w.days; p.missDays += missDays;
        if (missed > 0) p.missWeeks += 1;
        clan.used += used; clan.max += cap; clan.days += w.days; clan.missDays += missDays;
        clan.playerWeeks += 1; if (missed > 0) clan.missWeeks += 1;
      }
      if (weekDecks > 0) { clan.medals += w.medals; clan.decks += weekDecks; }
    }

    const clanDayRisk = clan.days ? clan.missDays / clan.days : MODEL.defaultDayRisk;
    const summary = {
      weeks: clan.weeks,
      participation: clan.max ? clan.used / clan.max : null,      // parte de mazos jugados
      weekMissRate: clan.playerWeeks ? clan.missWeeks / clan.playerWeeks : null,
      dayRisk: clanDayRisk,                                        // prob. de dejarse algún mazo un día
      perDeck: clan.decks ? clamp(clan.medals / clan.decks, RULES.minPerDeck, RULES.maxPerDeck) : null,
      hasData: clan.days > 0,
    };

    const k = MODEL.priorDays;
    for (const p of players.values()) {
      p.participation = p.max ? p.used / p.max : null;
      p.weekMissRate = p.weeks ? p.missWeeks / p.weeks : null;
      p.rawDayRisk = p.days ? p.missDays / p.days : null;
      // Suavizado hacia la media del clan: con pocas semanas no se dan 0 % ni 100 %
      p.dayRisk = (p.missDays + k * clanDayRisk) / (p.days + k);
      p.lowData = p.weeks < MODEL.lowDataWeeks;
    }

    return {
      clan: summary,
      players,
      riskFor(tag) {
        const p = players.get(tag);
        return p ? p.dayRisk : clanDayRisk;
      },
    };
  }

  // Mazos que se espera que juegue alguien con "left" pendientes y riesgo r:
  // con prob. 1-r juega todos; con prob. r se deja alguno (juega de 0 a left-1).
  const expectedDecks = (left, risk) => left - risk * (left + 1) / 2;

  /* ---------- día en curso ---------- */

  // Medallas por mazo de lo que va de semana (hoy incluido), o null si hay pocos datos.
  // Con jugadores: suma exacta. Solo con totales: los días cerrados cuentan como 200 mazos.
  function weekPerDeck(clan, st, completedDays) {
    if (clan.weekDecks >= MODEL.minWeekDecks) return clan.weekMedals / clan.weekDecks;
    if (clan.aggregateOnly && st && completedDays > 0) {
      const decks = completedDays * RULES.decksPerDay * 50 + clan.usedTotal;
      if (decks >= MODEL.minWeekDecks) return (st.completedMedals + clan.dayPoints) / decks;
    }
    return null;
  }

  // clan: salida de CWCalc.analyzeClan · rel: salida de reliability() o null
  // weekRate: medallas por mazo de la semana (weekPerDeck). A media tarde, la media de
  // solo hoy sale de pocos mazos y engaña (los primeros en jugar no son un clan medio).
  // Lo máximo que puede sacar un jugador con los mazos que le quedan hoy.
  // El duelo (al mejor de 3) solo se puede empezar con 3 mazos o más: con 4 → duelo 2-0 (500) + 2 batallas (400) = 900;
  // con 3 → 500 + 200 = 700; con 2 o menos, solo batallas (200 cada una).
  function maxForLeft(left) {
    const n = Math.max(0, Math.min(4, Math.floor(left || 0)));
    return n >= 3 ? 2 * 250 + (n - 2) * 200 : n * 200;
  }
  // Máximo de un clan: la suma de lo de cada jugador pendiente, sin pasar del cupo de mazos que le queda al clan
  function maxDay(pending, cap) {
    let room = Math.max(0, cap || 0);
    let total = 0;
    for (const p of [...(pending || [])].sort((a, b) => b.left - a.left)) {
      if (room <= 0) break;
      const d = Math.min(p.left, room);
      total += maxForLeft(d);
      room -= d;
    }
    return total;
  }

  function todayInputs(clan, rel, colosseum, weekRate) {
    const perDeck = weekRate != null ? weekRate
      : clan.usedTotal >= 8 && clan.avg != null ? clan.avg
      : (rel && rel.clan.perDeck) || clan.avg || MODEL.defaultPerDeck;
    const pending = clan.pending.map((p) => ({
      tag: p.tag, left: p.left,
      risk: rel ? rel.riskFor(p.tag) : MODEL.defaultDayRisk,
    }));
    const expDecks = Math.min(clan.remaining, pending.reduce((s, p) => s + expectedDecks(p.left, p.risk), 0));
    return {
      now: clan.dayPoints,
      base: colosseum ? clan.fame : clan.dayPoints,
      perDeck: clamp(perDeck, RULES.minPerDeck, RULES.maxPerDeck),
      pending,
      cap: clan.remaining,
      expDecks,
      max: clan.dayPoints + maxDay(clan.pending, clan.remaining),
    };
  }

  function sampleToday(t, R) {
    // Factores comunes a todo el clan ese día (actividad y acierto)
    const shock = MODEL.dayRiskShock * R.gauss();
    const form = Math.max(0.5, 1 + MODEL.dayFormCv * R.gauss());
    let decks = 0;
    let top = 0; // lo máximo posible con los mazos que juega cada uno (duelo solo con 3 o más)
    for (const p of t.pending) {
      const risk = clamp(p.risk + shock, 0, 1);
      const d = R.rnd() < risk ? Math.floor(R.rnd() * p.left) : p.left;
      decks += d;
      top += maxForLeft(d);
    }
    if (decks > t.cap) { top *= t.cap / decks; decks = t.cap; }
    if (!decks) return 0;
    const add = decks * t.perDeck * form + Math.sqrt(decks) * MODEL.deckSd * R.gauss();
    return clamp(add, decks * RULES.minPerDeck, Math.max(decks * RULES.minPerDeck, top));
  }

  // Probabilidades de cómo acaba el día. En coliseo se ordena por el total semanal.
  function runToday(model, rels, opts) {
    opts = opts || {};
    if (model.training) return null;
    const runs = Math.max(1, Math.floor(opts.runs || 4000));
    const R = makeRandom(opts.seed);
    const clans = model.clans;
    const n = clans.length;
    const wk = weekProgress(model);
    const inputs = clans.map((c) => todayInputs(c, rels ? rels[c.tag] : null, model.colosseum,
      weekPerDeck(c, wk.clans[c.tag], wk.completedDays)));
    const counts = clans.map(() => new Float64Array(n + 1));
    const finals = clans.map(() => new Float64Array(runs));
    const total = new Float64Array(n);

    for (let r = 0; r < runs; r++) {
      for (let i = 0; i < n; i++) total[i] = inputs[i].base + sampleToday(inputs[i], R);
      for (let i = 0; i < n; i++) {
        let better = 0;
        for (let j = 0; j < n; j++) if (j !== i && total[j] > total[i]) better++;
        counts[i][better + 1] += 1;
        finals[i][r] = total[i];
      }
    }

    const out = {};
    clans.forEach((c, i) => {
      const p = Array.from(counts[i], (v) => v / runs);
      const s = summarize(finals[i]);
      let expectedRank = 0;
      for (let k = 1; k <= n; k++) expectedRank += k * p[k];
      // Avance del barco al cerrar hoy: puntos por el puesto del día + bonus de defensas
      let expMove = null;
      let defenseBonus = 0;
      let expPoints = null;
      if (!model.colosseum) {
        const st = wk.clans[c.tag];
        const done = c.finished || (st && st.finished);
        defenseBonus = done ? 0 : (st && st.defenseBonus) || 0;
        expMove = 0;
        if (!done) for (let k = 1; k <= n; k++) expMove += p[k] * (RULES.movement[k - 1] || 0);
        expPoints = expMove + defenseBonus;
      }
      out[c.tag] = {
        p, pWin: p[1], expectedRank, expMove, defenseBonus, expPoints,
        expected: s.mean, p10: s.p10, p90: s.p90,
        expDecks: inputs[i].expDecks, perDeck: inputs[i].perDeck,
        hasHistory: !!(rels && rels[c.tag] && rels[c.tag].clan.hasData),
      };
    });
    return { runs, colosseum: model.colosseum, clans: out };
  }

  /* ---------- semana completa ---------- */

  // Estado de la semana en curso: qué días ya se jugaron, medallas y avance de cada barco
  function weekProgress(model, opts) {
    opts = opts || {};
    const race = model.race;
    const pi = race.periodIndex || 0;
    const dow = ((pi % 7) + 7) % 7;           // 0-2 entrenamiento, 3-6 batalla
    const weekStart = pi - dow;
    const training = race.periodType === 'training';
    const colosseum = opts.weekType === 'colosseum' ||
      (opts.weekType !== 'normal' && race.periodType === 'colosseum');

    const logs = (race.periodLogs || [])
      .filter((l) => l.periodIndex >= weekStart + 3 && l.periodIndex < pi)
      .sort((a, b) => a.periodIndex - b.periodIndex);
    const expectedCompleted = training ? 0 : Math.max(0, dow - 3);
    const missingLogs = logs.length < expectedCompleted;

    const clans = {};
    for (const c of model.clans) {
      let completedMedals = 0;
      let progress = 0;
      for (const l of logs) {
        const e = (l.items || []).find((x) => x.clan && x.clan.tag === c.tag);
        if (e) {
          completedMedals += e.pointsEarned || 0;
          if (e.progressEndOfDay != null) progress = e.progressEndOfDay;
        }
      }
      if (missingLogs && colosseum) completedMedals = Math.max(0, (c.fame || 0) - c.dayPoints);

      // Defensas del barco: las que seguían en pie al cerrar el último día jugado esta semana
      let defenses = null;
      let defenseBonus = null;
      let defenseSource = null;
      for (const l of logs) {
        const e = (l.items || []).find((x) => x.clan && x.clan.tag === c.tag);
        if (e && e.numOfDefensesRemaining != null) {
          defenses = e.numOfDefensesRemaining;
          defenseBonus = e.progressEarnedFromDefenses != null ? e.progressEarnedFromDefenses : defenseBonusFor(defenses);
          defenseSource = 'real';
        }
      }
      // Sin días jugados esta semana: las defensas se reponen cada semana, así que el
      // máximo visto en semanas anteriores de la temporada es una buena estimación
      if (defenses == null) {
        let maxSeen = null;
        for (const l of race.periodLogs || []) {
          if (l.periodIndex >= weekStart) continue;
          const e = (l.items || []).find((x) => x.clan && x.clan.tag === c.tag);
          if (e && e.numOfDefensesRemaining != null) maxSeen = Math.max(maxSeen || 0, e.numOfDefensesRemaining);
        }
        if (maxSeen != null) {
          defenses = maxSeen;
          defenseBonus = defenseBonusFor(maxSeen);
          defenseSource = 'estimado';
        }
      }

      const finished = !colosseum && (c.finished || progress >= RULES.finishLine);
      clans[c.tag] = { completedMedals, progress, finished, defenses, defenseBonus, defenseSource };
    }

    return {
      training, colosseum, missingLogs, clans,
      todayIsBattle: !training,
      futureDays: training ? RULES.battleDays : Math.max(0, 6 - dow),
      completedDays: logs.length,
      battleDay: training ? 0 : dow - 2,
      daysToStart: training ? 3 - dow : 0,
    };
  }

  // model: salida de CWCalc.buildModel · history: respuesta de /api/history
  function buildInputs(model, history, opts) {
    const wk = weekProgress(model, opts);
    const clans = model.clans.map((c) => {
      const st = wk.clans[c.tag];
      const h = history && history.clans ? history.clans[c.tag] : null;
      const weeks = prepareHistory(h && h.weeks);
      const rel = reliability(weeks);
      return {
        tag: c.tag,
        name: c.name,
        own: c.tag === model.own,
        completedMedals: st.completedMedals,
        // Medallas por día de lo que va de semana (la forma actual del clan)
        weekDaily: wk.completedDays > 0 ? st.completedMedals / wk.completedDays : null,
        completedDays: wk.completedDays,
        progress: st.progress,
        finished: st.finished,
        finishStamp: parseCrDate(c.finishTime),
        // Se supone que las defensas que siguen en pie no caen en los días que quedan
        dailyBonus: wk.colosseum || st.finished ? 0 : (st.defenseBonus || 0),
        today: wk.todayIsBattle ? todayInputs(c, rel, false, weekPerDeck(c, st, wk.completedDays)) : null,
        weeks,
        historyError: h ? h.error || null : 'sin datos',
      };
    });

    return {
      clans,
      colosseum: wk.colosseum, training: wk.training, todayIsBattle: wk.todayIsBattle,
      futureDays: wk.futureDays, missingLogs: wk.missingLogs,
      completedDays: wk.completedDays, battleDay: wk.battleDay,
    };
  }

  // Peso de cada semana del historial (0 = la más reciente): 1, 0,9, 0,8 … 0,1
  const recencyWeight = (i) => Math.max(0.1, Math.round((1 - 0.1 * i) * 10) / 10);

  // Junta varias tandas de simulaciones (para hacer muchas sin bloquear el navegador)
  function mergeRuns(parts) {
    if (parts.length === 1) return parts[0];
    const total = parts.reduce((s, p) => s + p.runs, 0);
    const wavg = (get) => parts.reduce((s, p) => s + get(p) * p.runs, 0) / total;
    const sumObj = (get) => {
      const first = get(parts[0]);
      if (!first) return first;
      const out = {};
      for (const k of Object.keys(first)) out[k] = typeof first[k] === 'number' ? wavg((p) => get(p)[k]) : first[k];
      return out;
    };
    const base = parts[0];
    return Object.assign({}, base, {
      runs: total,
      clans: base.clans.map((c, i) => Object.assign({}, c, {
        p: c.p.map((_, k) => wavg((p) => p.clans[i].p[k])),
        expectedRank: wavg((p) => p.clans[i].expectedRank),
        pTieFirst: wavg((p) => p.clans[i].pTieFirst),
        pWinAlone: wavg((p) => p.clans[i].pWinAlone),
        pFinish: c.pFinish == null ? null : wavg((p) => p.clans[i].pFinish),
        medals: sumObj((p) => p.clans[i].medals),
        progress: sumObj((p) => p.clans[i].progress),
      })),
    });
  }

  function run(inputs, opts) {
    opts = opts || {};
    const runs = Math.max(1, Math.floor(opts.runs || 10000));
    const cv = Math.max(0, opts.dayCv == null ? MODEL.futureDayCv : opts.dayCv);
    const formDays = opts.formDays == null ? MODEL.formDays : Math.max(0, opts.formDays);
    const decay = opts.recency == null ? null : opts.recency; // null = peso lineal 1 · 0,9 · … · 0,1
    const R = makeRandom(opts.seed);

    const clans = inputs.clans;
    const n = clans.length;
    const colosseum = inputs.colosseum;

    // Clanes sin historial usan todas las semanas de los demás clanes de la carrera
    const pooled = [].concat(...clans.map((c) => c.weeks));
    if (!pooled.length) throw new Error('Ningún clan de la carrera tiene historial: no hay datos para simular.');
    const pools = clans.map((c) => {
      const weeks = c.weeks.length ? c.weeks : pooled;
      const cum = [];
      let acc = 0;
      weeks.forEach((_, i) => { acc += !c.weeks.length ? 1 : decay == null ? recencyWeight(i) : Math.pow(decay, i); cum.push(acc); });
      return { weeks, cum, total: acc, fallback: !c.weeks.length };
    });
    const pick = (p) => {
      const r = R.rnd() * p.total;
      let i = 0;
      while (p.cum[i] < r) i++;
      return p.weeks[i];
    };

    const days = (inputs.todayIsBattle ? 1 : 0) + inputs.futureDays;
    const rankCount = clans.map(() => new Float64Array(n + 1));
    const medalRuns = clans.map(() => new Float64Array(runs));
    const progressRuns = clans.map(() => new Float64Array(runs));
    const finishCount = new Float64Array(n);
    const tieFirstCount = new Float64Array(n);
    const rankNow = new Int32Array(n);

    const medals = new Float64Array(n);
    const progress = new Float64Array(n);
    const finishedAt = new Float64Array(n);
    const base = new Float64Array(n);
    const dayVal = new Float64Array(n);
    const order = [];

    for (let r = 0; r < runs; r++) {
      for (let i = 0; i < n; i++) {
        const c = clans[i];
        medals[i] = c.completedMedals;
        progress[i] = c.progress;
        finishedAt[i] = c.finished ? -1 : Infinity;
        base[i] = pick(pools[i]).daily;
        // Mezcla el historial con lo que lleva el clan esta semana: si está jugando mucho
        // peor (o mejor) que de costumbre, los días que faltan se parecen más a esta semana
        if (c.weekDaily != null && c.completedDays > 0) {
          const w = c.completedDays / (c.completedDays + formDays);
          base[i] = (1 - w) * base[i] + w * c.weekDaily;
        }
      }

      for (let d = 0; d < days; d++) {
        const isToday = inputs.todayIsBattle && d === 0;
        order.length = 0;
        for (let i = 0; i < n; i++) {
          if (!colosseum && finishedAt[i] !== Infinity) { dayVal[i] = -1; continue; }
          const t = clans[i].today;
          // Hoy: lo ya conseguido + los mazos pendientes que se espera que se jueguen
          const v = isToday && t
            ? t.now + sampleToday(t, R)
            : Math.max(0, base[i] * (1 + cv * R.gauss()));
          dayVal[i] = v;
          medals[i] += v;
          order.push(i);
        }
        if (colosseum) continue;
        // Puesto del día entre los que siguen en carrera (empates al azar)
        const jitter = order.map(() => R.rnd());
        const idx = order.map((_, k) => k).sort((a, b) =>
          (dayVal[order[b]] - dayVal[order[a]]) || (jitter[b] - jitter[a]));
        idx.forEach((k, pos) => { progress[order[k]] += (RULES.movement[pos] || 0) + clans[order[k]].dailyBonus; });
        for (const i of order) if (progress[i] >= RULES.finishLine) finishedAt[i] = d;
      }

      // Clasificación final
      for (let i = 0; i < n; i++) {
        let better = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          if (colosseum) { if (medals[j] > medals[i]) better++; continue; }
          const fi = finishedAt[i], fj = finishedAt[j];
          if (fj !== Infinity && fi === Infinity) better++;
          else if (fj !== Infinity && fi !== Infinity) {
            if (fj < fi) better++;
            else if (fj === -1 && fi === -1 && clans[j].finishStamp < clans[i].finishStamp) better++;
          } else if (fj === Infinity && fi === Infinity) {
            if (progress[j] > progress[i] || (progress[j] === progress[i] && medals[j] > medals[i])) better++;
          }
        }
        rankCount[i][better + 1] += 1;
        rankNow[i] = better + 1;
        medalRuns[i][r] = medals[i];
        progressRuns[i][r] = progress[i];
        if (finishedAt[i] !== Infinity) finishCount[i] += 1;
      }
      // Dos o más clanes en el 1º = cruzaron la meta el mismo día y lo comparten
      let winners = 0;
      for (let i = 0; i < n; i++) if (rankNow[i] === 1) winners++;
      if (winners > 1) for (let i = 0; i < n; i++) if (rankNow[i] === 1) tieFirstCount[i] += 1;
    }

    const results = clans.map((c, i) => {
      const p = Array.from(rankCount[i], (v) => v / runs); // p[1] = prob. de quedar 1º
      let expected = 0;
      for (let k = 1; k <= n; k++) expected += k * p[k];
      const weeks = pools[i].fallback ? [] : pools[i].weeks;
      return {
        tag: c.tag, name: c.name, own: c.own, p, expectedRank: expected,
        pTieFirst: tieFirstCount[i] / runs,             // comparte el 1º con otro clan
        pWinAlone: p[1] - tieFirstCount[i] / runs,      // gana sin empate
        pFinish: colosseum ? null : finishCount[i] / runs,
        medals: summarize(medalRuns[i]),
        progress: colosseum ? null : summarize(progressRuns[i]),
        historyWeeks: weeks.length, usedFallback: pools[i].fallback,
        dailyAvg: weeks.length ? weeks.reduce((s, w) => s + w.daily, 0) / weeks.length : null,
      };
    });

    return { runs, colosseum, clans: results, days };
  }

  /* ---------- candidatos a expulsión ---------- */

  // Coeficiente de cada día según los mazos jugados ese día (0, 1, 2, 3 o 4)
  // Mazos jugados ese día: 0 → -0,5 · 1 → -1 · 2 → -0,75 · 3 → -0,25 · los 4 → +0,5
  const DEFAULT_DECK_COEF = [-0.5, -1, -0.75, -0.25, 0.5];
  // medalTarget: media de medallas por semana que se pide (la del clan: 2.200)
  // Medallas: llegar al objetivo semanal vale +0,5 y cada medalla de más o de menos, ±0,001 (±0,025 por cada 25).
  // Expulsar por debajo de -0,5; vigilar entre -0,5 y 0,5; bien por encima de 0,5. Hacen falta 4 semanas con datos.
  const KICK = { watchMargin: 1, minWeeks: 4, medalTarget: 2400, threshold: -0.5, medalBase: 0.5, medalStep: 0.001 };

  // Sin registro diario, reparte los mazos de la semana suponiendo días completos:
  // 13 mazos en 4 días → 4 + 4 + 4 + 1
  function splitWeek(decks, days) {
    const out = [];
    let left = clamp(Math.round(decks || 0), 0, days * RULES.decksPerDay);
    for (let i = 0; i < days; i++) {
      const d = Math.min(RULES.decksPerDay, left);
      out.push(d);
      left -= d;
    }
    return out;
  }

  /*
   * Nota de cada miembro:  media del coeficiente de sus días + peso × (medallas por día ÷ 1.000)
   * weeks: salida de prepareHistory (la más reciente primero)
   * members: [{ tag, name }] (miembros actuales)
   */
  function kickReport(weeks, members, opts) {
    opts = opts || {};
    const coef = opts.coef || DEFAULT_DECK_COEF;
    const nWeeks = Math.max(1, opts.weeks || 10);
    const medalWeight = opts.medalWeight == null ? 1 : opts.medalWeight;
    const medalTarget = opts.medalTarget == null ? KICK.medalTarget : opts.medalTarget;
    const threshold = opts.threshold == null ? KICK.threshold : opts.threshold;
    const margin = opts.watchMargin == null ? KICK.watchMargin : opts.watchMargin;
    const minWeeks = opts.minWeeks == null ? KICK.minWeeks : opts.minWeeks;

    const stats = new Map();
    const used = weeks.slice(0, nWeeks);
    for (const w of used) {
      for (const pl of w.players || []) {
        const [tag, decks, fame, exact] = pl;
        let days;
        let isExact = false;
        if (Array.isArray(exact)) {
          // Días reales del registro; null = aún no estaba en el clan ese día
          days = exact.slice(0, w.days).filter((v) => v != null);
          isExact = true;
        } else {
          days = splitWeek(decks, w.days);
        }
        let r = stats.get(tag);
        if (!r) stats.set(tag, (r = { weeks: 0, days: 0, counts: [0, 0, 0, 0, 0], coefSum: 0, medals: 0, exactDays: 0 }));
        r.weeks += 1;
        r.medals += fame || 0;
        for (const d of days) {
          const k = clamp(Math.round(d), 0, RULES.decksPerDay);
          r.counts[k] += 1;
          r.coefSum += coef[k];
          r.days += 1;
          if (isExact) r.exactDays += 1;
        }
      }
    }

    const rows = members.map((m) => {
      const r = stats.get(m.tag);
      const base = { tag: m.tag, name: m.name, weeks: r ? r.weeks : 0, days: r ? r.days : 0, counts: r ? r.counts : [0, 0, 0, 0, 0] };
      if (!r || r.weeks < minWeeks || !r.days) return Object.assign(base, { verdict: 'nuevo', score: null });
      const deckScore = r.coefSum / r.days;
      const medalsPerDay = r.medals / r.days;
      const medalsPerWeek = r.medals / r.weeks; // media de las semanas en que estaba
      const medalScore = medalWeight * (KICK.medalBase + (medalsPerWeek - medalTarget) * KICK.medalStep);
      const score = deckScore + medalScore;
      const verdict = score < threshold ? 'expulsar' : score <= threshold + margin ? 'vigilar' : 'bien';
      return Object.assign(base, {
        verdict, score, deckScore, medalScore, medalsPerDay, medalsPerWeek, medals: r.medals,
        exactShare: r.exactDays / r.days,
      });
    });

    const order = { expulsar: 0, vigilar: 1, bien: 2, nuevo: 3 };
    rows.sort((a, b) => (order[a.verdict] - order[b.verdict]) || ((a.score == null ? 0 : a.score) - (b.score == null ? 0 : b.score)) ||
      String(a.name).localeCompare(String(b.name), 'es'));
    return { rows, weeksUsed: used.length, exactWeeks: used.filter((w) => w.exactDays).length };
  }

  return {
    RULES, MODEL, KICK, DEFAULT_DECK_COEF, recencyWeight, mergeRuns, maxForLeft, maxDay, parseCrDate, splitWeek, kickReport, daysPlayed, prepareHistory, reliability, expectedDecks, weekPerDeck,
    defenseBonusFor, todayInputs, runToday, weekProgress, buildInputs, run,
  };
});
