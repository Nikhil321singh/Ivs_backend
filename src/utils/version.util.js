/**
 * Dotted version comparison for the app-update check.
 *
 * Deliberately tolerant: clients report their version from the platform build
 * config, which arrives as "1.4", "v1.4.2", "1.4.2-beta.3" or "1.4.2 (218)"
 * depending on who wired it up. Anything after the numeric part is ignored, and
 * a missing segment counts as 0, so "1.4" and "1.4.0" compare equal instead of
 * flagging a phantom update on every launch.
 *
 * A pre-release suffix is NOT ranked below its release (1.4.2-beta === 1.4.2).
 * Store builds never carry one, and treating a tester's beta as "behind" would
 * force-update them out of the build they are meant to be testing.
 */

const MAX_SEGMENTS = 4;

/** ["1", "4", "2"] -> [1, 4, 2]; junk -> []. */
const parse = (value) => {
  if (value === null || value === undefined) return [];

  const match = String(value).trim().match(/\d+(?:\.\d+)*/);
  if (!match) return [];

  return match[0]
    .split('.')
    .slice(0, MAX_SEGMENTS)
    .map((part) => parseInt(part, 10))
    .filter(Number.isInteger);
};

/** True when `value` looks like a version we can compare at all. */
const isValidVersion = (value) => parse(value).length > 0;

/**
 * -1 when a < b, 0 when equal, 1 when a > b.
 *
 * Returns 0 when either side is unparseable — callers treat "cannot tell" as
 * "up to date", so a client sending a garbage version string is never shown a
 * forced update it can't escape.
 */
const compareVersions = (a, b) => {
  const left = parse(a);
  const right = parse(b);

  if (left.length === 0 || right.length === 0) return 0;

  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return 0;
};

/** Convenience readers, so call sites read as the question they're asking. */
const isOlderThan = (version, target) => compareVersions(version, target) < 0;

module.exports = { compareVersions, isOlderThan, isValidVersion, parse };
