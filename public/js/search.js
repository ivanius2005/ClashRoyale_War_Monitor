// Buscador de clanes y jugadores (portada y ficha de jugador).
// - Clan: por #tag (va a /c/TAG) o por nombre (lista de clanes que coinciden, vía /api/search).
// - Jugador: solo por #tag (la API oficial no permite buscar jugadores por nombre).
(function () {
  'use strict';
  var TAG_RE = /^[0289PYLQGRJCUV]{3,12}$/;
  var VALID = /^#?[0289PYLQGRJCUVO]+$/i; // letras que puede tener un tag (la O se toma como 0)
  var norm = function (v) { return String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return n == null || !isFinite(n) ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };

  var CSS = '' +
    '.cws{display:flex;flex-direction:column;gap:8px;width:100%}' +
    '.cws-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.cws-mode{display:inline-flex;background:#0a110d;border:1px solid #1f2e24;border-radius:999px;padding:3px}' +
    '.cws-mode label{cursor:pointer}' +
    '.cws-mode input{position:absolute;opacity:0;pointer-events:none}' +
    '.cws-mode span{display:block;padding:6px 14px;border-radius:999px;font:600 13px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;color:#9bb0a0}' +
    '.cws-mode input:checked+span{background:#00ff41;color:#021004}' +
    '.cws-mode input:focus-visible+span{outline:2px solid #00ff41;outline-offset:2px}' +
    '.cws-box{flex:1;min-width:220px;display:flex;align-items:center;gap:8px;background:#101a14;border:1px solid #1f2e24;border-radius:999px;padding:4px 4px 4px 14px}' +
    '.cws-box:focus-within{border-color:#00ff41}' +
    '.cws-ic{width:18px;height:18px;flex:none;fill:none;stroke:#9bb0a0;stroke-width:2;stroke-linecap:round}' +
    '.cws-in{flex:1;min-width:0;background:none;border:0;outline:0;color:#f5fbf6;font:16px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;padding:6px 0}' +
    '.cws-in::-webkit-search-cancel-button{filter:invert(1) opacity(.5)}' +
    '.cws-go{flex:none;font:700 14px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;background:#00ff41;color:#021004;border:0;border-radius:999px;padding:8px 18px;cursor:pointer}' +
    '.cws-go:disabled{opacity:.6;cursor:progress}' +
    '.cws-go:focus-visible{outline:2px solid #00ff41;outline-offset:2px}' +
    '.cws-msg{margin:0;color:#9bb0a0;font-size:12.5px;min-height:1em}' +
    '.cws-msg.err{color:#ff5c5c}' +
    '.cws-res{list-style:none;margin:0;padding:0;display:grid;gap:6px}' +
    '.cws-res a{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#0a110d;border:1px solid #1f2e24;border-radius:10px;padding:8px 12px;color:#dde9e0;text-decoration:none}' +
    '.cws-res a:hover,.cws-res a:focus-visible{border-color:#00ff41;outline:0}' +
    '.cws-res b{color:#f5fbf6}' +
    '.cws-res span{color:#9bb0a0;font-size:12px;white-space:nowrap}' +
    '@media (max-width:520px){.cws-res a{flex-direction:column;align-items:flex-start;gap:2px}}';

  function mount(el, opts) {
    opts = opts || {};
    if (!document.getElementById('cws-css')) {
      var st = document.createElement('style'); st.id = 'cws-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var mode = opts.mode === 'p' ? 'p' : 'c';
    el.innerHTML =
      '<form class="cws" role="search" novalidate>' +
        '<div class="cws-row">' +
          '<div class="cws-mode" role="radiogroup" aria-label="Qué buscar">' +
            '<label><input type="radio" name="cwsk" value="c"' + (mode === 'c' ? ' checked' : '') + '><span>Clan</span></label>' +
            '<label><input type="radio" name="cwsk" value="p"' + (mode === 'p' ? ' checked' : '') + '><span>Jugador</span></label>' +
          '</div>' +
          '<div class="cws-box">' +
            '<svg class="cws-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>' +
            '<input class="cws-in" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
            '<button class="cws-go" type="submit">Buscar</button>' +
          '</div>' +
        '</div>' +
        '<p class="cws-msg" aria-live="polite"></p>' +
        '<ul class="cws-res" hidden></ul>' +
      '</form>';
    var form = el.querySelector('form');
    var input = el.querySelector('.cws-in');
    var msg = el.querySelector('.cws-msg');
    var res = el.querySelector('.cws-res');
    var go = el.querySelector('.cws-go');
    var cur = function () { return form.querySelector('input[name=cwsk]:checked').value; };
    var say = function (t, err) { msg.textContent = t || ''; msg.className = 'cws-msg' + (err ? ' err' : ''); };
    var setMode = function () {
      var p = cur() === 'p';
      input.placeholder = p ? '#TAG del jugador' : '#TAG o nombre del clan';
      input.setAttribute('aria-label', p ? 'Tag del jugador' : 'Tag o nombre del clan');
      say(p ? 'El #tag está en el perfil del jugador, debajo de su nombre.' : '');
      res.hidden = true;
    };
    form.addEventListener('change', setMode);
    setMode();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      res.hidden = true;
      if (!q) { say(cur() === 'p' ? 'Escribe el #tag del jugador.' : 'Escribe el #tag o el nombre del clan.', true); input.focus(); return; }
      var t = norm(q);
      // ¿Es un tag? Si empieza por # o solo tiene letras de tag y algún número (un nombre como «Grupo» no cuenta)
      var tagLike = VALID.test(q) && (q.charAt(0) === '#' || /\d/.test(q) || cur() === 'p');
      if (tagLike) {
        if (!TAG_RE.test(t)) { say('Ese tag no es válido: solo lleva los caracteres 0 2 8 9 P Y L Q G R J C U V.', true); return; }
        location.href = (cur() === 'p' ? '/p/' : '/c/') + t;
        return;
      }
      if (cur() === 'p') { say('Los jugadores solo se pueden buscar por su #tag (la API no permite buscarlos por nombre).', true); return; }
      if (q.length < 3) { say('Escribe al menos 3 letras del nombre del clan.', true); return; }
      go.disabled = true; say('Buscando clanes…');
      fetch('/api/search?q=' + encodeURIComponent(q)).then(function (r) {
        return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || ('Error ' + r.status)); return d; });
      }).then(function (d) {
        var items = d.items || [];
        if (!items.length) { say('No hay ningún clan con ese nombre.', true); return; }
        say(items.length + (items.length === 1 ? ' clan encontrado:' : ' clanes encontrados:'));
        res.innerHTML = items.map(function (c) {
          return '<li><a href="/c/' + norm(c.tag) + '"><b>' + esc(c.name) + '</b><span>' + esc(c.tag) + ' · ' + fmt(c.members) + '/50 · ' +
            fmt(c.clanWarTrophies) + ' trofeos de guerra' + (c.location ? ' · ' + esc(c.location) : '') + '</span></a></li>';
        }).join('');
        res.hidden = false;
      }).catch(function (err) { say(err.message, true); })
        .then(function () { go.disabled = false; });
    });
  }

  window.CWSearch = { mount: mount };
})();
