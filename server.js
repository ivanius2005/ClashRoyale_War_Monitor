#!/usr/bin/env node
'use strict';
/*
 * Clash War Monitor — servidor
 * ----------------------------
 * - Guarda la API key en el servidor (nunca llega al navegador)
 * - Consulta la API oficial de Clash Royale a través del proxy de RoyaleAPI
 * - Sirve la web estática de ./public
 *
 * Requisitos: Node 18 o superior. Sin dependencias (no hace falta npm install).
 * Arranque:   node server.js
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadDotEnv(path.join(__dirname, '.env'));
const recorder = require('./lib/recorder');
const { buildSummary } = require('./lib/summary');
const { buildPlayersReport, parseKickOpts } = require('./lib/players-report');
const schedule = require('./lib/schedule');
const discord = require('./lib/discord');
const news = require('./public/js/news.js');
const { spawn } = require('node:child_process');

const host = process.env.HOST || '127.0.0.1';
const CONFIG = {
  port: Number(process.env.PORT) || 3055,
  host,
  apiBase: (process.env.CR_API_BASE || 'https://proxy.royaleapi.dev/v1').replace(/\/+$/, ''),
  apiKey: (process.env.CR_API_KEY || '').trim(),
  liveCacheMs: Math.max(5, Number(process.env.CACHE_SECONDS) || 30) * 1000,
  historyCacheMs: Math.max(60, Number(process.env.HISTORY_CACHE_SECONDS) || 600) * 1000,
  historyWeeks: Math.min(20, Math.max(1, Number(process.env.HISTORY_WEEKS) || 10)),
  clanTag: normalizeTag(process.env.CLAN_TAG || '') || null,
  // Clanes con registro diario de mazos (por defecto, el de CLAN_TAG si está puesto)
  trackClans: String(process.env.TRACK_CLANS || process.env.CLAN_TAG || '').split(',').map(normalizeTag).filter(Boolean),
  trackMinutes: Math.max(5, Number(process.env.TRACK_MINUTES) || 10),
  dataDir: path.resolve(__dirname, process.env.DATA_DIR || 'data'),
  corsOrigins: String(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  rateLimit: Math.max(0, Number(process.env.RATE_LIMIT_PER_MIN ?? 60)),
  // Solo se confía en la IP que manda Cloudflare si nadie más puede llegar al servidor
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : ['127.0.0.1', '::1', 'localhost'].includes(host),
  // Cloudflare Access: si está a 1, solo se atiende a quien llegue con la cabecera de Access
  requireAccess: process.env.REQUIRE_ACCESS === '1',
  // Ruta alternativa a /api para usarla desde otro dominio (p. ej. el dashboard: /guerra-api/summary)
  apiAlias: (process.env.API_ALIAS ?? '/guerra-api').replace(/\/+$/, ''),
  summaryRuns: Math.min(50000, Math.max(1000, Number(process.env.SUMMARY_RUNS) || 10000)),
  // Web pública: cualquier clan (CLAN_TAG sigue siendo el clan de casa: registro, informe y PDF)
  anyClan: process.env.ANY_CLAN === '1',
  newClansPerMin: Math.max(1, Number(process.env.NEW_CLANS_PER_MIN) || 10),
  summaryRunsOthers: Math.min(20000, Math.max(1000, Number(process.env.SUMMARY_RUNS_OTHERS) || 5000)),
  summaryCacheMs: Math.max(30, Number(process.env.SUMMARY_CACHE_SECONDS) || 60) * 1000,
  // Informe diario: por defecto a las 08:00 (hora de Madrid) de viernes a lunes
  reportEnabled: process.env.REPORT_ENABLED !== '0',
  reportTz: process.env.REPORT_TZ || 'Europe/Madrid',
  reportHour: Math.min(23, Math.max(0, Number(process.env.REPORT_HOUR ?? 8))),
  reportMinute: Math.min(59, Math.max(0, Number(process.env.REPORT_MINUTE ?? 0))),
  reportDays: schedule.parseDays(process.env.REPORT_DAYS || 'fri,sat,sun,mon'),
  discordWebhook: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  // PDF: lo genera scripts/pdf_report.py con reportlab (sudo apt install python3-reportlab)
  pdfPython: process.env.PDF_PYTHON || 'python3',
  pdfEnabled: process.env.PDF_ENABLED !== '0',
  publicUrl: (process.env.PUBLIC_URL || '').trim(),
};
const REPORT_DIR = path.join(CONFIG.dataDir, 'reports');

const PUBLIC_DIR = path.join(__dirname, 'public');
const TAG_RE = /^[0289PYLQGRJCUV]{3,12}$/; // alfabeto de los tags de Supercell
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

if (!CONFIG.apiKey) {
  console.error('✖ Falta CR_API_KEY. Copia .env.example a .env y pega tu clave de developer.clashroyale.com');
  process.exit(1);
}
if (CONFIG.clanTag && !TAG_RE.test(CONFIG.clanTag)) {
  console.error(`✖ CLAN_TAG no es un tag válido: ${process.env.CLAN_TAG}`);
  process.exit(1);
}
for (const t of CONFIG.trackClans) {
  if (!TAG_RE.test(t)) { console.error(`✖ TRACK_CLANS contiene un tag no válido: ${t}`); process.exit(1); }
}

/* ---------- utilidades ---------- */

