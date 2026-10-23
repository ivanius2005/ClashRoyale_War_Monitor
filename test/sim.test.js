'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CWSim = require('../public/js/sim.js');
const CWCalc = require('../public/js/calc.js');

const week = (medals, extra = {}) => ({ medals, createdDate: '20260907T095000.000Z', finishTime: '19691231T235959.000Z', colosseum: false, ...extra });

function race({ periodType = 'training', periodIndex = 7, clans, periodLogs = [] }) {
  return {
    race: { clan: clans[0], clans, periodType, periodIndex, sectionIndex: 1, periodLogs },
    rosters: null, fetchedAt: new Date().toISOString(),
  };
}
const clan = (tag, extra = {}) => ({ tag, name: tag, fame: 0, periodPoints: 0, participants: [], ...extra });

test('daysPlayed: quien cruza la meta un día antes solo jugó 3 días', () => {
  assert.equal(CWSim.daysPlayed(week(30000)), 4);
  assert.equal(CWSim.daysPlayed(week(30000, { finishTime: '20260906T095000.000Z' })), 3);
  assert.equal(CWSim.daysPlayed(week(30000, { finishTime: '20260906T095000.000Z', colosseum: true })), 4);
});

test('un clan muy superior gana casi siempre y las probabilidades suman 1', () => {
  const tags = ['#A', '#B', '#C', '#D', '#E'];
  const model = CWCalc.buildModel(race({ clans: tags.map((t) => clan(t)) }));
  const history = { clans: {
    '#A': { weeks: Array(10).fill(week(40000)) },
    '#B': { weeks: Array(10).fill(week(20000)) },
    '#C': { weeks: Array(10).fill(week(19000)) },
    '#D': { weeks: Array(10).fill(week(15000)) },
    '#E': { weeks: Array(10).fill(week(9000)) },
  } };
  // Variación diaria alta a propósito: aquí se prueba la clasificación, no la calibración
  const res = CWSim.run(CWSim.buildInputs(model, history), { runs: 5000, seed: 1, dayCv: 0.12 });
  const a = res.clans.find((c) => c.tag === '#A');
  assert.ok(a.p[1] > 0.99, `P(ganar) de A = ${a.p[1]}`);
  for (const c of res.clans) {
    const sum = c.p.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `suma ${sum}`);
  }
  // B y C están igualados: los dos deben tener opciones reales de quedar 2º
  const b = res.clans.find((c) => c.tag === '#B'), cc = res.clans.find((c) => c.tag === '#C');
  assert.ok(b.p[2] > 0.3 && cc.p[2] > 0.2, `B ${b.p[2]} C ${cc.p[2]}`);
});

test('mismo seed, mismo resultado', () => {
  const model = CWCalc.buildModel(race({ clans: ['#A', '#B'].map((t) => clan(t)) }));
  const history = { clans: { '#A': { weeks: [week(20000), week(26000)] }, '#B': { weeks: [week(22000), week(24000)] } } };
  const r1 = CWSim.run(CWSim.buildInputs(model, history), { runs: 2000, seed: 42 });
  const r2 = CWSim.run(CWSim.buildInputs(model, history), { runs: 2000, seed: 42 });
  assert.deepEqual(r1.clans.map((c) => c.p), r2.clans.map((c) => c.p));
});

test('un clan que ya cruzó la meta queda 1º siempre', () => {
  const clans = [clan('#A', { finishTime: '20260910T095000.000Z' }), clan('#B'), clan('#C')];
  const model = CWCalc.buildModel(race({ periodType: 'warDay', periodIndex: 13, clans }));
  const history = { clans: { '#A': { weeks: [week(5000)] }, '#B': { weeks: [week(90000)] }, '#C': { weeks: [week(90000)] } } };
  const res = CWSim.run(CWSim.buildInputs(model, history), { runs: 2000, seed: 3 });
  assert.equal(res.clans.find((c) => c.tag === '#A').p[1], 1);
});

