import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  bin: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;
const rootSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const binShim = readFileSync(
  new URL('../bin/test-harness-visual-battery.mjs', import.meta.url),
  'utf8',
);

describe('package peer boundaries', () => {
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
        './lighthouse',
        './release-ladder',
        './visual-battery',
      ]),
    );
  });

  it('ships a stable executable shim before generated dist files exist', () => {
    expect(manifest.bin['test-harness-visual-battery']).toBe(
      './bin/test-harness-visual-battery.mjs',
    );
    expect(manifest.files).toContain('bin');
    expect(binShim).toContain('../dist/esm/bin/visual-battery.js');
  });
});
