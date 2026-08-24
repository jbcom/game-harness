import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlaywrightConfig, resolvePlaywrightPort } from '../src/playwright-config.js';

const ENV_KEYS = [
  'CI',
  'MULTIVIEW',
  'VISUAL',
  'JOURNEY',
  'PLAYWRIGHT_PORT',
  'PW_PORT',
  'PW_HEADLESS',
  'GITHUB_REPOSITORY',
  'GITHUB_RUN_ID',
  'GITHUB_JOB',
  'NO_COLOR',
] as const;

describe('definePlaywrightConfig', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to a single desktop project when no env gates are set', () => {
    const config = definePlaywrightConfig();
    expect(config.projects?.map((p) => p.name)).toEqual(['desktop']);
  });

  it('removes inherited NO_COLOR before Playwright forces color in child processes', () => {
    process.env.NO_COLOR = '1';
    process.env.CI = '1';

    definePlaywrightConfig();

    expect(process.env.NO_COLOR).toBeUndefined();
    expect(process.env.CI).toBe('1');
  });

  it('expands to every requested device tier under MULTIVIEW=1', () => {
    process.env.MULTIVIEW = '1';
    const config = definePlaywrightConfig({
      deviceTiers: ['desktop', 'mobile', 'tablet'],
    });
    expect(config.projects?.map((p) => p.name)).toEqual(['desktop', 'mobile', 'tablet']);
  });

  it('expands foldable to both portrait and landscape projects', () => {
    process.env.MULTIVIEW = '1';
    const config = definePlaywrightConfig({ deviceTiers: ['foldable'] });
    expect(config.projects?.map((p) => p.name)).toEqual([
      'foldable-portrait',
      'foldable-landscape',
    ]);
  });

  it('VISUAL=1 implies MULTIVIEW expansion', () => {
    process.env.VISUAL = '1';
    const config = definePlaywrightConfig({
      deviceTiers: ['desktop', 'ultrawide'],
    });
    expect(config.projects?.map((p) => p.name)).toEqual(['desktop', 'ultrawide']);
  });

  it('stays single-tier without MULTIVIEW even if multiple tiers requested', () => {
    const config = definePlaywrightConfig({
      deviceTiers: ['desktop', 'mobile', 'tablet'],
    });
    expect(config.projects?.map((p) => p.name)).toEqual(['desktop']);
  });

  it('appends extraProjects after device-tier projects', () => {
    const config = definePlaywrightConfig({
      extraProjects: [{ name: 'custom', use: {} }],
    });
    expect(config.projects?.map((p) => p.name)).toEqual(['desktop', 'custom']);
  });

  it('excludes journeySpecs from testIgnore by default (JOURNEY unset)', () => {
    const journeySpecs = ['e2e/journey-capture.spec.ts'];
    const config = definePlaywrightConfig({ journeySpecs });
    expect(config.testIgnore).toEqual(journeySpecs);
  });

  it('clears testIgnore when JOURNEY=1', () => {
    process.env.JOURNEY = '1';
    const journeySpecs = ['e2e/journey-capture.spec.ts'];
    const config = definePlaywrightConfig({ journeySpecs });
    expect(config.testIgnore).toEqual([]);
  });

  it('clears testIgnore when VISUAL=1 (implies JOURNEY)', () => {
    process.env.VISUAL = '1';
    const journeySpecs = ['e2e/journey-capture.spec.ts'];
    const config = definePlaywrightConfig({ journeySpecs });
    expect(config.testIgnore).toEqual([]);
  });

  it('adds visual/**/*.spec.ts to testMatch under VISUAL=1', () => {
    process.env.VISUAL = '1';
    const config = definePlaywrightConfig();
    expect(config.testMatch).toEqual(['e2e/**/*.spec.ts', 'visual/**/*.spec.ts']);
  });

  it('testMatch is just the e2e glob without VISUAL', () => {
    const config = definePlaywrightConfig();
    expect(config.testMatch).toBe('e2e/**/*.spec.ts');
  });

  it('scales CI timeout by ciTimeoutMultiplier', () => {
    process.env.CI = '1';
    const config = definePlaywrightConfig({ ciTimeoutMultiplier: 4 });
    expect(config.timeout).toBe(45_000 * 4);
  });

  it('uses local timeout defaults outside CI', () => {
    const config = definePlaywrightConfig();
    expect(config.timeout).toBe(45_000);
  });

  it('sets forbidOnly/retries/reporter based on CI', () => {
    process.env.CI = '1';
    const config = definePlaywrightConfig();
    expect(config.forbidOnly).toBe(true);
    expect(config.retries).toBe(2);
    expect(config.reporter).toBe('github');
  });

  it('keeps Chromium headed under CI by default', () => {
    process.env.CI = '1';
    const config = definePlaywrightConfig();
    expect(config.use?.headless).toBe(false);
  });

  it('supports explicit headless and ci-only modes', () => {
    expect(definePlaywrightConfig({ headless: true }).use?.headless).toBe(true);
    process.env.CI = '1';
    expect(definePlaywrightConfig({ headless: 'ci-only' }).use?.headless).toBe(true);
  });

  it('sets forbidOnly/retries/reporter for local runs', () => {
    const config = definePlaywrightConfig();
    expect(config.forbidOnly).toBe(false);
    expect(config.retries).toBe(0);
    expect(config.reporter).toBe('list');
  });

  it('derives baseURL from the configured port', () => {
    const config = definePlaywrightConfig({ port: 5555 });
    expect(config.use?.baseURL).toBe('http://127.0.0.1:5555/');
  });

  it('PLAYWRIGHT_PORT env overrides the port option', () => {
    process.env.PLAYWRIGHT_PORT = '9999';
    const config = definePlaywrightConfig({ port: 5555 });
    expect(config.use?.baseURL).toBe('http://127.0.0.1:9999/');
  });

  it('rejects malformed explicit port overrides instead of silently falling back', () => {
    expect(() => resolvePlaywrightPort({ environment: { PLAYWRIGHT_PORT: 'not-a-port' } })).toThrow(
      /PLAYWRIGHT_PORT\/PW_PORT/,
    );
    expect(() => resolvePlaywrightPort({ environment: { PW_PORT: '' } })).toThrow(/<empty>/);
  });

  it('derives one stable CI port across parent and worker config reloads', () => {
    process.env.CI = '1';
    process.env.GITHUB_REPOSITORY = 'example-org/example-game';
    process.env.GITHUB_RUN_ID = '1955';
    process.env.GITHUB_JOB = 'verify';

    const first = resolvePlaywrightPort({ localPort: 4399 });
    const second = resolvePlaywrightPort({ localPort: 4399 });
    const config = definePlaywrightConfig({ port: 4399 });

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(20_000);
    expect(first).toBeLessThan(30_000);
    expect(config.use?.baseURL).toBe(`http://127.0.0.1:${first}/`);
  });

  it('isolates concurrent CI runs and jobs while preserving explicit overrides', () => {
    const environment = {
      CI: '1',
      GITHUB_REPOSITORY: 'example-org/example-game',
      GITHUB_RUN_ID: '1955',
      GITHUB_JOB: 'verify',
    };
    const first = resolvePlaywrightPort({ localPort: 4399, environment });
    const otherRun = resolvePlaywrightPort({
      localPort: 4399,
      environment: { ...environment, GITHUB_RUN_ID: '1956' },
    });
    const otherJob = resolvePlaywrightPort({
      localPort: 4399,
      environment: { ...environment, GITHUB_JOB: 'release-playthrough' },
    });
    const explicit = resolvePlaywrightPort({
      localPort: 4399,
      environment: { ...environment, PLAYWRIGHT_PORT: '5444' },
    });

    expect(new Set([first, otherRun, otherJob]).size).toBe(3);
    expect(explicit).toBe(5444);
  });

  it('rejects a localPort outside the valid TCP range', () => {
    expect(() => resolvePlaywrightPort({ localPort: 70_000 })).toThrow(
      /Playwright port must be an integer from 1 to 65535/,
    );
    expect(() => resolvePlaywrightPort({ localPort: 0 })).toThrow(TypeError);
    expect(() => resolvePlaywrightPort({ localPort: 1.5 })).toThrow(TypeError);
  });

  it('falls back to the package default port when localPort is not provided', () => {
    expect(resolvePlaywrightPort({})).toBe(4173);
  });

  it('hashes a stable CI port even when GITHUB_REPOSITORY and GITHUB_JOB are unset', () => {
    const environment = { CI: '1', GITHUB_RUN_ID: '1955' };
    const port = resolvePlaywrightPort({ localPort: 4399, environment });
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(30_000);
    // Same identity inputs (both missing) must hash identically across calls.
    expect(resolvePlaywrightPort({ localPort: 4399, environment })).toBe(port);
  });

  it('passes the resolved port to a custom web-server command', () => {
    process.env.CI = '1';
    process.env.GITHUB_REPOSITORY = 'example-org/example-game';
    process.env.GITHUB_RUN_ID = '1955';
    process.env.GITHUB_JOB = 'verify';
    const config = definePlaywrightConfig({
      port: 4399,
      webServerCommand: (port) => `pnpm preview --port ${port} --strictPort`,
    });
    const webServer = config.webServer as { command?: string };
    const resolvedPort = new URL(String(config.use?.baseURL)).port;

    expect(webServer.command).toBe(`pnpm preview --port ${resolvedPort} --strictPort`);
  });

  it('respects a custom basePath', () => {
    const config = definePlaywrightConfig({ port: 4173, basePath: '/kuroga/' });
    expect(config.use?.baseURL).toBe('http://127.0.0.1:4173/kuroga/');
  });

  it('normalizes a base path for reliable relative navigation', () => {
    expect(definePlaywrightConfig({ basePath: 'kuroga' }).use?.baseURL).toBe(
      'http://127.0.0.1:4173/kuroga/',
    );
    expect(definePlaywrightConfig({ basePath: '  ' }).use?.baseURL).toBe('http://127.0.0.1:4173/');
    expect(definePlaywrightConfig({ basePath: '///' }).use?.baseURL).toBe('http://127.0.0.1:4173/');
    expect(definePlaywrightConfig({ basePath: '//games//kuroga//' }).use?.baseURL).toBe(
      'http://127.0.0.1:4173/games/kuroga/',
    );
  });

  it('rejects a base path containing URL state', () => {
    expect(() => definePlaywrightConfig({ basePath: '/game?mode=test' })).toThrow(/basePath/);
    expect(() => definePlaywrightConfig({ basePath: '/game#ready' })).toThrow(/basePath/);
    expect(() => definePlaywrightConfig({ basePath: '/games/../admin' })).toThrow(/basePath/);
    expect(() => definePlaywrightConfig({ basePath: '/games/%2e%2e/admin' })).toThrow(/basePath/);
    expect(() => definePlaywrightConfig({ basePath: '/games/%2f..%2fadmin' })).toThrow(/basePath/);
    expect(() => definePlaywrightConfig({ basePath: '/games/\\..\\admin' })).toThrow(/basePath/);
  });

  it('validates and de-duplicates the device and timeout matrix', () => {
    expect(() => definePlaywrightConfig({ deviceTiers: [] })).toThrow(/deviceTiers/);
    expect(() => definePlaywrightConfig({ deviceTiers: ['desktop', 'unknown' as never] })).toThrow(
      /unknown device tier/,
    );
    for (const inheritedKey of ['constructor', 'toString', '__proto__']) {
      expect(() => definePlaywrightConfig({ deviceTiers: [inheritedKey as never] })).toThrow(
        /unknown device tier/,
      );
    }
    expect(() => definePlaywrightConfig({ ciTimeoutMultiplier: 0 })).toThrow(/ciTimeoutMultiplier/);
    expect(() => definePlaywrightConfig({ ciTimeoutMultiplier: Number.NaN })).toThrow(
      /ciTimeoutMultiplier/,
    );

    process.env.MULTIVIEW = '1';
    const config = definePlaywrightConfig({
      deviceTiers: ['desktop', 'desktop', 'mobile'],
    });
    expect(config.projects?.map((project) => project.name)).toEqual(['desktop', 'mobile']);
  });

  it('applies caller overrides last', () => {
    const config = definePlaywrightConfig({ overrides: { timeout: 999 } });
    expect(config.timeout).toBe(999);
  });

  it('fully replaces the computed projects list when overrides.projects is set', () => {
    const config = definePlaywrightConfig({
      deviceTiers: ['desktop', 'mobile'],
      overrides: { projects: [{ name: 'custom-only' }] },
    });
    // Wholesale replacement (unlike `use`/`webServer`, which merge): only the
    // one caller-supplied project survives, each still muted by default.
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0]?.name).toBe('custom-only');
  });

  it('merges overrides.use on top of the computed use block instead of replacing it', () => {
    const config = definePlaywrightConfig({
      port: 4173,
      overrides: { use: { channel: 'chrome' } },
    });
    expect(config.use?.channel).toBe('chrome');
    // baseURL survives — proves this is a merge, not a wholesale replace.
    expect(config.use?.baseURL).toBe('http://127.0.0.1:4173/');
  });

  it('mutes every browser process by default', () => {
    const config = definePlaywrightConfig();
    expect(config.use?.launchOptions?.args).toContain('--mute-audio');
    expect(
      config.projects?.every((project) =>
        project.use?.launchOptions?.args?.includes('--mute-audio'),
      ),
    ).toBe(true);
  });

  it('applies the Linux hardware Vulkan profile to every project', () => {
    const config = definePlaywrightConfig({ gpuMode: 'linux-hardware-vulkan' });
    expect(config.use?.launchOptions).toEqual(
      expect.objectContaining({
        args: [
          '--use-gpu-in-tests',
          '--use-gl=angle',
          '--use-angle=vulkan',
          '--ignore-gpu-blocklist',
          '--mute-audio',
        ],
        env: expect.objectContaining({ EGL_PLATFORM: 'surfaceless' }),
      }),
    );
    expect(config.projects?.[0]?.use?.launchOptions?.args).toEqual(config.use?.launchOptions?.args);
  });

  it('preserves custom launch arguments while enforcing one mute argument', () => {
    const config = definePlaywrightConfig({
      overrides: {
        use: {
          launchOptions: { args: ['--use-angle=swiftshader', '--mute-audio'] },
        },
        projects: [
          {
            name: 'custom',
            use: { launchOptions: { args: ['--enable-unsafe-webgpu'] } },
          },
        ],
      },
    });

    expect(config.use?.launchOptions?.args).toEqual(['--use-angle=swiftshader', '--mute-audio']);
    expect(config.projects?.[0]?.use?.launchOptions?.args).toEqual([
      '--use-angle=swiftshader',
      '--enable-unsafe-webgpu',
      '--mute-audio',
    ]);
  });

  it('merges overrides.webServer on top of the computed webServer instead of replacing it', () => {
    const config = definePlaywrightConfig({
      port: 4173,
      overrides: { webServer: { env: { VITE_E2E: '1' } } },
    });
    const webServer = config.webServer as {
      env?: Record<string, string>;
      command?: string;
    };
    expect(webServer.env).toEqual({ VITE_E2E: '1' });
    // command survives — proves this is a merge, not a wholesale replace.
    expect(webServer.command).toContain('vite');
  });

  it('defaults testDir to "./tests"', () => {
    const config = definePlaywrightConfig();
    expect(config.testDir).toBe('./tests');
  });
});
