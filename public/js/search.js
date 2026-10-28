// Buscador de una sola caja (portada y ficha de jugador). Los tags son únicos, así que no hace falta elegir:
// - #tag de clan o de jugador: el servidor dice qué es (/api/lookup) y lleva a /c/TAG o /p/TAG.
// - nombre de clan: lista de clanes que coinciden (/api/search). Los jugadores no se pueden buscar por nombre.
(function () {
  'use strict';
  var TAG_RE = /^[0289PYLQGRJCUV]{3,12}$/;
  var VALID = /^#?[0289PYLQGRJCUVO]+$/i; // letras que puede tener un tag (la O se toma como 0)
  var norm = function (v) { return String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return n == null || !isFinite(n) ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var getJson = function (u) {
    return fetch(u).then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d.error || ('Error ' + r.status)); e.status = r.status; throw e; } return d; }); });
  };

  var CSS = '' +
    '.cws{display:flex;flex-direction:column;gap:8px;width:100%;max-width:560px;margin:0 auto}' +
    '.cws-box{display:flex;align-items:center;gap:8px;background:#101a14;border:1px solid #1f2e24;border-radius:999px;padding:3px 3px 3px 18px}' +
    '.cws-box:focus-within{border-color:#00ff41}' +
    '.cws-in{flex:1;min-width:0;background:none;border:0;outline:0;color:#f5fbf6;font:16px ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;padding:7px 0}' +
    '.cws-in::placeholder{color:#6e8474}' +
    '.cws-in::-webkit-search-cancel-button{filter:invert(1) opacity(.5)}' +
    '.cws-go{flex:none;display:flex;align-items:center;justify-content:center;width:42px;height:42px;background:#00ff41;color:#021004;border:0;border-radius:50%;padding:0;cursor:pointer}' +
    '.cws-go:disabled{opacity:.6;cursor:progress}' +
    '.cws-go:focus-visible{outline:2px solid #00ff41;outline-offset:2px}' +
    '.cws-ic{width:20px;height:20px;display:block;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}' +
    '.cws-msg{margin:0;color:#9bb0a0;font-size:12.5px;min-height:1em;text-align:center}' +
    '.cws-msg.err{color:#ff5c5c}' +
    '.cws-res{list-style:none;margin:0;padding:0;display:grid;gap:6px}' +
    '.cws-res a{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#0a110d;border:1px solid #1f2e24;border-radius:10px;padding:8px 12px;color:#dde9e0;text-decoration:none}' +
    '.cws-res a:hover,.cws-res a:focus-visible{border-color:#00ff41;outline:0}' +
    '.cws-res b{color:#f5fbf6}' +
    '.cws-res span{color:#9bb0a0;font-size:12px;white-space:nowrap}' +
    '@media (max-width:520px){.cws-res a{flex-direction:column;align-items:flex-start;gap:2px}}';

  function mount(el) {
    if (!document.getElementById('cws-css')) {
      var st = document.createElement('style'); st.id = 'cws-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    el.innerHTML =
      '<form class="cws" role="search" novalidate>' +
        '<div class="cws-box">' +
          '<input class="cws-in" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="characters" spellcheck="false"' +
            ' placeholder="#TAG o nombre de clan" aria-label="Tag de un clan o de un jugador, o nombre de un clan">' +
          '<button class="cws-go" type="submit" aria-label="Buscar" title="Buscar">' +
            '<svg class="cws-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg></button>' +
        '</div>' +
        '<p class="cws-msg" aria-live="polite"></p>' +
        '<ul class="cws-res" hidden></ul>' +
      '</form>';
    var form = el.querySelector('form');
    var input = el.querySelector('.cws-in');
    var msg = el.querySelector('.cws-msg');
    var res = el.querySelector('.cws-res');
    var go = el.querySelector('.cws-go');
    var say = function (t, err) { msg.textContent = t || ''; msg.className = 'cws-msg' + (err ? ' err' : ''); };
    var busy = function (b) { go.disabled = b; };

    function byName(q) {
      say('Buscando clanes…');
      return getJson('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
        var items = d.items || [];
        if (!items.length) { say('No hay ningún clan ni jugador con eso. Los jugadores se buscan por su #tag (está en su perfil, debajo del nombre).', true); return; }
        say(items.length + (items.length === 1 ? ' clan encontrado:' : ' clanes encontrados:'));
        res.innerHTML = items.map(function (c) {
          return '<li><a href="/c/' + norm(c.tag) + '"><b>' + esc(c.name) + '</b><span>' + esc(c.tag) + ' · ' + fmt(c.members) + '/50 · ' +
            fmt(c.clanWarTrophies) + ' trofeos de guerra' + (c.location ? ' · ' + esc(c.location) : '') + '</span></a></li>';
        }).join('');
        res.hidden = false;
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      res.hidden = true;
      if (!q) { say('Escribe el #tag de un clan o de un jugador, o el nombre de un clan.', true); input.focus(); return; }
      var t = norm(q);
      busy(true);
      var job;
      if (VALID.test(q) && TAG_RE.test(t)) {
        // Parece un tag: el servidor dice si es de un clan o de un jugador
        say('Buscando ' + '#' + t + '…');
        job = getJson('/api/lookup/' + t).then(function (d) {
          say((d.type === 'clan' ? 'Clan ' : 'Jugador ') + d.name + '…');
          location.href = (d.type === 'clan' ? '/c/' : '/p/') + t;
        }).catch(function (err) {
          // No es un tag que exista: quizá era un nombre de clan (sin #)
          if (err.status === 404 && q.charAt(0) !== '#' && q.length >= 3) return byName(q);
          throw err;
        });
      } else if (q.charAt(0) === '#') {
        job = Promise.reject(new Error('Ese tag no es válido: solo lleva los caracteres 0 2 8 9 P Y L Q G R J C U V.'));
      } else if (q.length < 3) {
        job = Promise.reject(new Error('Escribe al menos 3 letras del nombre del clan.'));
      } else {
        job = byName(q);
      }
      job.catch(function (err) { say(err.message, true); }).then(function () { busy(false); });
    });
  }

  window.CWSearch = { mount: mount };
})();
