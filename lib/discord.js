'use strict';
/*
 * Informe de las 08:00 en Discord (webhook). Sin dependencias: fetch de Node 18+.
 * Límites de Discord: descripción 4096, cada campo 1024, todo el mensaje 6000.
 */
const { pct, fmt } = require('../public/js/news.js');

const GREEN = 0x39ff14;
const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
// Flecha = si el número sube o baja; color = si es buena o mala noticia para nosotros
const arrow = (c) => `${c.good === true ? '🟢' : c.good === false ? '🔴' : '⚪'} ${c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '•'}`;

function standings(sum) {
  return sum.clans.map((c) => {
    const main = sum.race.colosseum ? `${fmt(c.weekMedals || 0)} medallas` : `${fmt(c.progress)} de avance`;
    const chance = c.week ? ` · 1º: ${pct(c.week.pFirst)}` : '';
    const line = `${c.position}. ${c.own ? `**${c.name}**` : c.name} — ${main} · hoy ${fmt(c.medalsToday)} (${c.decksToday}/200)${chance}`;
    return line;
  }).join('\n');
}

function pendingList(own, max = 1024) {
  if (!own || !own.pending.length) return 'Nadie: ¡todos han jugado sus 4 mazos!';
  const items = own.pending.map((p) => `${p.name} (${p.left})`);
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const rest = items.length - i;
    const next = (out ? ', ' : '') + items[i];
    if ((out + next).length > max - 20) return `${out} y ${rest} más`;
    out += next;
  }
  return out;
}

function headline(sum) {
  const own = sum.clans.find((c) => c.own);
  if (!own) return '';
  const lines = [];
  const others = sum.clans.filter((c) => !c.own);
  if (sum.race.colosseum) {
    lines.push(`Vamos **${own.position}º** en el coliseo con ${fmt(own.weekMedals || 0)} medallas.`);
  } else {
    const rival = own.position === 1 ? others[0] : sum.clans.find((c) => c.position === 1 && !c.own);
    const gap = rival ? Math.abs(own.progress - rival.progress) : 0;
    lines.push(own.position === 1
      ? `Vamos **1º** con ${fmt(own.progress)} puntos de avance${rival ? `, ${fmt(gap)} por delante de ${rival.name}` : ''}.`
      : `Vamos **${own.position}º** con ${fmt(own.progress)} puntos de avance, a ${fmt(gap)} de ${rival ? rival.name : 'el primero'}.`);
  }
  if (own.week) {
    const split = !sum.race.colosseum && own.week.pTieFirst > 0.01
      ? ` (solos ${pct(own.week.pWinAlone)}, empatados ${pct(own.week.pTieFirst)})` : '';
    lines.push(`Opciones de terminar 1º: **${pct(own.week.pFirst)}**${split}.`);
  }
  if (sum.own) {
    lines.push(sum.own.decksLeft
      ? `Hoy llevamos ${fmt(own.medalsToday)} medallas y ${own.decksToday}/200 mazos: **quedan ${sum.own.decksLeft}** de ${sum.own.playersPending} jugadores.`
      : `Hoy llevamos ${fmt(own.medalsToday)} medallas y los 200 mazos jugados.`);
  }
  return lines.join('\n');
}

function formatReport(report, publicUrl) {
  const sum = report.summary;
  const time = new Date(report.generatedAt).toLocaleTimeString('es-ES', { timeZone: report.tz || 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
  const fields = [{ name: 'Clasificación', value: clip(standings(sum), 1024) }];
  if (report.changes && report.changes.length) {
    fields.push({ name: 'Cambios desde el último informe', value: clip(report.changes.map((c) => `${arrow(c)} ${c.text}`).join('\n'), 1024) });
  }
  if (!sum.race.training && sum.own) {
    fields.push({ name: `Mazos pendientes (${sum.own.decksLeft})`, value: pendingList(sum.own) });
  }
  const embed = {
    title: clip(`⚔️ ${sum.own ? sum.own.name : 'Guerra'} · ${sum.race.label} · ${time}`, 256),
    description: clip(headline(sum), 4096),
    color: GREEN,
    fields,
    footer: { text: 'Monitor de guerra · datos de la API oficial de Clash Royale' },
    timestamp: report.generatedAt,
  };
  if (publicUrl) embed.url = publicUrl;
  return { username: 'Monitor de guerra', embeds: [embed] };
}

// file (opcional): { name, data: Buffer } → se adjunta al mensaje (p. ej. el PDF del informe)
async function send(webhookUrl, payload, file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let body, headers;
    if (file) {
      body = new FormData();
      body.append('payload_json', JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file.name }] }));
      body.append('files[0]', new Blob([file.data], { type: 'application/pdf' }), file.name);
    } else {
      body = JSON.stringify(payload);
      headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(`${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}wait=true`, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return true;
    if (res.status === 429 && attempt === 0) {
      let wait = 2;
      try { wait = Math.min(30, (await res.json()).retry_after || 2); } catch { /* sin cuerpo */ }
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Discord respondió ${res.status}`);
  }
  return false;
}

module.exports = { formatReport, send, pendingList, headline };
