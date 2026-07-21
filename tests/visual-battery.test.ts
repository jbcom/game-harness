import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runVisualBattery, VisualBatteryError } from '../src/visual-battery.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);
const noop = (): void => undefined;
const quiet = { log: noop, error: noop };

describe('runVisualBattery', () => {
  let cwd: string;
  let harnessDir: string;
  let baselinesDir: string;

  beforeEach(() => {
    cwd = join(
      tmpdir(),
      `visual-battery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    harnessDir = join(cwd, 'tests/harness');
    baselinesDir = join(harnessDir, '__screenshots__');
    mkdirSync(harnessDir, { recursive: true });
    mkdirSync(baselinesDir, { recursive: true });
    writeFileSync(join(harnessDir, 'foo.browser.test.tsx'), '// harness');
    writeFileSync(join(baselinesDir, 'foo.png'), 'fake-png-bytes');
    mockedExecSync.mockReset();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('throws when the harness dir does not exist', () => {
    expect(() => runVisualBattery('tests/does-not-exist', { cwd, ...quiet })).toThrow(
      VisualBatteryError,
    );
  });

  it('throws when no .browser.test.tsx files are found', () => {
    rmSync(join(harnessDir, 'foo.browser.test.tsx'));
    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(VisualBatteryError);
  });

  it('CI mode refuses to run with a dirty baseline dir', () => {
    mockedExecSync.mockImplementation((cmd) => {
      if (String(cmd).startsWith('git status')) return ' M tests/harness/__screenshots__/foo.png\n';
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ci: true, ...quiet })).toThrow(
      /uncommitted changes/,
    );
  });

  it('runs the test command with the discovered harness files', () => {
    let ranCommand = '';
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status')) return '';
      ranCommand = cmdStr;
      return '';
    });

    runVisualBattery('tests/harness', { cwd, ...quiet });
    expect(ranCommand).toContain('tests/harness/foo.browser.test.tsx');
  });

  it('uses a custom testCommand when provided', () => {
    let ranCommand = '';
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
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

  it('reports clean when git status shows no diff after the run', () => {
    const logs: string[] = [];
    mockedExecSync.mockImplementation((cmd) => {
      if (String(cmd).startsWith('git status')) return '';
      return '';
    });

    runVisualBattery('tests/harness', { cwd, log: (m) => logs.push(m), error: noop });
    expect(logs.some((l) => l.includes('no visual drift detected'))).toBe(true);
  });

  it('throws in CI mode when the run produces drift', () => {
    let callCount = 0;
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
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
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status')) return ' M tests/harness/__screenshots__/foo.png\n';
      return '';
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).not.toThrow();
  });

  it('throws when the harness test command itself fails', () => {
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr.startsWith('git status')) return '';
      throw new Error('test failed');
    });

    expect(() => runVisualBattery('tests/harness', { cwd, ...quiet })).toThrow(
      /one or more harnesses failed/,
    );
  });
});
