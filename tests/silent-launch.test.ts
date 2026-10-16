import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSilentQaForTests,
  isSilentQaActive,
  resolveSilentQaSearch,
} from '../src/silent-qa.js';

const accepts = (url: URL) =>
  url.protocol === 'example:' && url.hostname === 'qa' && url.pathname === '/';

describe('first-bootstrap silent launch resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetSilentQaForTests();
  });

  it.each([
    ['?seed=a%20b&tag=a~b&slash=x%2fY', '?seed=a%20b&tag=a~b&slash=x%2fY&muted=1'],
    ['seed=a%20b', '?seed=a%20b&muted=1'],
    ['?', '?muted=1'],
    ['?seed=a%20b&', '?seed=a%20b&muted=1'],
  ])('preserves original query encoding when appending to %s', async (search, expected) => {
    expect(
      await resolveSilentQaSearch({
        search,
        nativeLaunch: { readUrl: async () => 'example://qa/?muted=1', accepts },
      }),
    ).toBe(expected);
  });

  it('preserves browser queries byte-for-byte without a native reader', async () => {
    expect(await resolveSilentQaSearch({ search: '?seed=a%20b&muted=0&seed=c' })).toBe(
      '?seed=a%20b&muted=0&seed=c',
    );
    vi.stubGlobal('window', { location: { search: '?muted=1&road=daily' } });
    expect(await resolveSilentQaSearch()).toBe('?muted=1&road=daily');
    vi.unstubAllGlobals();
    expect(await resolveSilentQaSearch()).toBe('');
  });

  it('awaits the launch URL before returning a mute request', async () => {
    let release: ((url: string) => void) | undefined;
    const resolved = vi.fn();
    const pending = resolveSilentQaSearch({
      search: '?road=daily&seed=one',
      nativeLaunch: {
        readUrl: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
        accepts,
      },
    }).then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    release?.('example://qa/?muted=0&kurogaDebug=1&progress=999');
    await pending;
    expect(resolved).toHaveBeenCalledWith('?road=daily&seed=one&muted=1');
  });

  it.each([
    undefined,
    'example://qa/?road=daily',
    'https://foreign.test/?muted=1',
    'example://qa/other?muted=1',
  ])('does not turn ordinary or unapproved native launch %s into QA', async (url) => {
    expect(
      await resolveSilentQaSearch({
        search: '?seed=a%20b',
        nativeLaunch: { readUrl: async () => url, accepts },
      }),
    ).toBe('?seed=a%20b');
  });

  it('retains an existing browser mute while still validating the native lookup', async () => {
    const readUrl = vi.fn(async () => 'example://qa/?muted=1');
    expect(
      await resolveSilentQaSearch({
        search: '?muted=0&seed=a%20b',
        nativeLaunch: { readUrl, accepts },
      }),
    ).toBe('?muted=0&seed=a%20b');
    expect(readUrl).toHaveBeenCalledOnce();
  });

  it('supports a custom mute parameter without importing the native query', async () => {
    expect(
      await resolveSilentQaSearch({
        queryParameter: 'silent',
        nativeLaunch: { readUrl: async () => 'example://qa/?silent=0&seed=wrong', accepts },
      }),
    ).toBe('?silent=1');
  });

  it.each(['', 'relative?muted=1', 'http://[bad/?muted=1'])(
    'rejects malformed launch URL %s',
    async (url) => {
      await expect(
        resolveSilentQaSearch({
          search: '?muted=1',
          nativeLaunch: { readUrl: async () => url, accepts },
        }),
      ).rejects.toThrow();
    },
  );

  it('propagates native lookup and policy errors instead of an unmuted fallback', async () => {
    await expect(
      resolveSilentQaSearch({
        nativeLaunch: {
          readUrl: async () => {
            throw new Error('bridge unavailable');
          },
          accepts,
        },
      }),
    ).rejects.toThrow('bridge unavailable');
    await expect(
      resolveSilentQaSearch({
        nativeLaunch: {
          readUrl: async () => 'example://qa/?muted=1',
          accepts: () => {
            throw new Error('policy unavailable');
          },
        },
      }),
    ).rejects.toThrow('policy unavailable');
  });

  it('does not activate audio, publish readiness, navigate, or read/write preferences', async () => {
    const forbidden = () => {
      throw new Error('resolver must have no side effects');
    };
    vi.stubGlobal('document', { documentElement: { setAttribute: forbidden } });
    vi.stubGlobal('localStorage', { getItem: forbidden, setItem: forbidden });
    vi.stubGlobal('AudioContext', forbidden);
    vi.stubGlobal('window', { location: { search: '', assign: forbidden, replace: forbidden } });
    expect(
      await resolveSilentQaSearch({
        nativeLaunch: { readUrl: async () => 'example://qa/?muted=1', accepts },
      }),
    ).toBe('?muted=1');
    expect(isSilentQaActive()).toBe(false);
  });
});
