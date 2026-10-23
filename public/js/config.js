/*
 * config.js — Configuración del frontend
 *
 * apiBase: dónde está el servidor (server.js).
 *   ''                                  → el mismo sitio que sirve esta web (lo normal)
 *   'https://api-guerra.midominio.es'   → si alojas la web en otro sitio (Cloudflare Pages,
 *                                         GitHub Pages…). Recuerda poner ese origen en
 *                                         CORS_ORIGINS del .env del servidor.
 *
 * demoOnly: true → versión de demostración sin servidor (datos inventados).
 *                  Es la que genera `npm run build:demo` en dist/demo.html.
 */
window.CW_CONFIG = {
  apiBase: '',
};
