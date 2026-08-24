import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds an env object for a clean, credential-free npm invocation: HOME
 * points at an empty scratch directory (no ambient .npmrc, no cached auth)
 * and NPM_CONFIG_USERCONFIG pins npm at the supplied anonymous .npmrc.
 */
function createAnonymousEnvironment({ home, userConfig }) {
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    NPM_CONFIG_USERCONFIG: userConfig,
    npm_config_userconfig: userConfig,
  };
}

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const packageName = packageManifest.name;
const packagePathSegments = packageName.split('/');
const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scratchPrefix = join(tmpdir(), 'game-harness-');
const scratchDir = mkdtempSync(scratchPrefix);
if (!scratchDir.startsWith(scratchPrefix)) {
  throw new Error(`refusing to clean unexpected scratch path: ${scratchDir}`);
}
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const anonymousConfig = join(scratchDir, 'anonymous.npmrc');
writeFileSync(
  anonymousConfig,
  ['registry=https://registry.npmjs.org/', 'audit=false', 'fund=false', ''].join('\n'),
);
const npmEnvironment = createAnonymousEnvironment({
  home: join(scratchDir, 'home'),
  userConfig: anonymousConfig,
});

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: npmEnvironment,
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
  const npmVersion = execFileSync(npmCommand, ['--version'], {
    cwd: packageDir,
    encoding: 'utf8',
    env: npmEnvironment,
  }).trim();
  const npmMajor = Number.parseInt(npmVersion.split('.')[0], 10);
  // A floor, not an exact pin: the supported Node range (engines.node)
  // spans several LTS lines, each bundling a different npm. What this test
  // actually protects is modern, workspace-safe `npm pack`/`npm install`
  // behavior, which npm 10+ (Node 22's bundled version) already provides.
  if (!Number.isInteger(npmMajor) || npmMajor < 10) {
    throw new Error(`package verifier requires npm >=10, got ${npmVersion}`);
  }

  run(npmCommand, ['pack', '--pack-destination', scratchDir], packageDir);
  const tarball = readdirSync(scratchDir).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not produce a tarball');
  // npm derives the tarball name from the package name: a leading @scope/ is
  // flattened to scope- and the slash dropped, matching `npm pack`'s own rule.
  const tarballStem = packageManifest.name.replace(/^@/, '').replace('/', '-');
  const expectedTarball = `${tarballStem}-${packageManifest.version}.tgz`;
  if (tarball !== expectedTarball) {
    throw new Error(`npm pack produced ${tarball}, expected ${expectedTarball}`);
  }
  const tarballPath = join(scratchDir, tarball);
  const registryConsumerSource = process.env.TEST_HARNESS_CONSUMER_SOURCE;
  if (
    registryConsumerSource &&
    !new RegExp(`^${escapedPackageName}@\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$`).test(
      registryConsumerSource,
    )
  ) {
    throw new Error(`TEST_HARNESS_CONSUMER_SOURCE must be an exact ${packageName} package spec`);
  }
  const consumerSource = registryConsumerSource ?? tarballPath;

  const rootConsumer = createConsumer('peer-free-root-consumer');
  run(npmCommand, ['install', consumerSource, '--ignore-scripts'], rootConsumer);
  const installedLicense = readFileSync(
    join(rootConsumer, 'node_modules', ...packagePathSegments, 'LICENSE'),
    'utf8',
  );
  if (!installedLicense.includes('Copyright (c) 2026 Jon Bogaty')) {
    throw new Error('installed package-local LICENSE is missing the expected copyright');
  }
  assertMissing(rootConsumer, '@playwright/test');
  assertMissing(rootConsumer, 'vitest');
  assertMissing(rootConsumer, '@vitest/browser-playwright');
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness'); if(typeof h.verifyReleaseLadder!=='function'||'definePlaywrightConfig'in h||'defineBrowserTestConfig'in h)throw new Error('invalid CJS root')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness/chromium'); const p=h.createChromiumLaunchProfile({gpuMode:'software'}); if(p.args.at(-1)!=='--mute-audio'||!p.args.includes('--use-gl=swiftshader'))throw new Error('invalid CJS Chromium entry')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness/chromium'); const p=h.createChromiumLaunchProfile({gpuMode:'linux-hardware-vulkan'}); if(p.env.EGL_PLATFORM!=='surfaceless'||p.args.at(-1)!=='--mute-audio')throw new Error('invalid ESM Chromium entry')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness'); if(typeof h.lighthouseAssertions!=='function'||'definePlaywrightConfig'in h||'defineBrowserTestConfig'in h)throw new Error('invalid ESM root')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness/silent-qa'); const events=[]; const active=h.activateSilentQa(()=>events.push('mute'),{search:'?muted=1',markerTarget:{setAttribute:(name,value)=>events.push(name+'='+value)}}); if(!active||events.join(',')!=='mute,data-audio-mode=muted-test'||!h.isSilentQaActive())throw new Error('invalid CJS silent-QA entry')",
    ],
    rootConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness/silent-qa'); const events=[]; const active=h.activateSilentQa(()=>events.push('mute'),{search:'?muted=1',markerTarget:{setAttribute:(name,value)=>events.push(name+'='+value)}}); if(!active||events.join(',')!=='mute,data-audio-mode=muted-test'||!h.isSilentQaActive())throw new Error('invalid ESM silent-QA entry')",
    ],
    rootConsumer,
  );
  run(
    join(rootConsumer, 'node_modules', '.bin', `game-harness-visual-battery${binSuffix}`),
    ['--help'],
    rootConsumer,
  );
  run(
    join(rootConsumer, 'node_modules', '.bin', `test-harness-visual-battery${binSuffix}`),
    ['--help'],
    rootConsumer,
  );

  const playwrightConsumer = createConsumer('playwright-only-consumer');
  run(
    npmCommand,
    ['install', consumerSource, '@playwright/test@1.62.1', '--ignore-scripts'],
    playwrightConsumer,
  );
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness/production-runtime'); (async()=>{if(typeof h.verifyProductionRuntime!=='function'||typeof h.findAvailableProductionPort!=='function'||typeof h.ProductionRuntimeVerificationError!=='function'||typeof h.requireHardwareWebGL!=='function')throw new Error('invalid CJS production-runtime entry'); const [a,b]=await Promise.all([h.findAvailableProductionPort(),h.findAvailableProductionPort()]); if(!Number.isInteger(a)||a<1||a>65535||a===b)throw new Error('invalid CJS production-runtime port allocation')})()",
    ],
    playwrightConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness/production-runtime'); if(typeof h.verifyProductionRuntime!=='function'||typeof h.findAvailableProductionPort!=='function'||typeof h.ProductionRuntimeVerificationError!=='function'||typeof h.requireHardwareWebGL!=='function')throw new Error('invalid ESM production-runtime entry'); const [a,b]=await Promise.all([h.findAvailableProductionPort(),h.findAvailableProductionPort()]); if(!Number.isInteger(a)||a<1||a>65535||a===b)throw new Error('invalid ESM production-runtime port allocation')",
    ],
    playwrightConsumer,
  );
  assertMissing(playwrightConsumer, 'vitest');
  assertMissing(playwrightConsumer, '@vitest/browser-playwright');
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness/playwright'); const p=h.resolvePlaywrightPort({localPort:4399,environment:{CI:'1',GITHUB_REPOSITORY:'example-org/example-game',GITHUB_RUN_ID:'1955',GITHUB_JOB:'verify'}}); if(typeof h.definePlaywrightConfig!=='function'||typeof h.resolvePlaywrightPort!=='function'||!Number.isInteger(p)||p<20000||p>=30000||typeof h.openSilentGame!=='function'||h.silentTestUrl('/game?seed=1')!=='/game?seed=1&muted=1')throw new Error('invalid CJS Playwright entry')",
    ],
    playwrightConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness/playwright'); const p=h.resolvePlaywrightPort({localPort:4399,environment:{CI:'1',GITHUB_REPOSITORY:'example-org/example-game',GITHUB_RUN_ID:'1955',GITHUB_JOB:'verify'}}); if(typeof h.definePlaywrightConfig!=='function'||typeof h.resolvePlaywrightPort!=='function'||!Number.isInteger(p)||p<20000||p>=30000||typeof h.openSilentGame!=='function'||h.silentTestUrl('/game?seed=1')!=='/game?seed=1&muted=1')throw new Error('invalid ESM Playwright entry')",
    ],
    playwrightConsumer,
  );

  const vitestConsumer = createConsumer('vitest-browser-only-consumer');
  run(
    npmCommand,
    [
      'install',
      consumerSource,
      'vitest@4.1.10',
      '@vitest/browser-playwright@4.1.10',
      'playwright@1.62.1',
      '--ignore-scripts',
    ],
    vitestConsumer,
  );
  assertMissing(vitestConsumer, '@playwright/test');
  run(
    process.execPath,
    [
      '-e',
      "const h=require('@jbdevprimary/game-harness/vitest'); const c=h.defineBrowserTestConfig(); const a=c.browser.provider.options.launchOptions.args; if(typeof h.defineBrowserTestConfig!=='function'||a.at(-1)!=='--mute-audio')throw new Error('invalid CJS Vitest Browser entry')",
    ],
    vitestConsumer,
  );
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h=await import('@jbdevprimary/game-harness/vitest'); const c=h.defineBrowserTestConfig(); const a=c.browser.provider.options.launchOptions.args; if(typeof h.defineBrowserTestConfig!=='function'||a.at(-1)!=='--mute-audio')throw new Error('invalid ESM Vitest Browser entry')",
    ],
    vitestConsumer,
  );

  console.log(
    'Package boundary smoke passed for peer-free root/silent QA, Playwright/production-runtime, and Vitest Browser consumers.',
  );
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
