import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROMIUM_ANTI_THROTTLING_ARGS } from '../src/chromium-launch.js';
import { openSilentGame } from '../src/playwright-config.js';
import {
  findAvailableProductionPort,
  installWebGLContextEventRecorder,
  ProductionRuntimeVerificationError,
  readWebGLCanvasDiagnostics,
  readWebGLContextEvents,
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

function hardwarePreflight(
  info: { renderer: string; vendor: string; unmasked: boolean },
  context: Record<string, unknown> = {},
) {
  return {
    diagnostics: {
      canvasCount: 1,
      context: {
        attributes: { alpha: true, antialias: true },
        error: 'NO_ERROR',
        genericRenderer: info.renderer,
        genericVendor: info.vendor,
        isContextLost: false,
        kind: 'webgl2',
        renderer: info.renderer,
        unmasked: info.unmasked,
        vendor: info.vendor,
        ...context,
      },
      selectedCanvas: {
        className: 'game-canvas',
        connected: true,
        height: 720,
        id: 'board',
        rect: { height: 720, width: 1280, x: 0, y: 0 },
        width: 1280,
      },
      selector: '#scene-canvas canvas',
    },
    info,
  };
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
      verifyProductionRuntime({
        url: '   ',
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(/runtime URL must not be empty/);
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('rejects malformed and non-HTTP runtime URLs before launching anything', async () => {
    await expect(
      verifyProductionRuntime({ url: 'not a URL', assertReady: async () => undefined }),
    ).rejects.toThrow(/valid absolute URL/);
    await expect(
      verifyProductionRuntime({ url: 'file:///tmp/game.html', assertReady: async () => undefined }),
    ).rejects.toThrow(/http or https/);
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('validates server identity and lifecycle durations before launching', async () => {
    const base = {
      url: 'http://127.0.0.1:4274/',
      assertReady: async () => undefined,
    };
    await expect(verifyProductionRuntime({ ...base, server: { command: ' ' } })).rejects.toThrow(
      /server command/,
    );
    await expect(
      verifyProductionRuntime({
        ...base,
        server: { command: 'vite', readyUrl: 'relative/path' },
      }),
    ).rejects.toThrow(/readiness URL.*absolute/);
    await expect(
      verifyProductionRuntime({
        ...base,
        server: { command: 'vite', startupTimeoutMs: 0 },
      }),
    ).rejects.toThrow(/startupTimeoutMs.*positive/);
    await expect(
      verifyProductionRuntime({
        ...base,
        server: { command: 'vite', shutdownTimeoutMs: -1 },
      }),
    ).rejects.toThrow(/shutdownTimeoutMs.*non-negative/);
    await expect(verifyProductionRuntime({ ...base, settleTimeMs: Number.NaN })).rejects.toThrow(
      /settleTimeMs.*non-negative/,
    );
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
      expect.objectContaining({
        args: [...CHROMIUM_ANTI_THROTTLING_ARGS, '--custom', '--mute-audio'],
        headless: false,
      }),
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
          ...CHROMIUM_ANTI_THROTTLING_ARGS,
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
      expect.objectContaining({
        env: expect.objectContaining({ GAME_SEED: 'fixed-seed' }),
      }),
    );
  });

  it('opens the page with caller-supplied pageOptions when provided', async () => {
    const { browser, page } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      pageOptions: { viewport: { width: 1280, height: 720 } },
      assertReady: async () => undefined,
    });

    expect(browser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 720 },
    });
    expect(page.url).toHaveBeenCalled();
  });

  it('ignores non-error console messages and sub-400 HTTP responses', async () => {
    const { handlers } = createRuntime();

    await verifyProductionRuntime({
      url: 'https://game.example/',
      assertReady: async () => {
        handlers.get('console')?.({
          type: () => 'log',
          text: () => 'informational',
        } as never);
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
    const info = {
      renderer: 'ANGLE (Intel, Vulkan 1.4, Intel open-source Mesa driver)',
      vendor: 'Google Inc. (Intel)',
      unmasked: true,
    };
    page.evaluate.mockResolvedValueOnce(info).mockResolvedValueOnce(hardwarePreflight(info));

    await expect(readWebGLRenderer(page as never)).resolves.toEqual(
      expect.objectContaining({ renderer: expect.stringContaining('Intel') }),
    );
    await expect(requireHardwareWebGL(page as never)).resolves.toEqual(
      expect.objectContaining({ renderer: expect.stringContaining('Intel') }),
    );
  });

  it('accepts the Apple GPU that headless Chromium reaches through ANGLE Metal', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue(
      hardwarePreflight({
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)',
        vendor: 'Google Inc. (Apple)',
        unmasked: true,
      }),
    );
    await expect(requireHardwareWebGL(page as never)).resolves.toEqual(
      expect.objectContaining({ renderer: expect.stringContaining('ANGLE Metal Renderer') }),
    );
  });

  it.each(['SwiftShader', 'llvmpipe (LLVM 19.1.7)'])(
    'rejects the software WebGL renderer %s',
    async (renderer) => {
      const { page } = createRuntime();
      page.evaluate.mockResolvedValue(
        hardwarePreflight({ renderer, vendor: 'software', unmasked: true }),
      );
      await expect(requireHardwareWebGL(page as never)).rejects.toThrow(/hardware WebGL required/i);
    },
  );

  it('fails closed when the browser exposes only a masked renderer', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue(
      hardwarePreflight({ renderer: 'WebKit WebGL', vendor: 'WebKit', unmasked: false }),
    );
    await expect(requireHardwareWebGL(page as never)).rejects.toThrow(/masked renderer/i);
  });

  it('reports <empty> when the unmasked renderer string is blank', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue(
      hardwarePreflight({ renderer: '', vendor: '', unmasked: true }),
    );
    await expect(requireHardwareWebGL(page as never)).rejects.toThrow(/unmasked renderer: <empty>/);
  });

  it('retains a lost context snapshot when an owned hardware preflight fails', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue(
      hardwarePreflight(
        { renderer: 'null', unmasked: false, vendor: 'null' },
        {
          attributes: null,
          error: 'CONTEXT_LOST_WEBGL',
          genericRenderer: null,
          genericVendor: null,
          isContextLost: true,
          kind: 'webgl',
          renderer: null,
          vendor: null,
        },
      ),
    );

    await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
      /"error":"CONTEXT_LOST_WEBGL".*"isContextLost":true.*"kind":"webgl"/,
    );
  });

  it('retains the hardware verdict when renderer or diagnostic probes reject', async () => {
    const { page } = createRuntime();
    page.evaluate
      .mockRejectedValueOnce(new Error('selected canvas detached'))
      .mockRejectedValueOnce('page closed');

    await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
      /hardware WebGL required; renderer probe failed: <unavailable: selected canvas detached>; diagnostic=<unavailable: page closed>/,
    );
  });

  it('uses the owned preflight snapshot without a second public diagnostic read', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValue(
      hardwarePreflight({ renderer: 'WebKit WebGL', unmasked: false, vendor: 'WebKit' }),
    );

    await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
      /received masked renderer: WebKit WebGL/,
    );
    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  it('records context lifecycle events before navigation and retains them on a preflight failure', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValueOnce([]);
    const assertReady = vi
      .fn()
      .mockRejectedValue(new ProductionRuntimeVerificationError('hardware preflight failed'));

    await expect(
      verifyProductionRuntime({
        assertReady,
        captureWebGLContextEvents: true,
        url: 'https://game.example/',
      }),
    ).rejects.toThrow(/webglContextEvents=\[\]/);

    expect(page.addInitScript).toHaveBeenCalledOnce();
    expect(page.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(openSilentGame).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('retains ordinary assertion failures with lifecycle diagnostics', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValueOnce([]);

    await expect(
      verifyProductionRuntime({
        assertReady: async () => {
          throw new Error('landing did not settle');
        },
        captureWebGLContextEvents: true,
        url: 'https://game.example/',
      }),
    ).rejects.toThrow(/landing did not settle\nwebglContextEvents=\[\]/);
  });

  it('appends the lifecycle ledger when the post-ready settle window fails', async () => {
    const { page } = createRuntime();
    page.waitForTimeout.mockRejectedValueOnce(new Error('animation never settled'));
    page.evaluate.mockResolvedValueOnce([]);

    await expect(
      verifyProductionRuntime({
        assertReady: async () => undefined,
        captureWebGLContextEvents: true,
        settleTimeMs: 1,
        url: 'https://game.example/',
      }),
    ).rejects.toThrow(/animation never settled\nwebglContextEvents=\[\]/);
  });

  it('retains the original assertion when lifecycle diagnostics cannot be read', async () => {
    const { page } = createRuntime();
    page.evaluate.mockRejectedValueOnce(new Error('page closed'));

    await expect(
      verifyProductionRuntime({
        assertReady: async () => {
          throw new Error('landing did not settle');
        },
        captureWebGLContextEvents: true,
        url: 'https://game.example/',
      }),
    ).rejects.toThrow(/landing did not settle\nwebglContextEvents=<unavailable: page closed>/);
  });

  it('formats a non-Error assertion value with lifecycle diagnostics', async () => {
    const { page } = createRuntime();
    page.evaluate.mockResolvedValueOnce([]);

    await expect(
      verifyProductionRuntime({
        assertReady: async () => {
          throw 'landing did not settle';
        },
        captureWebGLContextEvents: true,
        url: 'https://game.example/',
      }),
    ).rejects.toThrow(/landing did not settle\nwebglContextEvents=\[\]/);
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
      vi.stubGlobal('document', {
        querySelector: vi.fn().mockReturnValue(canvas),
      });

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
      vi.stubGlobal('document', {
        querySelector: vi.fn().mockReturnValue(canvas),
      });

      await readWebGLRenderer(page as never);
      const result = evaluateArgOf(page.evaluate)('canvas');

      expect(result).toEqual({
        renderer: 'param:renderer',
        vendor: 'param:vendor',
        unmasked: false,
      });
    });

    it('throws in-page when the canvas selector matches nothing', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      vi.stubGlobal('document', {
        querySelector: vi.fn().mockReturnValue(null),
      });

      await readWebGLRenderer(page as never);
      const callback = evaluateArgOf(page.evaluate);

      expect(() => callback('canvas')).toThrow(/WebGL canvas not found: canvas/);
    });

    it('throws in-page when no WebGL context is available', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      canvas.getContext = vi.fn().mockReturnValue(null) as never;
      vi.stubGlobal('document', {
        querySelector: vi.fn().mockReturnValue(canvas),
      });

      await readWebGLRenderer(page as never);
      const callback = evaluateArgOf(page.evaluate);

      expect(() => callback('canvas')).toThrow(/WebGL context unavailable: canvas/);
    });

    it('reports selector ownership without creating a context on a pristine canvas', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const context = {
        INVALID_ENUM: 0x0500,
        INVALID_FRAMEBUFFER_OPERATION: 0x0506,
        INVALID_OPERATION: 0x0502,
        INVALID_VALUE: 0x0501,
        NO_ERROR: 0,
        OUT_OF_MEMORY: 0x0505,
        RENDERER: 'renderer',
        VENDOR: 'vendor',
        getContextAttributes: vi.fn().mockReturnValue({ alpha: true, antialias: true }),
        getError: vi.fn().mockReturnValue(0),
        getExtension: vi.fn().mockReturnValue({
          UNMASKED_RENDERER_WEBGL: 'unmasked-renderer',
          UNMASKED_VENDOR_WEBGL: 'unmasked-vendor',
        }),
        getParameter: vi.fn((name: string) => `param:${name}`),
        isContextLost: vi.fn().mockReturnValue(false),
      };
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      Object.assign(canvas, {
        className: 'board-canvas',
        height: 720,
        id: 'board',
        isConnected: true,
        width: 1280,
      });
      canvas.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ height: 720, width: 1280, x: 0, y: 0 }) as never;
      canvas.getContext = vi
        .fn()
        .mockImplementation((kind: string) => (kind === 'webgl2' ? context : null)) as never;
      vi.stubGlobal('document', {
        querySelectorAll: vi.fn().mockReturnValue([canvas]),
      });

      await readWebGLCanvasDiagnostics(page as never, '#scene-canvas canvas');
      const result = evaluateArgOf(page.evaluate)('#scene-canvas canvas');

      expect(result).toMatchObject({
        canvasCount: 1,
        context: null,
        selector: '#scene-canvas canvas',
        selectedCanvas: { id: 'board' },
      });
      expect(canvas.getContext).not.toHaveBeenCalled();

      page.evaluate.mockResolvedValue(
        hardwarePreflight({ renderer: 'ANGLE (Intel)', unmasked: true, vendor: 'Google Inc.' }),
      );
      await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).resolves.toEqual(
        expect.objectContaining({ unmasked: true }),
      );
      const preflight = evaluateArgOf(page.evaluate)('#scene-canvas canvas');
      expect(preflight).toMatchObject({
        diagnostics: {
          context: {
            attributes: { alpha: true, antialias: true },
            error: 'NO_ERROR',
            isContextLost: false,
            kind: 'webgl2',
          },
        },
      });
      expect(canvas.getContext).toHaveBeenCalledWith('webgl2');
    });

    it('retains a lost WebGL context in the owned preflight snapshot', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const context = {
        INVALID_ENUM: 0x0500,
        INVALID_FRAMEBUFFER_OPERATION: 0x0506,
        INVALID_OPERATION: 0x0502,
        INVALID_VALUE: 0x0501,
        NO_ERROR: 0,
        OUT_OF_MEMORY: 0x0505,
        RENDERER: 'renderer',
        VENDOR: 'vendor',
        getContextAttributes: vi.fn().mockReturnValue(null),
        getError: vi.fn().mockReturnValue(0x9242),
        getExtension: vi.fn().mockReturnValue(null),
        getParameter: vi.fn().mockReturnValue(null),
        isContextLost: vi.fn().mockReturnValue(true),
      };
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      Object.assign(canvas, { className: '', height: 0, id: '', isConnected: true, width: 0 });
      canvas.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ height: 0, width: 0, x: 0, y: 0 }) as never;
      canvas.getContext = vi
        .fn()
        .mockImplementation((kind: string) => (kind === 'webgl' ? context : null)) as never;
      vi.stubGlobal('document', {
        querySelectorAll: vi.fn().mockReturnValue([canvas]),
      });
      page.evaluate.mockResolvedValue(
        hardwarePreflight({ renderer: 'null', unmasked: false, vendor: 'null' }),
      );

      await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
        /masked renderer: null/,
      );
      const result = evaluateArgOf(page.evaluate)('#scene-canvas canvas');

      expect(result).toMatchObject({
        diagnostics: {
          context: {
            attributes: null,
            error: 'CONTEXT_LOST_WEBGL',
            isContextLost: true,
            kind: 'webgl',
            renderer: null,
            unmasked: false,
          },
        },
      });
    });

    it('reports no selected canvas when the owner selector resolves only non-canvas nodes', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      vi.stubGlobal('document', {
        querySelectorAll: vi.fn().mockReturnValue([{}]),
      });

      await readWebGLCanvasDiagnostics(page as never, '#scene-canvas canvas');
      const result = evaluateArgOf(page.evaluate)('#scene-canvas canvas');

      expect(result).toEqual({
        canvasCount: 0,
        context: null,
        selectedCanvas: null,
        selector: '#scene-canvas canvas',
      });

      page.evaluate.mockResolvedValue(
        hardwarePreflight({ renderer: 'WebKit WebGL', unmasked: false, vendor: 'WebKit' }),
      );
      await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
        /masked renderer: WebKit WebGL/,
      );
      const preflight = evaluateArgOf(page.evaluate);
      expect(() => preflight('#scene-canvas canvas')).toThrow(
        /WebGL canvas not found: #scene-canvas canvas/,
      );
    });

    it('reports a selected canvas with no WebGL context separately from a missing canvas', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      Object.assign(canvas, {
        className: 'poster',
        height: 160,
        id: 'poster',
        isConnected: true,
        width: 320,
      });
      canvas.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ height: 160, width: 320, x: 4, y: 8 }) as never;
      canvas.getContext = vi.fn().mockReturnValue(null) as never;
      vi.stubGlobal('document', {
        querySelectorAll: vi.fn().mockReturnValue([canvas]),
      });

      await readWebGLCanvasDiagnostics(page as never, '#scene-canvas canvas');
      const result = evaluateArgOf(page.evaluate)('#scene-canvas canvas');

      expect(result).toMatchObject({
        canvasCount: 1,
        context: null,
        selectedCanvas: { id: 'poster' },
      });

      page.evaluate.mockResolvedValue(
        hardwarePreflight({ renderer: 'WebKit WebGL', unmasked: false, vendor: 'WebKit' }),
      );
      await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
        /masked renderer: WebKit WebGL/,
      );
      const preflight = evaluateArgOf(page.evaluate);
      expect(() => preflight('#scene-canvas canvas')).toThrow(
        /WebGL context unavailable: #scene-canvas canvas/,
      );
    });

    it('records generic WebGL identity and an unknown GL error without an unmasked extension', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const context = {
        INVALID_ENUM: 0x0500,
        INVALID_FRAMEBUFFER_OPERATION: 0x0506,
        INVALID_OPERATION: 0x0502,
        INVALID_VALUE: 0x0501,
        NO_ERROR: 0,
        OUT_OF_MEMORY: 0x0505,
        RENDERER: 'renderer',
        VENDOR: 'vendor',
        getContextAttributes: vi.fn().mockReturnValue(null),
        getError: vi.fn().mockReturnValue(0x9999),
        getExtension: vi.fn().mockReturnValue(null),
        getParameter: vi.fn((name: string) => `generic:${name}`),
        isContextLost: vi.fn().mockReturnValue(false),
      };
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      Object.assign(canvas, { className: '', height: 1, id: '', isConnected: true, width: 1 });
      canvas.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ height: 1, width: 1, x: 0, y: 0 }) as never;
      canvas.getContext = vi
        .fn()
        .mockImplementation((kind: string) => (kind === 'webgl' ? context : null)) as never;
      vi.stubGlobal('document', {
        querySelectorAll: vi.fn().mockReturnValue([canvas]),
      });

      page.evaluate.mockResolvedValue(
        hardwarePreflight({
          renderer: 'generic:renderer',
          unmasked: false,
          vendor: 'generic:vendor',
        }),
      );
      await expect(requireHardwareWebGL(page as never, '#scene-canvas canvas')).rejects.toThrow(
        /masked renderer: generic:renderer/,
      );
      const result = evaluateArgOf(page.evaluate)('#scene-canvas canvas');

      expect(result).toMatchObject({
        diagnostics: {
          context: {
            error: 'GL_ERROR_0x9999',
            genericRenderer: 'generic:renderer',
            kind: 'webgl',
            renderer: 'generic:renderer',
            unmasked: false,
          },
        },
      });
    });

    it('records and bounds observational WebGL context lifecycle events', async () => {
      vi.stubGlobal('HTMLCanvasElement', FakeHTMLCanvasElement);
      const { page } = createRuntime();
      const listeners = new Map<string, (event: Event) => void>();
      vi.stubGlobal('window', {
        addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
          listeners.set(type, listener);
        }),
      });
      const canvas = Object.create(FakeHTMLCanvasElement.prototype) as HTMLCanvasElement;
      Object.assign(canvas, { className: 'board', height: 720, id: 'board', width: 1280 });

      await installWebGLContextEventRecorder(page as never);
      const install = page.addInitScript.mock.calls.at(-1)?.[0] as (key: string) => void;
      const key = page.addInitScript.mock.calls.at(-1)?.[1] as string;
      install(key);
      for (let index = 0; index < 33; index += 1) {
        listeners.get('webglcontextlost')?.({
          target: index === 0 ? {} : canvas,
          timeStamp: index,
          type: 'webglcontextlost',
        } as unknown as Event);
      }
      listeners.get('webglcontextrestored')?.({
        target: canvas,
        timeStamp: 34,
        type: 'webglcontextrestored',
      } as unknown as Event);

      await readWebGLContextEvents(page as never);
      const read = evaluateArgOf(page.evaluate) as (storedKey: string) => unknown;
      const events = read(key) as Array<{ canvas: { id: string } | null; type: string }>;

      expect(events).toHaveLength(32);
      expect(events[0]).toMatchObject({ canvas: { id: 'board' }, type: 'webglcontextlost' });
      expect(events.at(-1)).toMatchObject({ type: 'webglcontextrestored' });
    });

    it('reads an empty lifecycle ledger when no recorder was requested', async () => {
      const { page } = createRuntime();
      const key = '__gameHarnessWebGLContextEvents';
      delete (globalThis as Record<string, unknown>)[key];

      await readWebGLContextEvents(page as never);
      const read = evaluateArgOf(page.evaluate) as (storedKey: string) => unknown;

      expect(read(key)).toEqual([]);
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
        localStorageSentinels: {
          'settings::muted': 'false',
          'settings::seed': null,
        },
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
      page.evaluate.mockResolvedValue({
        'settings::muted': 'false',
        'settings::missing': null,
      });
      const store = new Map<string, string>([['settings::muted', 'false']]);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
      });

      await verifyProductionRuntime({
        url: 'https://game.example/',
        localStorageSentinels: {
          'settings::muted': 'false',
          'settings::missing': null,
        },
        assertReady: async () => undefined,
      });

      const readCallback = page.evaluate.mock.calls.at(-1)?.[0] as (keys: string[]) => unknown;
      const result = readCallback(['settings::muted', 'settings::missing']);

      expect(result).toEqual({
        'settings::muted': 'false',
        'settings::missing': null,
      });
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

  it('appends the lifecycle ledger to a post-ready sentinel failure', async () => {
    const { page } = createRuntime();
    page.evaluate
      .mockResolvedValueOnce({ 'settings::muted': 'true' })
      .mockResolvedValueOnce([{ timeStamp: 12, type: 'webglcontextlost' }]);

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        captureWebGLContextEvents: true,
        localStorageSentinels: { 'settings::muted': 'false' },
        assertReady: async () => undefined,
      }),
    ).rejects.toThrow(
      /localStorage sentinel settings::muted changed:[\s\S]*webglContextEvents=\[{"timeStamp":12,"type":"webglcontextlost"}\]/,
    );
  });

  it.each([
    ['Error', new Error('storage unavailable')],
    ['non-Error', 'storage unavailable'],
  ])(
    'retains a post-ready %s storage-read failure when its lifecycle ledger cannot be read',
    async (_, error) => {
      const { page } = createRuntime();
      page.evaluate.mockRejectedValueOnce(error).mockRejectedValueOnce(new Error('page closed'));

      await expect(
        verifyProductionRuntime({
          url: 'https://game.example/',
          captureWebGLContextEvents: true,
          localStorageSentinels: { 'settings::muted': 'false' },
          assertReady: async () => undefined,
        }),
      ).rejects.toThrow(/storage unavailable\nwebglContextEvents=<unavailable: page closed>/);
    },
  );

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

    expect(spawn).toHaveBeenCalledWith('vite', [], expect.objectContaining({ cwd: '/srv/game' }));
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

  it('preserves a ProductionRuntimeVerificationError identity and stack when capture is off', async () => {
    createRuntime();
    const readyError = new ProductionRuntimeVerificationError('heading never appeared');
    const stack = readyError.stack;

    await expect(
      verifyProductionRuntime({
        url: 'https://game.example/',
        assertReady: async () => {
          throw readyError;
        },
      }),
    ).rejects.toBe(readyError);
    expect(readyError.stack).toBe(stack);
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
