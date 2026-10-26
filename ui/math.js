// A tiny TeX renderer for formulas in notes ($…$, $$…$$, \(…\), \[…\]): letters, Greek,
// symbols, powers/subscripts, fractions, roots, accents, fonts, \text and matrices.
// Not a full TeX: unknown commands are shown as written.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', implies: '⟹', impliedby: '⟸',
  leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓', longrightarrow: '⟶',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬',
  lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', angle: '∠',
  infty: '∞', partial: '∂', nabla: '∇', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', prime: '′', degree: '°',
  top: '⊤', bot: '⊥', dagger: '†', ddagger: '‡', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', mid: '∣', vert: '|', Vert: '‖',
  lbrace: '{', rbrace: '}', backslash: '\\', triangle: '△', square: '□', checkmark: '✓', blacksquare: '■',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
  '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '_': '_', '&': '&', '|': '‖',
};
const BIG = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', bigcup: '⋃', bigcap: '⋂', coprod: '∐' };
const FUNCS = new Set(['log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'lim', 'liminf', 'limsup', 'min', 'max', 'sup', 'inf', 'det', 'deg', 'dim', 'ker', 'gcd', 'arg', 'Pr', 'mod', 'hom']);
const ACCENT = { vec: '⃗', hat: '̂', widehat: '̂', tilde: '̃', widetilde: '̃', dot: '̇', ddot: '̈', check: '̌', breve: '̆', acute: '́', grave: '̀' };
const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'middle']);

