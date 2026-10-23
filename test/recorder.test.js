'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/recorder.js');

const H = 3600000;
const raceAt = (periodIndex, parts, periodType = 'warDay', sectionIndex = 2) => ({
  periodIndex, sectionIndex, periodType,
  clan: { participants: parts.map(([tag, decksUsed, decksUsedToday]) => ({ tag, decksUsed, decksUsedToday })) },
});

test('registro: mazos exactos de cada día a partir de las fotos', () => {
  const s = { periods: [] };
  const t0 = Date.UTC(2026, 8, 17, 11);
  // Día 1 (periodIndex 3): A juega 4, B juega 1
  R.observe(s, raceAt(3, [['#A', 2, 2], ['#B', 1, 1]]), t0);
  R.observe(s, raceAt(3, [['#A', 4, 4], ['#B', 1, 1]]), t0 + 5 * H);
  // Día 2: al empezar, "antes de hoy" = lo del día 1 completo
  R.observe(s, raceAt(4, [['#A', 4, 0], ['#B', 1, 0]]), t0 + 24 * H);
  R.observe(s, raceAt(4, [['#A', 6, 2], ['#B', 3, 2]]), t0 + 30 * H);
  // Día 3: A jugó 2 el día 2 y B 2 (aunque la última foto del día 2 no lo viera)
  R.observe(s, raceAt(5, [['#A', 6, 0], ['#B', 3, 0]]), t0 + 48 * H);
  const days = R.dailyCounts(s);
  assert.equal(days.length, 3);
  assert.deepEqual(days[0].counts, { '#A': 4, '#B': 1 });
  assert.deepEqual(days[1].counts, { '#A': 2, '#B': 2 });
  assert.equal(days[0].closed, true);
  assert.equal(days[2].closed, false);
});

test('registro: el día siguiente corrige lo que no llegó a verse antes del cierre', () => {
  const s = { periods: [] };
  const t0 = Date.UTC(2026, 8, 17, 11);
  R.observe(s, raceAt(3, [['#A', 3, 3]]), t0);                 // última foto: 3 mazos
  R.observe(s, raceAt(4, [['#A', 4, 0]]), t0 + 24 * H);        // al día siguiente, 4 antes de hoy
  assert.equal(R.dailyCounts(s)[0].counts['#A'], 4);
});

test('registro: añade los días a las semanas del historial que cubre enteras', () => {
  const s = { periods: [] };
  const start = Date.UTC(2026, 8, 17, 11); // jueves
  R.observe(s, raceAt(3, [['#A', 4, 4], ['#B', 2, 2]]), start);
  R.observe(s, raceAt(4, [['#A', 4, 0], ['#B', 2, 0]]), start + 24 * H);
  R.observe(s, raceAt(4, [['#A', 5, 1], ['#B', 4, 2]]), start + 26 * H);
  R.observe(s, raceAt(5, [['#A', 5, 0], ['#B', 4, 0], ['#C', 0, 0]]), start + 48 * H);
  R.observe(s, raceAt(5, [['#A', 9, 4], ['#B', 4, 0], ['#C', 4, 4]]), start + 50 * H);
  R.observe(s, raceAt(6, [['#A', 9, 0], ['#B', 4, 0], ['#C', 4, 0]]), start + 72 * H);
  const weeks = [{ createdDate: '20260921T100000.000Z', players: [['#A', 13, 2000], ['#B', 6, 800], ['#C', 8, 1400]] }];
  const covered = R.attachDays(weeks, R.dailyCounts(s));
  assert.equal(covered, 1);
  assert.deepEqual(weeks[0].players[0][3], [4, 1, 4, 4]);   // el 4º día cuadra con el total (13)
  assert.deepEqual(weeks[0].players[1][3], [2, 2, 0, 2]);
  assert.deepEqual(weeks[0].players[2][3], [null, null, 4, 4]); // C entró el día 3
});

test('registro: semanas sin cubrir se quedan como estaban', () => {
  const weeks = [{ createdDate: '20260921T100000.000Z', players: [['#A', 13, 2000]] }];
  assert.equal(R.attachDays(weeks, []), 0);
  assert.equal(weeks[0].players[0].length, 3);
});
