import { version } from 'vitest/node';

/**
 * The major version of the Vitest the consumer installed. The peer range spans
 * Vitest 4 and 5, which disagree about where some browser-mode options live
 * (Vitest 5 moved the browser server's port from `browser.api` to the
 * top-level `api`, and ignores the old one).
 */
export function vitestMajor(): number {
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major)) throw new Error(`unrecognised Vitest version: ${version}`);
  return major;
}
