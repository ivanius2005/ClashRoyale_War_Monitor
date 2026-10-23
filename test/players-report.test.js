'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildPlayersReport, parseKickOpts, trendOf } = require('../lib/players-report');
const fixture = require('./fixtures/carrera-2026-10-10.json');

// Historial de prueba: 10 semanas con los miembros reales del 10/10 y casos claros
function makeHistory() {
  const war = JSON.parse(JSON.stringify(fixture.payload));
  const roster = war.rosters['#LVR980LQ'];
  const weeks = [];
  for (let i = 0; i < 10; i++) {
    const names = {}; const players = [];
    roster.forEach((m, k) => {
      names[m.tag] = m.name;
      let medals = 2400 + ((k * 37) % 9) * 50, decks = 16;
      if (m.name === 'KING KILLER') medals = i < 4 ? 3400 : 2800;      // mejora
      if (m.name === 'Ivanius2005') medals = i < 4 ? 2000 : 2900;      // empeora
      if (m.name === 'lucho') { decks = 4; medals = 600; }             // se deja casi todo
      players.push([m.tag, decks, medals]);
    });
    weeks.push({ createdDate: new Date(Date.UTC(2026, 9, 19) - i * 7 * 86400e3).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000Z'), seasonId: 137 - Math.floor((i + 2) / 4), sectionIndex: (3 - ((i + 2) % 4) + 4) % 4, colosseum: false, medals: 120000, rank: 2, finishTime: '19691231T235959.000Z', names, players });
  }
  return { war, history: { clans: { '#LVR980LQ': { weeks } } } };
}

test('tendencia: últimas 4 semanas frente a las 6 anteriores', () => {
  const s = (a) => a.map((m) => ({ medals: m, decks: 16 }));
  assert.equal(trendOf(s([3000, 3000, 3000, 3000, 2000, 2000, 2000, 2000, 2000, 2000])).label, 'mejora');
  assert.equal(trendOf(s([2000, 2000, 2000, 2000, 3000, 3000, 3000, 3000, 3000, 3000])).label, 'empeora');
  assert.equal(trendOf(s([2500, 2500, 2500, 2500, 2520, 2500, 2480, 2500, 2500, 2500])).label, 'estable');
  assert.equal(trendOf([{ medals: 2000, decks: 16 }, null, null, null, null]).label, 'pocos datos');
});

test('ajustes de expulsión desde la URL', () => {
  const o = parseKickOpts(new URLSearchParams('weeks=6&medal=2&thr=0.5&coef=-1,-3,-2,0.5,1'));
  assert.deepEqual(o, { weeks: 6, medalWeight: 2, medalTarget: 2400, threshold: 0.5, coef: [-1, -3, -2, 0.5, 1] });
  assert.equal(parseKickOpts(new URLSearchParams('weeks=99&coef=x')).weeks, 10);
  assert.deepEqual(parseKickOpts(new URLSearchParams('')), { weeks: 10, medalWeight: 1, medalTarget: 2400, threshold: -0.5, coef: [-0.5, -1, -0.75, -0.25, 0.5] });
  assert.equal(parseKickOpts(new URLSearchParams('target=2400')).medalTarget, 2400);
});

test('informe de jugadores: series, medias, tendencias y expulsiones', () => {
  const { war, history } = makeHistory();
  const r = buildPlayersReport(war, history, parseKickOpts(new URLSearchParams('')));
  assert.equal(r.players.length, 50);
  assert.equal(r.labels.length, 10);
  const by = (n) => r.players.find((p) => p.name === n);
  assert.equal(by('KING KILLER').trend.label, 'mejora');
  assert.equal(by('Ivanius2005').trend.label, 'empeora');
  assert.equal(by('lucho').missed, 120);
  assert.equal(by('lucho').kick.verdict, 'expulsar');
  assert.equal(by('Ivanius2005').kick.days, 40); // 10 semanas × 4 días de guerra
  assert.equal(by('KING KILLER').rank, 1);
  assert.ok(Math.abs(by('KING KILLER').perDeck - by('KING KILLER').medals / 160) < 1e-9);
});

const hasReportlab = spawnSync('python3', ['-c', 'import reportlab'], { stdio: 'ignore' }).status === 0;
test('PDFs de jugadores: informe del clan y ficha', { skip: !hasReportlab && 'falta reportlab' }, () => {
  const { war, history } = makeHistory();
  const report = buildPlayersReport(war, history, parseKickOpts(new URLSearchParams('')));
  for (const [mode, tag] of [['clan', ''], ['player', report.players.find((p) => p.name === 'Ivanius2005').tag]]) {
    const r = spawnSync('python3', [path.join(__dirname, '..', 'scripts', 'pdf_players.py')], {
      input: JSON.stringify({ mode, report, tag, generatedAt: '2026-10-22T08:00:00Z', tz: 'Europe/Madrid' }), maxBuffer: 20e6,
    });
    assert.equal(r.status, 0, r.stderr.toString());
    assert.equal(r.stdout.subarray(0, 5).toString(), '%PDF-');
    require('node:fs').writeFileSync(`/tmp/pdf-${mode}.pdf`, r.stdout);
  }
});
