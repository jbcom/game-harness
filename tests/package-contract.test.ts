import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  bin: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  name: string;
  packageManager: string;
  version: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;
const rootSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const binShim = readFileSync(
  new URL('../bin/test-harness-visual-battery.mjs', import.meta.url),
  'utf8',
);
const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
const packageVerifier = readFileSync(
  new URL('../scripts/verify-package-boundaries.mjs', import.meta.url),
  'utf8',
);

describe('package peer boundaries', () => {
  it('pins the current browser-tool matrix and declares the widest supported Node range', () => {
    // version is release-please's to manage -- assert shape, not an exact
    // value, so a routine release doesn't break this contract test.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest).toMatchObject({
      name: '@jbdevprimary/game-harness',
      engines: { node: '>=22' },
      packageManager: 'pnpm@11.23.0',
      devDependencies: {
        '@playwright/test': '1.62.1',
        '@types/node': '24.13.3',
        '@vitest/browser-playwright': '4.1.10',
        rimraf: '6.1.3',
        typescript: '7.0.2',
        vitest: '4.1.10',
      },
    });
  });

  it('lets consumers install only the framework peer for their chosen entry point', () => {
    expect(Object.keys(manifest.peerDependenciesMeta ?? {}).sort()).toEqual(
      Object.keys(manifest.peerDependencies).sort(),
    );

    for (const peer of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta?.[peer]?.optional, peer).toBe(true);
    }
  });

  it('keeps the root peer-free and exposes framework integrations only as subpaths', () => {
    expect(rootSource).not.toContain("'./browser-config.js'");
    expect(rootSource).not.toContain("'./playwright-config.js'");

    expect(Object.keys(manifest.exports)).toEqual(
      expect.arrayContaining([
        '.',
        './vitest',
        './playwright',
        './silent-qa',
        './production-runtime',
        './chromium',
        './lighthouse',
        './release-ladder',
        './visual-battery',
      ]),
    );
  });

  it('ships a stable executable shim before generated dist files exist', () => {
    // No leading "./" -- npm publish rejects that form as invalid and
    // silently strips the bin entry from the published tarball (confirmed
    // by publishing 0.4.3 with it and finding an empty bin field on the
    // registry). `npm pkg fix` is the authority on the corrected form.
    expect(manifest.bin['test-harness-visual-battery']).toBe('bin/test-harness-visual-battery.mjs');
    expect(manifest.bin['game-harness-visual-battery']).toBe('bin/test-harness-visual-battery.mjs');
    expect(manifest.files).toContain('AGENTS.md');
    expect(manifest.files).toContain('bin');
    expect(manifest.files).toContain('CHANGELOG.md');
    expect(manifest.files).toContain('docs');
    expect(manifest.files).toContain('llms.txt');
    expect(manifest.files).toContain('LICENSE');
    expect(manifest.files).toContain('README.md');
    expect(binShim).toContain('../dist/esm/bin/visual-battery.js');
    expect(license).toContain('Copyright (c) 2026 Jon Bogaty');
  });

  it('uses the exact npm publish packer from the package directory', () => {
    expect(packageVerifier).toContain('npmMajor < 10');
    expect(packageVerifier).toContain("['pack', '--pack-destination', scratchDir]");
    expect(packageVerifier).toMatch(/\$\{tarballStem\}-\$\{packageManifest\.version\}\.tgz/u);
    expect(packageVerifier).not.toContain("['pack', packageDir");
    expect(packageVerifier).not.toMatch(/pnpm[^\n]*\bpack\b/);
    expect(packageVerifier).not.toContain("'@jbcom'");
    expect(packageVerifier).toContain('packagePathSegments');
  });

  it('provides matching ESM and CommonJS declaration conditions', () => {
    for (const [subpath, definition] of Object.entries(manifest.exports)) {
      if (subpath === './package.json') continue;
      const conditional = definition as {
        import?: { types?: string; default?: string };
        require?: { types?: string; default?: string };
      };
      expect(conditional.import?.types, subpath).toMatch(/\.d\.ts$/);
      expect(conditional.import?.default, subpath).toMatch(/dist\/esm\/.*\.js$/);
      expect(conditional.require?.types, subpath).toMatch(/\.d\.cts$/);
      expect(conditional.require?.default, subpath).toMatch(/dist\/cjs\/.*\.js$/);
    }
  });
});
