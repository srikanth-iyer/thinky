// The website's choice of looks: the same looks as the app (look/looks.js and look/skins.css, which the
// website's build copies from the newest release: web/site-looks.mjs), saved the same way the app saves
// them (localStorage lookMode, skinDay, skinNight). The "Try it" demo lives on the same site, so a look
// picked here is the demo's look too, and the other way round.
// Loaded in each page's <head>, so the look is on before anything shows; the menu is built once the page
// has loaded, into the page's <span id="looks">.
(function () {
  var LOOKS = window.THINKY_LOOKS || []; // (none when the build didn't add look/: the page keeps its plain colours)
  var root = document.documentElement;
  var dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var byId = function (id) { for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].id === id) return LOOKS[i]; return null; };
  var get = function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  var set = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // the first day look and the first night look on the list: what shows when nothing (or a look the site
  // doesn't offer) is saved
  var first = function (dk) { for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].dark === dk) return LOOKS[i].id; return null; };
  // only one look of each kind (online: Plain and Plain night, he asked Nov 25): the menu is just
  // Light, Dark or System
  var onlyModes = function () { return LOOKS.filter(function (l) { return !l.dark; }).length < 2 && LOOKS.filter(function (l) { return l.dark; }).length < 2; };
  // what is saved: Light, Dark or Match system, and a day look and a night look. With nothing saved the
  // site follows the system.
  function state() {
    var mode = get('lookMode'), day = get('skinDay'), night = get('skinNight');
    if (!byId(day) || byId(day).dark) day = first(false);
    if (!byId(night) || !byId(night).dark) night = first(true);
    return { mode: mode || 'system', day: day, night: night };
  }
  var nightNow = function (st) { return st.mode === 'dark' || (st.mode === 'system' && !!(dark && dark.matches)); };
  // put the look on the page (every colour and font on the site comes from it: style.css)
  function apply() {
    if (!LOOKS.length) return;
    var st = state();
    root.setAttribute('data-skin', nightNow(st) ? st.night : st.day);
    paint();
  }
  apply();
  if (dark && dark.addEventListener) dark.addEventListener('change', apply); // (Match system: follows it live)

  // a look's name as HTML: the looks named after the app show the thinky wordmark (as in the app)
  // (the list is the site's own, made from the app's code; its words are still escaped before they go in the page)
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function nameHTML(l) {
    if (!l.word) return esc(l.name);
    return '<svg class="wm-in" viewBox="0 0 207 91" role="img" aria-label="thinky"><use href="look/brand/wordmark.svg#m"/></svg>' + (l.after ? ' ' + esc(l.after) : '');
  }

  var box = null; // the menu, once built
  // the menu: Light / Dark / Match system, then the day looks and the night looks, each with a small
  // sample of its colours (the sample wears the look itself: data-skin on it)
  function build() {
    var spot = document.getElementById('looks');
    if (!spot || !LOOKS.length) return;
    var row = function (l) {
      return '<li><button type="button" data-look="' + esc(l.id) + '"><span class="swatch" data-skin="' + esc(l.id) + '"><i></i><b></b></span>' +
        '<span class="lk-name">' + nameHTML(l) + '<small>' + esc(l.note) + '</small></span></button></li>';
    };
    var modes = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
    var modeBar = '<div class="lk-modes" role="group" aria-label="Light or dark">' + modes.map(function (m) { return '<button type="button" data-mode="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>';
    spot.innerHTML = onlyModes()
      ? '<details class="looks"><summary>Look</summary><div class="looks-menu lk-short">' + modeBar +
        '<p class="lk-foot">System follows your device. The demo uses the same choice.</p></div></details>'
      : '<details class="looks"><summary>Look</summary><div class="looks-menu">' + modeBar +
        '<p class="lk-h">Day looks</p><ul>' + LOOKS.filter(function (l) { return !l.dark; }).map(row).join('') + '</ul>' +
        '<p class="lk-h">Night looks</p><ul>' + LOOKS.filter(function (l) { return l.dark; }).map(row).join('') + '</ul>' +
        '<p class="lk-foot">The same looks as the app. System uses your day look in the day and your night look at night. Your choice is kept in this browser, and the demo uses it too.</p></div></details>';
    box = spot.querySelector('details');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var st = state();
      if (b.dataset.mode) st.mode = b.dataset.mode;
      else {
        // a look picked: it goes in its own slot (day or night), and it shows now: if it's the other
        // brightness from what shows, the page switches to it
        var l = byId(b.dataset.look);
        if (l.dark) st.night = l.id; else st.day = l.id;
        if (nightNow(st) !== l.dark) st.mode = l.dark ? 'dark' : 'light';
      }
      set('lookMode', st.mode); set('skinDay', st.day); set('skinNight', st.night);
      apply();
    });
    // the menu closes with Escape or a click elsewhere
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.open) { box.open = false; box.querySelector('summary').focus(); } });
    document.addEventListener('click', function (e) { if (box.open && !box.contains(e.target)) box.open = false; });
    paint();
  }
  // mark what is chosen in the menu
  function paint() {
    if (!box) return;
    var st = state(), shown = nightNow(st) ? st.night : st.day;
    box.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
    box.querySelectorAll('[data-look]').forEach(function (b) {
      var id = b.dataset.look;
      b.setAttribute('aria-pressed', String(id === shown));
      b.classList.toggle('slot', id !== shown && (id === st.day || id === st.night)); // (the other half of the pair, not showing now)
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
