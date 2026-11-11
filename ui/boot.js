// Apply the saved look before anything paints (a plain script in <head>; the app's
// security policy allows no inline scripts).
// (a look that was taken out: the one App.setSkin falls back to, so the first picture is already it)
// Build 39: Light / Dark / Match system with a day look and a night look (app.js lookState/shownLook, the
// same rule; before that, one look in `skin`, which is what shows when the others aren't saved yet)
try {
  var get1 = function (k) { return JSON.parse(localStorage.getItem(k) || 'null'); };
  var skin = get1('skin') || 'thinky'; // (the default look since Build 33, he asked)
  var mode = get1('lookMode'), day = get1('skinDay'), night = get1('skinNight');
  if (mode && day && night) skin = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? night : day;
  document.documentElement.dataset.skin = { grimoire: 'calm', screenplay: 'plain', azulejo: 'thinky' }[skin] || skin;
} catch (e) {}
// link colour and fonts picked in Settings (see App.applyTextStyle)
try {
  var st = document.documentElement.style, get = function (k) { return JSON.parse(localStorage.getItem(k) || '""'); };
  var link = get('linkColor');
  if (link) { st.setProperty('--link', link); st.setProperty('--link-line', 'color-mix(in srgb, ' + link + ' 45%, transparent)'); }
  if (get('linkStyle')) document.documentElement.setAttribute('data-links', get('linkStyle')); // how page links look
  if (get('fontBody')) st.setProperty('--font-body', get('fontBody'));
  if (get('fontTitle')) st.setProperty('--font-title', get('fontTitle'));
} catch (e) {}
// the sidebar's width, where two sides meet, and wide mode (App.grip, App.setWide), so the first
// picture already has them
try {
  var sw = JSON.parse(localStorage.getItem('sideW') || 'null'), sp = JSON.parse(localStorage.getItem('splitAt') || 'null');
  if (sw > 0) document.documentElement.style.setProperty('--side-w', sw + 'px');
  if (sp > 0 && sp < 1) document.documentElement.style.setProperty('--split', String(sp));
  if (JSON.parse(localStorage.getItem('wide') || 'false') === true) document.documentElement.classList.add('wide');
  if (JSON.parse(localStorage.getItem('motion') || 'true') === false) document.documentElement.dataset.motion = 'off'; // Settings → Look → Animations
} catch (e) {}
