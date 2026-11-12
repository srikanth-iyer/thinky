// The version people see (Build 41, he decided, Nov 9): the first number goes up when thinky is released
// to the public, the middle one for big changes, the last one for small ones (back to 0 when the middle
// one goes up). Change it with every build (CHANGELOG.md's heading says the same). The release on GitHub
// is titled "Build N · version X" from it (build.yml reads this line).
//
// Since Build 41 it is also the installed app's own version (scripts/ci_version.py stamps it in), and
// updates compare it: a release is newer when its version is higher, whichever part went up. The
// release job on GitHub refuses a build whose version isn't higher than the last release's. The build
// number is ui/build.js's (made by CI).
export const VERSION = '0.5.8';

/** "0.5.2" → [0, 5, 2]; anything else → null. */
export const parseVersion = (s) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(s ?? '').trim()); return m ? m.slice(1).map(Number) : null; };
/** Is version a higher than b (each part compared as a number, the first one first)? */
export function higherVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k];
  return false;
}
/** The version in a release's title ("Build 42 · version 0.5.3"), or null. */
export const releaseVersion = (title) => /\bversion (\d+\.\d+\.\d+)\b/.exec(String(title ?? ''))?.[1] ?? null;
