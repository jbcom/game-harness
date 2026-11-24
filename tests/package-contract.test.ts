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
const productionRuntimeSource = readFileSync(
  new URL('../src/production-runtime.ts', import.meta.url),
  'utf8',
);
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
  it('declares the widest supported Node range and the package manager', () => {
    // version is release-please's to manage -- assert shape, not an exact
    // value, so a routine release doesn't break this contract test.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest).toMatchObject({
      name: 'game-harness',
      engines: { node: '>=22' },
      packageManager: 'pnpm@11.23.0',
    });
  });

  it('pins the browser-tool matrix to exact, mutually consistent versions', () => {
    // The contract is that the toolchain is pinned exactly and that the vitest
    // family moves together. The numbers themselves belong to the dependency
    // group, so a routine bump must not break this test.
    const exact = /^\d+\.\d+\.\d+$/;
    const toolchain = [
      '@playwright/test',
      '@types/node',
      '@vitest/browser-playwright',
      '@vitest/coverage-v8',
      'rimraf',
      'typescript',
      'vitest',
    ];
    for (const name of toolchain) {
      expect(manifest.devDependencies[name], name).toMatch(exact);
    }

    const { vitest } = manifest.devDependencies;
    expect(manifest.devDependencies['@vitest/browser-playwright']).toBe(vitest);
    expect(manifest.devDependencies['@vitest/coverage-v8']).toBe(vitest);
    expect(manifest.devDependencies.typescript).toMatch(/^7\./);
    expect(manifest.devDependencies['@types/node']).toMatch(/^24\./);
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
        './playwright/xvfb-setup',
        './silent-qa',
        './production-runtime',
        './chromium',
        './lighthouse',
        './release-ladder',
        './visual-battery',
        './subject-capture',
        './subject-pictures',
        './touch',
        './android-webview',
      ]),
    );
  });

  it('keeps scripted touch and the Android WebView forward free of any framework peer', () => {
    for (const file of ['touch.ts', 'android-webview.ts']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/from '(?:@playwright|playwright|vitest|@vitest)/u);
    }
    expect(rootSource).not.toContain("'./touch.js'");
  });

  it('keeps the subject-picture staleness check free of any browser peer', () => {
    const picturesSource = readFileSync(
      new URL('../src/subject-pictures.ts', import.meta.url),
      'utf8',
    );
    expect(picturesSource).not.toMatch(/from '(?:@playwright|playwright|vitest|@vitest)/u);
    expect(rootSource).toContain("'./subject-pictures.js'");
    expect(rootSource).not.toContain("'./subject-capture.js'");
  });

  it('keeps the Xvfb globalSetup peer-free so it can be named as a plain file path', () => {
    const xvfbSource = readFileSync(new URL('../src/xvfb-setup.ts', import.meta.url), 'utf8');
    expect(xvfbSource).not.toMatch(/from '(?:@playwright|playwright|vitest|@vitest)/u);
    expect(JSON.stringify(manifest.exports['./playwright/xvfb-setup'])).toContain('xvfb-setup');
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

  it('keeps production-runtime declarations independent of DOM-only WebGL aliases', () => {
    // The public declaration is emitted directly from this source. Using the
    // literal union keeps downstream type-checks from requiring
    // WebGLPowerPreference solely to read runtime diagnostics.
    expect(productionRuntimeSource).not.toContain('WebGLPowerPreference');
    expect(productionRuntimeSource).toContain(
      "powerPreference?: 'default' | 'high-performance' | 'low-power' | undefined;",
    );
  });
});
