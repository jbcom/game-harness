import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import spawn from 'cross-spawn';

export interface VisualBatteryCommand {
  /** Executable invoked directly, without a shell. */
  command: string;
  /** Fixed arguments inserted before the discovered harness paths. */
  args?: readonly string[];
}

export interface VisualBatteryOptions {
  /** CI mode: refuses to run with a dirty baseline dir, fails on drift instead of updating. */
  ci?: boolean;
  /** Repo root the git commands run relative to. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * The `pnpm test:browser`-equivalent command, without harness paths.
   * Strings are split on whitespace for backward compatibility; use the
   * object form when an argument contains spaces. Commands execute directly,
   * never through a shell. Defaults to `'pnpm test:browser'`.
   */
  testCommand?: string | VisualBatteryCommand;
  /** Baseline root relative to `cwd`. Defaults to `${harnessGlob}/__screenshots__`; `baselineProfile` is appended below it. */
  baselinesDir?: string;
  /**
   * Optional platform/profile directory below the baseline root (for example
   * `linux`). The profile is also exposed to Vite browser tests as
   * `VITE_VISUAL_BASELINE_PROFILE`, allowing byte-exact baselines to remain
   * strict on renderers that cannot produce identical PNGs.
   */
  baselineProfile?: string;
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

/**
 * Thrown by every `runVisualBattery()` failure path — a missing harness dir,
 * no discovered `.browser.test.ts(x)` files, a misplaced `__screenshots__`
 * directory, a dirty baseline dir in `--ci` mode, a failing harness run, or
 * detected drift while `ci: true`. Callers (tests, other tooling) can catch
 * this specific type instead of `process.exit`, which only the CLI entry
 * point (`bin/test-harness-visual-battery`) calls.
 */
export class VisualBatteryError extends Error {}

function findUnexpectedBaselineDirectories(root: string, canonical: string): string[] {
  const unexpected: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = resolve(directory, entry.name);
      if (child === canonical) continue;
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

function canonicalizePath(target: string): string {
  const missingSegments: string[] = [];
  let existingAncestor = target;
  while (!existsSync(existingAncestor)) {
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = dirname(existingAncestor);
  }
  return resolve(realpathSync(existingAncestor), ...missingSegments);
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
    baselineProfile,
    isolatedHarnessFiles = [],
    log = defaultLog,
    error = defaultError,
  } = options;

  const HARNESS_DIR = resolve(cwd, harnessDir);
  const relativeHarnessDir = relative(resolve(cwd), HARNESS_DIR).split(sep).join('/') || '.';
  if (baselineProfile && !/^[a-z0-9][a-z0-9_-]*$/i.test(baselineProfile)) {
    throw new VisualBatteryError(`invalid baseline profile: ${baselineProfile}`);
  }
  const relativeBaselinesRoot = options.baselinesDir ?? `${relativeHarnessDir}/__screenshots__`;
  const canonicalBaselinesDir = resolve(cwd, relativeBaselinesRoot);
  const relativeBaselinesDir = baselineProfile
    ? `${relativeBaselinesRoot.replace(/\/$/, '')}/${baselineProfile}`
    : relativeBaselinesRoot;
  const BASELINES_DIR = resolve(cwd, relativeBaselinesDir);
  const canonicalCwd = realpathSync(resolve(cwd));

  const die = (msg: string): never => {
    error(msg);
    throw new VisualBatteryError(msg);
  };

  const assertInsideCwd = (label: string, target: string): void => {
    const pathFromCwd = relative(canonicalCwd, canonicalizePath(target));
    if (pathFromCwd === '..' || pathFromCwd.startsWith(`..${sep}`) || isAbsolute(pathFromCwd)) {
      die(`${label} must stay inside cwd: ${target}`);
    }
  };

  assertInsideCwd('harness dir', HARNESS_DIR);
  assertInsideCwd('baselines dir', BASELINES_DIR);

  if (!existsSync(HARNESS_DIR)) {
    die(`harness dir not found: ${HARNESS_DIR}`);
  }
  if (!statSync(HARNESS_DIR).isDirectory()) {
    die(`harness path is not a directory: ${HARNESS_DIR}`);
  }

  const unexpectedBaselineDirectories = findUnexpectedBaselineDirectories(
    HARNESS_DIR,
    canonicalBaselinesDir,
  );
  if (unexpectedBaselineDirectories.length > 0) {
    die(
      `unexpected screenshot director${unexpectedBaselineDirectories.length === 1 ? 'y' : 'ies'} outside ${relativeBaselinesDir}: ${unexpectedBaselineDirectories
        .map((directory) => relative(cwd, directory))
        .join(', ')}`,
    );
  }

  const harnessFiles = readdirSync(HARNESS_DIR)
    .filter((f) => /\.browser\.test\.(?:ts|tsx)$/.test(f))
    .sort()
    .map((f) => `${relativeHarnessDir}/${f}`);

  if (harnessFiles.length === 0) {
    die('no .browser.test.ts or .browser.test.tsx harness files found');
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
      beforeStatus = execFileSync('git', ['status', '--porcelain', '--', relativeBaselinesDir], {
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
    const command =
      typeof testCommand === 'string'
        ? (() => {
            const parts = testCommand.trim().split(/\s+/u);
            const executable = parts.shift() || die('test command must not be empty');
            return { command: executable, args: parts };
          })()
        : testCommand;
    if (!command.command.trim()) die('test command executable must not be empty');
    const commandArgs = [...(command.args ?? []), ...files];
    log(`running ${label}: ${[command.command, ...commandArgs].join(' ')}...`);
    const environment = {
      ...process.env,
      ...(baselineProfile ? { VITE_VISUAL_BASELINE_PROFILE: baselineProfile } : {}),
    };
    try {
      if (process.platform === 'win32') {
        // Package managers are commonly exposed as .cmd shims on Windows.
        // cross-spawn resolves those shims without opting into shell: true.
        const result = spawn.sync(command.command, commandArgs, {
          cwd,
          stdio: 'inherit',
          env: environment,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`test command exited with ${result.status}`);
      } else {
        execFileSync(command.command, commandArgs, {
          cwd,
          stdio: 'inherit',
          env: environment,
        });
      }
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
  if (baselineCount === 0) {
    die(`no PNG baselines produced in: ${BASELINES_DIR}`);
  }
  log(`baseline screenshots produced: ${baselineCount}`);

  let afterStatus = '';
  try {
    afterStatus = execFileSync('git', ['status', '--porcelain', '--', relativeBaselinesDir], {
      cwd,
      encoding: 'utf-8',
    });
  } catch (err) {
    die(`git status failed after harness run: ${err}`);
  }

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
