'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../lib/schedule');
const { buildSummary } = require('../lib/summary');
const discord = require('../lib/discord');
const news = require('../public/js/news.js');
const fixture = require('./fixtures/carrera-2026-10-10.json');

const OPTS = { hour: 8, minute: 0, days: [5, 6, 0, 1], tz: 'Europe/Madrid' };
const iso = (d) => d.toISOString();

/* ---------- calendario ---------- */

test('informe: el jueves por la mañana el siguiente es el viernes a las 08:00 (hora de verano)', () => {
  const next = schedule.nextRun(new Date('2026-10-22T08:00:00Z'), OPTS); // jueves 10:00 en Madrid
  assert.equal(iso(next), '2026-10-23T06:00:00.000Z');                     // viernes 08:00 CEST
});

test('informe: respeta el cambio de hora del 25 de octubre', () => {
  const next = schedule.nextRun(new Date('2026-10-25T08:00:00Z'), OPTS); // domingo 09:00 CET
  assert.equal(iso(next), '2026-10-26T07:00:00.000Z');                     // lunes 08:00 CET
});

test('informe: justo a las 08:00 del lunes, el siguiente es el viernes', () => {
  const next = schedule.nextRun(new Date('2026-10-26T07:00:00Z'), OPTS);
  assert.equal(iso(next), '2026-10-30T07:00:00.000Z');
});

test('informe: ventana para recuperar el informe si el servidor arrancó tarde', () => {
  assert.equal(schedule.inCatchUpWindow(new Date('2026-10-17T07:30:00Z'), OPTS), true);  // sábado 09:30
  assert.equal(schedule.inCatchUpWindow(new Date('2026-10-17T10:00:00Z'), OPTS), false); // sábado 12:00
  assert.equal(schedule.inCatchUpWindow(new Date('2026-10-21T07:00:00Z'), OPTS), false); // miércoles
});

test('informe: días y fechas en hora de Madrid', () => {
  assert.deepEqual(schedule.parseDays('fri,sat,sun,mon'), [5, 6, 0, 1]);
  assert.deepEqual(schedule.parseDays('vie, sáb'), [5, 6]);
  assert.equal(schedule.dateKey(new Date('2026-10-16T22:30:00Z'), 'Europe/Madrid'), '2026-10-17');
});

/* ---------- resumen con la carrera real del 10 de octubre ---------- */

const sum = buildSummary(fixture.payload, fixture.history, { runs: 4000, todayRuns: 3000, seed: 1 });

test('resumen: clasificación, mazos pendientes y medallas por mazo', () => {
  assert.deepEqual(sum.clans.map((c) => [c.name, c.position]), [
    ['Furia Ibérica', 1], ['Snipes', 2], ['The Ice King', 3], ['The Clashers', 3], ['CelestialBharat', 5],
  ]);
  const own = sum.clans[0];
  assert.equal(own.own, true);
  assert.equal(own.progress, 5670);
  assert.equal(own.decksToday, 83);
  assert.equal(sum.own.decksLeft, 117);
  assert.equal(sum.own.playersPending, 31);
  assert.equal(Math.round(own.perDeck * 100) / 100, 160.97); // lo mismo que RoyaleAPI
  assert.equal(sum.race.battleDay, 3);
});

test('resumen: probabilidades coherentes', () => {
  for (const c of sum.clans) {
    assert.ok(Math.abs(c.week.pWinAlone + c.week.pTieFirst - c.week.pFirst) < 1e-9);
  }
  const [furia, snipes] = sum.clans;
  assert.ok(furia.week.pFirst > snipes.week.pFirst, 'vamos por delante y con más medallas por mazo');
  assert.ok(Math.abs(furia.week.pTieFirst - snipes.week.pTieFirst) < 1e-9, 'el empate es el mismo para los dos');
  const winSolo = sum.clans.reduce((s, c) => s + c.week.pWinAlone, 0);
  assert.ok(winSolo <= 1 + 1e-9);
});

/* ---------- novedades ---------- */

test('novedades: puesto, avance, opciones y mazos', () => {
  const later = JSON.parse(JSON.stringify(sum));
  later.at = '2026-10-10T20:00:00Z';
  later.clans[0].decksToday = 160;
  later.clans[0].week.pFirst = sum.clans[0].week.pFirst + 0.1;
  const changes = news.diff(sum, later);
  assert.ok(changes.some((c) => c.kind === 'chance' && c.dir === 'up'));
  assert.ok(changes.some((c) => c.kind === 'decks' && /83 → 160/.test(c.text)));
});

test('novedades: otra carrera no se compara', () => {
  const other = JSON.parse(JSON.stringify(sum));
  other.at = '2026-11-10T20:00:00Z';
  const changes = news.diff(sum, other);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'race');
});

/* ---------- Discord ---------- */

test('discord: respeta los límites de tamaño y lista los pendientes', () => {
  const payload = discord.formatReport({ generatedAt: '2026-10-10T06:00:00Z', summary: sum, changes: [] }, 'https://guerra.example');
  const e = payload.embeds[0];
  const total = e.title.length + e.description.length + e.fields.reduce((s, f) => s + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `mensaje de ${total} caracteres`);
  for (const f of e.fields) assert.ok(f.value.length <= 1024, `${f.name}: ${f.value.length}`);
  assert.match(e.description, /Vamos \*\*1º\*\* con 5\.670/);
  const pending = e.fields.find((f) => f.name.startsWith('Mazos pendientes'));
  assert.match(pending.name, /117/);
  assert.match(pending.value, /Ivanius2005 \(4\)/);
  assert.match(pending.value, /Beti \(3\)/);
});

test('novedades: que un rival baje es buena noticia', () => {
  const later = JSON.parse(JSON.stringify(sum));
  later.at = '2026-10-10T20:00:00Z';
  const snipes = later.clans.find((c) => c.name === 'Snipes');
  snipes.week.pFirst = Math.max(0, sum.clans.find((c) => c.name === 'Snipes').week.pFirst - 0.2);
  const ch = news.diff(sum, later).find((c) => c.kind === 'rival');
  assert.equal(ch.dir, 'down');
  assert.equal(ch.good, true);
});