test('coliseo: gana quien suma más medallas, con lo ya jugado incluido', () => {
  // Día 3 de batalla (periodIndex % 7 = 5): dos días ya jugados
  const clans = [clan('#A'), clan('#B')];
  const periodLogs = [
    { periodIndex: 17, items: [{ clan: { tag: '#A' }, pointsEarned: 60000 }, { clan: { tag: '#B' }, pointsEarned: 1000 }] },
    { periodIndex: 18, items: [{ clan: { tag: '#A' }, pointsEarned: 60000 }, { clan: { tag: '#B' }, pointsEarned: 1000 }] },
  ];
  const model = CWCalc.buildModel(race({ periodType: 'colosseum', periodIndex: 19, clans, periodLogs }));
  const history = { clans: { '#A': { weeks: [week(20000)] }, '#B': { weeks: [week(60000)] } } };
  const inputs = CWSim.buildInputs(model, history);
  assert.equal(inputs.completedDays, 2);
  assert.equal(inputs.colosseum, true);
  const res = CWSim.run(inputs, { runs: 3000, seed: 9 });
  // B hace 15.000/día y le quedan hoy y mañana: no alcanza los 120.000 de A
  assert.ok(res.clans.find((c) => c.tag === '#A').p[1] > 0.99);
});

test('hoy: nunca menos de lo ya conseguido ni más del máximo posible', () => {
  const clans = [
    clan('#A', { periodPoints: 30000, participants: [{ tag: '#p', name: 'p', decksUsedToday: 4 }] }),
    clan('#B'),
  ];
  const model = CWCalc.buildModel(race({ periodType: 'colosseum', periodIndex: 20, clans }));
  const history = { clans: { '#A': { weeks: [week(4000)] }, '#B': { weeks: [week(4000)] } } };
  const inputs = CWSim.buildInputs(model, history);
  assert.equal(inputs.futureDays, 0);
  const res = CWSim.run(inputs, { runs: 500, seed: 5 });
  const a = res.clans.find((c) => c.tag === '#A');
  assert.equal(a.medals.p10, 30000); // sin mazos pendientes: se queda exactamente en 30.000
  assert.equal(a.p[1], 1);
});

test('clan sin historial: usa el de los demás y lo marca', () => {
  const model = CWCalc.buildModel(race({ clans: ['#A', '#B'].map((t) => clan(t)) }));
  const history = { clans: { '#A': { weeks: [week(20000)] }, '#B': { weeks: null, error: 'x' } } };
  const res = CWSim.run(CWSim.buildInputs(model, history), { runs: 200, seed: 2 });
  assert.equal(res.clans.find((c) => c.tag === '#B').usedFallback, true);
});

test('calc: el tope de 200 mazos limita los pendientes', () => {
  const participants = Array.from({ length: 50 }, (_, i) => ({ tag: `#${i}`, name: `j${i}`, decksUsedToday: 4 }));
  participants.push({ tag: '#ex', name: 'ex', decksUsedToday: 4 });
  const roster = participants.slice(0, 49).map((p) => ({ tag: p.tag, name: p.name }));
  roster.push({ tag: '#nuevo', name: 'nuevo' });
  const c = CWCalc.analyzeClan({ tag: '#A', participants, periodPoints: 1000 }, roster, false);
  assert.equal(c.pendingRaw, 4);
  assert.equal(c.remaining, 0);
  assert.equal(c.capped, true);
});

/* ---------- fiabilidad de jugadores y modelo de hoy ---------- */

const pw = (players, extra = {}) => week(20000, { players, ...extra });

