'use strict';
// Previsión del ranking de guerra (trofeos de guerra) del país del clan (top 100) y mundial (top 1000).
//
// Al acabar la semana cada clan suma o resta trofeos según su puesto en su carrera:
//   semana normal: 1º +20, 2º +10, 3º −5, 4º −10, 5º −20 · coliseo: ×5 (+100, +50, −25, −50, −100)
// (comprobado con el historial de la API). Para cada puesto posible del clan se simula cómo acaban los demás:
// los rivales de su misma carrera ocupan los puestos que deja libres; el resto de clanes del top acaba en un
// puesto al azar (no conocemos sus carreras). Así se ve, por ejemplo, «si ganáis, del 69º al 66º de España».

const DELTA = [20, 10, -5, -10, -20];

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

// list: ranking de la API (items con tag y clanScore), ordenado; top: 100 o 1000
function forecast(opts) {
  const { list, ourTag, ourTrophies, rivals = [], colosseum = false, top, runs = 2000, ourP = null, seed = 12345 } = opts;
  const mult = colosseum ? 5 : 1;
  const items = (list || []).filter((x) => x && x.tag);
  // Si la lista acaba justo en el top (la API no da más), los clanes de debajo también pueden subir y adelantarnos:
  // se añaden clanes estimados por debajo del corte, tan apretados como los últimos 100 del top.
  let estimated = 0;
  if (opts.tail && items.length >= top && items.length >= 100) {
    const last = items[items.length - 1].clanScore;
    const span = Math.max(1, items[items.length - 100].clanScore - last);
    const perTrophy = 100 / span;
    const depth = 25 * (colosseum ? 5 : 1) * 2; // lo que puede subir un clan de abajo, con margen
    for (let t = last; t >= last - depth; t--) {
      // repartir perTrophy clanes por trofeo (con decimales acumulados)
      const n = Math.floor((last - t + 1) * perTrophy) - Math.floor((last - t) * perTrophy);
      for (let k = 0; k < n; k++) items.push({ tag: `~${t}-${k}`, clanScore: t === last ? t - 1 : t, estimated: true });
    }
    estimated = items.length - list.length;
  }
  const inList = items.find((x) => x.tag === ourTag);
  const current = inList && inList.rank <= top ? inList.rank : null;
  const trophies = ourTrophies != null ? ourTrophies : inList ? inList.clanScore : null;
  const others = items.filter((x) => x.tag !== ourTag);
  const rivalSet = new Set(rivals.filter((t) => t !== ourTag));
  const rivalIdx = others.map((x, i) => (rivalSet.has(x.tag) ? i : -1)).filter((i) => i >= 0);
  const cutoff = items.length >= top ? items[top - 1].clanScore : null;
  if (trophies == null) return { top, current, trophies: null, cutoff, outcomes: [], expected: null };

  const R = rng(seed);
  const scores = new Float64Array(others.length);
  const outcomes = [];
  const all = []; // [posición, peso] para la previsión con las probabilidades de la semana
  for (let r = 0; r < 5; r++) {
    const mine = trophies + DELTA[r] * mult;
    const pos = new Int32Array(runs);
    let inTop = 0;
    for (let k = 0; k < runs; k++) {
      for (let i = 0; i < others.length; i++) scores[i] = others[i].clanScore + DELTA[Math.floor(R() * 5)] * mult;
      // Rivales de la misma carrera: se reparten los otros 4 puestos
      if (rivalIdx.length) {
        const free = [0, 1, 2, 3, 4].filter((x) => x !== r);
        for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
        rivalIdx.forEach((i, n) => { scores[i] = others[i].clanScore + DELTA[free[n % 4]] * mult; });
      }
      let ahead = 0;
      for (let i = 0; i < others.length; i++) if (scores[i] > mine || (scores[i] === mine && R() < 0.5)) ahead++;
      // El último del top tras la semana: si quedamos por debajo de él, estamos fuera
      pos[k] = ahead + 1;
      if (ahead + 1 <= top) inTop++;
    }
    const sorted = Array.from(pos).sort((a, b) => a - b);
    const o = {
      rank: r + 1, delta: DELTA[r] * mult, trophies: mine,
      median: quant(sorted, 0.5), p10: quant(sorted, 0.1), p90: quant(sorted, 0.9), pIn: inTop / runs,
    };
    outcomes.push(o);
    if (ourP && ourP[r] > 0) for (let k = 0; k < runs; k += 10) all.push([sorted[k], ourP[r]]);
  }
  let expected = null;
  if (all.length) {
    all.sort((a, b) => a[0] - b[0]);
    const tot = all.reduce((s, x) => s + x[1], 0);
    let acc = 0; let median = all[all.length - 1][0]; let inW = 0;
    for (const [p, w] of all) { if (p <= top) inW += w; }
    for (const [p, w] of all) { acc += w; if (acc >= tot / 2) { median = p; break; } }
    expected = { median, pIn: inW / tot };
  }
  return { top, current, trophies, cutoff, colosseum, outcomes, expected, estimated };
}

module.exports = { forecast, DELTA };
