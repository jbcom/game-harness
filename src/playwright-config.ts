import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

export type DeviceTier = 'desktop' | 'mobile' | 'tablet' | 'foldable' | 'ultrawide';

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];

const DEVICE_TIER_PROJECTS: Record<DeviceTier, Project[]> = {
  desktop: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  mobile: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  tablet: [{ name: 'tablet', use: { ...devices['iPad Mini'] } }],
  // The foldable form factor sits between tablet and phone — wide CSS-px
  // viewport but Android UA, touch primary, high DPR. Portrait + landscape
  // are separate projects since HUD layout regressions differ by axis.
  foldable: [
    {
      name: 'foldable-portrait',
      use: { ...devices['Pixel 7'], viewport: { width: 840, height: 2120 }, deviceScaleFactor: 3 },
    },
    {
      name: 'foldable-landscape',
      use: { ...devices['Pixel 7'], viewport: { width: 2120, height: 840 }, deviceScaleFactor: 3 },
    },
  ],
  ultrawide: [
    {
      name: 'ultrawide',
      use: { ...devices['Desktop Chrome'], viewport: { width: 3440, height: 1440 } },
    },
  ],
};

export interface PlaywrightConfigOptions {
  /** Playwright `testDir`. Defaults to `'./tests'`. */
  testDir?: string;
  /** Base path the dev/preview server serves from. Defaults to `'/'`. */
  basePath?: string;
  /** Port for the local webServer + baseURL. Defaults to 4173, overridable via `PLAYWRIGHT_PORT`/`PW_PORT`. */
  port?: number;
  /**
   * Which device-tier Playwright projects to include. `desktop` is always
   * present as the tier-1 CI gate; passing more tiers here is equivalent to
   * the fleet's `MULTIVIEW=1` convention already wired below — you don't
   * need to also request `desktop` explicitly.
   * Defaults to `['desktop']` (single project, matching the fast CI gate),
   * expanding to all requested tiers when `MULTIVIEW=1` or `VISUAL=1` is set.
   */
  deviceTiers?: DeviceTier[];
  /** Extra Playwright projects appended after the device-tier projects. */
  extraProjects?: Project[];
  /**
   * Spec globs that only run when `JOURNEY=1` is set (or when `VISUAL=1` is
   * set, since visual runs imply the full journey suite). These are
   * "agent review harness" specs — expensive artefact-producing runs, not
   * part of the fast tier-1 functional gate. Excluded from `testIgnore`
   * otherwise.
   */
  journeySpecs?: string[];
  /**
   * Multiplier applied to the local (non-CI) timeout defaults to derive the
   * CI timeout. CI runners are consistently slower under WebGL/render load;
   * defaults to 4 (45s local → 180s CI action-adjacent test timeout, scaled
   * per-field below).
   */
  ciTimeoutMultiplier?: number;
  /**
   * Overrides merged last, escape-hatch for anything this factory doesn't
   * expose. `use` and `webServer` are merged one level deep on top of the
   * computed defaults (see `definePlaywrightConfig`'s return); every other
   * field fully replaces.
   */
  overrides?: Omit<Partial<PlaywrightTestConfig>, 'use' | 'webServer'> & {
    use?: Partial<NonNullable<PlaywrightTestConfig['use']>>;
    webServer?: Partial<
      Extract<NonNullable<PlaywrightTestConfig['webServer']>, { command?: string }>
    >;
  };
}

const DEFAULT_PORT = 4173;
const LOCAL_TEST_TIMEOUT_MS = 45_000;
const LOCAL_ACTION_TIMEOUT_MS = 15_000;
const LOCAL_NAV_TIMEOUT_MS = 15_000;

/**
 * Builds a full Playwright config, encoding the Aethelgard tiered-device +
 * env-gated-suite convention:
 *
 * - `desktop` project always runs; `MULTIVIEW=1` (or `VISUAL=1`) expands to
 *   every requested device tier (mobile/tablet/foldable/ultrawide).
 * - `JOURNEY=1` (or `VISUAL=1`) opts into expensive artefact-producing specs
 *   that are excluded from the default tier-1 functional gate so CI stays
 *   fast.
 * - `VISUAL=1` additionally adds `visualSpecs` to the test match glob.
 * - CI timeouts scale up from local defaults via `ciTimeoutMultiplier`
 *   (CI runners run WebGL/render-heavy tests 2-4x slower than local dev).
 */
