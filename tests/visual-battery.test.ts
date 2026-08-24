import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runVisualBattery, VisualBatteryError } from '../src/visual-battery.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
vi.mock('cross-spawn', () => ({
  default: Object.assign(vi.fn(), { sync: vi.fn() }),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedSpawnSync = vi.mocked(spawn.sync);
const noop = (): void => undefined;
const quiet = { log: noop, error: noop };

function commandLine(command: unknown, args: unknown): string {
  return [String(command), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
}

describe('runVisualBattery', () => {
  let cwd: string;
  let harnessDir: string;
  let baselinesDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'visual-battery-test-'));
    harnessDir = join(cwd, 'tests/harness');
    baselinesDir = join(harnessDir, '__screenshots__');
    mkdirSync(harnessDir, { recursive: true });
    mkdirSync(baselinesDir, { recursive: true });
    writeFileSync(join(harnessDir, 'foo.browser.test.tsx'), '// harness');
    writeFileSync(join(baselinesDir, 'foo.png'), 'fake-png-bytes');
    mockedExecFileSync.mockReset();
    mockedSpawnSync.mockReset();
    mockedSpawnSync.mockImplementation((command, args, options) => {
      try {
        mockedExecFileSync(command, args, options as never);
        return { status: 0 } as ReturnType<typeof spawn.sync>;
      } catch (error) {
        return {
          status: null,
          error: error instanceof Error ? error : new Error(String(error)),
        } as ReturnType<typeof spawn.sync>;
      }
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('throws when the harness dir does not exist', () => {
    expect(() => runVisualBattery('tests/does-not-exist', { cwd, ...quiet })).toThrow(
      VisualBatteryError,
    );
  });

  it('reports an invalid cwd through the documented error contract', () => {
    const errors: string[] = [];
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd: join(cwd, 'missing-cwd'),
        log: noop,
        error: (message) => errors.push(message),
      }),
    ).toThrow(VisualBatteryError);
    expect(errors).toEqual([expect.stringMatching(/cwd not found/)]);
  });

  it('rejects harness and baseline paths outside the repository cwd', () => {
    expect(() => runVisualBattery('../outside', { cwd, ...quiet })).toThrow(
      /harness dir must stay inside cwd/,
    );
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd,
        baselinesDir: '../outside',
        ...quiet,
      }),
    ).toThrow(/baselines dir must stay inside cwd/);
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd,
        baselinesDir,
        ...quiet,
      }),
    ).toThrow(/baselines dir must be relative/);
  });

  it('rejects a harness symlink that resolves outside cwd', () => {
    const outside = mkdtempSync(join(tmpdir(), 'visual-battery-outside-'));
    const link = join(cwd, 'linked-harness');
    try {
      const externalHarness = join(outside, 'harness');
      mkdirSync(externalHarness);
      symlinkSync(externalHarness, link, process.platform === 'win32' ? 'junction' : 'dir');

      expect(() => runVisualBattery('linked-harness', { cwd, ...quiet })).toThrow(
        /harness dir must stay inside cwd/,
      );
    } finally {
      if (existsSync(link)) unlinkSync(link);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a baseline symlink that resolves outside cwd', () => {
    const outside = mkdtempSync(join(tmpdir(), 'visual-battery-outside-'));
    const link = join(harnessDir, 'linked-baselines');
    try {
      symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

      expect(() =>
        runVisualBattery('tests/harness', {
          cwd,
          baselinesDir: 'tests/harness/linked-baselines',
          ...quiet,
        }),
      ).toThrow(/baselines dir must stay inside cwd/);
    } finally {
      if (existsSync(link)) unlinkSync(link);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a harness path that is a file', () => {
    const filePath = join(cwd, 'not-a-directory');
    writeFileSync(filePath, 'file');
    expect(() => runVisualBattery('not-a-directory', { cwd, ...quiet })).toThrow(/not a directory/);
  });

  it('throws when no browser harness files are found', () => {
    rmSync(join(harnessDir, 'foo.browser.test.tsx'));
    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(VisualBatteryError);
  });

  it('rejects screenshot directories nested outside the owned baseline directory', () => {
    const misplaced = join(harnessDir, 'tests/harness/__screenshots__');
    mkdirSync(misplaced, { recursive: true });
    writeFileSync(join(misplaced, 'missed.png'), 'misplaced-png-bytes');

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /unexpected screenshot director/i,
    );
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('pluralizes the error when multiple misplaced screenshot directories are found', () => {
    const misplacedA = join(harnessDir, 'nested-a/__screenshots__');
    const misplacedB = join(harnessDir, 'nested-b/__screenshots__');
    mkdirSync(misplacedA, { recursive: true });
    mkdirSync(misplacedB, { recursive: true });
    writeFileSync(join(misplacedA, 'a.png'), 'a-png-bytes');
    writeFileSync(join(misplacedB, 'b.png'), 'b-png-bytes');

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /unexpected screenshot directories/i,
    );
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('CI mode refuses to run with a dirty baseline dir', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (commandLine(cmd, args).startsWith('git status'))
        return ' M tests/harness/__screenshots__/foo.png\n';
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ci: true, ...quiet })).toThrow(
      /uncommitted changes/,
    );
  });

  it('CI mode fails closed when the pre-run git status check itself fails', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (commandLine(cmd, args).startsWith('git status')) {
        throw new Error('fatal: not a git repository');
      }
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ci: true, ...quiet })).toThrow(
      /git status failed.*not a git repository/,
    );
  });

  it('runs the test command with the discovered harness files', () => {
    let ranCommand = '';
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      ranCommand = cmdStr;
      return '';
    });

    runVisualBattery('tests/harness', { cwd, ...quiet });
    expect(ranCommand).toContain('tests/harness/foo.browser.test.tsx');
  });

  it('discovers TypeScript harness files without JSX', () => {
    writeFileSync(join(harnessDir, 'behavior.browser.test.ts'), '// behavior harness');
    let ranCommand = '';
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      ranCommand = cmdStr;
      return '';
    });

    runVisualBattery('tests/harness', { cwd, ...quiet });

    expect(ranCommand).toContain('tests/harness/behavior.browser.test.ts');
  });

  it('supports the repository root as the harness directory', () => {
    rmSync(join(cwd, 'tests'), { recursive: true, force: true });
    mkdirSync(join(cwd, '__screenshots__'));
    writeFileSync(join(cwd, 'root.browser.test.ts'), '// root harness');
    writeFileSync(join(cwd, '__screenshots__/root.png'), 'root-png-bytes');
    let ranCommand = '';
    mockedExecFileSync.mockImplementation((command, args) => {
      const commandText = commandLine(command, args);
      if (command === 'git') return '';
      ranCommand = commandText;
      return '';
    });

    runVisualBattery('.', { cwd, ...quiet });

    expect(ranCommand).toContain('./root.browser.test.ts');
  });

  it('uses a custom testCommand when provided', () => {
    let ranCommand = '';
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      ranCommand = cmdStr;
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      testCommand: 'npm run test:browser',
      ...quiet,
    });
    expect(ranCommand.startsWith('npm run test:browser')).toBe(true);
  });

  it('supports a direct command object without shell interpolation', () => {
    let executable = '';
    let invocationArgs: readonly string[] = [];
    mockedExecFileSync.mockImplementation((command, args) => {
      if (command === 'git') return '';
      executable = String(command);
      invocationArgs = args as string[];
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      testCommand: {
        command: 'custom-runner',
        args: ['--project', 'game with spaces'],
      },
      ...quiet,
    });

    expect(executable).toBe('custom-runner');
    expect(invocationArgs).toEqual([
      '--project',
      'game with spaces',
      'tests/harness/foo.browser.test.tsx',
    ]);
  });

  it('supports a direct command object without fixed arguments', () => {
    let invocationArgs: readonly string[] = [];
    mockedExecFileSync.mockImplementation((command, args) => {
      if (command === 'git') return '';
      invocationArgs = args as string[];
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      testCommand: { command: 'custom-runner' },
      ...quiet,
    });

    expect(invocationArgs).toEqual(['tests/harness/foo.browser.test.tsx']);
  });

  it('resolves Windows command shims without enabling shell interpolation', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    if (!platformDescriptor) throw new Error('process.platform descriptor unavailable');
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    mockedExecFileSync.mockReturnValue('');
    mockedSpawnSync.mockReturnValue({ status: 0 } as ReturnType<typeof spawn.sync>);

    try {
      runVisualBattery('tests/harness', { cwd, ...quiet });
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'pnpm',
      ['test:browser', 'tests/harness/foo.browser.test.tsx'],
      expect.objectContaining({ cwd, stdio: 'inherit' }),
    );
  });

  it('fails closed when a Windows command shim errors or exits non-zero', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    if (!platformDescriptor) throw new Error('process.platform descriptor unavailable');
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    mockedExecFileSync.mockReturnValue('');

    try {
      mockedSpawnSync.mockReturnValueOnce({
        error: new Error('spawn failed'),
      } as ReturnType<typeof spawn.sync>);
      expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
        /one or more harnesses failed/,
      );

      mockedSpawnSync.mockReturnValueOnce({ status: 1 } as ReturnType<typeof spawn.sync>);
      expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
        /one or more harnesses failed/,
      );
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  it('rejects empty string and object commands', () => {
    expect(() => runVisualBattery('tests/harness', { cwd, testCommand: '  ', ...quiet })).toThrow(
      /test command must not be empty/,
    );
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd,
        testCommand: { command: '  ' },
        ...quiet,
      }),
    ).toThrow(/test command executable must not be empty/);
  });

  it('scopes byte-exact baselines and the browser test environment to a profile', () => {
    const linuxBaselinesDir = join(baselinesDir, 'linux');
    mkdirSync(linuxBaselinesDir, { recursive: true });
    writeFileSync(join(linuxBaselinesDir, 'foo.png'), 'linux-png-bytes');
    const statusCommands: string[] = [];
    let browserEnv: NodeJS.ProcessEnv | undefined;
    mockedExecFileSync.mockImplementation((cmd, args, options) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) {
        statusCommands.push(cmdStr);
        return '';
      }
      browserEnv = options?.env;
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      ci: true,
      baselineProfile: 'linux',
      ...quiet,
    });

    expect(statusCommands).toHaveLength(2);
    expect(statusCommands.every((command) => command.includes('__screenshots__/linux'))).toBe(true);
    expect(browserEnv?.VITE_VISUAL_BASELINE_PROFILE).toBe('linux');
  });

  it('appends a profile below a custom baseline root', () => {
    rmSync(baselinesDir, { recursive: true });
    const customRoot = join(harnessDir, 'visual-baselines');
    const linuxBaselinesDir = join(customRoot, 'linux');
    mkdirSync(linuxBaselinesDir, { recursive: true });
    writeFileSync(join(linuxBaselinesDir, 'foo.png'), 'linux-png-bytes');
    const statusCommands: string[] = [];
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const command = commandLine(cmd, args);
      if (command.startsWith('git status')) statusCommands.push(command);
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      ci: true,
      baselinesDir: 'tests/harness/visual-baselines',
      baselineProfile: 'linux',
      ...quiet,
    });

    expect(statusCommands).toHaveLength(2);
    expect(statusCommands.every((command) => command.includes('visual-baselines/linux'))).toBe(
      true,
    );
  });

  it('rejects a baseline profile that could escape the owned directory', () => {
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd,
        baselineProfile: '../linux',
        ...quiet,
      }),
    ).toThrow(/invalid baseline profile/i);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('runs selected harnesses in fresh browser processes', () => {
    writeFileSync(join(harnessDir, 'webgl.browser.test.tsx'), '// WebGL harness');
    const ranCommands: string[] = [];
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      ranCommands.push(cmdStr);
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      isolatedHarnessFiles: ['webgl.browser.test.tsx'],
      ...quiet,
    });

    expect(ranCommands).toHaveLength(2);
    expect(ranCommands[0]).toContain('foo.browser.test.tsx');
    expect(ranCommands[0]).not.toContain('webgl.browser.test.tsx');
    expect(ranCommands[1]).toContain('webgl.browser.test.tsx');
    expect(ranCommands[1]).not.toContain('foo.browser.test.tsx');
  });

  it('skips the batched run entirely when every discovered harness file is isolated', () => {
    const ranCommands: string[] = [];
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      ranCommands.push(cmdStr);
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      isolatedHarnessFiles: ['foo.browser.test.tsx'],
      ...quiet,
    });

    expect(ranCommands).toHaveLength(1);
    expect(ranCommands[0]).toContain('foo.browser.test.tsx');
  });

  it('rejects an unknown isolated harness name', () => {
    expect(() =>
      runVisualBattery('tests/harness', {
        cwd,
        isolatedHarnessFiles: ['missing.browser.test.tsx'],
        ...quiet,
      }),
    ).toThrow(/isolated harness file.*not found/i);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('reports clean when git status shows no diff after the run', () => {
    const logs: string[] = [];
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (commandLine(cmd, args).startsWith('git status')) return '';
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      log: (m) => logs.push(m),
      error: noop,
    });
    expect(logs.some((l) => l.includes('no visual drift detected'))).toBe(true);
  });

  it('skips non-PNG entries when logging baseline file sizes for an update-mode drift report', () => {
    writeFileSync(join(baselinesDir, 'README.md'), '# not a baseline');
    const logs: string[] = [];
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (commandLine(cmd, args).startsWith('git status'))
        return ' M tests/harness/__screenshots__/foo.png\n';
      return '';
    });

    runVisualBattery('tests/harness', {
      cwd,
      log: (m) => logs.push(m),
      error: noop,
    });

    expect(logs.some((l) => l.includes('foo.png') && l.includes('bytes'))).toBe(true);
    expect(logs.some((l) => l.includes('README.md'))).toBe(false);
  });

  it('throws in CI mode when the run produces drift', () => {
    let callCount = 0;
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) {
        callCount += 1;
        // first call (pre-run dirty check) clean, second call (post-run diff) dirty
        return callCount === 1 ? '' : ' M tests/harness/__screenshots__/foo.png\n';
      }
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ci: true, ...quiet })).toThrow(/drift/i);
  });

  it('does not throw in update mode when the run produces drift, just reports it', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return ' M tests/harness/__screenshots__/foo.png\n';
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).not.toThrow();
  });

  it('throws when the harness test command itself fails', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      throw new Error('test failed');
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /one or more harnesses failed/,
    );
  });

  it('throws when the run completes without ever creating the baselines dir', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      // Simulate a harness command that removes the screenshots directory
      // instead of writing to it (e.g. a misconfigured test run).
      rmSync(baselinesDir, { recursive: true, force: true });
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /baselines dir not created/,
    );
  });

  it('throws when the run produces no PNG baselines', () => {
    rmSync(join(baselinesDir, 'foo.png'));
    mockedExecFileSync.mockReturnValue('');
    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /no PNG baselines produced/,
    );
  });

  it('fails closed when the post-run git status check fails', () => {
    mockedExecFileSync.mockImplementation((command) => {
      if (command === 'git') throw new Error('repository unavailable');
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /git status failed after harness run.*repository unavailable/,
    );
  });

  it('logs through console.log/console.error by default when no logger is supplied', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const cmdStr = commandLine(cmd, args);
      if (cmdStr.startsWith('git status')) return '';
      return '';
    });

    runVisualBattery('tests/harness', { cwd });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[visual-battery]'));
    logSpy.mockRestore();
  });

  it('reports the default console.error prefix on failure when no logger is supplied', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(() => runVisualBattery('tests/does-not-exist', { cwd })).toThrow(VisualBatteryError);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[visual-battery] ERROR: harness dir not found'),
    );
    errorSpy.mockRestore();
  });
});
