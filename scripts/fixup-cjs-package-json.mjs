#!/usr/bin/env node
// Marks dist/cjs as CommonJS (dist/esm inherits the package's top-level
// "type": "module") so Node's dual-package resolution doesn't misinterpret
// the .js files under dist/cjs as ESM.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cjsDir = resolve(import.meta.dirname, '..', 'dist', 'cjs');
mkdirSync(cjsDir, { recursive: true });
writeFileSync(
  resolve(cjsDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

const binPath = resolve(import.meta.dirname, '..', 'dist', 'esm', 'bin', 'visual-battery.js');
try {
  const { chmodSync, existsSync } = await import('node:fs');
  if (existsSync(binPath)) chmodSync(binPath, 0o755);
} catch {
  // best-effort — npm also sets the exec bit on publish for `bin` entries
}

// Node's conditional type resolution needs a CommonJS-flavoured declaration
// entry for every `require` target. TypeScript emits one declaration tree from
// the shared source, so mirror those files with `.d.cts` extensions after emit.
const typesDir = resolve(import.meta.dirname, '..', 'dist', 'types');
const mirrorDeclarations = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      mirrorDeclarations(source);
    } else if (entry.name.endsWith('.d.ts')) {
      copyFileSync(source, `${source.slice(0, -5)}.d.cts`);
    }
  }
};
mirrorDeclarations(typesDir);
