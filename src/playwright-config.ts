import {
  defineConfig,
  devices,
  expect,
  type Page,
  type PlaywrightTestConfig,
  type Response,
} from '@playwright/test';
import { type ChromiumGpuMode, createChromiumLaunchProfile } from './chromium-launch.js';
import {
  SILENT_QA_MARKER_ATTRIBUTE,
  SILENT_QA_MARKER_VALUE,
  SILENT_QA_QUERY_PARAMETER,
  SILENT_QA_QUERY_VALUE,
} from './silent-qa.js';

export {
  SILENT_QA_MARKER_ATTRIBUTE,
  SILENT_QA_MARKER_VALUE,
  SILENT_QA_QUERY_PARAMETER,
  SILENT_QA_QUERY_VALUE,
} from './silent-qa.js';

export type DeviceTier = 'desktop' | 'mobile' | 'tablet' | 'foldable' | 'ultrawide';

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];
type LaunchOptions = NonNullable<NonNullable<PlaywrightTestConfig['use']>['launchOptions']>;

export type SilentQueryValue = string | number | boolean;

export interface SilentTestUrlOptions {
  /** Runtime-only mute query parameter. Defaults to the fleet-standard `muted`. */
  muteQueryParameter?: string;
  /** Runtime-only mute query value. Defaults to `1`. */
  muteQueryValue?: string;
}

export interface OpenSilentGameOptions extends SilentTestUrlOptions {
  /** DOM selector that owns the mute-ready marker. Defaults to `html`. */
  markerSelector?: string;
  /** Marker attribute set only after runtime audio is muted. */
  markerAttribute?: string;
  /** Required marker value. Defaults to `muted-test`. */
  markerValue?: string;
  /** Maximum time to wait for the application mute marker. Defaults to 5 seconds. */
  markerTimeout?: number;
  /** Options forwarded to `page.goto()`. */
  navigationOptions?: NonNullable<Parameters<Page['goto']>[1]>;
}

export interface ResolvePlaywrightPortOptions {
  /** Stable local-development port. Defaults to 4173. */
  localPort?: number;
  /** Injectable environment for deterministic consumers and tests. Defaults to `process.env`. */
  environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Adds the fleet's non-persistent mute mode to a relative or absolute URL.
 * Explicit caller parameters replace existing values, and the mute value is
 * applied last so a stale `muted=0` can never make an agent run audible.
 */
export function silentTestUrl(
  target = '.',
  parameters: Readonly<Record<string, SilentQueryValue>> = {},
  options: SilentTestUrlOptions = {},
): string {
  const fragmentIndex = target.indexOf('#');
  const fragment = fragmentIndex >= 0 ? target.slice(fragmentIndex) : '';
  const withoutFragment = fragmentIndex >= 0 ? target.slice(0, fragmentIndex) : target;
  const queryIndex = withoutFragment.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const query = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '';
  const search = new URLSearchParams(query);

  for (const [key, value] of Object.entries(parameters)) search.set(key, String(value));
  search.set(
    options.muteQueryParameter ?? SILENT_QA_QUERY_PARAMETER,
    options.muteQueryValue ?? SILENT_QA_QUERY_VALUE,
  );

  return `${pathname}?${search.toString()}${fragment}`;
}

/**
 * Navigates to a game in runtime-only mute mode and fails closed until the
 * application confirms that audio was muted before test interaction begins.
 */
export async function openSilentGame(
  page: Page,
  target = '.',
  parameters: Readonly<Record<string, SilentQueryValue>> = {},
  options: OpenSilentGameOptions = {},
): Promise<Response | null> {
  const response = await page.goto(
    silentTestUrl(target, parameters, {
      ...(options.muteQueryParameter === undefined
        ? {}
        : { muteQueryParameter: options.muteQueryParameter }),
      ...(options.muteQueryValue === undefined ? {} : { muteQueryValue: options.muteQueryValue }),
    }),
    options.navigationOptions,
  );

  await expect(page.locator(options.markerSelector ?? 'html')).toHaveAttribute(
    options.markerAttribute ?? SILENT_QA_MARKER_ATTRIBUTE,
    options.markerValue ?? SILENT_QA_MARKER_VALUE,
    { timeout: options.markerTimeout ?? 5_000 },
  );

  return response;
}

function mergeMutedLaunchOptions(...sources: Array<LaunchOptions | undefined>): LaunchOptions {
  const merged = Object.assign({}, ...sources.filter((source) => source !== undefined));
  const args = sources
    .flatMap((source) => source?.args ?? [])
    .filter((argument) => argument !== '--mute-audio');
  return { ...merged, args: [...new Set(args), '--mute-audio'] };
}

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
   * Builds a custom web-server command with the already-resolved local or
   * CI-isolated port. Prefer this over hard-coding a port in
   * `overrides.webServer.command`.
   */
  webServerCommand?: (port: number) => string;
  /** Renderer profile. Defaults to native Chromium selection (`auto`). */
  gpuMode?: ChromiumGpuMode;
  /**
   * `false` (default) keeps Chromium headed locally and in CI. Use Xvfb on
   * Linux CI. `true` is explicit headless mode; `ci-only` retains the older
   * hosted-runner behavior when a display is genuinely unavailable.
   */
  headless?: boolean | 'ci-only';
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
const CI_PORT_START = 20_000;
const CI_PORT_SPAN = 10_000;
const LOCAL_TEST_TIMEOUT_MS = 45_000;
const LOCAL_ACTION_TIMEOUT_MS = 15_000;
const LOCAL_NAV_TIMEOUT_MS = 15_000;

function validPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizePlaywrightChildEnvironment(): void {
  // Playwright 1.62 injects FORCE_COLOR=1 into web-server and worker
  // processes. An inherited NO_COLOR is therefore ignored and only makes
  // Node emit a warning in each child. Removing it here changes this
  // Playwright subprocess only; the invoking shell remains untouched.
  delete process.env.NO_COLOR;
}

/**
 * Resolves one stable Playwright preview port for every config reload in an
 * Actions job. Explicit `PLAYWRIGHT_PORT`/`PW_PORT` values win; local runs use
 * `localPort`; GitHub/Gitea CI hashes repository, run, job, and local port into
 * the fleet's isolated port range.
 */
export function resolvePlaywrightPort(options: ResolvePlaywrightPortOptions = {}): number {
  const environment = options.environment ?? process.env;
  const configuredPort = Number(environment.PLAYWRIGHT_PORT ?? environment.PW_PORT);
  if (validPort(configuredPort)) return configuredPort;

  const localPort = options.localPort ?? DEFAULT_PORT;
  if (!validPort(localPort)) {
    throw new TypeError(
      `Playwright port must be an integer from 1 to 65535; received ${localPort}`,
    );
  }

  const runId = environment.GITHUB_RUN_ID ?? environment.GITHUB_RUN_NUMBER;
  if (!environment.CI || !runId) return localPort;

  const identity = [
    environment.GITHUB_REPOSITORY ?? '',
    runId,
    environment.GITHUB_JOB ?? '',
    String(localPort),
  ].join('\0');
  return CI_PORT_START + (stableHash(identity) % CI_PORT_SPAN);
}

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
  normalizePlaywrightChildEnvironment();

