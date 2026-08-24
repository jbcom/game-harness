import { type PlaywrightProviderOptions, playwright } from '@vitest/browser-playwright';
import type { TestUserConfig } from 'vitest/node';
import { type ChromiumGpuMode, createChromiumLaunchProfile } from './chromium-launch.js';

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
   * Playwright browser-context options. A device scale factor of 1 is the
   * default so headed and headless Chromium produce the same deterministic
   * screenshot dimensions; callers can override it explicitly when a test
   * needs high-DPI rendering.
   */
  contextOptions?: PlaywrightProviderOptions['contextOptions'];
  /**
   * Extra Chromium launch args merged after the selected renderer profile.
   * Forwarded to the Playwright provider's `launchOptions.args`.
   */
  gpuArgs?: string[];
  /** Renderer profile. Defaults to `auto`; software rendering is always explicit. */
  gpuMode?: ChromiumGpuMode;
  /**
   * `true` — always headless. `false` (default) — always headed.
   * `'ci-only'` — headed locally, headless when `process.env.CI` is set.
   * CI should normally retain the headed default and supply Xvfb.
   */
  headless?: boolean | 'ci-only';
  /**
   * Show Vitest's interactive browser UI. Defaults to false so headed runs use
   * a fixed Playwright viewport and deterministic device scale. The Chromium
   * window remains visible whenever `headless` is false.
   */
  ui?: boolean;
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
   * Disable file-level parallelism. A shared Playwright Chromium pool
   * flakes under parallel browser-test load (independent specs racing for
   * the same browser context can time out). Defaults to `true` (serialized)
   * — flip off only once you've
   * verified your suite tolerates concurrent browser contexts.
   */
  fileParallelism?: boolean;
}

function resolveHeadless(headless: BrowserTestConfigOptions['headless']): boolean {
  if (typeof headless === 'boolean') return headless;
  // Explicit legacy/hosted-runner mode: headed locally, headless under CI.
  return Boolean(process.env.CI);
}

/**
 * Builds a `test` fragment for a Vitest Browser Mode project, wired for
 * real-Chromium (or other Playwright-driven browser) test execution.
 *
 * Encodes a reviewed pattern: headed by default both locally and in
 * CI, silent at the Chromium boundary, and native renderer selection unless a
 * consumer explicitly requests software or the proven Linux Vulkan profile.
 *
 * The returned object is meant to be spread into a Vitest `projects[]`
 * entry's `test` field (or merged into a top-level `test` block for
 * single-project setups):
 *
 * ```ts
 * import { defineBrowserTestConfig } from '@jbcom/game-harness/vitest';
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
 * NOTE: a headed browser needs a display server. On Linux CI images without
 * one, wrap the test command in `xvfb-run` rather than forcing headless here.
 */
export function defineBrowserTestConfig(
  opts: BrowserTestConfigOptions = {},
): TestUserConfig & { __optimizeDepsInclude?: string[] } {
  const {
    contextOptions = {},
    gpuArgs = [],
    gpuMode = 'auto',
    headless = false,
    ui = false,
    instances = [{ browser: 'chromium' }],
    optimizeDeps = [],
    setupFiles,
    name = 'browser',
    include = ['tests/browser/**/*.browser.test.{ts,tsx}'],
    fileParallelism = false,
  } = opts;

  const resolvedHeadless = resolveHeadless(headless);
  const launchProfile = createChromiumLaunchProfile({ gpuMode, args: gpuArgs });
  if (ui && contextOptions.deviceScaleFactor !== undefined) {
    throw new Error(
      'Vitest browser UI uses a null viewport, so contextOptions.deviceScaleFactor is not supported when ui is true',
    );
  }
  const resolvedContextOptions = ui ? contextOptions : { deviceScaleFactor: 1, ...contextOptions };

  const test: TestUserConfig & { __optimizeDepsInclude?: string[] } = {
    name,
    include,
    fileParallelism,
    browser: {
      enabled: true,
      headless: resolvedHeadless,
      ui,
      provider: playwright({
        launchOptions: launchProfile,
        contextOptions: resolvedContextOptions,
      }),
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
