// A month grid, shared by the date picker and "Go to date".
// Weeks start on Monday. Days with a journal can be marked with a dot.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const keyOf = ([y, m, d]) => `${y}-${m}-${d}`;
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * host: element to fill. opts: { date: [y,m,d] shown first and focused, marks: Set of keyOf(date),
 * onPick(date), onMonth(y, m) (called when the shown month changes), today: [y,m,d] }
 */
export function createCalendar(host, opts) {
  let [y, m] = opts.date;
  let focus = opts.date.slice();
  const el = document.createElement('div');
  el.className = 'cal';
  host.append(el);

  const draw = () => {
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const cells = [];
    for (let k = 0; k < 42; k++) {
      const dt = new Date(y, m - 1, 1 - lead + k);
      const d = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
      if (k >= 35 && d[1] !== m && k % 7 === 0) break; // no all-next-month last row
      const cls = ['day'];
      if (d[1] !== m) cls.push('other');
      if (same(d, opts.today)) cls.push('today');
      if (opts.marks?.has(keyOf(d))) cls.push('mark');
      if (same(d, focus)) cls.push('focus');
      cells.push(`<button type="button" class="${cls.join(' ')}" data-d="${d.join('-')}" tabindex="${same(d, focus) ? 0 : -1}" aria-label="${d[2]} ${MONTHS[d[1] - 1]} ${d[0]}">${d[2]}</button>`);
    }
    el.innerHTML = `<div class="cal-head"><button type="button" data-nav="-1" aria-label="Previous month">‹</button>
      <span class="cal-title">${MONTHS[m - 1]} ${y}</span>
      <button type="button" data-nav="1" aria-label="Next month">›</button></div>
      <div class="cal-grid">${DOW.map((d) => `<span class="dow">${d}</span>`).join('')}${cells.join('')}</div>`;
  };
  const setMonth = (ny, nm) => {
    const dt = new Date(ny, nm - 1, 1);
    y = dt.getFullYear(); m = dt.getMonth() + 1;
    draw();
    opts.onMonth?.(y, m);
  };
  const moveFocus = (delta) => {
    const dt = new Date(focus[0], focus[1] - 1, focus[2] + delta);
    focus = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
    if (focus[0] !== y || focus[1] !== m) setMonth(focus[0], focus[1]); else draw();
    el.querySelector('.day.focus')?.focus();
  };
  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { setMonth(y, m + Number(nav.dataset.nav)); return; }
    const b = e.target.closest('[data-d]');
    if (b) { focus = b.dataset.d.split('-').map(Number); opts.onPick?.(focus); }
  });
  el.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (k) { e.preventDefault(); moveFocus(k); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); const d = e.key === 'PageUp' ? -1 : 1; focus = [focus[0], focus[1] + d, 1]; setMonth(y, m + d); return; }
    if (e.key === 'Enter' && e.target.closest('[data-d]')) { e.preventDefault(); opts.onPick?.(focus); }
  });
  draw();
  return {
    el,
    focusDay() { el.querySelector('.day.focus')?.focus(); },
    setMarks(marks) { opts.marks = marks; draw(); },
    show(date) { focus = date.slice(); setMonth(date[0], date[1]); },
  };
}