test('fiabilidad: cuenta días con mazos sin jugar y suaviza con la media del clan', () => {
  const weeks = CWSim.prepareHistory([
    pw([['#fiel', 16], ['#flojo', 8], ['#uno', 15]]),
    pw([['#fiel', 16], ['#flojo', 0], ['#uno', 15]]),
    pw([['#fiel', 16], ['#flojo', 12], ['#uno', 15]]),
  ]);
  const rel = CWSim.reliability(weeks);
  const fiel = rel.players.get('#fiel'), flojo = rel.players.get('#flojo'), uno = rel.players.get('#uno');
  assert.equal(fiel.participation, 1);
  assert.equal(fiel.rawDayRisk, 0);
  assert.equal(flojo.rawDayRisk, (2 + 4 + 1) / 12); // 8 sin jugar = 2 días, 16 = 4, 4 = 1
  assert.equal(uno.rawDayRisk, 3 / 12);             // se deja 1 mazo cada semana = 1 día de 4
  assert.equal(uno.weekMissRate, 1);
  // suavizado: nunca 0 % aunque no haya fallado, y el flojo tiene más riesgo que el fiel
  assert.ok(fiel.dayRisk > 0 && fiel.dayRisk < flojo.dayRisk);
  // jugador sin historial = media del clan
  assert.equal(rel.riskFor('#nuevo'), rel.clan.dayRisk);
});

test('fiabilidad: si el clan cruzó la meta un día antes, el máximo de la semana es 12', () => {
  const weeks = CWSim.prepareHistory([pw([['#a', 12]], { finishTime: '20260906T095000.000Z' })]);
  const rel = CWSim.reliability(weeks);
  assert.equal(rel.players.get('#a').participation, 1);
});

test('mazos esperados: riesgo 0 juega todos, riesgo alto juega menos', () => {
  assert.equal(CWSim.expectedDecks(4, 0), 4);
  assert.equal(CWSim.expectedDecks(4, 1), 1.5);
});

test('runToday: con los mismos datos, el clan con jugadores fiables acaba por delante', () => {
  const roster = (tag) => Array.from({ length: 20 }, (_, i) => ({ tag: `${tag}${i}`, name: `j${i}` }));
  const rosters = { '#A': roster('#A'), '#B': roster('#B') };
  const mk = (tag) => clan(tag, { periodPoints: 10000 });
  const model = CWCalc.buildModel({ ...race({ periodType: 'warDay', periodIndex: 4, clans: [mk('#A'), mk('#B')] }), rosters });
  const relOf = (tag, decks) => CWSim.reliability(CWSim.prepareHistory(
    Array.from({ length: 5 }, () => week(20 * decks * 175, { players: rosters[tag].map((m) => [m.tag, decks]) }))));
  // A: todos juegan 16 de 16; B: todos juegan 4 de 16 (se dejan 3 días de 4)
  const res = CWSim.runToday(model, { '#A': relOf('#A', 16), '#B': relOf('#B', 4) }, { runs: 3000, seed: 11 });
  assert.ok(res.clans['#A'].pWin > 0.95, `A ${res.clans['#A'].pWin}`);
  assert.equal(Math.round(res.clans['#A'].expDecks), 80);
  assert.ok(res.clans['#B'].expDecks < 45, `B ${res.clans['#B'].expDecks}`);
  assert.ok(Math.abs(res.clans['#A'].p[1] + res.clans['#A'].p[2] - 1) < 1e-9);
});

test('runToday: día de entrenamiento no calcula nada', () => {
  const model = CWCalc.buildModel(race({ clans: [clan('#A'), clan('#B')] }));
  assert.equal(CWSim.runToday(model, {}, { runs: 10 }), null);
});

test('weekProgress y avance esperado: el favorito del día avanza más', () => {
  const clans = [clan('#A', { periodPoints: 30000 }), clan('#B', { periodPoints: 5000 })];
  const periodLogs = [{ periodIndex: 3, items: [
    { clan: { tag: '#A' }, pointsEarned: 20000, progressEndOfDay: 3200 },
    { clan: { tag: '#B' }, pointsEarned: 10000, progressEndOfDay: 2000 },
  ] }];
  const model = CWCalc.buildModel(race({ periodType: 'warDay', periodIndex: 4, clans, periodLogs }));
  const wk = CWSim.weekProgress(model);
  assert.equal(wk.clans['#A'].progress, 3200);
  assert.equal(wk.completedDays, 1);
  assert.equal(wk.battleDay, 2);
  const t = CWSim.runToday(model, {}, { runs: 1000, seed: 4 });
  assert.equal(Math.round(t.clans['#A'].expMove), 3000); // A ya tiene 30.000 y nadie juega más: 1º seguro
  assert.equal(Math.round(t.clans['#B'].expMove), 1800);
});

