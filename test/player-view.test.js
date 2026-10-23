'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../lib/player-view');

const ic = (...k) => Object.fromEntries(['medium', ...k].map((x) => [x, `https://x/${x}.png`]));
const profile = {
  tag: '#AAA', name: 'Prueba', expLevel: 60, clan: { tag: '#CLAN', name: 'Clan' }, role: 'elder',
  cards: [
    { id: 1, name: 'Común', level: 16, maxLevel: 16, rarity: 'common', iconUrls: ic('evolutionMedium'), evolutionLevel: 1 },
    { id: 2, name: 'Legendaria', level: 6, maxLevel: 8, rarity: 'legendary', iconUrls: ic('heroMedium'), evolutionLevel: 2 },
    { id: 3, name: 'Las dos', level: 11, maxLevel: 11, rarity: 'epic', iconUrls: ic('evolutionMedium', 'heroMedium'), evolutionLevel: 3 },
    { id: 4, name: 'Solo héroe de dos', level: 14, maxLevel: 14, rarity: 'rare', iconUrls: ic('evolutionMedium', 'heroMedium'), evolutionLevel: 2 },
  ],
  currentDeck: [{ id: 1, name: 'Común', level: 16, maxLevel: 16, elixirCost: 3, iconUrls: ic('evolutionMedium'), evolutionLevel: 1 }],
  supportCards: [{ id: 9, name: 'Torre', level: 6, maxLevel: 11 }],
};
const b = (me, opp, type = 'PvP') => ({ type, battleTime: '20261022T120000.000Z', team: [{ crowns: me }], opponent: [{ crowns: opp, name: 'R' }] });

test('jugador: niveles del juego, evoluciones y héroes', () => {
  const v = V.build(profile, [], null, null);
  assert.deepEqual(v.cards.byLevel, [{ level: 16, n: 3 }, { level: 14, n: 1 }]); // 6/8 legendaria = 14
  assert.deepEqual(v.cards.evolutions.map((x) => x.name), ['Común', 'Las dos']);
  assert.deepEqual(v.cards.heroes.map((x) => x.name), ['Legendaria', 'Las dos', 'Solo héroe de dos']);
  assert.equal(v.cards.tower[0].level, 11);   // 6/11 → 11
  assert.equal(v.clan.role, 'Veterano');
});

test('jugador: últimas 15 batallas y porcentaje de victorias', () => {
  const log = [...Array(10).fill(b(2, 1)), ...Array(5).fill(b(0, 1, 'riverRacePvP')), ...Array(10).fill(b(1, 1))];
  const v = V.build(profile, log, null, null);
  assert.equal(v.battles.list.length, 15);
  assert.equal(v.battles.wins, 10); assert.equal(v.battles.losses, 5);
  assert.ok(Math.abs(v.battles.winRate - 10 / 15) < 1e-9);
  assert.equal(v.battles.warInLog, 5);
});

test('jugador: actividad en la guerra de su clan', () => {
  const wk = (decks) => ({ seasonId: 137, sectionIndex: 0, standings: [{ clan: { tag: '#CLAN', participants: decks == null ? [] : [{ tag: '#AAA', decksUsed: decks, fame: decks * 200 }] } }] });
  const race = { clan: { tag: '#CLAN', participants: [{ tag: '#AAA', decksUsed: 6, decksUsedToday: 2, fame: 1200 }] } };
  const act = (weeks) => V.build(profile, [], race, { items: weeks.map(wk) }).war;
  assert.equal(act([16, 16, 15, 16]).activity.level, 'muy-activo');
  assert.equal(act([10, 9, 12]).activity.level, 'activo');
  assert.equal(act([4, 0, 2]).activity.level, 'poco');
  assert.equal(act([0, 0]).activity.level, 'no');
  const w = act([null, 16]);
  assert.equal(w.weeks[0].present, false); assert.equal(w.activity.weeksSeen, 1);
  assert.deepEqual(w.thisWeek, { decksUsed: 6, decksUsedToday: 2, fame: 1200 });
  assert.equal(V.build({ ...profile, clan: null }, [], null, null).war.activity.level, 'sin-clan');
});
