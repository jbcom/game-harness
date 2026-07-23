import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineBrowserTestConfig } from '../src/browser-config.js';

describe('defineBrowserTestConfig', () => {
  const originalCi = process.env.CI;

  beforeEach(() => {
    delete process.env.CI;
  });

  afterEach(() => {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  it('defaults to a single chromium instance', () => {
    const config = defineBrowserTestConfig();
    expect(config.browser?.instances).toEqual([{ browser: 'chromium' }]);
  });

  it('defaults name to "browser"', () => {
    const config = defineBrowserTestConfig();
    expect(config.name).toBe('browser');
  });

  it('defaults fileParallelism to false (serialized)', () => {
    const config = defineBrowserTestConfig();
    expect(config.fileParallelism).toBe(false);
  });

  it('defaults to headed locally', () => {
    const config = defineBrowserTestConfig();
    expect(config.browser?.headless).toBe(false);
  });

  it('disables Vitest UI while keeping the headed Chromium window visible', () => {
    const config = defineBrowserTestConfig();
    expect(config.browser?.headless).toBe(false);
    expect(config.browser?.ui).toBe(false);
  });

  it('allows interactive Vitest UI as an explicit debugging mode', () => {
    const config = defineBrowserTestConfig({ ui: true });
    expect(config.browser?.ui).toBe(true);
    const provider = config.browser?.provider as {
      options?: { contextOptions?: { deviceScaleFactor?: number } };
    };
    expect(provider.options?.contextOptions?.deviceScaleFactor).toBeUndefined();
  });

  it('rejects a device scale that Playwright cannot combine with Vitest UI', () => {
    expect(() =>
      defineBrowserTestConfig({ ui: true, contextOptions: { deviceScaleFactor: 2 } }),
    ).toThrow(/deviceScaleFactor is not supported when ui is true/);
  });

  it('remains headed under CI so Xvfb can exercise normal compositing', () => {
    process.env.CI = '1';
    const config = defineBrowserTestConfig();
    expect(config.browser?.headless).toBe(false);
  });

  it('supports an explicit ci-only headless mode for constrained runners', () => {
    process.env.CI = '1';
    const config = defineBrowserTestConfig({ headless: 'ci-only' });
    expect(config.browser?.headless).toBe(true);
  });

  it('respects an explicit headless: true override even without CI', () => {
    const config = defineBrowserTestConfig({ headless: true });
    expect(config.browser?.headless).toBe(true);
  });

  it('respects an explicit headless: false override even under CI', () => {
    process.env.CI = '1';
    const config = defineBrowserTestConfig({ headless: false });
    expect(config.browser?.headless).toBe(false);
  });

  it('uses native Chromium renderer selection by default', () => {
    const config = defineBrowserTestConfig({ gpuArgs: ['--custom-flag'] });
    const provider = config.browser?.provider as
      | {
          name?: string;
          options?: { launchOptions?: { args?: string[] } };
        }
      | undefined;
    expect(provider?.name).toBe('playwright');
    expect(provider?.options?.launchOptions?.args).toEqual(['--custom-flag', '--mute-audio']);
  });

  it('pins device scale to one for deterministic headed screenshots', () => {
    const config = defineBrowserTestConfig();
    const provider = config.browser?.provider as {
      options?: { contextOptions?: { deviceScaleFactor?: number } };
    };
    expect(provider.options?.contextOptions?.deviceScaleFactor).toBe(1);
  });

  it('allows callers to opt into a high-DPI browser context', () => {
    const config = defineBrowserTestConfig({
      contextOptions: { deviceScaleFactor: 2, locale: 'en-US' },
    });
    const provider = config.browser?.provider as {
      options?: { contextOptions?: { deviceScaleFactor?: number; locale?: string } };
    };
    expect(provider.options?.contextOptions).toEqual({ deviceScaleFactor: 2, locale: 'en-US' });
  });

  it('makes the software renderer an explicit profile', () => {
    const config = defineBrowserTestConfig({ gpuMode: 'software' });
    const provider = config.browser?.provider as {
      options?: { launchOptions?: { args?: string[] } };
    };
    expect(provider.options?.launchOptions?.args).toEqual([
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--mute-audio',
    ]);
  });

  it('provides the proven Linux Intel Vulkan profile', () => {
    const config = defineBrowserTestConfig({ gpuMode: 'linux-hardware-vulkan' });
    const provider = config.browser?.provider as {
      options?: {
        launchOptions?: { args?: string[]; env?: Record<string, string | undefined> };
      };
    };
    expect(provider.options?.launchOptions?.args).toEqual([
      '--use-gpu-in-tests',
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--ignore-gpu-blocklist',
      '--mute-audio',
    ]);
    expect(provider.options?.launchOptions?.env?.EGL_PLATFORM).toBe('surfaceless');
  });

  it('deduplicates a caller-supplied mute argument and keeps it last', () => {
    const config = defineBrowserTestConfig({ gpuArgs: ['--mute-audio', '--custom-flag'] });
    const provider = config.browser?.provider as {
      options?: { launchOptions?: { args?: string[] } };
    };
    expect(provider.options?.launchOptions?.args?.filter((arg) => arg === '--mute-audio')).toEqual([
      '--mute-audio',
    ]);
    expect(provider.options?.launchOptions?.args?.at(-1)).toBe('--mute-audio');
  });

  it('surfaces optimizeDeps via __optimizeDepsInclude for the caller to merge into vite config', () => {
    const config = defineBrowserTestConfig({
      optimizeDeps: ['three/examples/jsm/utils/SkeletonUtils.js'],
    });
    expect(config.__optimizeDepsInclude).toEqual(['three/examples/jsm/utils/SkeletonUtils.js']);
  });

  it('omits __optimizeDepsInclude when no optimizeDeps given', () => {
    const config = defineBrowserTestConfig();
    expect(config.__optimizeDepsInclude).toBeUndefined();
  });

  it('passes through setupFiles', () => {
    const config = defineBrowserTestConfig({ setupFiles: ['tests/setup.ts'] });
    expect(config.setupFiles).toEqual(['tests/setup.ts']);
  });

  it('omits setupFiles when not given', () => {
    const config = defineBrowserTestConfig();
    expect(config.setupFiles).toBeUndefined();
  });

  it('uses the default include glob when not overridden', () => {
    const config = defineBrowserTestConfig();
    expect(config.include).toEqual(['tests/browser/**/*.browser.test.{ts,tsx}']);
  });

  it('respects a custom include glob', () => {
    const config = defineBrowserTestConfig({ include: ['tests/harness/**/*.browser.test.tsx'] });
    expect(config.include).toEqual(['tests/harness/**/*.browser.test.tsx']);
  });

  it('respects custom browser instances', () => {
    const config = defineBrowserTestConfig({
      instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
    });
    expect(config.browser?.instances).toEqual([{ browser: 'chromium' }, { browser: 'webkit' }]);
  });

  it('always enables browser mode', () => {
    const config = defineBrowserTestConfig();
    expect(config.browser?.enabled).toBe(true);
  });
});