/* ---------- defensas del barco ---------- */

test('defensas: valores de la tabla del juego', () => {
  assert.equal(CWSim.defenseBonusFor(15), 435);
  assert.equal(CWSim.defenseBonusFor(14), 376); // caso real de Snipes (T137 S1, día 2)
  assert.equal(CWSim.defenseBonusFor(1), 5);
  assert.equal(CWSim.defenseBonusFor(3), 5 + 7 + 11);
  assert.equal(CWSim.defenseBonusFor(0), 0);
});

test('defensas: dato real del último día jugado y puntos de hoy = puesto + defensas', () => {
  const clans = [clan('#A', { periodPoints: 30000 }), clan('#B', { periodPoints: 5000 })];
  const periodLogs = [{ periodIndex: 3, items: [
    { clan: { tag: '#A' }, pointsEarned: 20000, progressEndOfDay: 3400, numOfDefensesRemaining: 12, progressEarnedFromDefenses: 400 },
    { clan: { tag: '#B' }, pointsEarned: 10000, progressEndOfDay: 1800, numOfDefensesRemaining: 0, progressEarnedFromDefenses: 0 },
  ] }];
  const model = CWCalc.buildModel(race({ periodType: 'warDay', periodIndex: 4, clans, periodLogs }));
  const wk = CWSim.weekProgress(model);
  assert.equal(wk.clans['#A'].defenses, 12);
  assert.equal(wk.clans['#A'].defenseBonus, 400);
  assert.equal(wk.clans['#A'].defenseSource, 'real');
  const t = CWSim.runToday(model, {}, { runs: 1000, seed: 4 });
  assert.equal(Math.round(t.clans['#A'].expPoints), 3400); // 1º seguro: 3.000 + 400
  assert.equal(Math.round(t.clans['#B'].expPoints), 1800); // 2º seguro sin defensas
});

test('defensas: sin días jugados se estiman con la semana anterior', () => {
  const clans = [clan('#A'), clan('#B')];
  const periodLogs = [
    { periodIndex: 3, items: [{ clan: { tag: '#A' }, numOfDefensesRemaining: 15 }, { clan: { tag: '#B' }, numOfDefensesRemaining: 9 }] },
    { periodIndex: 6, items: [{ clan: { tag: '#A' }, numOfDefensesRemaining: 11 }, { clan: { tag: '#B' }, numOfDefensesRemaining: 7 }] },
  ];
  // Semana 2, entrenamiento (periodIndex 8): los registros 3 y 6 son de la semana anterior
  const model = CWCalc.buildModel(race({ periodType: 'training', periodIndex: 8, clans, periodLogs }));
  const wk = CWSim.weekProgress(model);
  assert.equal(wk.clans['#A'].defenses, 15);
  assert.equal(wk.clans['#A'].defenseBonus, 435);
  assert.equal(wk.clans['#A'].defenseSource, 'estimado');
  assert.equal(wk.clans['#B'].defenses, 9);
});

