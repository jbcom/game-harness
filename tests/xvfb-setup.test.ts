import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import xvfbGlobalSetup, {
  createXvfbGlobalSetup,
  setupXvfb,
  XVFB_PATH_ENV,
  type XvfbProcess,
  type XvfbSpawn,
} from '../src/xvfb-setup.js';

type Stdio = readonly (Readable | Writable | null | undefined)[];

class FakeXvfb extends EventEmitter implements XvfbProcess {
  readonly displayfd = new PassThrough();
  readonly stdio: Stdio;
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  exitOnKill = true;

  constructor(pipe: Readable | null = null) {
    super();
    this.stdio = [null, null, null, pipe ?? this.displayfd];
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exitOnKill) queueMicrotask(() => this.emit('exit', null, signal ?? 'SIGTERM'));
    return true;
  }
}

function harness(child = new FakeXvfb()) {
  const spawn = vi.fn<XvfbSpawn>(() => child);
  const env: Record<string, string | undefined> = {};
  return { child, spawn, env };
}

describe('setupXvfb on a non-Linux platform', () => {
  for (const platform of ['darwin', 'win32', 'freebsd']) {
    it(`is a no-op on ${platform}: nothing spawned, DISPLAY untouched`, async () => {
      const { spawn, env } = harness();
      env.DISPLAY = '/private/tmp/launchd/xquartz';
      await expect(setupXvfb({ platform, spawn, env })).resolves.toBeUndefined();
      expect(spawn).not.toHaveBeenCalled();
      expect(env.DISPLAY).toBe('/private/tmp/launchd/xquartz');
    });
  }

  it('defaults to process.platform, and the default export ignores the config Playwright passes', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      await expect(setupXvfb()).resolves.toBeUndefined();
      await expect(
        (xvfbGlobalSetup as (config: unknown) => Promise<unknown>)({ platform: 'linux' }),
      ).resolves.toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(process, 'platform', descriptor);
    }
  });
});