// letters in other alphabets (math fonts)
const shift = (ch, upper, lower) => {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
  if (lower && c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
  return ch;
};
const BB_EXCEPT = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
const CAL_EXCEPT = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ' };
const FONTS = {
  mathbb: (ch) => BB_EXCEPT[ch] || shift(ch, 0x1D538, 0x1D552),
  mathcal: (ch) => CAL_EXCEPT[ch] || shift(ch, 0x1D49C, 0),
  mathscr: (ch) => CAL_EXCEPT[ch] || shift(ch, 0x1D49C, 0),
  mathfrak: (ch) => shift(ch, 0x1D504, 0x1D51E),
};

class P {
  constructor(s) { this.s = s; this.i = 0; }
  peek() { return this.s[this.i]; }
  eof() { return this.i >= this.s.length; }
  /** One argument: {group} or a single token. Returns its source text. */
  arg() {
    this.skipSpace();
    if (this.peek() === '{') {
      let depth = 0; const start = this.i + 1;
      for (; this.i < this.s.length; this.i++) {
        const c = this.s[this.i];
        if (c === '\\') { this.i++; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { this.i++; return this.s.slice(start, this.i - 1); }
      }
      return this.s.slice(start);
    }
    if (this.peek() === '\\') { const m = this.s.slice(this.i).match(/^\\([a-zA-Z]+|.)/); this.i += m ? m[0].length : 1; return m ? m[0] : ''; }
    return this.s[this.i++] ?? '';
  }
  optArg() {
    if (this.peek() !== '[') return null;
    const end = this.s.indexOf(']', this.i);
    if (end < 0) return null;
    const v = this.s.slice(this.i + 1, end); this.i = end + 1; return v;
  }
  skipSpace() { while (this.peek() === ' ') this.i++; }
}

/** Render a TeX source string to HTML. */
export function tex(src) {
  const p = new P(src);
  let out = '';
  let base = ''; // last atom, for ^ and _
  const flush = () => { out += base; base = ''; };
  while (!p.eof()) {
    const c = p.peek();
    if (c === '^' || c === '_') {
      p.i++;
      let sup = '', sub = '';
      const a = tex(p.arg());
      if (c === '^') sup = a; else sub = a;
      p.skipSpace();
      if ((p.peek() === '_' && !sub) || (p.peek() === '^' && !sup)) {
        const c2 = p.s[p.i++];
        const b = tex(p.arg());
        if (c2 === '^') sup = b; else sub = b;
      }
      if (sup && sub) base += `<span class="m-ss"><sup>${sup}</sup><sub>${sub}</sub></span>`;
      else base += sup ? `<sup>${sup}</sup>` : `<sub>${sub}</sub>`;
      continue;
    }
    flush();
    if (c === '\\') {
      const m = src.slice(p.i).match(/^\\([a-zA-Z]+|.)/);
      if (!m) { p.i++; base = '\\'; continue; }
      p.i += m[0].length;
      const name = m[1];
      if (name === '\\') { base = '<br>'; continue; }
      if (IGNORE.has(name)) continue;
      if (name in SYM) { base = esc(SYM[name]); continue; }
      if (name in BIG) { base = `<span class="m-big">${BIG[name]}</span>`; continue; }
      if (FUNCS.has(name)) { base = `<span class="m-op">${name}</span>`; continue; }
      if (name === 'operatorname') { base = `<span class="m-op">${esc(p.arg())}</span>`; continue; }
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = tex(p.arg()), b = tex(p.arg());
        base = `<span class="m-frac"><span>${a}</span><span>${b}</span></span>`; continue;
      }
      if (name === 'binom') {
        const a = tex(p.arg()), b = tex(p.arg());
        base = `(<span class="m-frac m-binom"><span>${a}</span><span>${b}</span></span>)`; continue;
      }
      if (name === 'sqrt') {
        const n = p.optArg();
        const a = tex(p.arg());
        base = `${n ? `<sup class="m-root">${tex(n)}</sup>` : ''}√<span class="m-over">${a}</span>`; continue;
      }
      if (name in ACCENT) { const a = tex(p.arg()); base = `<span class="m-acc">${a}${ACCENT[name]}</span>`; continue; }
      if (name === 'bar' || name === 'overline') { base = `<span class="m-over">${tex(p.arg())}</span>`; continue; }
      if (name === 'underline') { base = `<span class="m-under">${tex(p.arg())}</span>`; continue; }
      if (name === 'text' || name === 'textrm' || name === 'mathrm' || name === 'textnormal' || name === 'mbox') { base = `<span class="m-text">${esc(p.arg())}</span>`; continue; }
      if (name === 'mathbf' || name === 'textbf' || name === 'boldsymbol' || name === 'bm') { base = `<b>${tex(p.arg())}</b>`; continue; }
      if (name === 'mathit' || name === 'textit' || name === 'emph') { base = `<i>${esc(p.arg())}</i>`; continue; }
      if (name === 'mathsf' || name === 'mathtt' || name === 'texttt') { base = `<span class="m-text">${esc(p.arg())}</span>`; continue; }
      if (name in FONTS) { base = esc([...p.arg()].map(FONTS[name]).join('')); continue; }
      if (name === 'begin') { base = env(p); continue; }
      if (name === 'not') { const a = tex(p.arg()); base = `${a}̸`; continue; }
      base = `<span class="m-unknown">\\${esc(name)}</span>`;
      continue;
    }
    p.i++;
    if (c === '{') { p.i--; base = tex(p.arg()); continue; }
    if (c === '}') continue;
    if (c === '~') { base = ' '; continue; }
    if (/[a-zA-Z]/.test(c)) { base = `<i>${c}</i>`; continue; }
    if (c === '-') { base = '−'; continue; }
    if (c === "'") { base = '′'; continue; }
    if ('=<>+'.includes(c)) { base = ` ${esc(c)} `; continue; }
    base = esc(c);
  }
  flush();
  return out;
}

/** \begin{bmatrix} a & b \\ c & d \end{bmatrix} (and pmatrix, vmatrix, matrix, cases, aligned…) */
function env(p) {
  const kind = p.arg();
  const endTag = `\\end{${kind}}`;
  const end = p.s.indexOf(endTag, p.i);
  const body = p.s.slice(p.i, end < 0 ? undefined : end);
  p.i = end < 0 ? p.s.length : end + endTag.length;
  const text = kind === 'array' ? body.replace(/^\s*\{[^}]*\}/, '') : body; // drop the column spec
  const rows = text.split(/\\\\/).map((r) => r.trim()).filter((r, k, all) => r || k < all.length - 1).map((r) => r.split('&'));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, k) => `<span>${tex((r[k] ?? '').trim())}</span>`).join('')).join('');
  const fence = { bmatrix: 'm-b', pmatrix: 'm-p', vmatrix: 'm-v', Vmatrix: 'm-vv', Bmatrix: 'm-cb', cases: 'm-cases' }[kind] || '';
  const align = /align|cases|split|gather/.test(kind) ? ' m-left' : '';
  return `<span class="m-mat ${fence}${align}" style="--cols:${cols}">${cells}</span>`;
}

/** Find formulas in plain text: [{start, end, tex, display}] (no overlaps). */
export function findMath(s) {
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > 0 && s[m.index - 1] === '\\') continue; // \$ is a dollar sign
    const t = m[1] ?? m[2] ?? m[3] ?? m[4];
    out.push({ start: m.index, end: m.index + m[0].length, tex: t, display: m[1] !== undefined || m[3] !== undefined });
  }
  return out;
}