test('simulación: el bonus de defensas se suma al avance de cada día', () => {
  // Último día de batalla (periodIndex 13 = día 4): A ya lleva 20.000 medallas hoy y B 1.000
  const clans = [clan('#A', { periodPoints: 20000 }), clan('#B', { periodPoints: 1000 })];
  const model = CWCalc.buildModel(race({ periodType: 'warDay', periodIndex: 13, clans, periodLogs: [
    { periodIndex: 10, items: [
      { clan: { tag: '#A' }, pointsEarned: 1, progressEndOfDay: 3435, numOfDefensesRemaining: 15, progressEarnedFromDefenses: 435 },
      { clan: { tag: '#B' }, pointsEarned: 1, progressEndOfDay: 1800, numOfDefensesRemaining: 0, progressEarnedFromDefenses: 0 },
    ] },
  ] }));
  const history = { clans: { '#A': { weeks: [week(90000)] }, '#B': { weeks: [week(9000)] } } };
  const res = CWSim.run(CWSim.buildInputs(model, history), { runs: 500, seed: 8, dayCv: 0 });
  const a = res.clans.find((c) => c.tag === '#A');
  // Hoy es el día 4: A empezó con 3.435 y gana hoy (+3.000 +435)
  assert.equal(Math.round(a.progress.mean), 3435 + 3435);
});

/* ---------- candidatos a expulsión ---------- */

