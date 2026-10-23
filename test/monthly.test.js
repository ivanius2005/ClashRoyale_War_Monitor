'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildMonthly, buildSummary } = require('../lib/summary');
const fixture = require('./fixtures/carrera-2026-10-10.json');

const names = { '#A': 'Ana', '#B': 'Beto', '#C': 'Carla' };
const week = (seasonId, sectionIndex, players) => ({ seasonId, sectionIndex, colosseum: sectionIndex === 3, names, players });
const war = {
  race: {
    sectionIndex: 1, // semana 2 de la temporada 137
    clan: { tag: '#OWN', participants: [{ tag: '#A', name: 'Ana', fame: 1200, decksUsed: 8 }, { tag: '#B', name: 'Beto', fame: 1500, decksUsed: 8 }] },
  },
  rosters: { '#OWN': [{ tag: '#A', role: 'member' }, { tag: '#B', role: 'elder' }] },
};
const history = { clans: { '#OWN': { weeks: [
  week(137, 0, [['#A', 16, 3000], ['#B', 16, 2800]]),
  week(136, 3, [['#A', 16, 2500], ['#C', 16, 3200]]),
  week(136, 2, [['#A', 16, 2500], ['#C', 16, 3200]]),
  week(136, 1, [['#A', 16, 2500], ['#C', 16, 3200]]),
  week(136, 0, [['#A', 16, 2500], ['#C', 15, 3200]]),
] } } };

test('miembro del mes: temporada en curso (semanas cerradas + la actual)', () => {
  const m = buildMonthly(war, history, false);
  assert.equal(m.current.seasonId, 137);
  assert.equal(m.current.weeksCounted, 2);
  assert.equal(m.current.live, true);
  assert.deepEqual(m.current.top.map((e) => [e.name, e.medals]), [['Beto', 4300], ['Ana', 4200]]);
});

test('miembro del mes: temporada terminada, aunque el ganador ya no esté', () => {
  const m = buildMonthly(war, history, false);
  assert.equal(m.previous.seasonId, 136);
  assert.equal(m.previous.complete, true);
  const [first, second] = m.previous.top;
  assert.deepEqual([first.name, first.medals, first.decks, first.member], ['Carla', 12800, 63, false]);
  assert.deepEqual([second.name, second.medals], ['Ana', 10000]);
});

test('miembro del mes: la primera semana de la temporada empieza una nueva', () => {
  const w1 = { ...war, race: { ...war.race, sectionIndex: 0 } };
  const m = buildMonthly(w1, history, true); // entrenamiento: aún sin medallas en curso
  assert.equal(m.current.seasonId, 138);
  assert.equal(m.current.top.length, 0);
  assert.equal(m.previous.seasonId, 137);
});

const hasReportlab = spawnSync('python3', ['-c', 'import reportlab'], { stdio: 'ignore' }).status === 0;
test('PDF: se genera con los datos reales del 10 de octubre', { skip: !hasReportlab && 'falta reportlab' }, () => {
  const summary = buildSummary(fixture.payload, fixture.history, { runs: 2000, todayRuns: 1000, seed: 3 });
  const r = spawnSync('python3', [path.join(__dirname, '..', 'scripts', 'pdf_report.py')], {
    input: JSON.stringify({ summary, generatedAt: '2026-10-10T16:37:00Z', tz: 'Europe/Madrid' }), maxBuffer: 20e6,
  });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(r.stdout.subarray(0, 5).toString(), '%PDF-');
  assert.ok(r.stdout.length > 30000, `PDF de ${r.stdout.length} bytes`);
});
