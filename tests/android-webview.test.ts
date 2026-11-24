import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidWebViewError, forwardAndroidWebView } from '../src/android-webview.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const UNIX_TABLE = [
  'Num       RefCount Protocol Flags    Type St Inode Path',
  '0000000000000000: 00000002 00000000 00010000 0001 01 54321 @webview_devtools_remote_1234',
  '0000000000000000: 00000002 00000000 00010000 0001 01 54322 @webview_devtools_remote_9999',
  '0000000000000000: 00000002 00000000 00010000 0001 01 54323 @chrome_devtools_remote',
].join('\n');

/** A scripted `adb`: answers by the arguments it is given and records every call. */
function scriptedAdb(overrides: Record<string, string | Error> = {}) {
  const answers: Record<string, string | Error> = {
    'shell pidof com.example.game': '1234\n',
    'shell cat /proc/net/unix': UNIX_TABLE,
    'forward tcp:0 localabstract:webview_devtools_remote_1234': '41715\n',
    'forward --remove tcp:41715': '',
    ...overrides,
  };
  const calls: string[] = [];
  const runAdb = vi.fn(async (args: readonly string[]) => {
    const key = args.join(' ').replace(/^-s \S+ /u, '');
    calls.push(args.join(' '));
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`unexpected adb call: ${args.join(' ')}`);
    return answer;
  });
  return { runAdb, calls };
}

describe('forwardAndroidWebView', () => {
  it('forwards the DevTools socket of the running app and hands back an endpoint', async () => {
    const { runAdb, calls } = scriptedAdb();
    const forward = await forwardAndroidWebView({ appId: 'com.example.game', runAdb });
    expect(forward).toMatchObject({
      endpoint: 'http://127.0.0.1:41715',
      port: 41715,
      socket: 'webview_devtools_remote_1234',
      pid: 1234,
    });
    expect(calls).toEqual([
      'shell pidof com.example.game',
      'shell cat /proc/net/unix',
      'forward tcp:0 localabstract:webview_devtools_remote_1234',
    ]);

    await forward.close();
    await forward.close();
    expect(calls.at(-1)).toBe('forward --remove tcp:41715');
    expect(calls.filter((call) => call.includes('--remove'))).toHaveLength(1);
  });

  it('lets a failed port-forward removal be retried', async () => {
    const { runAdb, calls } = scriptedAdb({
      'forward --remove tcp:41715': new Error('device offline'),
    });
    const forward = await forwardAndroidWebView({ appId: 'com.example.game', runAdb });
    await expect(forward.close()).rejects.toThrow(/device offline/u);
    await expect(forward.close()).rejects.toThrow(/device offline/u);
    expect(calls.filter((call) => call.includes('--remove'))).toHaveLength(2);
  });

  it('targets one device when a serial is given, and a fixed local port when asked', async () => {
    const { runAdb, calls } = scriptedAdb({
      'forward tcp:9222 localabstract:webview_devtools_remote_1234': '',
      'forward --remove tcp:9222': '',
    });
    const forward = await forwardAndroidWebView({
      appId: 'com.example.game',
      serial: 'emulator-5554',
      localPort: 9222,
      runAdb,
    });
    expect(forward).toMatchObject({ endpoint: 'http://127.0.0.1:9222', port: 9222 });
    await forward.close();
    expect(calls.every((call) => call.startsWith('-s emulator-5554 '))).toBe(true);
  });

  it('picks the process that owns a socket when the app has several', async () => {
    const { runAdb } = scriptedAdb({
      'shell pidof com.example.game': '5555 9999 1234',
      'forward tcp:0 localabstract:webview_devtools_remote_9999': '41716',
    });
    expect((await forwardAndroidWebView({ appId: 'com.example.game', runAdb })).pid).toBe(9999);
  });

  it('says so when the app is not running', async () => {
    const { runAdb } = scriptedAdb({ 'shell pidof com.example.game': new Error('exit 1') });
    await expect(forwardAndroidWebView({ appId: 'com.example.game', runAdb })).rejects.toThrow(
      /is not running/u,
    );
    const empty = scriptedAdb({ 'shell pidof com.example.game': '\n' });
    await expect(
      forwardAndroidWebView({ appId: 'com.example.game', runAdb: empty.runAdb }),
    ).rejects.toThrow(AndroidWebViewError);
  });

  it('explains a running app that has no debuggable WebView', async () => {
    const { runAdb } = scriptedAdb({
      'shell pidof com.example.game': '777',
      'shell cat /proc/net/unix': '@chrome_devtools_remote\n',
    });
    await expect(forwardAndroidWebView({ appId: 'com.example.game', runAdb })).rejects.toThrow(
      /pid 777\) has no WebView DevTools socket.*debuggable build.*sockets present: none/su,
    );
    const other = scriptedAdb({ 'shell pidof com.example.game': '777' });
    await expect(
      forwardAndroidWebView({ appId: 'com.example.game', runAdb: other.runAdb }),
    ).rejects.toThrow(/sockets present: 1234, 9999/u);
  });

  it('fails when adb reports no port for an automatically chosen forward', async () => {
    const { runAdb } = scriptedAdb({
      'forward tcp:0 localabstract:webview_devtools_remote_1234': 'not a port',
    });
    await expect(forwardAndroidWebView({ appId: 'com.example.game', runAdb })).rejects.toThrow(
      /did not report a local port/u,
    );
  });

  it.each([
    [
      'an application id with a shell metacharacter',
      { appId: 'com.example.game; reboot' },
      /application id/u,
    ],
    ['an application id with no dot', { appId: 'game' }, /application id/u],
    ['a serial with a space', { appId: 'com.example.game', serial: 'a b' }, /serial/u],
    ['a fractional port', { appId: 'com.example.game', localPort: 1.5 }, /localPort/u],
    ['a negative port', { appId: 'com.example.game', localPort: -1 }, /localPort/u],
    ['a port above 65535', { appId: 'com.example.game', localPort: 70_000 }, /localPort/u],
  ])('rejects %s before calling adb', async (_name, options, message) => {
    const { runAdb } = scriptedAdb();
    await expect(forwardAndroidWebView({ ...options, runAdb })).rejects.toThrow(message);
    expect(runAdb).not.toHaveBeenCalled();
  });
});

