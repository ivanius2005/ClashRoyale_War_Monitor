'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/rankings');
const A = require('../lib/analysis');
const V = require('../lib/player-view');

const list = Array.from({ length: 100 }, (_, i) => ({ tag: `#C${i}`, rank: i + 1, clanScore: 6000 - i * 10 }));

test('ranking: ganar sube, perder baja, fuera del top es N/A', () => {
  const our = list[49]; // 50º con 5.510
  const f = R.forecast({ list, ourTag: our.tag, ourTrophies: our.clanScore, top: 100, runs: 400 });
  assert.equal(f.current, 50);
  assert.ok(f.outcomes[0].median <= 50 && f.outcomes[4].median >= 50);
  assert.deepEqual(f.outcomes.map((o) => o.delta), [20, 10, -5, -10, -20]);
  const out = R.forecast({ list, ourTag: '#YO', ourTrophies: 4000, top: 100, runs: 200 });
  assert.equal(out.current, null);
  assert.ok(out.outcomes.every((o) => o.pIn === 0));
  const col = R.forecast({ list, ourTag: our.tag, ourTrophies: our.clanScore, top: 100, runs: 50, colosseum: true });
  assert.deepEqual(col.outcomes.map((o) => o.delta), [100, 50, -25, -50, -100]);
});

test('análisis: semana de coliseo y medallas de verdad (no el avance del barco)', () => {
  const st = (rank, tc, fame, parts) => ({ rank, trophyChange: tc, clan: { tag: `#T${rank}`, name: `C${rank}`, fame, clanScore: 4000, participants: parts } });
  const me = (tc) => ({ rank: 2, trophyChange: tc, clan: { tag: '#YO', name: 'Yo', fame: 9000, clanScore: 4100, participants: [{ tag: '#a', name: 'a', fame: 3000, decksUsed: 16 }, { tag: '#b', name: 'b', fame: 1000, decksUsed: 8 }] } });
  const riverlog = { items: [
    { seasonId: 1, sectionIndex: 1, createdDate: '20261019T093505.000Z', standings: [st(1, 20, 10000, []), me(10)] },
    { seasonId: 0, sectionIndex: 3, createdDate: '20261005T093505.000Z', standings: [st(1, 100, 50000, []), me(50)] },
  ] };
  const w = A.buildWeek({ tag: '#YO', riverlog, daily: [], members: [{ tag: '#a', name: 'a' }, { tag: '#c', name: 'c' }] });
  assert.equal(w.colosseum, false); assert.equal(w.totals.medals, 4000); assert.equal(w.totals.none, 1);
  const c = A.buildWeek({ tag: '#YO', riverlog, daily: [], members: [], colosseum: true });
  assert.equal(c.colosseum, true); assert.equal(c.label, 'Temporada 0, semana 4');
  assert.throws(() => A.buildDay({ tag: '#YO', race: null, daily: [], members: [] }), /Aún no hay/);
});

test('jugador: el campeón que la API no da se saca de la última partida con ese mazo', () => {
  const card = (id, rarity = 'common') => ({ id, name: `c${id}`, level: 1, maxLevel: rarity === 'champion' ? 6 : 16, rarity, iconUrls: { medium: 'x' } });
  const deck7 = [1, 2, 3, 4, 5, 6, 7].map((i) => card(i));
  const profile = { tag: '#P', name: 'p', cards: [...deck7, card(99, 'champion')], currentDeck: deck7 };
  const log = [{ type: 'PvP', battleTime: '20261022T120000.000Z', team: [{ crowns: 1, cards: [...deck7, card(99, 'champion')] }], opponent: [{ crowns: 0 }] }];
  const v = V.build(profile, log, null, null);
  assert.equal(v.cards.deck.length, 8);
  assert.equal(v.cards.deck[7].champion, true);
  assert.equal(V.build(profile, [], null, null).cards.deck[7].unknown, true);
});
