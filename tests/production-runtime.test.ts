import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSilentGame } from '../src/playwright-config.js';
import {
  findAvailableProductionPort,
  readWebGLRenderer,
  requireHardwareWebGL,
  verifyProductionRuntime,
} from '../src/production-runtime.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('@playwright/test', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../src/playwright-config.js', () => ({ openSilentGame: vi.fn() }));

type RuntimeHandler = (value: never) => void;

function createRuntime() {
  const handlers = new Map<string, RuntimeHandler>();
  const page = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ 'settings::muted': 'false' }),
    on: vi.fn((event: string, handler: RuntimeHandler) => {
      handlers.set(event, handler);
      return page;
    }),
    url: vi.fn(() => 'http://127.0.0.1:4274/?muted=1'),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  vi.mocked(chromium.launch).mockResolvedValue(browser as never);
  vi.mocked(openSilentGame).mockResolvedValue(null);
  return { browser, handlers, page };
}

describe('verifyProductionRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an empty or whitespace-only runtime URL before launching anything', async () => {
    await expect(
      verifyProductionRuntime({ url: '   ', assertReady: async () => undefined }),
    ).rejects.toThrow(/runtime URL must not be empty/);
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('rejects a non-function assertReady before launching anything', async () => {
    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: undefined as never,
      }),
    ).rejects.toThrow(/assertReady must be a function/);
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('reserves distinct available ports for parallel production verifiers', async () => {
    const [first, second] = await Promise.all([
      findAvailableProductionPort(),
      findAvailableProductionPort(),
    ]);

    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(65_535);
    expect(second).not.toBe(first);
  });

  it('boots a fresh browser silently and preserves saved preferences', async () => {
    const { browser, page } = createRuntime();
    const assertReady = vi.fn().mockResolvedValue(undefined);
    const assertSilentState = vi.fn().mockResolvedValue(undefined);

    const result = await verifyProductionRuntime({
      url: 'http://127.0.0.1:4274/',
      browserLaunchOptions: { args: ['--custom', '--mute-audio'] },
      localStorageSentinels: { 'settings::muted': 'false' },
      assertReady,
      assertSilentState,
    });

    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--custom', '--mute-audio'], headless: false }),
    );
    expect(page.addInitScript).toHaveBeenCalledOnce();
    expect(openSilentGame).toHaveBeenCalledWith(
      page,
      'http://127.0.0.1:4274/',
      {},
      expect.objectContaining({ markerTimeout: 15_000 }),
    );
    expect(assertReady).toHaveBeenCalledWith(page);
    expect(assertSilentState).toHaveBeenCalledWith(page);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(result.finalUrl).toContain('muted=1');
    expect(result.localStorage).toEqual({ 'settings::muted': 'false' });
  });

  it('applies the Linux hardware Vulkan renderer profile', async () => {
    createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      gpuMode: 'linux-hardware-vulkan',
      assertReady: async () => undefined,
    });

    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '--use-gpu-in-tests',
          '--use-gl=angle',
          '--use-angle=vulkan',
          '--ignore-gpu-blocklist',
          '--mute-audio',
        ],
        env: expect.objectContaining({ EGL_PLATFORM: 'surfaceless' }),
        headless: false,
      }),
    );
  });

  it('merges custom browserLaunchOptions.env into the Chromium launch options', async () => {
    createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      browserLaunchOptions: { env: { GAME_SEED: 'fixed-seed' } },
      assertReady: async () => undefined,
    });

    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining({ GAME_SEED: 'fixed-seed' }) }),
    );
  });

  it('opens the page with caller-supplied pageOptions when provided', async () => {
    const { browser, page } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      pageOptions: { viewport: { width: 1280, height: 720 } },
      assertReady: async () => undefined,
    });

    expect(browser.newPage).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } });
    expect(page.url).toHaveBeenCalled();
  });

  it('ignores non-error console messages and sub-400 HTTP responses', async () => {
    const { handlers } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      assertReady: async () => {
        handlers.get('console')?.({ type: () => 'log', text: () => 'informational' } as never);
        handlers.get('response')?.({
          status: () => 204,
          url: () => 'https://game.example/health',
        } as never);
      },
    });
    // No assertion needed beyond not throwing: recording either as an issue
    // would have failed the run via the trailing issues check.
  });

  it('falls back to a generic message when a failed request has no failure() detail', async () => {
    const { handlers } = createRuntime();

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          handlers.get('requestfailed')?.({
            failure: () => null,
            url: () => 'https://game.example/asset.glb',
          } as never);
        },
      }),
    ).rejects.toThrow(/request failed without an error message/);
  });

  it('reads and accepts a hardware-backed WebGL renderer', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue({
      renderer: 'ANGLE (Intel, Vulkan 1.4, Intel open-source Mesa driver)',
      vendor: 'Google Inc. (Intel)',
      unmasked: true,
    });

    await expect(readWebGLRenderer(page as never)).resolves.toEqual(
      expect.objectContaining({ renderer: expect.stringContaining('Intel') }),
    );
    await expect(requireHardwareWebGL(page as never)).resolves.toEqual(
      expect.objectContaining({ renderer: expect.stringContaining('Intel') }),
    );
  });

  it.each(['SwiftShader', 'llvmpipe (LLVM 19.1.7)'])(
    'rejects the software WebGL renderer %s',
    async (renderer) => {
      const { page } = createRuntime();
      page.evaluate.mockResolvedValue({ renderer, vendor: 'software', unmasked: true });
      await expect(requireHardwareWebGL(page as never)).rejects.toThrow(/hardware WebGL required/i);
    },
  );

  it('fails closed when the browser exposes only a masked renderer', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue({
      renderer: 'WebKit WebGL',
      vendor: 'WebKit',
      unmasked: false,
    });
    await expect(requireHardwareWebGL(page as never)).rejects.toThrow(/masked renderer/i);
  });

  it('reports <empty> when the unmasked renderer string is blank', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue({ renderer: '', vendor: '', unmasked: true });
    await expect(requireHardwareWebGL(page as never)).rejects.toThrow(
      /unmasked renderer: <empty>/,
    );
  });

  describe('the in-page evaluate callback', () => {
    // `page.evaluate`/`page.addInitScript` serialize their callback into the
    // real browser; the mocked Page above never invokes it. Capture the real
    // function each production API hands to Playwright and execute it
    // directly against a fake DOM/localStorage to prove the actual in-page
    // logic (not just that `evaluate` was called).
    class FakeHTMLCanvasElement {}

    function evaluateArgOf(evaluateMock: ReturnType<typeof vi.fn>): (arg: unknown) => unknown {
      const call = evaluateMock.mock.calls.at(-1);
      if (!call) throw new Error('page.evaluate was never called');
      return call[0] as (arg: unknown) => unknown;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('reads the unmasked renderer/vendor through WEBGL_debug_renderer_info when present', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const extension = {
        UNMASKED_RENDERER_WEBGL: 'unmasked-renderer',
        UNMASKED_VENDOR_WEBGL: 'unmasked-vendor',
      };
      const context = {
        RENDERER: 'renderer',
        VENDOR: 'vendor',
        getExtension: vi.fn().mockReturnValue(extension),
        getParameter: vi.fn((name: string) => `param:${name}`),
      };
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      canvas.getContext = vi.fn().mockReturnValue(context) as never;
      vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(canvas) });

      await readWebGLRenderer(page as never);
      const result = evaluateArgOf(page.evaluate)('canvas');

      expect(result).toEqual({
        renderer: 'param:unmasked-renderer',
        vendor: 'param:unmasked-vendor',
        unmasked: true,
      });
    });

    it('falls back to the masked RENDERER/VENDOR parameters without the debug extension', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const context = {
        RENDERER: 'renderer',
        VENDOR: 'vendor',
        getExtension: vi.fn().mockReturnValue(null),
        getParameter: vi.fn((name: string) => `param:${name}`),
      };
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      canvas.getContext = vi.fn().mockReturnValue(context) as never;
      vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(canvas) });

      await readWebGLRenderer(page as never);
      const result = evaluateArgOf(page.evaluate)('canvas');

      expect(result).toEqual({ renderer: 'param:renderer', vendor: 'param:vendor', unmasked: false });
    });

    it('throws in-page when the canvas selector matches nothing', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(null) });

      await readWebGLRenderer(page as never);
      const callback = evaluateArgOf(page.evaluate);

      expect(() => callback('canvas')).toThrow(/WebGL canvas not found: canvas/);
    });

    it('throws in-page when no WebGL context is available', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      canvas.getContext = vi.fn().mockReturnValue(null) as never;
      vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(canvas) });

      await readWebGLRenderer(page as never);
      const callback = evaluateArgOf(page.evaluate);

      expect(() => callback('canvas')).toThrow(/WebGL context unavailable: canvas/);
    });

    it('seeds and clears localStorage sentinels through the in-page init script', async () => {
      const { page } = createRuntime();
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      });

      await verifyProductionRuntime({
        url: 'https://game.example/',
        localStorageSentinels: { 'settings::muted': 'false', 'settings::seed': null },
        assertReady: async () => undefined,
      });

      const initScriptCallback = page.addInitScript.mock.calls.at(-1)?.[0] as (
        values: Array<[string, string | null]>,
      ) => void;
      store.set('settings::seed', 'stale');
      initScriptCallback([
        ['settings::muted', 'false'],
        ['settings::seed', null],
      ]);

      expect(store.get('settings::muted')).toBe('false');
      expect(store.has('settings::seed')).toBe(false);
    });

    it('reads localStorage sentinels through the in-page evaluate callback', async () => {
      const { page } = createRuntime();
      page.evaluate.mockResolvedValue({ 'settings::muted': 'false', 'settings::missing': null });
      const store = new Map<string, string>([['settings::muted', 'false']]);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
      });

      await verifyProductionRuntime({
        url: 'https://game.example/',
        localStorageSentinels: { 'settings::muted': 'false', 'settings::missing': null },
        assertReady: async () => undefined,
      });

      const readCallback = page.evaluate.mock.calls.at(-1)?.[0] as (keys: string[]) => unknown;
      const result = readCallback(['settings::muted', 'settings::missing']);

      expect(result).toEqual({ 'settings::muted': 'false', 'settings::missing': null });
    });
  });

  it('fails when runtime errors are emitted after navigation', async () => {
    const { handlers } = createRuntime();

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          handlers.get('console')?.({
            type: () => 'error',
            text: () => 'module initialization failed',
          } as never);
          handlers.get('pageerror')?.(new Error('render crashed') as never);
        },
      }),
    ).rejects.toThrow(/module initialization failed.*render crashed/s);
  });

  it('wraps an assertReady failure with the runtime errors recorded before it threw', async () => {
    const { handlers } = createRuntime();

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          handlers.get('console')?.({
            type: () => 'error',
            text: () => 'asset manifest 404',
          } as never);
          throw new Error('heading never appeared');
        },
      }),
    ).rejects.toThrow(
      /production runtime failed while emitting runtime errors:[\s\S]*asset manifest 404/,
    );
  });

  it('fails on broken requests and HTTP error responses', async () => {
    const { handlers } = createRuntime();

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          handlers.get('requestfailed')?.({
            failure: () => ({ errorText: 'net::ERR_FAILED' }),
            url: () => 'https://game.example/missing.glb',
          } as never);
          handlers.get('response')?.({
            status: () => 503,
            url: () => 'https://game.example/save-api',
          } as never);
        },
      }),
    ).rejects.toThrow(/ERR_FAILED.*missing\.glb.*HTTP 503.*save-api/s);
  });

  it('fails when a saved preference changes during the boot', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue({ 'settings::muted': 'true' });

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        localStorageSentinels: { 'settings::muted': 'false' },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/settings::muted.*expected.*false.*received.*true/i);
  });

  it('owns a local server and refuses to reuse an occupied readiness URL', async () => {
    const runtime = createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    });
    child.kill.mockImplementation(() => {
      // Exit fires asynchronously and exitCode/signalCode update only once
      // the 'exit' event is actually observed, matching real Node
      // child_process semantics and letting stopServer's onExit listener
      // (not just the childExited() pre-check) resolve waitForChildExit.
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      });
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('not listening'))
      .mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await verifyProductionRuntime({
      url: 'http://127.0.0.1:4274/',
      server: { command: 'vite', args: ['preview', '--strictPort'] },
      assertReady: async () => undefined,
    });

    expect(spawn).toHaveBeenCalledWith(
      'vite',
      ['preview', '--strictPort'],
      expect.objectContaining({ stdio: ['ignore', 'inherit', 'inherit'] }),
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runtime.browser.close).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    createRuntime();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'vite', args: ['preview', '--strictPort'] },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/already reachable/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('passes a custom cwd through to the owned server child process', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn().mockImplementation(() => {
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('not listening'))
        .mockResolvedValue(new Response('', { status: 200 })),
    );

    await verifyProductionRuntime({
      url: 'http://127.0.0.1:4274/',
      server: { command: 'vite', cwd: '/srv/game' },
      assertReady: async () => undefined,
    });

    expect(spawn).toHaveBeenCalledWith(
      'vite',
      [],
      expect.objectContaining({ cwd: '/srv/game' }),
    );
    vi.unstubAllGlobals();
  });

  it('cancels every reachable readiness response body before retry or success', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    });
    child.kill.mockImplementation(() => {
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, null));
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const retryCancel = vi.fn().mockResolvedValue(undefined);
    const readyCancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('not listening'))
        .mockResolvedValueOnce({
          body: { cancel: retryCancel },
          ok: false,
          status: 503,
        } as unknown as Response)
        .mockResolvedValueOnce({
          body: { cancel: readyCancel },
          ok: true,
          status: 200,
        } as unknown as Response),
    );

    await verifyProductionRuntime({
      url: 'http://127.0.0.1:4274/',
      server: { command: 'vite', args: ['preview', '--strictPort'] },
      assertReady: async () => undefined,
    });

    expect(retryCancel).toHaveBeenCalledOnce();
    expect(readyCancel).toHaveBeenCalledOnce();
  });

  it('keeps proven reachability authoritative when body cancellation rejects', async () => {
    createRuntime();
    const cancel = vi.fn().mockRejectedValue(new Error('stream already locked'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: { cancel },
        ok: true,
        status: 200,
      } as unknown as Response),
    );

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'vite', args: ['preview', '--strictPort'] },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/already reachable/i);

    expect(cancel).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('propagates an assertReady failure unchanged when no runtime issues were recorded', async () => {
    createRuntime();
    const readyError = new Error('heading never appeared');

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          throw readyError;
        },
      }),
    ).rejects.toBe(readyError);
  });

  it('skips the settle wait entirely when settleTimeMs is 0', async () => {
    const { page } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      settleTimeMs: 0,
      assertReady: async () => undefined,
    });

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('waits the default 250ms settle window when settleTimeMs is not provided', async () => {
    const { page } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      assertReady: async () => undefined,
    });

    expect(page.waitForTimeout).toHaveBeenCalledWith(250);
  });

  it('surfaces a spawn error from the owned server process', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn().mockImplementation(() => {
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
      }),
    });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT: no such executable')));
      return child as never;
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'does-not-exist', args: [] },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/runtime server failed to start.*ENOENT/s);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('fails closed when the owned server process exits before becoming ready', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn().mockReturnValue(true),
    });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.exitCode = 1;
        child.emit('exit', 1, null);
      });
      return child as never;
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'vite', args: ['preview'] },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/runtime server exited before readiness \(code=1, signal=null\)/);
    // Already exited: stopServer must not attempt to kill it again.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('times out when the owned server never becomes ready', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn().mockImplementation(() => {
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'vite', args: ['preview'], startupTimeoutMs: 5 },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/did not become ready within 5 ms/);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('escalates to SIGKILL when the owned server ignores SIGTERM', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    });
    let sigkillSent = false;
    child.kill.mockImplementation((signal: NodeJS.Signals) => {
      if (signal === 'SIGKILL') {
        sigkillSent = true;
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, 'SIGKILL'));
      }
      // SIGTERM is accepted by the process but intentionally ignored,
      // simulating a server that doesn't shut down gracefully.
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: {
          command: 'vite',
          args: ['preview'],
          startupTimeoutMs: 5,
          // Short enough to keep the test fast, long enough for the
          // SIGTERM-then-SIGKILL escalation to run to completion.
          shutdownTimeoutMs: 20,
        },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/did not become ready/);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(sigkillSent).toBe(true);
  });

  it('stops waiting once kill() reports the process could not be signalled', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn().mockReturnValue(false),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: { command: 'vite', args: ['preview'], startupTimeoutMs: 5 },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/did not become ready/);
    // kill() returning false means the OS could not signal the process;
    // stopServer must not wait for an exit event that will never come.
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('stops after an ignored SIGTERM once SIGKILL also fails to signal the process', async () => {
    createRuntime();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn((signal: NodeJS.Signals) => signal !== 'SIGKILL'),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('not listening')));

    await expect(
      verifyProductionRuntime({
        url: 'http://127.0.0.1:4274/',
        server: {
          command: 'vite',
          args: ['preview'],
          startupTimeoutMs: 5,
          shutdownTimeoutMs: 5,
        },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/did not become ready/);

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledTimes(2);
  });
});
