export interface LighthouseCiConfig {
  ci: {
    collect: {
      staticDistDir?: string;
      url: string[];
      numberOfRuns: number;
      settings: {
        preset: string;
        chromeFlags: string;
      };
    };
    assert: {
      preset: string;
      assertions: Record<string, unknown>;
    };
    upload: {
      target: string;
    };
  };
}

export interface LighthouseAssertionsOverrides {
  staticDistDir?: string;
  url?: string[];
  numberOfRuns?: number;
  assertions?: Record<string, unknown>;
}

const PRESETS: Record<string, LighthouseCiConfig> = {
  // A production lighthouserc.json, verbatim: perf 0.6 / a11y 0.85 /
  // best-practices 0.7 (warn-level, not error — a score dip surfaces in CI
  // logs without hard-blocking a merge on Lighthouse's inherent run-to-run
  // variance), SEO/PWA assertions off since these are single-page game
  // shells with no SEO surface and no installable-PWA requirement.
  'game-default': {
    ci: {
      collect: {
        staticDistDir: './dist',
        url: ['http://localhost/index.html'],
        numberOfRuns: 3,
        settings: {
          preset: 'desktop',
          chromeFlags: '--no-sandbox --disable-dev-shm-usage --disable-gpu',
        },
      },
      assert: {
        preset: 'lighthouse:no-pwa',
        assertions: {
          'categories:performance': ['warn', { minScore: 0.6 }],
          'categories:accessibility': ['warn', { minScore: 0.85 }],
          'categories:best-practices': ['warn', { minScore: 0.7 }],
          'categories:seo': 'off',
          'uses-responsive-images': 'off',
          'uses-rel-preconnect': 'off',
          'csp-xss': 'off',
        },
      },
      upload: { target: 'temporary-public-storage' },
    },
  },
};

/**
 * Returns a Lighthouse CI (`lighthouserc.json`) config object for a named
 * preset, with an escape hatch for per-repo overrides merged on top.
 *
 * ```ts
 * // lighthouserc.mjs
 * import { lighthouseAssertions } from '@jbcom/game-harness';
 * export default lighthouseAssertions('game-default');
 * ```
 *
 * Or, to keep `lighthouserc.json` as static JSON, run this once and paste
 * the output — the factory has no runtime dependency on the consumer's
 * environment beyond the overrides you pass.
 */
export type LighthousePreset = keyof typeof PRESETS | (string & {});

export function lighthouseAssertions(
  preset: LighthousePreset = 'game-default',
  overrides: LighthouseAssertionsOverrides = {},
): LighthouseCiConfig {
  const base = PRESETS[preset];
  if (!base) {
    throw new Error(
      `unknown lighthouse preset: ${preset}. known presets: ${Object.keys(PRESETS).join(', ')}`,
    );
  }

  return {
    ci: {
      collect: {
        ...base.ci.collect,
        ...(overrides.staticDistDir !== undefined && { staticDistDir: overrides.staticDistDir }),
        ...(overrides.url !== undefined && { url: overrides.url }),
        ...(overrides.numberOfRuns !== undefined && { numberOfRuns: overrides.numberOfRuns }),
      },
      assert: {
        ...base.ci.assert,
        assertions: { ...base.ci.assert.assertions, ...overrides.assertions },
      },
      upload: base.ci.upload,
    },
  };
}
