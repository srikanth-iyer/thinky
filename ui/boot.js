// Apply the saved look before anything paints (a plain script in <head>; the app's
// security policy allows no inline scripts).
try { document.documentElement.dataset.skin = JSON.parse(localStorage.getItem('skin')) || 'calm'; } catch (e) {}
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
} catch (e) {}