function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function normalizeTag(raw) {
  let s;
  try { s = decodeURIComponent(raw); } catch { s = String(raw); }
  // Se acepta con o sin '#', en minúsculas, y la O se corrige a 0 (error típico al teclear)
  return s.trim().toUpperCase().replace(/^#+/, '').replace(/\s+/g, '').replace(/O/g, '0');
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !CONFIG.corsOrigins.length) return {};
  if (!CONFIG.corsOrigins.includes('*') && !CONFIG.corsOrigins.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

function json(req, res, status, data, extra = {}) {
  send(res, status, MIME['.json'], JSON.stringify(data), { 'Cache-Control': 'no-store', ...corsHeaders(req), ...extra });
}

const clientIp = (req) => (CONFIG.trustProxy && req.headers['cf-connecting-ip']) || req.socket.remoteAddress || '?';

/* ---------- límite de peticiones por IP (la web es pública) ---------- */

const hits = new Map();
function rateLimited(ip) {
  if (!CONFIG.rateLimit) return false;
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now - h.start > 60_000) h = { start: now, n: 0 };
  h.n += 1;
  hits.set(ip, h);
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > 60_000) hits.delete(k);
  return h.n > CONFIG.rateLimit;
}

/* ---------- API de Clash Royale ---------- */

// Contadores para vigilar el uso (GET /api/stats, solo desde la propia máquina)
const stats = { since: Date.now(), api: 0, apiErrors: 0, api429: 0, staleServed: 0, cacheHits: 0, cacheMisses: 0, rejected: 0, clans: new Map() };
const isHome = (tag) => !!CONFIG.clanTag && tag === CONFIG.clanTag;
const notFound = new Map();   // tags que no existen: no se vuelven a pedir en 10 min
const admitted = [];          // clanes nuevos admitidos en el último minuto

// Antes de consultar un clan que no es el de casa: ¿existe? ¿cabe otro clan nuevo este minuto?
function guardClan(tag) {
  if (isHome(tag)) return;
  const now = Date.now();
  stats.clans.set(tag, now);
  const nf = notFound.get(tag);
  if (nf && now - nf < 10 * 60e3) throw new ApiError(404, 'No hay ningún clan con ese tag, o el clan no está en una guerra ahora mismo.');
  if (caches.has(`war:${tag}`)) return; // ya consultado: no es nuevo
  while (admitted.length && now - admitted[0] > 60e3) admitted.shift();
  if (admitted.length >= CONFIG.newClansPerMin) {
    stats.rejected += 1;
    throw new ApiError(429, 'Hay mucha gente consultando clanes ahora mismo. Prueba de nuevo en un minuto.');
  }
  admitted.push(now);
}

