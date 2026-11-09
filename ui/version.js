// The version people see (Build 41, he decided, Nov 9): the first number goes up when thinky is released
// to the public, the middle one for big changes, the last one for small ones (back to 0 when the middle
// one goes up). Change it with every build (CHANGELOG.md's heading says the same). The release on GitHub
// is titled "Build N · version X" from it (build.yml reads this line).
//
// The installed app's own version stays 0.1.N (N = the build number, scripts/ci_version.py): the update
// check compares those, and Build 40 and older only accept an update whose version ends in its build
// number, so that number can't change without stopping them from updating.
export const VERSION = '0.5.2';
