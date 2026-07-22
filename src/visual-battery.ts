import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export interface VisualBatteryOptions {
  /** CI mode: refuses to run with a dirty baseline dir, fails on drift instead of updating. */
  ci?: boolean;
  /** Repo root the git commands run relative to. Defaults to `process.cwd()`. */
  cwd?: string;
  /** The `pnpm test:browser`-equivalent command to shell out to (without the file args). Defaults to `'pnpm test:browser'`. */
  testCommand?: string;
  /** Where the baseline PNGs land, relative to `cwd`. Defaults to `${harnessGlob}/__screenshots__`. */
  baselinesDir?: string;
  /**
   * Harness basenames that each need a fresh browser process. Use this for
   * WebGL screenshots whose renderer state can drift after earlier canvases
   * have shared a long-lived Chromium process.
   */
  isolatedHarnessFiles?: string[];
  /** Logger, swappable for tests. Defaults to `console.log`/`console.error`. */
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

export class VisualBatteryError extends Error {}

function findUnexpectedBaselineDirectories(root: string, expected: string): string[] {
  const unexpected: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = resolve(directory, entry.name);
      if (child === expected) continue;
      if (entry.name === '__screenshots__') {
        unexpected.push(child);
        continue;
      }
      visit(child);
    }
  };

  visit(root);
  return unexpected;
}

function defaultLog(msg: string): void {
  console.log(`[visual-battery] ${msg}`);
}
function defaultError(msg: string): void {
  console.error(`[visual-battery] ERROR: ${msg}`);
}

/**
 * Deterministic git-diff-based visual-regression gate.
 *
 * Runs every `.browser.test.tsx` harness file under `harnessDir`, then
 * diffs the resulting `__screenshots__/*.png` baselines against what's
 * committed in git. No pixel-threshold fuzzing, no flaky perceptual
 * comparison — a screenshot either byte-matches the committed baseline
 * (via `git status --porcelain`) or it doesn't.
 *
 * - Update mode (`ci: false`, the default): runs the harnesses, lets new
 *   baselines land on disk, reports what changed so a human can review
 *   `git diff` and commit intentionally.
 * - CI mode (`ci: true`): refuses to run at all if the baselines dir has
 *   uncommitted changes already (an untrusted starting state), then fails
 *   the process if the run produces any drift from the committed baseline.
 *
 * Throws `VisualBatteryError` on any failure condition instead of calling
 * `process.exit` directly, so callers (tests, other tooling) can catch it;
 * the CLI entry point (`bin/test-harness-visual-battery`) is the thing that
 * exits the process.
 */
