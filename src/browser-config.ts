import { playwright } from '@vitest/browser-playwright';
import type { TestUserConfig } from 'vitest/node';

/**
 * A single browser instance entry, as accepted by Vitest Browser Mode's
 * `test.browser.instances` array (one per browser/viewport combination).
 */
export interface BrowserInstance {
  browser: 'chromium' | 'firefox' | 'webkit';
  [key: string]: unknown;
}

export interface BrowserTestConfigOptions {
  /**
   * Extra Chromium launch args merged after the sane GPU/ANGLE defaults.
   * Forwarded to the Playwright provider's `launchOptions.args`.
   */
  gpuArgs?: string[];
  /**
   * `true` — always headed. `false` — always headless.
   * `'ci-only'` (default) — headed locally, headless when `process.env.CI`
   * is set. Matches the Aethelgard convention: real-GPU rendering is more
   * trustworthy for WebGL/r3f assertions during local dev, while CI runners
   * have no GPU and must run headless regardless.
   */
  headless?: boolean | 'ci-only';
  /** Browser instances for the `browser.instances` array. Defaults to a single chromium instance. */
  instances?: BrowserInstance[];
  /**
   * Extra module specifiers to add to `optimizeDeps.include`. Useful for
   * deep-import paths (e.g. `three/examples/jsm/utils/SkeletonUtils.js`)
   * that Vite's dependency scanner doesn't discover on its own and that
   * would otherwise trigger a mid-run re-bundle (and a duplicate module
   * instance) the first time a browser test imports them. Read this field
   * off the return value (`__optimizeDepsInclude`) and merge it into your
   * `vite.config.ts`'s own `optimizeDeps.include` — Vitest's `test` fragment
   * has no `optimizeDeps` field of its own, that lives at the top-level
   * Vite config.
   */
  optimizeDeps?: string[];
  /** Passed through verbatim to `test.setupFiles`. */
  setupFiles?: string[];
  /** Project name. Defaults to `'browser'`. */
  name?: string;
  /** Test file glob(s). Defaults to `['tests/browser/**\/*.browser.test.{ts,tsx}']`. */
  include?: string[];
  /**
   * Disable file-level parallelism. The Aethelgard fleet found that a
   * shared Playwright Chromium pool flakes under parallel browser-test
   * load (independent specs racing for the same browser context can time
   * out). Defaults to `true` (serialized) — flip off only once you've
   * verified your suite tolerates concurrent browser contexts.
   */
  fileParallelism?: boolean;
}

const DEFAULT_GPU_ARGS: readonly string[] = [
  // ANGLE/SwiftShader software rasterizer flags — let WebGL contexts
  // initialize in a headless/CI environment with no real GPU.
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
];

function resolveHeadless(headless: BrowserTestConfigOptions['headless']): boolean {
  if (typeof headless === 'boolean') return headless;
  // 'ci-only' (default): headed locally, headless under CI.
  return Boolean(process.env.CI);
}

/**
 * Builds a `test` fragment for a Vitest Browser Mode project, wired for
 * real-Chromium (or other Playwright-driven browser) test execution.
 *
 * Encodes the Aethelgard pattern: headed-by-default locally so WebGL/r3f
 * assertions run against real GPU compositing, CI auto-detects headless
 * (no GPU on hosted runners — SwiftShader/ANGLE software rasterizer flags
 * are baked in as defaults), and ANGLE/GPU launchOptions are pre-tuned so
 * consumers don't have to rediscover the flag set.
 *
 * The returned object is meant to be spread into a Vitest `projects[]`
 * entry's `test` field (or merged into a top-level `test` block for
 * single-project setups):
 *
 * ```ts
 * import { defineBrowserTestConfig } from '@arcade-cabinet/test-harness/vitest';
 *
 * export default defineConfig({
 *   test: {
 *     projects: [
 *       { extends: true, test: { name: 'unit', environment: 'node', include: [...] } },
 *       { extends: true, test: defineBrowserTestConfig({
 *           optimizeDeps: ['three/examples/jsm/utils/SkeletonUtils.js'],
 *         }) },
 *     ],
 *   },
 * });
 * ```
 *
 * NOTE: xvfb — if you set `headless: false` (or leave `'ci-only'` and run
 * this in a CI image without `process.env.CI` set), a truly headed browser
 * needs a display server. On Linux CI images without one, wrap the test
 * command in `xvfb-run` rather than forcing headless here.
 */
export function defineBrowserTestConfig(
  opts: BrowserTestConfigOptions = {},
): TestUserConfig & { __optimizeDepsInclude?: string[] } {
  const {
    gpuArgs = [],
    headless = 'ci-only',
    instances = [{ browser: 'chromium' }],
    optimizeDeps = [],
    setupFiles,
    name = 'browser',
    include = ['tests/browser/**/*.browser.test.{ts,tsx}'],
    fileParallelism = false,
  } = opts;

  const resolvedHeadless = resolveHeadless(headless);
  const args = [...DEFAULT_GPU_ARGS, ...gpuArgs];

  const test: TestUserConfig & { __optimizeDepsInclude?: string[] } = {
    name,
    include,
    fileParallelism,
    browser: {
      enabled: true,
      headless: resolvedHeadless,
      provider: playwright({ launchOptions: { args } }),
      instances,
    },
  };

  if (setupFiles) {
    test.setupFiles = setupFiles;
  }

  if (optimizeDeps.length > 0) {
    // Vitest's `test` fragment has no `optimizeDeps` field (that lives at
    // the top-level Vite config) — surface the caller's list here so a
    // single options object can drive both without duplicating it.
    test.__optimizeDepsInclude = optimizeDeps;
  }

  return test;
}