describe('setupXvfb on Linux', () => {
  it('spawns Xvfb with -displayfd, publishes DISPLAY, and tears down with SIGTERM', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('7\n');
    const teardown = await pending;

    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      'Xvfb',
      ['-displayfd', '3', '-screen', '0', '1920x1200x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] },
    );
    expect(env.DISPLAY).toBe(':7');
    expect(teardown).toBeTypeOf('function');

    await teardown?.();
    expect(child.signals).toEqual(['SIGTERM']);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('restores a DISPLAY that was set before setup', async () => {
    const { child, spawn, env } = harness();
    env.DISPLAY = ':0';
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('12\n');
    const teardown = await pending;
    expect(env.DISPLAY).toBe(':12');
    await teardown?.();
    expect(env.DISPLAY).toBe(':0');
  });

  it('reassembles a display number split across chunks', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('1');
    child.displayfd.write('0');
    child.displayfd.write('0\n');
    await pending;
    expect(env.DISPLAY).toBe(':100');
  });

  it('resolves the Xvfb binary from the option, then the environment, then PATH', async () => {
    const options = [
      { xvfbPath: '/opt/x/Xvfb', env: { [XVFB_PATH_ENV]: '/env/Xvfb' }, expected: '/opt/x/Xvfb' },
      { env: { [XVFB_PATH_ENV]: '/env/Xvfb' }, expected: '/env/Xvfb' },
      { env: {}, expected: 'Xvfb' },
    ];
    for (const { expected, ...rest } of options) {
      const { child, spawn } = harness();
      const pending = setupXvfb({ platform: 'linux', spawn, ...rest });
      child.displayfd.write('1\n');
      await pending;
      expect(spawn.mock.calls[0]?.[0]).toBe(expected);
    }
  });

  it('honours a custom screen geometry', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env, screen: '1280x720x24' });
    child.displayfd.write('3\n');
    await pending;
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      '-displayfd',
      '3',
      '-screen',
      '0',
      '1280x720x24',
      '-nolisten',
      'tcp',
    ]);
  });

  it('tears down once however many times the teardown is called', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('4\n');
    const teardown = await pending;
    await Promise.all([teardown?.(), teardown?.()]);
    await teardown?.();
    expect(child.signals).toEqual(['SIGTERM']);
  });

  it('does not signal an Xvfb that already exited, but still restores DISPLAY', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('5\n');
    const teardown = await pending;
    child.emit('exit', 1, null);
    await teardown?.();
    expect(child.signals).toEqual([]);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('waits for the process to exit before the teardown resolves', async () => {
    const { child, spawn, env } = harness();
    child.exitOnKill = false;
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('6\n');
    const teardown = await pending;
    let settled = false;
    const tearingDown = teardown?.().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    child.emit('exit', null, 'SIGTERM');
    await tearingDown;
    expect(settled).toBe(true);
  });

  it('fails, without setting DISPLAY, when Xvfb exits before reporting a display', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.emit('exit', 1, null);
    await expect(pending).rejects.toThrow(/Xvfb exited before reporting a display \(code 1\)/u);
    expect(env.DISPLAY).toBeUndefined();
    expect(child.signals).toEqual([]);
  });

  it('names the signal when Xvfb is killed before reporting a display', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.emit('exit', null, 'SIGKILL');
    await expect(pending).rejects.toThrow(/\(signal SIGKILL\)/u);
  });

  it('fails when the process cannot be started', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env, xvfbPath: '/missing/Xvfb' });
    child.emit('error', new Error('spawn /missing/Xvfb ENOENT'));
    await expect(pending).rejects.toThrow(/Could not start Xvfb at \/missing\/Xvfb: .*ENOENT/u);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('fails and stops the process when it reports something other than a display number', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.write('not-a-display\n');
    await expect(pending).rejects.toThrow(/invalid display number "not-a-display"/u);
    expect(child.signals).toEqual(['SIGTERM']);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('fails when the displayfd pipe closes without a display number', async () => {
    const { child, spawn, env } = harness();
    const pending = setupXvfb({ platform: 'linux', spawn, env });
    child.displayfd.end();
    await expect(pending).rejects.toThrow(/closed the -displayfd pipe before reporting a display/u);
  });

  it('fails when the spawn did not expose a displayfd pipe', async () => {
    const child = new FakeXvfb();
    const withoutPipe = Object.assign(new EventEmitter(), {
      stdio: [null, null, null, null] satisfies Stdio,
      kill: child.kill.bind(child),
    });
    const spawn: XvfbSpawn = () => withoutPipe;
    await expect(setupXvfb({ platform: 'linux', spawn, env: {} })).rejects.toThrow(
      /did not expose a -displayfd pipe/u,
    );
  });

  it('reports a missing binary through the real spawn', async () => {
    const env: Record<string, string | undefined> = {};
    await expect(
      setupXvfb({ platform: 'linux', env, xvfbPath: '/nonexistent/game-harness/Xvfb' }),
    ).rejects.toThrow(/Could not start Xvfb at \/nonexistent\/game-harness\/Xvfb: .*ENOENT/u);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('reads the binary override from process.env and leaves process.env.DISPLAY alone on failure', async () => {
    const before = process.env.DISPLAY;
    vi.stubEnv(XVFB_PATH_ENV, '/nonexistent/game-harness/Xvfb');
    try {
      await expect(setupXvfb({ platform: 'linux' })).rejects.toThrow(/Could not start Xvfb/u);
      expect(process.env.DISPLAY).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('createXvfbGlobalSetup', () => {
  it('binds the options once and ignores the config Playwright passes to globalSetup', async () => {
    const { child, spawn, env } = harness();
    const globalSetup = createXvfbGlobalSetup({
      platform: 'linux',
      spawn,
      env,
      screen: '800x600x24',
    });
    const pending = (globalSetup as (config: unknown) => ReturnType<typeof globalSetup>)({
      screen: 'ignored',
    });
    child.displayfd.write('9\n');
    const teardown = await pending;
    expect(env.DISPLAY).toBe(':9');
    expect(spawn.mock.calls[0]?.[1]).toContain('800x600x24');
    await teardown?.();
  });
});