export function runVisualBattery(harnessDir: string, options: VisualBatteryOptions = {}): void {
  const {
    ci = false,
    cwd = process.cwd(),
    testCommand = 'pnpm test:browser',
    isolatedHarnessFiles = [],
    log = defaultLog,
    error = defaultError,
  } = options;

  const HARNESS_DIR = resolve(cwd, harnessDir);
  const relativeHarnessDir = harnessDir.replace(/^\.\//, '').replace(/\/$/, '');
  const BASELINES_DIR = resolve(
    cwd,
    options.baselinesDir ?? `${relativeHarnessDir}/__screenshots__`,
  );
  const relativeBaselinesDir = options.baselinesDir ?? `${relativeHarnessDir}/__screenshots__`;

  const die = (msg: string): never => {
    error(msg);
    throw new VisualBatteryError(msg);
  };

  if (!existsSync(HARNESS_DIR)) {
    die(`harness dir not found: ${HARNESS_DIR}`);
  }

  const unexpectedBaselineDirectories = findUnexpectedBaselineDirectories(
    HARNESS_DIR,
    BASELINES_DIR,
  );
  if (unexpectedBaselineDirectories.length > 0) {
    die(
      `unexpected screenshot director${unexpectedBaselineDirectories.length === 1 ? 'y' : 'ies'} outside ${relativeBaselinesDir}: ${unexpectedBaselineDirectories
        .map((directory) => relative(cwd, directory))
        .join(', ')}`,
    );
  }

  const harnessFiles = readdirSync(HARNESS_DIR)
    .filter((f) => f.endsWith('.browser.test.tsx'))
    .map((f) => `${relativeHarnessDir}/${f}`);

  if (harnessFiles.length === 0) {
    die('no harness files found');
  }

  const unknownIsolatedHarnessFiles = isolatedHarnessFiles.filter(
    (file) => !harnessFiles.some((harnessFile) => harnessFile.endsWith(`/${file}`)),
  );
  if (unknownIsolatedHarnessFiles.length > 0) {
    die(`isolated harness file(s) not found: ${unknownIsolatedHarnessFiles.join(', ')}`);
  }

  const isolatedHarnessSet = new Set(isolatedHarnessFiles);
  const batchedHarnessFiles = harnessFiles.filter(
    (file) => !isolatedHarnessSet.has(file.slice(file.lastIndexOf('/') + 1)),
  );
  const isolatedHarnessPaths = harnessFiles.filter((file) =>
    isolatedHarnessSet.has(file.slice(file.lastIndexOf('/') + 1)),
  );

  log(`running ${harnessFiles.length} harness file(s):`);
  for (const f of harnessFiles) log(`  - ${f}`);

  if (ci) {
    let beforeStatus = '';
    try {
      beforeStatus = execSync(`git status --porcelain ${relativeBaselinesDir}/`, {
        cwd,
        encoding: 'utf-8',
      });
    } catch (err) {
      die(`git status failed: ${err}`);
    }
    if (beforeStatus.trim().length > 0) {
      die(
        `${relativeBaselinesDir}/ has uncommitted changes before run — commit or reset before --ci mode`,
      );
    }
  }

  const runHarnessFiles = (files: string[], label: string): void => {
    if (files.length === 0) return;
    log(`running ${label}: ${testCommand} ${files.join(' ')}...`);
    try {
      execSync(`${testCommand} ${files.join(' ')}`, { cwd, stdio: 'inherit' });
    } catch {
      die('one or more harnesses failed — fix the failing test before re-running visual battery');
    }
  };

  runHarnessFiles(batchedHarnessFiles, 'batched harnesses');
  for (const isolatedHarnessPath of isolatedHarnessPaths) {
    runHarnessFiles([isolatedHarnessPath], `isolated harness ${isolatedHarnessPath}`);
  }

  if (!existsSync(BASELINES_DIR)) {
    die(`baselines dir not created: ${BASELINES_DIR}`);
  }
  const baselineCount = readdirSync(BASELINES_DIR).filter((f) => f.endsWith('.png')).length;
  log(`baseline screenshots produced: ${baselineCount}`);

  const afterStatus = execSync(`git status --porcelain ${relativeBaselinesDir}/`, {
    cwd,
    encoding: 'utf-8',
  });

  if (afterStatus.trim().length === 0) {
    log('baselines clean — no visual drift detected.');
    return;
  }

  if (ci) {
    error('DRIFT DETECTED in CI mode:');
    error(afterStatus);
    error(`failing — run visual:battery locally + commit baselines`);
    throw new VisualBatteryError('visual drift detected in CI mode');
  }

  log(`baselines updated — ${afterStatus.split('\n').filter(Boolean).length} file(s) changed:`);
  log(afterStatus);
  log(`review the diff with \`git diff ${relativeBaselinesDir}/\` then commit if intended.`);
  log('CI gate: rerun with `ci: true` will fail until the updated baselines are committed.');

  log('baseline file sizes:');
  for (const f of readdirSync(BASELINES_DIR)) {
    if (!f.endsWith('.png')) continue;
    const path = resolve(BASELINES_DIR, f);
    const size = statSync(path).size;
    log(`  ${f}  ${size} bytes`);
  }
}
