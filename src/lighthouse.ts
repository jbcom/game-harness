export interface LighthouseCiConfig {
  ci: {
    collect: {
      staticDistDir: string;
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
 * import { lighthouseAssertions } from '@jbdevprimary/game-harness';
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

  const staticDistDir = overrides.staticDistDir ?? base.ci.collect.staticDistDir;
  if (staticDistDir !== undefined && !staticDistDir.trim()) {
    throw new TypeError('Lighthouse staticDistDir must not be empty');
  }
  const url = overrides.url ?? base.ci.collect.url;
  if (url.length === 0 || url.some((entry) => !entry.trim())) {
    throw new TypeError('Lighthouse url must contain at least one non-empty URL');
  }
  const numberOfRuns = overrides.numberOfRuns ?? base.ci.collect.numberOfRuns;
  if (!Number.isInteger(numberOfRuns) || numberOfRuns < 1) {
    throw new TypeError('Lighthouse numberOfRuns must be a positive integer');
  }

  return {
    ci: {
      collect: {
        ...base.ci.collect,
        staticDistDir,
        url: [...url],
        numberOfRuns,
        settings: { ...base.ci.collect.settings },
      },
      assert: {
        ...base.ci.assert,
        assertions: {
          ...structuredClone(base.ci.assert.assertions),
          ...overrides.assertions,
        },
      },
      upload: { ...base.ci.upload },
    },
  };
}
