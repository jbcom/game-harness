import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSilentGame } from '../src/playwright-config.js';
import { verifyProductionRuntime } from '../src/production-runtime.js';

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
      expect.objectContaining({ args: ['--custom', '--mute-audio'], headless: true }),
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
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, null));
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
});
