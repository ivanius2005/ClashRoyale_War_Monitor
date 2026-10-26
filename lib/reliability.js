'use strict';
// Índice de fiabilidad de un jugador (0-100): cómo de bueno, estable y fiel es en la guerra.
//   - Nota (50 %): su nota con la fórmula de «Expulsiones» del clan de casa, de −1,5 (0) a +1,5 (1).
//   - Estabilidad (25 %): 1 − coeficiente de variación de sus medallas en las semanas que jugó (medallas parecidas
//     cada semana = estable; a rachas = inestable).
//   - Fidelidad (25 %): semanas seguidas en el mismo clan, contando desde la más reciente, de 10.
// Si falta alguna parte, se reparte su peso entre las demás. Alta ≥ 75 · Media ≥ 50 · Baja < 50.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// weeks: de la más reciente a la más antigua; cada una { decks, medals, clan } o null si no hay datos
function reliability({ score, weeks }) {
  const ws = Array.isArray(weeks) ? weeks : [];
  const nota = score == null ? null : clamp((score + 1.5) / 3, 0, 1);
  const played = ws.filter((w) => w && w.decks > 0).map((w) => w.medals);
  let estabilidad = null;
  if (played.length >= 2) {
    const mean = played.reduce((s, x) => s + x, 0) / played.length;
    const sd = Math.sqrt(played.reduce((s, x) => s + (x - mean) ** 2, 0) / played.length);
    estabilidad = mean > 0 ? clamp(1 - sd / mean, 0, 1) : 0;
  }
  // Fidelidad: desde la semana más reciente con datos, cuántas seguidas en ese mismo clan
  const first = ws.find((w) => w && w.clan);
  let streak = 0;
  if (first) {
    for (const w of ws.slice(ws.indexOf(first))) {
      if (!w || w.clan !== first.clan) break;
      streak += 1;
    }
  }
  const fidelidad = first ? streak / 10 : null;
  const clans = new Set(ws.filter((w) => w && w.clan).map((w) => w.clan)).size;
  const parts = [[nota, 0.5], [estabilidad, 0.25], [fidelidad, 0.25]].filter(([v]) => v != null);
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  if (!wsum || nota == null) return { index: null, label: 'Sin datos', nota, estabilidad, fidelidad, streak, clans };
  const index = Math.round(100 * parts.reduce((s, [v, w]) => s + v * w, 0) / wsum);
  return { index, label: index >= 75 ? 'Alta' : index >= 50 ? 'Media' : 'Baja', nota, estabilidad, fidelidad, streak, clans };
}

module.exports = { reliability };
