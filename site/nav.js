// The website's side menu, like the app's sidebar (he asked, Nov 25: "the side menu like in the app ...
// to organize the pages and the thoughts"): the thinky name, Home and Try it, the sections of the page
// you're on, and the site's other pages. On a wide screen it stays at the left; on a phone the ☰ button
// at the top opens it over the page. Each page loads it (defer); without it, the footer's links remain.
(function () {
  // the site's pages, in the menu's order (index.html and try/index.html, so the links also work when
  // the site is opened from a folder)
  var PAGES = [
    ['index.html', 'Home', 'home'],
    ['try/index.html', 'Try it in your browser', 'try'],
    ['markdown.html', 'What is a Markdown note?', 'page'],
    ['highlights.html', 'Highlights from the web', 'page'],
    ['changelog.html', 'Changelog', 'page'],
    ['privacy.html', 'Privacy', 'page'],
    ['code-signing.html', 'Code signing policy', 'page'],
    ['https://github.com/srikanth-iyer/thinky', 'Source on GitHub', 'out'],
  ];
  // small line icons, drawn like the app's (currentColor, 1.6 stroke)
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    try: '<path d="M8 5v14l11-7z"/>',
    page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    out: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v6H4V6h6"/>',
    sec: '<path d="M5 12h14"/>',
  };
  var icon = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>'; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function build() {
    var main = document.querySelector('main');
    if (!main) return;
    // which page this is: the file name at the end of the address (the home page: index.html or "/")
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var link = function (p) {
      var cur = p[0] === here;
      var ext = p[2] === 'out';
      return '<li><a href="' + esc(p[0]) + '"' + (cur ? ' aria-current="page"' : '') + (ext ? ' rel="noopener"' : '') + '>' + icon(p[2]) + '<span>' + esc(p[1]) + '</span></a></li>';
    };
    // this page's sections: its headings, each given an id to link to (from its words, when it has none)
    var used = {};
    var secs = Array.prototype.map.call(main.querySelectorAll('h2'), function (h) {
      if (!h.id) {
        var id = h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
        while (used[id] || document.getElementById(id)) id += '-2';
        h.id = id;
      }
      used[h.id] = true;
      return '<li><a href="#' + esc(h.id) + '">' + icon('sec') + '<span>' + esc(h.textContent) + '</span></a></li>';
    });
    var side = document.createElement('nav');
    side.className = 'site-side';
    side.id = 'site-side';
    side.setAttribute('aria-label', 'Site');
    side.innerHTML =
      '<a class="ss-brand" href="index.html"><img src="icon.svg" alt=""><span>thinky</span></a>' +
      '<ul class="ss-list">' + PAGES.slice(0, 2).map(link).join('') + '</ul>' +
      (secs.length ? '<p class="ss-h">On this page</p><ul class="ss-list ss-secs">' + secs.join('') + '</ul>' : '') +
      '<p class="ss-h">Pages</p><ul class="ss-list">' + PAGES.slice(2).map(link).join('') + '</ul>' +
      // the look (look.js): Light, Dark or System, one press moves on to the next (he asked, Nov 25)
      (window.thinkyLook && window.thinkyLook.simple() ? '<div class="ss-look"><button type="button" class="ss-lk"></button></div>' : '');
    document.body.insertBefore(side, document.body.firstChild);
    var lk = side.querySelector('.ss-lk');
    if (lk) {
      var showLook = function () {
        var m = window.thinkyLook.mode();
        lk.innerHTML = window.thinkyLook.icon(m) + '<span>Look: ' + esc(window.thinkyLook.name(m)) + '</span>';
      };
      lk.addEventListener('click', function () { window.thinkyLook.cycle(); });
      document.addEventListener('thinky-look', showLook);
      showLook();
    }
    document.body.classList.add('has-side');

    // the phone's ☰ button, at the start of the page's top line; it opens the menu over the page
    var top = main.querySelector('header.top');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ss-open';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-controls', 'site-side');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    if (top) top.insertBefore(btn, top.firstChild);
    var shade = document.createElement('div');
    shade.className = 'ss-shade';
    document.body.appendChild(shade);
    var show = function (on) {
      document.body.classList.toggle('ss-shown', on);
      btn.setAttribute('aria-expanded', String(on));
      if (on) { var a = side.querySelector('a'); if (a) a.focus(); }
    };
    btn.addEventListener('click', function () { show(!document.body.classList.contains('ss-shown')); });
    shade.addEventListener('click', function () { show(false); });
    // a link picked on a phone closes the menu; Escape closes it too
    side.addEventListener('click', function (e) { if (e.target.closest('a')) show(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('ss-shown')) { show(false); btn.focus(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
