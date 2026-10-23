'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recorder = require('../lib/recorder');
const { buildSummary } = require('../lib/summary');
const fixture = require('./fixtures/carrera-2026-10-10.json');

test('registro: medallas de cada día a partir de las de la semana', () => {
  let store = { periods: [] };
  const race = (pi, today, week, fame) => ({ sectionIndex: 1, periodIndex: pi, periodType: 'warDay',
    clan: { participants: [{ tag: '#A', decksUsedToday: today, decksUsed: week, fame }] } });
  const t0 = Date.UTC(2026, 9, 15, 10);
  store = recorder.observe(store, race(10, 2, 2, 300), t0);              // día 1 (periodIndex 10 = 1er día de batalla)
  store = recorder.observe(store, race(10, 4, 4, 650), t0 + 3600e3);
  store = recorder.observe(store, race(11, 3, 7, 1100), t0 + 86400e3);   // día 2
  const c = recorder.dailyCounts(store);
  assert.equal(c[0].medals['#A'], 650);
  assert.equal(c[1].medals['#A'], 450);
  assert.equal(c[0].counts['#A'], 4);
  assert.equal(c[1].counts['#A'], 3);
});

test('registro: sin la foto del día anterior, las medallas del día quedan sin calcular', () => {
  let store = { periods: [] };
  store = recorder.observe(store, { sectionIndex: 1, periodIndex: 12, periodType: 'warDay',
    clan: { participants: [{ tag: '#A', decksUsedToday: 4, decksUsed: 12, fame: 1800 }] } }, Date.UTC(2026, 9, 17, 10));
  assert.equal(recorder.dailyCounts(store)[0].medals['#A'], undefined);
});

const sum = buildSummary(fixture.payload, fixture.history, { runs: 3000, todayRuns: 2000, seed: 2 });

test('resumen: probabilidad de cada puesto', () => {
  for (const c of sum.clans) {
    assert.equal(c.week.p.length, 5);
    assert.ok(Math.abs(c.week.p.reduce((s, v) => s + v, 0) - 1) < 1e-9, `${c.name} suma ${c.week.p}`);
    assert.equal(c.week.p[0], c.week.pFirst);
    assert.equal(c.today.p.length, 5);
  }
});

test('resumen: jugadores del clan con hoy, semana y medias', () => {
  const pl = sum.players;
  assert.ok(pl, 'hay lista de jugadores');
  assert.equal(pl.list.filter((p) => p.member).length, 50);
  assert.ok(pl.list.some((p) => p.name === 'luisiño' && !p.member), 'el que se fue pero jugó esta semana también sale');
  const ivan = pl.list.find((p) => p.name === 'Ivanius2005');
  assert.deepEqual(ivan.today, { decks: 0, left: 4, medals: null });
  assert.equal(ivan.week.decks, 8);
  assert.equal(ivan.week.medals, 1500);
  assert.equal(ivan.week.perDay, 750);
  assert.equal(ivan.role, 'Colíder');
  const beti = pl.list.find((p) => p.name === 'Beti');
  assert.equal(beti.today.left, 3);
  // Los totales cuadran con RoyaleAPI: 83 mazos hoy, 483 en la semana, 77.750 medallas
  assert.equal(pl.list.reduce((s, p) => s + p.today.decks, 0), 83);
  assert.equal(pl.list.reduce((s, p) => s + p.week.decks, 0), 483);
  assert.equal(pl.list.reduce((s, p) => s + p.week.medals, 0), 77750);
  // Primero los miembros, de más a menos medallas
  assert.equal(pl.list[0].name, 'Mapelolo24');
});

test('ataques: quién queda, riesgo de dejarse mazos y media por ataque', () => {
  const a = sum.players.attacks;
  assert.equal(a.decksLeft, 117);
  assert.equal(a.players, 31);
  assert.ok(a.expMissed > 0 && a.expMissed < 117, `mazos que se espera dejar: ${a.expMissed}`);
  assert.ok(a.pAll > 0 && a.pAll < 1);
  for (const p of sum.players.list) {
    if (p.attack.left === 0) { assert.equal(p.attack.risk, 0); assert.equal(p.attack.expMissed, 0); continue; }
    assert.ok(p.attack.risk > 0 && p.attack.risk < 1, `${p.name}: ${p.attack.risk}`);
    // Con riesgo r y n mazos pendientes, se espera dejar r·(n+1)/2
    assert.ok(Math.abs(p.attack.expMissed - p.attack.risk * (p.attack.left + 1) / 2) < 1e-9);
  }
  const beti = sum.players.list.find((p) => p.name === 'Beti');
  assert.equal(beti.attack.left, 3);
  assert.equal(Math.round(beti.attack.perDeckWeek * 100) / 100, Math.round(1100 / 9 * 100) / 100);
});
