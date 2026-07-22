import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratchPrefix = join(tmpdir(), 'arcade-test-harness-');
const scratchDir = mkdtempSync(scratchPrefix);
if (!scratchDir.startsWith(scratchPrefix)) {
  throw new Error(`refusing to clean unexpected scratch path: ${scratchDir}`);
}
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnvironment = { ...process.env };
for (const key of [
  'npm_config_auto_install_peers',
  'npm_config_hoist_pattern',
  'npm_config_recursive',
]) {
  delete npmEnvironment[key];
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...npmEnvironment,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
}

function createConsumer(name) {
  const directory = join(scratchDir, name);
  mkdirSync(directory);
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, private: true, version: '0.0.0' }, null, 2)}\n`,
  );
  return directory;
}

function assertMissing(directory, packagePath) {
  const installedPath = join(directory, 'node_modules', ...packagePath.split('/'));
  if (existsSync(installedPath)) {
    throw new Error(`unexpected framework peer installed: ${packagePath}`);
  }
}

try {
  run(npmCommand, ['pack', packageDir, '--pack-destination', scratchDir], packageDir);
  const tarball = readdirSync(scratchDir).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not produce a tarball');
  const tarballPath = join(scratchDir, tarball);

  const rootConsumer = createConsumer('peer-free-root-consumer');
  run(npmCommand, ['install', tarballPath, '--ignore-scripts'], rootConsumer);
  assertMissing(rootConsumer, '@playwright/test');
  assertMissing(rootConsumer, 'vitest');
  assertMissing(rootConsumer, '@vitest/browser-playwright');
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@arcade-cabinet/test-harness'); if(typeof h.verifyReleaseLadder!=='function'||'definePlaywrightConfig'in h||'defineBrowserTestConfig'in h)throw new Error('invalid CJS root')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@arcade-cabinet/test-harness'); if(typeof h.lighthouseAssertions!=='function'||'definePlaywrightConfig'in h||'defineBrowserTestConfig'in h)throw new Error('invalid ESM root')",
    ],
    rootConsumer,
  );
  run(
    join(rootConsumer, 'node_modules', '.bin', 'test-harness-visual-battery'),
    ['--help'],
    rootConsumer,
  );

  const playwrightConsumer = createConsumer('playwright-only-consumer');
  run(
    npmCommand,
    ['install', tarballPath, '@playwright/test@1.60.0', '--ignore-scripts'],
    playwrightConsumer,
  );
  assertMissing(playwrightConsumer, 'vitest');
  assertMissing(playwrightConsumer, '@vitest/browser-playwright');
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@arcade-cabinet/test-harness/playwright'); if(typeof h.definePlaywrightConfig!=='function')throw new Error('invalid CJS Playwright entry')",
    ],
    playwrightConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@arcade-cabinet/test-harness/playwright'); if(typeof h.definePlaywrightConfig!=='function')throw new Error('invalid ESM Playwright entry')",
    ],
    playwrightConsumer,
  );

  console.log('Package boundary smoke passed for peer-free root and Playwright-only consumers.');
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