describe('the default adb runner', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  type Callback = (error: Error | null, stdout: string, stderr: string) => void;
  const respond = (
    handler: (file: string, args: readonly string[]) => [Error | null, string, string],
  ) => {
    vi.mocked(execFile).mockImplementation(((
      file: string,
      args: readonly string[],
      _options: unknown,
      callback: Callback,
    ) => {
      const [error, stdout, stderr] = handler(file, args);
      callback(error, stdout, stderr);
    }) as never);
  };

  it('spawns adb directly with the arguments, a timeout and no shell', async () => {
    respond((_file, args) => {
      if (args.at(-1) === 'com.example.game') return [null, '1234', ''];
      if (args.includes('/proc/net/unix')) return [null, UNIX_TABLE, ''];
      if (args.includes('--remove')) return [null, '', ''];
      return [null, '41715\n', ''];
    });
    const forward = await forwardAndroidWebView({
      appId: 'com.example.game',
      adbPath: '/opt/sdk/platform-tools/adb',
      timeoutMs: 2_000,
    });
    await forward.close();

    const first = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      { timeout: number; shell?: unknown },
    ];
    expect(first[0]).toBe('/opt/sdk/platform-tools/adb');
    expect(first[1]).toEqual(['shell', 'pidof', 'com.example.game']);
    expect(first[2]).toMatchObject({ timeout: 2_000, encoding: 'utf8' });
    expect(first[2].shell).toBeUndefined();
  });

  it('defaults to adb on the path and a 15 second timeout, and reports stderr on failure', async () => {
    respond(() => [new Error('Command failed'), '', 'error: no devices/emulators found\n']);
    await expect(forwardAndroidWebView({ appId: 'com.example.game' })).rejects.toThrow(
      /is not running/u,
    );
    const call = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      { timeout: number },
    ];
    expect(call[0]).toBe('adb');
    expect(call[2].timeout).toBe(15_000);

    respond((_file, args) =>
      args.includes('pidof')
        ? [null, '1234', '']
        : [new Error('Command failed'), '', 'error: closed\n'],
    );
    await expect(forwardAndroidWebView({ appId: 'com.example.game' })).rejects.toThrow(
      /adb shell cat \/proc\/net\/unix failed: error: closed/u,
    );
  });

  it('falls back to the error message when adb printed nothing on stderr', async () => {
    respond((_file, args) =>
      args.includes('pidof') ? [null, '1234', ''] : [new Error('spawn adb ENOENT'), '', ''],
    );
    await expect(forwardAndroidWebView({ appId: 'com.example.game' })).rejects.toThrow(
      /failed: spawn adb ENOENT/u,
    );
  });
});
