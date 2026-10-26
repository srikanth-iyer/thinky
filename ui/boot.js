// Apply the saved look before anything paints (a plain script in <head>; the app's
// security policy allows no inline scripts).
try { document.documentElement.dataset.skin = JSON.parse(localStorage.getItem('skin')) || 'calm'; } catch (e) {}
// link colour and fonts picked in Settings (see App.applyTextStyle)
try {
  var st = document.documentElement.style, get = function (k) { return JSON.parse(localStorage.getItem(k) || '""'); };
  var link = get('linkColor');
  if (link) { st.setProperty('--link', link); st.setProperty('--link-line', 'color-mix(in srgb, ' + link + ' 45%, transparent)'); }
  if (get('fontBody')) st.setProperty('--font-body', get('fontBody'));
  if (get('fontTitle')) st.setProperty('--font-title', get('fontTitle'));
} catch (e) {}
