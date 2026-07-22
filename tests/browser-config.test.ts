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

  it('resolves headless=false locally by default ("ci-only")', () => {
    const config = defineBrowserTestConfig();
    expect(config.browser?.headless).toBe(false);
  });

  it('resolves headless=true under CI by default ("ci-only")', () => {
    process.env.CI = '1';
    const config = defineBrowserTestConfig();
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

  it('merges custom gpuArgs after the default GPU/ANGLE args', () => {
    const config = defineBrowserTestConfig({ gpuArgs: ['--custom-flag'] });
    const provider = config.browser?.provider as
      | {
          name?: string;
          options?: { launchOptions?: { args?: string[] } };
        }
      | undefined;
    expect(provider?.name).toBe('playwright');
    expect(provider?.options?.launchOptions?.args).toEqual([
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--custom-flag',
      '--mute-audio',
    ]);
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