async function cr(pathname, retry = true) {
  stats.api += 1;
  let res;
  try {
    res = await fetch(CONFIG.apiBase + pathname, {
      headers: { Authorization: `Bearer ${CONFIG.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    if (retry) { await new Promise((r) => setTimeout(r, 800)); return cr(pathname, false); }
    throw new ApiError(503, 'No se pudo contactar con la API de Clash Royale (sin conexión o tiempo agotado). Prueba en un minuto.');
  }
  if (res.ok) return res.json();
  // Fallo puntual del proxy o de la API (5xx): un reintento antes de rendirse
  if (res.status >= 500 && retry) { await new Promise((r) => setTimeout(r, 800)); return cr(pathname, false); }

  let reason = '';
  try { reason = (await res.json()).reason || ''; } catch { /* sin cuerpo */ }
  const known = {
    400: 'La API rechazó la petición: revisa el tag.',
    403: 'La API rechazó la clave. Comprueba CR_API_KEY y que la clave tenga la IP 45.79.218.79 en su lista.',
    404: 'No hay ningún clan con ese tag, o el clan no está en una guerra ahora mismo.',
    429: 'Demasiadas peticiones a la API. Espera unos segundos y vuelve a intentarlo.',
    503: 'La API de Clash Royale está en mantenimiento. Prueba más tarde.',
  };
  stats.apiErrors += 1;
  if (res.status === 429) stats.api429 += 1;
  const message = known[res.status] || `La API respondió ${res.status}${reason ? ` (${reason})` : ''}.`;
  // Un 403 de la API es un problema de configuración de este servidor, no del usuario.
  // Los 5xx de la API o del proxy nunca se reenvían tal cual: Cloudflare tomaría un 520/525 por un fallo de este servidor.
  if (res.status >= 500 && res.status !== 503) {
    throw new ApiError(503, `La API de Clash Royale (o el proxy de RoyaleAPI) está fallando ahora mismo (error ${res.status}). Prueba en un minuto.`);
  }
  throw new ApiError(res.status === 403 ? 502 : res.status, message);
}

// Caché con deduplicación: si 20 personas piden lo mismo a la vez, solo sale 1 petición
const caches = new Map();
// Último dato bueno de cada clave: si la API falla (5xx o sin conexión), se sirve esto (hasta 6 h) en vez de un error
const lastGood = new Map();
const STALE_MAX = 6 * 3600e3;
function cached(key, ttl, fn) {
  const hit = caches.get(key);
  if (hit && Date.now() - hit.at < ttl) { stats.cacheHits += 1; return hit.promise; }
  stats.cacheMisses += 1;
  const promise = fn().then(
    (v) => { lastGood.set(key, { at: Date.now(), v }); return v; },
    (e) => {
      const old = lastGood.get(key);
      if (e && e.status >= 500 && old && Date.now() - old.at < STALE_MAX) { stats.staleServed += 1; return old.v; }
      throw e;
    },
  );
  caches.set(key, { at: Date.now(), promise });
  promise.catch(() => caches.delete(key));
  if (caches.size > 500) caches.delete(caches.keys().next().value);
  if (lastGood.size > 500) lastGood.delete(lastGood.keys().next().value);
  return promise;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of caches) if (now - v.at > 30 * 60e3) caches.delete(k);
  for (const [k, v] of lastGood) if (now - v.at > STALE_MAX) lastGood.delete(k);
  for (const [k, t] of notFound) if (now - t > 10 * 60e3) notFound.delete(k);
  for (const [k, t] of stats.clans) if (now - t > 3600e3) stats.clans.delete(k);
}, 5 * 60e3).unref();

function raceClanTags(race) {
  return [...new Set([race.clan?.tag, ...(race.clans || []).map((c) => c.tag)].filter(Boolean))];
}

function getWar(tag) {
  return cached(`war:${tag}`, CONFIG.liveCacheMs, async () => {
    const race = await cr(`/clans/%23${tag}/currentriverrace`).catch((e) => {
      if (e && e.status === 404 && !isHome(tag)) notFound.set(tag, Date.now()); // tag inexistente: recordarlo
      throw e;
    });
    if (CONFIG.trackClans.includes(tag)) record(tag, race);
    // Miembros actuales de los 5 clanes: sirven para saber quién puede jugar todavía
    // (los "participants" incluyen a gente que ya se fue del clan).
    const rosters = {};
    await Promise.all(raceClanTags(race).map(async (t) => {
      try {
        const data = await cr(`/clans/${encodeURIComponent(t)}/members?limit=50`);
        rosters[t] = (data.items || []).map((m) => ({ tag: m.tag, name: m.name, role: m.role }));
      } catch {
        rosters[t] = null; // la web avisará y usará los participantes como respaldo
      }
    }));
    return { fetchedAt: new Date().toISOString(), race, rosters };
  });
}

// Reduce el registro de carreras de un clan a lo que necesitan la simulación y la
// fiabilidad de jugadores (la respuesta original trae los 5 clanes completos: ~300 KB).
function reduceRaceLog(items, tag, currentSectionIndex, withNames) {
  return items.map((it, i) => {
    const st = (it.standings || []).find((s) => s.clan && s.clan.tag === tag);
    if (!st) return null;
    const parts = Array.isArray(st.clan.participants) ? st.clan.participants : [];
    const medals = parts.length ? parts.reduce((s, p) => s + (p.fame || 0), 0) : (st.clan.fame || 0);
    // La última semana de cada temporada es la de coliseo
    const colosseum = i === 0 ? currentSectionIndex === 0 : items[i - 1].seasonId !== it.seasonId;
    return {
      seasonId: it.seasonId,
      sectionIndex: it.sectionIndex,
      createdDate: it.createdDate,
      rank: st.rank,
      trophyChange: st.trophyChange ?? null,
      medals,
      finishTime: st.clan.finishTime || null,
      colosseum,
      // [tag, mazos usados en la semana (máx. 16), medallas] de cada participante
      players: parts.map((pl) => [pl.tag, pl.decksUsed || 0, pl.fame || 0]),
      // Nombres solo del clan propio (para el miembro del mes, aunque ya no esté en el clan)
      ...(withNames ? { names: Object.fromEntries(parts.map((pl) => [pl.tag, pl.name])) } : {}),
    };
  }).filter(Boolean);
}

function getHistory(tag) {
  return cached(`history:${tag}`, CONFIG.historyCacheMs, async () => {
    const { race } = await getWar(tag);
    const clans = {};
    await Promise.all(raceClanTags(race).map(async (t) => {
      try {
        const data = await cr(`/clans/${encodeURIComponent(t)}/riverracelog?limit=${CONFIG.historyWeeks}`);
        const weeks = reduceRaceLog(data.items || [], t, race.sectionIndex, normalizeTag(t) === normalizeTag(tag));
        const bare = normalizeTag(t);
        let daily = null;
        if (CONFIG.trackClans.includes(bare)) {
          const counts = recorder.dailyCounts(recorder.load(recorder.fileFor(CONFIG.dataDir, bare)));
          const covered = recorder.attachDays(weeks, counts);
          daily = { since: counts.length ? new Date(counts[0].start).toISOString() : null, weeksCovered: covered };
        }
        clans[t] = { weeks, daily };
      } catch (e) {
        clans[t] = { weeks: null, error: e.message };
      }
    }));
    return { fetchedAt: new Date().toISOString(), weeksRequested: CONFIG.historyWeeks, clans };
  });
}

// Búsqueda de clanes por nombre (API oficial: mínimo 3 letras)
function searchClans(q) {
  return cached(`search:${q.toLowerCase()}`, 5 * 60 * 1000, async () => {
    const data = await cr(`/clans?name=${encodeURIComponent(q)}&limit=15`);
    return {
      items: (data.items || []).map((c) => ({
        tag: c.tag, name: c.name, members: c.members, clanWarTrophies: c.clanWarTrophies,
        clanScore: c.clanScore, type: c.type,
        location: c.location ? c.location.name : null,
        countryCode: c.location && c.location.isCountry ? c.location.countryCode : null,
      })),
    };
  });
}

/* ---------- resumen en directo ---------- */

function getSummary(tag) {
  return cached(`summary:${tag}`, CONFIG.summaryCacheMs, async () => {
    const war = await getWar(tag);
    let history = null;
    try { history = await getHistory(tag); } catch (e) { console.error(`Historial de #${tag}: ${e.message}`); }
    return buildSummary(war, history, { runs: isHome(tag) ? CONFIG.summaryRuns : CONFIG.summaryRunsOthers, daily: dailyFor(tag) });
  });
}

// Mazos y medallas por día del registro (solo para los clanes en TRACK_CLANS)
function dailyFor(tag) {
  const bare = normalizeTag(tag);
  if (!CONFIG.trackClans.includes(bare)) return null;
  try { return recorder.dailyCounts(recorder.load(recorder.fileFor(CONFIG.dataDir, bare))); } catch { return null; }
}

/* ---------- PDF ---------- */

const slug = (sum) => {
  const own = sum.clans.find((c) => c.own);
  return `${(own ? own.name : 'guerra').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-guerra`;
};
const stamp = (iso) => {
  const p = schedule.parts(new Date(iso), CONFIG.reportTz);
  const z = (n) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}-${z(p.hour)}${z(p.minute)}`;
};

function sendPdf(res, buf, filename) {
  res.writeHead(200, {
    'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
    // inline: se abre en el navegador (en el móvil, desde ahí se comparte a WhatsApp)
    'Content-Disposition': `inline; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

function renderPdf(data, script = 'pdf_report.py') {
  return new Promise((resolve, reject) => {
    const child = spawn(CONFIG.pdfPython, [path.join(__dirname, 'scripts', script)], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('El PDF tardó demasiado.')); }, 45_000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`No se pudo ejecutar ${CONFIG.pdfPython}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0 && buf.subarray(0, 5).toString() === '%PDF-') return resolve(buf);
      const msg = Buffer.concat(err).toString();
      if (/No module named 'reportlab'/.test(msg)) return reject(new Error('Falta reportlab: sudo apt install python3-reportlab'));
      console.error(msg.split('\n').slice(-6).join('\n'));
      reject(new Error('No se pudo generar el PDF.'));
    });
    child.stdin.end(JSON.stringify(data));
  });
}

/* ---------- informe diario ---------- */

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function listReports() {
  let files = [];
  try { files = fs.readdirSync(REPORT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch { return []; }
  return files.sort().reverse().map((f) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'));
      return { date: r.date, generatedAt: r.generatedAt, battleDay: r.summary.race.battleDay, label: r.summary.race.label };
    } catch { return null; }
  }).filter(Boolean);
}

function latestReport() {
  const [first] = listReports();
  if (!first) return null;
  try { return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, `${first.date}.json`), 'utf8')); } catch { return null; }
}

async function generateReport({ sendDiscord = true, now = new Date() } = {}) {
  const tag = CONFIG.clanTag;
  if (!tag) throw new Error('Falta CLAN_TAG en el .env: el informe diario es del clan propio.');
  caches.delete(`war:${tag}`); // datos recién pedidos, no los de la caché
  const war = await getWar(tag);
  let history = null;
  try { history = await getHistory(tag); } catch (e) { console.error(`Historial de #${tag}: ${e.message}`); }
  const summary = buildSummary(war, history, { runs: Math.max(CONFIG.summaryRuns, 20000), daily: dailyFor(tag) });
  if (summary.race.training) return { skipped: 'La carrera está en días de entrenamiento: hoy no hay informe.' };
  const prev = latestReport();
  const same = !!(prev && news.sameRace(prev.summary, summary));
  const report = {
    generatedAt: now.toISOString(), date: schedule.dateKey(now, CONFIG.reportTz), tz: CONFIG.reportTz,
    summary, changes: same ? news.diff(prev.summary, summary, { minPct: 0.02 }) : [],
    previousAt: same ? prev.generatedAt : null, discord: null,
  };
  let pdf = null;
  if (CONFIG.pdfEnabled) {
    try {
      pdf = await renderPdf({ summary, generatedAt: report.generatedAt, tz: CONFIG.reportTz });
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(path.join(REPORT_DIR, `${report.date}.pdf`), pdf);
      report.pdf = true;
    } catch (e) { report.pdf = false; console.error(`PDF del informe: ${e.message}`); }
  }
  if (sendDiscord && CONFIG.discordWebhook) {
    const file = pdf ? { name: `${slug(summary)}-${stamp(report.generatedAt)}.pdf`, data: pdf } : null;
    try { await discord.send(CONFIG.discordWebhook, discord.formatReport(report, CONFIG.publicUrl), file); report.discord = file ? 'enviado con PDF' : 'enviado'; }
    catch (e) { report.discord = `error: ${e.message}`; console.error(`Informe a Discord: ${e.message}`); }
  }
  writeJsonAtomic(path.join(REPORT_DIR, `${report.date}.json`), report);
  return report;
}

const reportOpts = () => ({ hour: CONFIG.reportHour, minute: CONFIG.reportMinute, days: CONFIG.reportDays, tz: CONFIG.reportTz });

async function runReport(why) {
  try {
    const r = await generateReport();
    console.log(r.skipped ? `  Informe (${why}): ${r.skipped}` : `  Informe (${why}) guardado: ${r.date}${r.discord ? ` · Discord: ${r.discord}` : ''}`);
  } catch (e) {
    console.error(`  Informe (${why}) fallido: ${e.message}`);
  }
}

function scheduleReports() {
  const at = schedule.nextRun(new Date(), reportOpts());
  setTimeout(async () => { await runReport('programado'); scheduleReports(); }, Math.max(1000, at.getTime() - Date.now()));
  console.log(`  Próximo informe: ${at.toLocaleString('es-ES', { timeZone: CONFIG.reportTz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`);
}

/* ---------- registro diario de mazos ---------- */

function record(tag, race) {
  try {
    const file = recorder.fileFor(CONFIG.dataDir, tag);
    recorder.save(file, recorder.observe(recorder.load(file), race, Date.now()));
  } catch (e) {
    console.error(`Registro diario de #${tag}: ${e.message}`);
  }
}

async function recordAll() {
  for (const tag of CONFIG.trackClans) {
    try { record(tag, await cr(`/clans/%23${tag}/currentriverrace`)); }
    catch (e) { console.error(`Registro diario de #${tag}: ${e.message}`); }
  }
}

/* ---------- ficheros estáticos ---------- */

function serveStatic(res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return send(res, 400, 'text/plain; charset=utf-8', 'Ruta no válida'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'text/plain; charset=utf-8', 'Prohibido');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', 'No encontrado');
    send(res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', buf, { 'Cache-Control': 'no-cache' });
  });
}

/* ---------- rutas ---------- */

function tagFrom(req, res, raw) {
  const tag = normalizeTag(raw);
  if (!TAG_RE.test(tag)) {
    json(req, res, 400, { error: 'Tag no válido: solo puede contener 0 2 8 9 P Y L Q G R J C U V.' });
    return null;
  }
  if (CONFIG.clanTag && !CONFIG.anyClan && tag !== CONFIG.clanTag) {
    json(req, res, 403, { error: `Este servidor solo consulta el clan #${CONFIG.clanTag}.` });
    return null;
  }
  guardClan(tag); // puede lanzar 404 (no existe) o 429 (demasiados clanes nuevos): lo responde route()
  return tag;
}

const ACCESS_PAGE = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso restringido</title><body style="background:#0a0d0b;color:#d6e2da;font:15px ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:30em;padding:2em;border:1px solid #1f2b23"><p style="color:#39ff14;margin:0 0 .6em">// ACCESO RESTRINGIDO</p>
<p>Esta página solo se puede abrir a través de Cloudflare Access. Si te han dado acceso, entra por la dirección pública que te pasaron.</p></main></body></html>`;

// Página para los miembros del clan: la tarjeta del dashboard a pantalla completa.
// Se monta al vuelo desde deploy/dashboard-card.html, así siempre es la versión actual.
// Página de un clan: la tarjeta a pantalla completa, con buscador de clan y aviso de contenido de fans
function clanPage(tag, home) {
  const card = fs.readFileSync(path.join(__dirname, 'deploy', 'dashboard-card.html'), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
  const search = CONFIG.anyClan ? `<form class="pick" action="/c/" onsubmit="event.preventDefault();var t=this.t.value.toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/O/g,'0');if(/^[0289PYLQGRJCUV]{3,12}$/.test(t))location.href='/c/'+t;else this.t.setCustomValidity('Tag no válido'),this.t.reportValidity();">
  <label for="t">¿Otro clan?</label><input id="t" name="t" placeholder="#TAG del clan" autocomplete="off" autocapitalize="characters" spellcheck="false" oninput="this.setCustomValidity('')"><button>Ver</button>${CONFIG.clanTag && !home ? `<a href="/">Volver a #${CONFIG.clanTag}</a>` : ''}</form>` : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#050805"><title>Guerra de clanes${tag && !home ? ` · #${tag}` : ''}</title>
<style>html{background:#050805;color-scheme:dark}body{margin:0;padding:max(16px,env(safe-area-inset-top)) 12px max(24px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:14px;font:14px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;color:#dde9e0}
.pick{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;max-width:1100px}
.pick label{color:#9bb0a0;font-size:12.5px}
.pick input{font:inherit;font-size:16px;flex:1;min-width:9em;max-width:16em;background:#101a14;color:#f5fbf6;border:1px solid #1f2e24;border-radius:999px;padding:7px 14px}
.pick button{font:inherit;font-weight:700;background:#00ff41;color:#021004;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}
.pick a{color:#9bb0a0;font-size:12.5px;margin-left:auto}
.fan{max-width:1100px;color:#6e8474;font-size:11.5px;text-align:center;margin:0}
.pick input:focus-visible,.pick button:focus-visible{outline:2px solid #00ff41;outline-offset:2px}</style>
</head><body>${search}<script>window.CW_CARD_TAG=${JSON.stringify(tag || '')};window.CW_CARD_HOME=${home ? 'true' : 'false'};</script>${card}
<p class="fan">Contenido de fans, no afiliado ni respaldado por Supercell. Datos de la API oficial de Clash Royale.</p></body></html>`;
}

const accessEmail = (req) => String(req.headers['cf-access-authenticated-user-email'] || '').trim().toLowerCase() || null;

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname;
  if (CONFIG.apiAlias && (p === CONFIG.apiAlias || p.startsWith(`${CONFIG.apiAlias}/`))) p = `/api${p.slice(CONFIG.apiAlias.length)}`;

  if (req.method === 'OPTIONS' && p.startsWith('/api/')) {
    res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Accept', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'Método no permitido' });

  if (p === '/api/health') return json(req, res, 200, { ok: true });
  if (CONFIG.requireAccess && !accessEmail(req)) {
    if (p.startsWith('/api/')) return json(req, res, 401, { error: 'Acceso solo a través de Cloudflare Access.' });
    return send(res, 401, 'text/html; charset=utf-8', ACCESS_PAGE, { 'Cache-Control': 'no-store' });
  }
  // Portada: la tarjeta. El monitor clásico, en /monitor (sus rutas son relativas, siguen valiendo)
  if (p === '/monitor') return serveStatic(res, '/index.html');
  if (p === '/monitor/') return send(res, 301, 'text/plain; charset=utf-8', '', { Location: '/monitor' });
  if (p === '/' || p === '/clan' || p === '/clan/') return send(res, 200, 'text/html; charset=utf-8', clanPage(CONFIG.clanTag, true), { 'Cache-Control': 'no-store' });
  const mc = p.match(/^\/c\/([^/]+)\/?$/); // página de cualquier clan: /c/LVR980LQ
  if (mc) {
    const t = normalizeTag(decodeURIComponent(mc[1]));
    if (!TAG_RE.test(t) || (CONFIG.clanTag && !CONFIG.anyClan && t !== CONFIG.clanTag)) return send(res, 302, 'text/plain', '', { Location: '/' });
    return send(res, 200, 'text/html; charset=utf-8', clanPage(t, isHome(t)), { 'Cache-Control': 'no-store' });
  }
  // Contadores de uso: solo desde la propia máquina (sin pasar por Cloudflare)
  if (p === '/api/stats') {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'];
    if (!local) return json(req, res, 404, { error: 'No encontrado.' });
    const hour = Date.now() - 3600e3;
    return json(req, res, 200, {
      desde: new Date(stats.since).toISOString(), peticionesApi: stats.api, erroresApi: stats.apiErrors, errores429: stats.api429,
      cache: { aciertos: stats.cacheHits, fallos: stats.cacheMisses, datosDeReserva: stats.staleServed }, clanesRechazados: stats.rejected,
      clanesUltimaHora: [...stats.clans.values()].filter((t) => t > hour).length, enCache: caches.size, tagsInexistentes: notFound.size,
    });
  }
  if (!p.startsWith('/api/')) return serveStatic(res, p);
  if (rateLimited(clientIp(req))) {
    return json(req, res, 429, { error: 'Demasiadas consultas seguidas. Espera un minuto.' }, { 'Retry-After': '60' });
  }
  if (p === '/api/config') {
    return json(req, res, 200, {
      clanTag: CONFIG.clanTag && !CONFIG.anyClan ? `#${CONFIG.clanTag}` : null, historyWeeks: CONFIG.historyWeeks,
      homeTag: CONFIG.clanTag ? `#${CONFIG.clanTag}` : null, anyClan: CONFIG.anyClan,
      reports: !!CONFIG.clanTag, // los informes guardados se enseñan aunque el programado esté apagado
      pdf: !!CONFIG.clanTag && CONFIG.pdfEnabled,
      report: { hour: CONFIG.reportHour, minute: CONFIG.reportMinute, days: CONFIG.reportDays, tz: CONFIG.reportTz },
    });
  }
  if (p === '/api/me') return json(req, res, 200, { email: accessEmail(req) });

  if (p === '/api/summary') {
    const raw = url.searchParams.get('tag');
    const tag = raw && CONFIG.anyClan ? tagFrom(req, res, raw) : (CONFIG.clanTag || tagFrom(req, res, raw || ''));
    return tag && json(req, res, 200, await getSummary(tag));
  }
  if (p === '/api/report/latest') {
    const r = latestReport();
    return r ? json(req, res, 200, r) : json(req, res, 404, { error: 'Todavía no hay ningún informe.' });
  }
  if (p === '/api/reports') return json(req, res, 200, { items: listReports().slice(0, 30) });
  if (p === '/api/report.pdf') {
    if (!CONFIG.clanTag) return json(req, res, 400, { error: 'El PDF necesita CLAN_TAG en el .env.' });
    if (!CONFIG.pdfEnabled) return json(req, res, 404, { error: 'La exportación a PDF está desactivada (PDF_ENABLED=0).' });
    const sum = await getSummary(CONFIG.clanTag);
    const pdf = await cached(`pdf:${CONFIG.clanTag}:${sum.at}`, CONFIG.summaryCacheMs,
      () => renderPdf({ summary: sum, generatedAt: sum.at, tz: CONFIG.reportTz }));
    return sendPdf(res, pdf, `${slug(sum)}-${stamp(sum.at)}.pdf`);
  }
  // Desempeño de los jugadores (10 semanas): informe del clan o ficha de uno
  if (p === '/api/players.pdf' || p === '/api/player.pdf') {
    if (!CONFIG.clanTag) return json(req, res, 400, { error: 'El PDF necesita CLAN_TAG en el .env.' });
    if (!CONFIG.pdfEnabled) return json(req, res, 404, { error: 'La exportación a PDF está desactivada (PDF_ENABLED=0).' });
    const opts = parseKickOpts(url.searchParams);
    const one = p === '/api/player.pdf';
    const ptag = one ? normalizeTag(url.searchParams.get('tag') || '') : '';
    if (one && !ptag) return json(req, res, 400, { error: 'Falta el tag del jugador.' });
    const key = `${p}:${ptag}:${JSON.stringify(opts)}`;
    const pdf = await cached(key, CONFIG.summaryCacheMs, async () => {
      const tag = CONFIG.clanTag;
      const report = buildPlayersReport(await getWar(tag), await getHistory(tag), opts);
      if (one && !report.players.some((x) => x.tag === `#${ptag}`)) throw new ApiError(404, 'Ese jugador no está en el clan.');
      return renderPdf({ mode: one ? 'player' : 'clan', report, tag: `#${ptag}`, generatedAt: report.generatedAt, tz: CONFIG.reportTz }, 'pdf_players.py');
    });
    const z = (n) => String(n).padStart(2, '0'); const d = new Date();
    return sendPdf(res, pdf, `${one ? `jugador-${ptag.toLowerCase()}` : 'jugadores'}-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.pdf`);
  }
  if (p === '/api/report/latest.pdf') {
    const [first] = listReports();
    const file = first && path.join(REPORT_DIR, `${first.date}.pdf`);
    if (!file || !fs.existsSync(file)) return json(req, res, 404, { error: 'El último informe no tiene PDF.' });
    return sendPdf(res, fs.readFileSync(file), `${first.date}-informe-${String(CONFIG.reportHour).padStart(2, '0')}h.pdf`);
  }

  if (p === '/api/search') {
    if (CONFIG.clanTag && !CONFIG.anyClan) return json(req, res, 403, { error: `Este servidor solo consulta el clan #${CONFIG.clanTag}.` });
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
    if (q.length < 3) return json(req, res, 400, { error: 'Escribe al menos 3 letras del nombre del clan.' });
    return json(req, res, 200, await searchClans(q));
  }

  let m = p.match(/^\/api\/war\/([^/]+)\/?$/);
  if (m) {
    const tag = tagFrom(req, res, m[1]);
    return tag && json(req, res, 200, await getWar(tag));
  }
  m = p.match(/^\/api\/history\/([^/]+)\/?$/);
  if (m) {
    const tag = tagFrom(req, res, m[1]);
    return tag && json(req, res, 200, await getHistory(tag));
  }
  return json(req, res, 404, { error: 'Ruta de API desconocida' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!(e instanceof ApiError)) console.error(e);
    if (!res.headersSent) json(req, res, e instanceof ApiError ? e.status : 500, { error: e.message || 'Error interno del servidor' });
  });
});

// Prueba manual del informe: node server.js --report-now [--no-discord]
if (process.argv.includes('--report-now')) {
  generateReport({ sendDiscord: !process.argv.includes('--no-discord') })
    .then((r) => {
      if (r.skipped) { console.log(r.skipped); return process.exit(0); }
      console.log(`✔ Informe guardado en ${path.join(REPORT_DIR, `${r.date}.json`)}${r.discord ? ` · Discord: ${r.discord}` : ''}`);
      console.log(discord.headline(r.summary).replace(/\*\*/g, ''));
      process.exit(0);
    })
    .catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
} else server.listen(CONFIG.port, CONFIG.host, () => {
  if (CONFIG.trackClans.length) {
    recordAll();
    setInterval(recordAll, CONFIG.trackMinutes * 60 * 1000);
    console.log(`  Registro diario de mazos: ${CONFIG.trackClans.map((t) => `#${t}`).join(', ')} cada ${CONFIG.trackMinutes} min → ${CONFIG.dataDir}`);
  }
  console.log(`✔ Clash War Monitor escuchando en http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Clan: ${CONFIG.clanTag ? `#${CONFIG.clanTag}${CONFIG.anyClan ? ` (de casa) + cualquier otro, máx. ${CONFIG.newClansPerMin} nuevos/min` : ' (solo este)'}` : 'cualquiera'}   historial: ${CONFIG.historyWeeks} semanas   límite: ${CONFIG.rateLimit || 'sin límite'}/min por IP`);
  if (CONFIG.corsOrigins.length) console.log(`  CORS permitido para: ${CONFIG.corsOrigins.join(', ')}`);
  if (CONFIG.requireAccess) console.log('  Cloudflare Access obligatorio (REQUIRE_ACCESS=1)');
  if (CONFIG.clanTag && CONFIG.reportEnabled) {
    scheduleReports();
    // Si el servidor arrancó tarde (corte de luz, reinicio), recupera el informe de hoy
    const today = schedule.dateKey(new Date(), CONFIG.reportTz);
    if (schedule.inCatchUpWindow(new Date(), reportOpts()) && !listReports().some((r) => r.date === today)) runReport('recuperado');
  }
});
