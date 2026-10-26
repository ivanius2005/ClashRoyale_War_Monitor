'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reliability } = require('../lib/reliability');
const recorder = require('../lib/recorder');

const wk = (medals, clan = '#A', decks = 16) => ({ decks, medals, clan });

test('fiabilidad: estable y fiel con buena nota es alta; a rachas y cambiando de clan, baja', () => {
  const good = reliability({ score: 1.4, weeks: Array.from({ length: 10 }, () => wk(2900)) });
  assert.equal(good.label, 'Alta'); assert.equal(good.streak, 10); assert.ok(good.index >= 90);
  const bad = reliability({ score: -1, weeks: [wk(3000, '#B'), wk(200, '#B'), wk(2800, '#C'), wk(100, '#D'), null, wk(1500, '#E')] });
  assert.equal(bad.label, 'Baja'); assert.equal(bad.streak, 2); assert.equal(bad.clans, 4);
  assert.equal(reliability({ score: null, weeks: [wk(2000)] }).index, null);
});

test('registro: anota la hora en que sube el número de mazos de cada jugador', () => {
  const store = {};
  const race = (today, used) => ({ periodIndex: 3, sectionIndex: 1, periodType: 'warDay', clan: { participants: [{ tag: '#P', decksUsedToday: today, decksUsed: used, fame: today * 200 }] } });
  const t0 = Date.UTC(2026, 9, 22, 10);
  recorder.observe(store, race(1, 1), t0);              // primera foto: ya tenía 1 (antes de esta hora)
  recorder.observe(store, race(1, 1), t0 + 600e3);
  recorder.observe(store, race(3, 3), t0 + 1200e3);     // dos mazos más en este rato
  const day = recorder.dailyCounts(store)[0];
  assert.deepEqual(day.times['#P'], [[t0, 1, 1], [t0 + 1200e3, 3, 0]]);
});
