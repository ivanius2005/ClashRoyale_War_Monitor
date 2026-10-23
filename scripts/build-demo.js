#!/usr/bin/env node
'use strict';
/*
 * Genera dist/demo.html: la web completa en un único archivo, sin servidor y con
 * datos inventados. Sirve para enseñarla, colgarla en GitHub Pages o abrirla en el móvil.
 *
 *   npm run build:demo
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const inlineJs = (code) => code.replace(/<\/script/gi, '<\\/script');

// Tema claro: se aplica solo si el dispositivo o el visor lo piden.
// El aspecto por defecto sigue siendo el IVN_05 oscuro.
const LIGHT = `
  --bg:#f2f5f2; --panel:#ffffff; --panel-2:#f4f7f5; --panel-3:#e6eee8;
  --line:#d6e0d9; --line-2:#b7c7bb;
  --text:#1c2b21; --muted:#4f6357; --dim:#77897d; --white:#0a130d;
  --green:#07802a; --green-2:#2a9d4f; --green-soft:rgba(7,128,42,.14);
  --amber:#9a5b00; --amber-soft:rgba(154,91,0,.12);
  --red:#c0321f; --red-soft:rgba(192,50,31,.1);
  --on-accent:#ffffff; --grid:rgba(7,128,42,.05); --tint:rgba(0,0,0,.03); --edge:rgba(0,0,0,.22);
  --water-1:#2f93b3; --water-2:#1c6f8b;
  --clan-1:#0a86c2; --clan-2:#7a4fd1; --clan-3:#c93b7f; --clan-4:#7d6b3f;
  --rk1:#07802a; --rk1-t:#ffffff; --rk2:#6fbf88; --rk2-t:#062d12; --rk3:#cfd9d2; --rk3-t:#23342a;
  --rk4:#e0a23c; --rk4-t:#2b1a00; --rk5:#d4473a; --rk5-t:#ffffff;`;
const LIGHT_RULES = `
.qfield input::placeholder{color:#9aa89e}
.led.on{box-shadow:none}
.risk.r-lo{border-color:rgba(7,128,42,.5)}
.risk.r-mid{border-color:rgba(154,91,0,.5)}
.risk.r-hi{border-color:rgba(192,50,31,.55)}
.msg{border-color:rgba(154,91,0,.35)}
.msg.err{border-color:rgba(192,50,31,.4)}
.chip.amber{border-color:rgba(154,91,0,.6)}
.chip.green{border-color:rgba(7,128,42,.55)}
.water{box-shadow:inset 0 3px 8px rgba(0,0,0,.25)}
.lane.own .water{box-shadow:inset 0 3px 8px rgba(0,0,0,.25),0 0 0 2px var(--green)}`;
// Prefija cada selector de cada regla (también los de listas separadas por comas)
const scope = (sel, rules) => rules.trim().split('\n').map((r) => {
  const i = r.indexOf('{');
  const selectors = r.slice(0, i).split(',').map((x) => `${sel} ${x.trim()}`).join(',');
  return selectors + r.slice(i);
}).join('\n');

const THEME = `
/* ---- añadido por build-demo: bordes seguros del móvil y tema claro ---- */
:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{padding:0;min-height:0;background-color:var(--bg)}
@media (prefers-color-scheme: light){
  :root:not([data-theme="dark"]){${LIGHT}}
${scope(':root:not([data-theme="dark"])', LIGHT_RULES)}
}
:root[data-theme="light"]{${LIGHT}}
${scope(':root[data-theme="light"]', LIGHT_RULES)}
`;

// Con SNAPSHOT=archivo.js se monta una "foto real": ese archivo sustituye a los datos inventados
// (define window.CWDemo con datos de verdad) y CONFIG_JSON añade { snapshot: {...} } a la configuración.
const SNAP = process.env.SNAPSHOT ? path.resolve(process.env.SNAPSHOT) : null;
const EXTRA_CONFIG = process.env.CONFIG_JSON || '{}';

let html = read('public/index.html');
html = html.replace(/\?v=\d+/g, ''); // la versión de los archivos solo sirve en la web real
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`No se encontró en index.html: ${from}`);
  html = html.replace(from, () => to);
};

swap('<title>Monitor de guerra de clanes · Clash Royale</title>', `<title>${SNAP ? (process.env.TITLE || 'Foto real · Monitor de guerra de clanes') : 'Demo · Monitor de guerra de clanes'}</title>`);
swap('<link rel="stylesheet" href="css/styles.css">', `<style>\n${read('public/css/styles.css')}\n${THEME}</style>`);
swap('<script src="js/config.js"></script>', `<script>window.CW_CONFIG = Object.assign({ apiBase: '', demoOnly: true }, ${EXTRA_CONFIG});</script>`);
for (const f of ['calc', 'sim', 'news', 'demo', 'app']) {
  const src = f === 'demo' && SNAP ? fs.readFileSync(SNAP, 'utf8') : read(`public/js/${f}.js`);
  swap(`<script src="js/${f}.js"></script>`, `<script>\n${inlineJs(src)}\n</script>`);
}

const out = process.env.OUT ? path.resolve(process.env.OUT) : path.join(root, 'dist', 'demo.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`✔ ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
