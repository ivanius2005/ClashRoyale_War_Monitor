'use strict';
/*
 * Horarios en una zona horaria concreta (por defecto Europe/Madrid), sin dependencias.
 * Sirve para lanzar el informe a las 08:00 de los días de guerra aunque la Raspberry
 * esté en UTC y aunque cambie la hora (último domingo de marzo y de octubre).
 */

const WEEKDAYS = { sun: 0, dom: 0, mon: 1, lun: 1, tue: 2, mar: 2, wed: 3, mie: 3, 'mié': 3, thu: 4, jue: 4, fri: 5, vie: 5, sat: 6, sab: 6, 'sáb': 6 };

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second,
    weekday: WEEKDAYS[o.weekday.toLowerCase()],
  };
}

// Diferencia (ms) entre la hora local de tz y UTC en ese instante
function offset(date, tz) {
  const p = parts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// Instante UTC de una hora local de tz (y-m-d h:mi)
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offset(new Date(guess), tz);
  t = guess - offset(new Date(t), tz); // segunda pasada por si el cambio de hora cae en medio
  return new Date(t);
}

function dateKey(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseDays(s) {
  const days = String(s || '').split(',').map((x) => WEEKDAYS[x.trim().toLowerCase()]).filter((x) => x != null);
  return days.length ? [...new Set(days)] : [5, 6, 0, 1];
}

// Próximo momento (estrictamente después de now) que cae a hour:minute en uno de los días
function nextRun(now, { hour, minute = 0, days, tz }) {
  const p = parts(now, tz);
  for (let k = 0; k <= 8; k++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + k, 12));
    const dp = { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), weekday: base.getUTCDay() };
    if (!days.includes(dp.weekday)) continue;
    const at = zonedToUtc(dp.year, dp.month, dp.day, hour, minute, tz);
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error('No hay ningún día de informe configurado');
}

// ¿Toca recuperar el informe de hoy? (el servidor arrancó tarde: entre la hora y graceHours después)
function inCatchUpWindow(now, { hour, minute = 0, days, tz, graceHours = 3 }) {
  const p = parts(now, tz);
  if (!days.includes(p.weekday)) return false;
  const start = zonedToUtc(p.year, p.month, p.day, hour, minute, tz).getTime();
  return now.getTime() >= start && now.getTime() < start + graceHours * 3600e3;
}

module.exports = { parts, offset, zonedToUtc, dateKey, parseDays, nextRun, inCatchUpWindow };