  const {
    testDir = './tests',
    basePath = '/',
    port,
    webServerCommand,
    gpuMode = 'auto',
    headless = false,
    deviceTiers = ['desktop'],
    extraProjects = [],
    journeySpecs = [],
    ciTimeoutMultiplier = 4,
    overrides = {},
  } = opts;

  const IS_CI = Boolean(process.env.CI);
  const IS_HEADLESS =
    process.env.PW_HEADLESS === '1' || (headless === 'ci-only' ? IS_CI : headless);
  const CHROMIUM_CHANNEL =
    process.env.PW_CHROMIUM_CHANNEL ?? (!IS_CI && !IS_HEADLESS ? 'chrome' : undefined);

  const PORT = resolvePlaywrightPort({ localPort: port ?? DEFAULT_PORT });
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
  const launchProfile = createChromiumLaunchProfile({ gpuMode });

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
      launchOptions: mergeMutedLaunchOptions(launchProfile),
    },
    webServer: {
      command:
        webServerCommand?.(PORT) ?? `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
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
  const mergedUse: NonNullable<PlaywrightTestConfig['use']> = {
    ...resolved.use,
    ...overrides.use,
    launchOptions: mergeMutedLaunchOptions(
      resolved.use?.launchOptions,
      overrides.use?.launchOptions,
    ),
  };
  const configuredProjects = overrides.projects ?? resolved.projects ?? [];
  const mutedProjects = configuredProjects.map((project) => ({
    ...project,
    use: {
      ...project.use,
      launchOptions: mergeMutedLaunchOptions(mergedUse.launchOptions, project.use?.launchOptions),
    },
  }));

  return {
    ...resolved,
    ...overrides,
    // `use` and `webServer` are merged one level deep — a caller supplying
    // `overrides.use` almost always wants to ADD a field (e.g. `channel` or
    // an extra header), not replace baseURL/headless/timeouts wholesale.
    // Every other top-level field (projects, testMatch, etc.) still fully
    // replaces on override, matching a plain object spread.
    use: mergedUse,
    webServer: mergedWebServer,
    projects: mutedProjects,
  };
}