export function definePlaywrightConfig(opts: PlaywrightConfigOptions = {}): PlaywrightTestConfig {
  const {
    testDir = './tests',
    basePath = '/',
    port,
    deviceTiers = ['desktop'],
    extraProjects = [],
    journeySpecs = [],
    ciTimeoutMultiplier = 4,
    overrides = {},
  } = opts;

  const IS_CI = Boolean(process.env.CI);
  const IS_HEADLESS = process.env.PW_HEADLESS === '1' || IS_CI;
  const CHROMIUM_CHANNEL =
    process.env.PW_CHROMIUM_CHANNEL ?? (!IS_CI && !IS_HEADLESS ? 'chrome' : undefined);

  const configuredPort = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PW_PORT);
  const PORT =
    Number.isInteger(configuredPort) && configuredPort > 0
      ? configuredPort
      : (port ?? DEFAULT_PORT);
  const BASE_URL = `http://127.0.0.1:${PORT}${basePath}`;
  const REUSE_SERVER = !IS_CI && process.env.PW_REUSE_SERVER === '1';

  const includeVisual = process.env.VISUAL === '1';
  const includeMultiview = process.env.MULTIVIEW === '1' || includeVisual;
  const includeJourney = process.env.JOURNEY === '1' || includeVisual;

  // Specs live under e2e/ (+ visual/ when VISUAL=1) relative to testDir —
  // the Aethelgard convention.
  const testMatch = includeVisual
    ? ['e2e/**/*.spec.ts', 'visual/**/*.spec.ts']
    : 'e2e/**/*.spec.ts';
  const testIgnore = includeJourney ? [] : journeySpecs;

  const TEST_TIMEOUT_MS = IS_CI
    ? LOCAL_TEST_TIMEOUT_MS * ciTimeoutMultiplier
    : LOCAL_TEST_TIMEOUT_MS;
  const ACTION_TIMEOUT_MS = IS_CI
    ? LOCAL_ACTION_TIMEOUT_MS * ciTimeoutMultiplier
    : LOCAL_ACTION_TIMEOUT_MS;
  const NAV_TIMEOUT_MS = IS_CI ? LOCAL_NAV_TIMEOUT_MS * 2 : LOCAL_NAV_TIMEOUT_MS;

  const tiers = includeMultiview ? deviceTiers : (deviceTiers.slice(0, 1) as DeviceTier[]);
  const tierProjects = tiers.flatMap((tier) => DEVICE_TIER_PROJECTS[tier] ?? []);
  const projects = [...tierProjects, ...extraProjects];

  const base: PlaywrightTestConfig = {
    testDir,
    testMatch,
    testIgnore,
    fullyParallel: true,
    forbidOnly: IS_CI,
    retries: IS_CI ? 2 : 0,
    reporter: IS_CI ? 'github' : 'list',
    timeout: TEST_TIMEOUT_MS,
    use: {
      baseURL: BASE_URL,
      headless: IS_HEADLESS,
      trace: 'retain-on-failure',
      actionTimeout: ACTION_TIMEOUT_MS,
      navigationTimeout: NAV_TIMEOUT_MS,
      browserName: 'chromium',
      channel: CHROMIUM_CHANNEL,
    },
    webServer: {
      command: `pnpm exec vite --host 127.0.0.1 --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: REUSE_SERVER,
      timeout: 60_000,
    },
    projects,
  };

  const resolved = defineConfig(base);
  const singleWebServer = Array.isArray(resolved.webServer) ? undefined : resolved.webServer;
  const mergedWebServer: PlaywrightTestConfig['webServer'] = Array.isArray(resolved.webServer)
    ? resolved.webServer
    : ({ ...singleWebServer, ...overrides.webServer } as NonNullable<
        PlaywrightTestConfig['webServer']
      >);

  return {
    ...resolved,
    ...overrides,
    // `use` and `webServer` are merged one level deep — a caller supplying
    // `overrides.use` almost always wants to ADD a field (e.g. `channel` or
    // an extra header), not replace baseURL/headless/timeouts wholesale.
    // Every other top-level field (projects, testMatch, etc.) still fully
    // replaces on override, matching a plain object spread.
    use: { ...resolved.use, ...overrides.use },
    webServer: mergedWebServer,
  };
}
