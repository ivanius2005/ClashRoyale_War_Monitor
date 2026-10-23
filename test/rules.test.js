'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CWCalc = require('../public/js/calc.js');
const CWSim = require('../public/js/sim.js');

test('reglas: máximo por jugador según los mazos que le quedan (duelo solo con 3 o más)', () => {
  for (const f of [CWCalc.maxForLeft, CWSim.maxForLeft]) {
    assert.deepEqual([0, 1, 2, 3, 4].map(f), [0, 200, 400, 700, 900]);
  }
});

test('reglas: un clan entero saca como mucho 45.000 al día', () => {
  const pending = Array.from({ length: 50 }, (_, i) => ({ tag: `#${i}`, left: 4 }));
  assert.equal(CWCalc.maxDay(pending, 200), 45000);
  // Con el cupo del clan lleno a medias, se reparten los mazos que quedan dando prioridad a quien puede hacer duelo
  assert.equal(CWCalc.maxDay(pending, 10), 900 + 900 + 400);
  // Dos jugadores con 2 mazos cada uno: sin duelo, solo batallas
  assert.equal(CWCalc.maxDay([{ left: 2 }, { left: 2 }], 200), 800);
});

test('reglas: la simulación nunca pasa del máximo real', () => {
  const t = { pending: Array.from({ length: 50 }, () => ({ left: 4, risk: 0 })), cap: 200, perDeck: 260 };
  const inputs = { pending: t.pending };
  assert.equal(CWSim.maxDay(inputs.pending, 200), 45000);
});
