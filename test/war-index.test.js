'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const fs = require('fs'); const path = require('path');
const { WarIndex, lastWeekKeys } = require('../lib/war-index');
const R = require('../lib/rankings');

test('índice de guerra: guarda a los jugadores de los 5 clanes y los recuerda en disco', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wi-')), 'war-index.json');
  const ix = new WarIndex(file);
  ix.ingest({ items: [{ seasonId: 137, sectionIndex: 1, createdDate: '20261019T093505.000Z', standings: [
    { rank: 1, trophyChange: 20, clan: { tag: '#A', name: 'Clan A', participants: [{ tag: '#P1', decksUsed: 16, fame: 3000, boatAttacks: 1 }] } },
    { rank: 3, trophyChange: -5, clan: { tag: '#B', name: 'Clan B', participants: [{ tag: '#P2', decksUsed: 8, fame: 1200 }] } },
  ] }] });
  assert.deepEqual(ix.get('#P2')['2026-10-19'], { clan: { tag: '#B', name: 'Clan B' }, decks: 8, medals: 1200, rank: 3, boat: 0 });
  assert.equal(ix.weeks['2026-10-19'].label, 'T137·S2');
  ix.save();
  assert.deepEqual(new WarIndex(file).get('#P1')['2026-10-19'], { clan: { tag: '#A', name: 'Clan A' }, decks: 16, medals: 3000, rank: 1, boat: 1 });
});

test('índice de guerra: las 10 últimas semanas cerradas acaban en lunes', () => {
  const k = lastWeekKeys(3, Date.parse('2026-10-26T12:00:00Z'));
  assert.deepEqual(k, ['2026-10-26', '2026-10-19', '2026-10-12']);
  assert.equal(lastWeekKeys(1, Date.parse('2026-10-26T08:00:00Z'))[0], '2026-10-19'); // aún no ha cerrado
});

test('coliseo: la semana que acaba el primer lunes de un mes (4.ª o 5.ª de la temporada)', () => {
  assert.equal(R.isColosseumWeek(Date.parse('2026-09-28T12:00:00Z')), true);   // acaba el 5 de octubre
  assert.equal(R.isColosseumWeek(Date.parse('2026-10-19T12:00:00Z')), false);
  assert.equal(R.isColosseumWeek(Date.parse('2026-10-27T12:00:00Z')), true);   // acaba el 2 de noviembre
  assert.equal(R.isColosseumWeek(Date.parse('2026-11-23T12:00:00Z')), false);
  assert.equal(R.isColosseumWeek(Date.parse('2026-12-01T12:00:00Z')), true);   // acaba el 7 de diciembre (5.ª semana)
});