test('expulsión: reparto de la semana en días completos', () => {
  assert.deepEqual(CWSim.splitWeek(13, 4), [4, 4, 4, 1]);
  assert.deepEqual(CWSim.splitWeek(16, 4), [4, 4, 4, 4]);
  assert.deepEqual(CWSim.splitWeek(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(CWSim.splitWeek(6, 3), [4, 2, 0]);
});

test('expulsión: coeficientes por día, medallas y veredictos', () => {
  // 4 semanas iguales (16 mazos = los 4 días completos)
  const mk = (rows) => CWSim.prepareHistory([1, 2, 3, 4].map((i) => ({ medals: 1, createdDate: `2026090${i}T095000.000Z`, players: rows })));
  const w = mk([['#a', 16, 2600], ['#b', 0, 0], ['#c', 16, 2000], ['#d', 12, 2400]]);
  const m = ['a', 'b', 'c', 'd'].map((x) => ({ tag: `#${x}`, name: x }));
  const by = Object.fromEntries(CWSim.kickReport(w, m, { medalTarget: 2500 }).rows.map((r) => [r.name, r]));
  // a: todos los mazos (+0,5) y 2.600 medallas (+0,6) → 1,1 → bien
  assert.ok(Math.abs(by.a.score - 1.1) < 1e-9); assert.equal(by.a.verdict, 'bien');
  // c: todos los mazos (+0,5) y 2.000 medallas (0) → 0,5 → vigilar (bien es estrictamente por encima)
  assert.ok(Math.abs(by.c.score - 0.5) < 1e-9); assert.equal(by.c.verdict, 'vigilar');
  // b: nada (-0,5) y 0 medallas (0,5 - 2,5 = -2) → -2,5 → expulsar
  assert.ok(Math.abs(by.b.score + 2.5) < 1e-9); assert.equal(by.b.verdict, 'expulsar');
  // d: 12 mazos/semana = 3 días de 4 y 1 de 0 → (0,5·3 - 0,5) / 4 = 0,25; 2.400 → 0,4 → 0,65 → bien
  assert.ok(Math.abs(by.d.deckScore - 0.25) < 1e-9); assert.ok(Math.abs(by.d.medalScore - 0.4) < 1e-9);
});

test('expulsión: hacen falta 4 semanas con datos', () => {
  const w = CWSim.prepareHistory([1, 2, 3, 4].map((i) => ({ medals: 1, createdDate: `2026090${i}T095000.000Z`,
    players: i <= 3 ? [['#a', 16, 2400], ['#n', 16, 2400]] : [['#a', 16, 2400]] })));
  const by = Object.fromEntries(CWSim.kickReport(w, [{ tag: '#a', name: 'a' }, { tag: '#n', name: 'n' }]).rows.map((r) => [r.name, r]));
  assert.equal(by.a.verdict, 'bien');   // 4 semanas
  assert.equal(by.n.verdict, 'nuevo');  // solo 3
});

test('expulsión: la media objetivo y el peso de las medallas mueven la nota', () => {
  const w = CWSim.prepareHistory([1, 2, 3, 4].map((i) => ({ medals: 1, createdDate: `2026090${i}T095000.000Z`, players: [['#a', 16, 2300]] })));
  const m = [{ tag: '#a', name: 'a' }];
  const r1 = CWSim.kickReport(w, m, { medalTarget: 2400 }).rows[0];
  const r2 = CWSim.kickReport(w, m, { medalTarget: 2200 }).rows[0];
  const r3 = CWSim.kickReport(w, m, { medalTarget: 2200, medalWeight: 2 }).rows[0];
  assert.ok(Math.abs(r1.medalScore - 0.4) < 1e-9);   // 100 por debajo de 2.400
  assert.ok(Math.abs(r2.medalScore - 0.6) < 1e-9);   // 100 por encima de 2.200
  assert.ok(Math.abs(r3.medalScore - 1.2) < 1e-9);   // con peso 2
  assert.equal(r1.medalsPerWeek, 2300);
});

test('expulsión: coeficientes personalizados', () => {
  const w = CWSim.prepareHistory([1, 2, 3, 4].map((i) => ({ medals: 1, createdDate: `2026090${i}T095000.000Z`, players: [['#a', 0, 2400]] })));
  const r = CWSim.kickReport(w, [{ tag: '#a', name: 'a' }], { coef: [-3, -1, -1, 0, 1] }).rows[0];
  assert.equal(r.deckScore, -3);
  assert.ok(Math.abs(r.score - (-3 + 0.5)) < 1e-9);
});

test('simulación: las semanas recientes pesan más (1 · 0,9 … 0,1)', () => {
  assert.deepEqual([0, 1, 2, 5, 9, 15].map(CWSim.recencyWeight), [1, 0.9, 0.8, 0.5, 0.1, 0.1]);
});
test('run: la forma de esta semana pesa en los días que faltan', () => {
  // Dos clanes idénticos por historial; uno lleva la semana muy por debajo
  const mk = (tag, weekDaily) => ({
    tag, name: tag, own: false, completedMedals: weekDaily * 2, weekDaily, completedDays: 2, progress: 4000,
    finished: false, finishStamp: NaN, dailyBonus: 435, today: null,
    weeks: [{ medals: 128000, days: 4, daily: 32000, colosseum: false }], historyError: null,
  });
  const inputs = { clans: [mk('#A', 32000), mk('#B', 26000)], colosseum: false, training: false, todayIsBattle: false, futureDays: 2, missingLogs: false, completedDays: 2, battleDay: 3 };
  const conForma = CWSim.run(inputs, { runs: 3000, seed: 4 });
  const sinForma = CWSim.run(inputs, { runs: 3000, seed: 4, formDays: 1e9 });
  const bCon = conForma.clans[1].p[1], bSin = sinForma.clans[1].p[1];
  assert.ok(conForma.clans[0].p[1] > 0.9, `el clan en forma debería ganar casi siempre (${conForma.clans[0].p[1]})`);
  assert.ok(bSin - bCon > 0.2, `al clan en mala racha le baja mucho la probabilidad (sin forma ${bSin}, con forma ${bCon})`);
});

test('run: dos clanes que cruzan la meta el mismo día comparten el 1º', () => {
  // Los dos cruzan seguro el último día pase lo que pase
  const mk = (tag) => ({
    tag, name: tag, own: false, completedMedals: 0, weekDaily: null, completedDays: 3, progress: 9700,
    finished: false, finishStamp: NaN, dailyBonus: 435, today: null,
    weeks: [{ medals: 128000, days: 4, daily: 32000, colosseum: false }], historyError: null,
  });
  const inputs = { clans: [mk('#A'), mk('#B')], colosseum: false, training: false, todayIsBattle: false, futureDays: 1, missingLogs: false, completedDays: 3, battleDay: 4 };
  const res = CWSim.run(inputs, { runs: 500, seed: 2 });
  for (const c of res.clans) {
    assert.equal(c.p[1], 1, 'los dos terminan 1º');
    assert.equal(c.pTieFirst, 1, 'y siempre empatados');
    assert.equal(c.pWinAlone, 0);
  }
});
