import { describe, expect, it } from 'vitest';
import { rawChromiumArgs } from './chromium/support/raw-chromium.js';

describe('raw Chromium silence guard', () => {
  it.each([[], ['--custom'], ['--mute-audio', '--custom', '--mute-audio']])(
    'appends exactly one mute after every caller and helper argument: %j',
    (...args) => {
      const launchArgs = rawChromiumArgs(args, 'test-profile');
      expect(launchArgs.filter((arg) => arg === '--mute-audio')).toEqual(['--mute-audio']);
      expect(launchArgs.at(-1)).toBe('--mute-audio');
      expect(launchArgs.slice(-6)).toEqual([
        '--remote-debugging-port=0',
        '--user-data-dir=test-profile',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
        '--mute-audio',
      ]);
      expect(launchArgs.slice(0, args.filter((arg) => arg !== '--mute-audio').length)).toEqual(
        args.filter((arg) => arg !== '--mute-audio'),
      );
    },
  );
});
